use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::Mutex;

#[cfg(target_os = "linux")]
use zbus::connection::Connection;
#[cfg(target_os = "linux")]
use zbus::zvariant::OwnedFd;

static IS_PLAYING: AtomicBool = AtomicBool::new(false);
static INHIBITED: AtomicBool = AtomicBool::new(false);
static SENDER: Mutex<Option<tokio::sync::mpsc::UnboundedSender<bool>>> = Mutex::new(None);

/// Check whether sleep is currently inhibited
pub fn is_inhibited() -> bool {
    INHIBITED.load(Ordering::Relaxed)
}

/// Check whether playback is currently marked as active
pub fn is_playing() -> bool {
    IS_PLAYING.load(Ordering::Relaxed)
}

/// Explicitly attach and start the sleep inhibitor worker on the given Tokio runtime
pub fn init_with_runtime(handle: &tokio::runtime::Handle) {
    let mut guard = SENDER.lock();
    if guard.is_none() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        handle.spawn(run_worker(rx));
        *guard = Some(tx);
    }
}

/// Update playback state and acquire or release sleep inhibitors accordingly
pub fn set_playback_state(playing: bool) {
    let prev = IS_PLAYING.swap(playing, Ordering::SeqCst);
    if prev == playing {
        return;
    }

    let mut guard = SENDER.lock();
    if let Some(tx) = guard.as_ref() {
        if tx.send(playing).is_ok() {
            return;
        }
    }

    // Spawn new worker if channel not active yet
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        handle.spawn(run_worker(rx));
        let _ = tx.send(playing);
        *guard = Some(tx);
    }
}

/// Worker loop handling state transitions sequentially, completely eliminating race conditions.
async fn run_worker(mut rx: tokio::sync::mpsc::UnboundedReceiver<bool>) {
    let mut inhibitor = PlatformInhibitor::new();
    let mut currently_inhibited = false;

    while let Some(msg) = rx.recv().await {
        let mut target = msg;
        // Drain queued messages to catch up to the latest desired state
        while let Ok(next) = rx.try_recv() {
            target = next;
        }

        if target && !currently_inhibited {
            inhibitor.acquire().await;
            currently_inhibited = true;
            INHIBITED.store(true, Ordering::SeqCst);

            // Double check if a pause command arrived during async acquire
            while let Ok(next) = rx.try_recv() {
                target = next;
            }
            if !target {
                inhibitor.release().await;
                currently_inhibited = false;
                INHIBITED.store(false, Ordering::SeqCst);
            }
        } else if !target && currently_inhibited {
            inhibitor.release().await;
            currently_inhibited = false;
            INHIBITED.store(false, Ordering::SeqCst);
        }
    }

    if currently_inhibited {
        inhibitor.release().await;
        INHIBITED.store(false, Ordering::SeqCst);
    }
}

// ============================================================================
// Platform-specific implementations
// Requirements:
// 1. Allow screen lock, screen saver, and display sleep on idle ("能够锁屏").
// 2. Prevent system suspend / sleep while music is playing ("不要睡眠").
// ============================================================================

#[cfg(target_os = "linux")]
struct PlatformInhibitor {
    login1_fd: Option<OwnedFd>,
    pm_cookie: Option<u32>,
    gnome_cookie: Option<u32>,
}

#[cfg(target_os = "linux")]
impl PlatformInhibitor {
    fn new() -> Self {
        Self {
            login1_fd: None,
            pm_cookie: None,
            gnome_cookie: None,
        }
    }

    async fn acquire(&mut self) {
        // 1. Inhibit systemd-logind via System Bus (handles system-wide suspend/sleep)
        // Notice: We only inhibit "sleep" (suspend/hibernate), NOT "idle",
        // so that the display can sleep, screensaver can activate, and screen can lock!
        if self.login1_fd.is_none() {
            match Connection::system().await {
                Ok(sys_conn) => {
                    match sys_conn
                        .call_method(
                            Some("org.freedesktop.login1"),
                            "/org/freedesktop/login1",
                            Some("org.freedesktop.login1.Manager"),
                            "Inhibit",
                            &("sleep", "wmplayer", "正在播放音乐", "block"),
                        )
                        .await
                    {
                        Ok(reply) => match reply.body().deserialize::<OwnedFd>() {
                            Ok(fd) => {
                                eprintln!("✅ [SleepInhibitor] systemd-logind sleep inhibited (allows screen lock)");
                                self.login1_fd = Some(fd);
                            }
                            Err(e) => {
                                eprintln!("⚠️ [SleepInhibitor] Failed to deserialize logind fd: {e}");
                            }
                        },
                        Err(e) => {
                            eprintln!("⚠️ [SleepInhibitor] logind Inhibit call failed: {e}");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("⚠️ [SleepInhibitor] Could not connect to system bus: {e}");
                }
            }
        }

        // 2. Inhibit Desktop Power Management via Session Bus
        if let Ok(sess_conn) = Connection::session().await {
            // 2a. KDE / Freedesktop PowerManagement (inhibits sleep/suspend; screensaver is handled separately)
            if self.pm_cookie.is_none() {
                if let Ok(reply) = sess_conn
                    .call_method(
                        Some("org.freedesktop.PowerManagement.Inhibit"),
                        "/org/freedesktop/PowerManagement/Inhibit",
                        Some("org.freedesktop.PowerManagement.Inhibit"),
                        "Inhibit",
                        &("wmplayer", "正在播放音乐"),
                    )
                    .await
                {
                    if let Ok(cookie) = reply.body().deserialize::<u32>() {
                        eprintln!("✅ [SleepInhibitor] KDE PowerManagement inhibited (cookie={cookie})");
                        self.pm_cookie = Some(cookie);
                    }
                }
            }

            // 2b. GNOME SessionManager
            // Flag 4 = Inhibit Suspend. Flag 8 (Inhibit Idle) is intentionally omitted to allow screen lock/idle.
            if self.gnome_cookie.is_none() {
                if let Ok(reply) = sess_conn
                    .call_method(
                        Some("org.gnome.SessionManager"),
                        "/org/gnome/SessionManager",
                        Some("org.gnome.SessionManager"),
                        "Inhibit",
                        &("wmplayer", 0u32, "正在播放音乐", 4u32),
                    )
                    .await
                {
                    if let Ok(cookie) = reply.body().deserialize::<u32>() {
                        eprintln!("✅ [SleepInhibitor] GNOME SessionManager suspend inhibited (cookie={cookie})");
                        self.gnome_cookie = Some(cookie);
                    }
                }
            }
        }
    }

    async fn release(&mut self) {
        // Dropping login1_fd closes the file descriptor, informing logind to remove the lock
        if let Some(fd) = self.login1_fd.take() {
            drop(fd);
            eprintln!("✅ [SleepInhibitor] systemd-logind uninhibited");
        }

        let pm_cookie = self.pm_cookie.take();
        let gnome_cookie = self.gnome_cookie.take();

        if pm_cookie.is_some() || gnome_cookie.is_some() {
            if let Ok(sess_conn) = Connection::session().await {
                if let Some(cookie) = pm_cookie {
                    let _ = sess_conn
                        .call_method(
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "/org/freedesktop/PowerManagement/Inhibit",
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "UnInhibit",
                            &(cookie,),
                        )
                        .await;
                    eprintln!("✅ [SleepInhibitor] KDE PowerManagement uninhibited (cookie={cookie})");
                }
                if let Some(cookie) = gnome_cookie {
                    let _ = sess_conn
                        .call_method(
                            Some("org.gnome.SessionManager"),
                            "/org/gnome/SessionManager",
                            Some("org.gnome.SessionManager"),
                            "Uninhibit",
                            &(cookie,),
                        )
                        .await;
                    eprintln!("✅ [SleepInhibitor] GNOME SessionManager uninhibited (cookie={cookie})");
                }
            }
        }
        eprintln!("✅ [SleepInhibitor] Released sleep inhibitors");
    }
}

#[cfg(target_os = "windows")]
mod windows_power {
    #[repr(C)]
    struct REASON_CONTEXT {
        version: u32,
        flags: u32,
        simple_reason_string: *const u16,
    }
    const POWER_REQUEST_CONTEXT_VERSION: u32 = 0;
    const POWER_REQUEST_CONTEXT_SIMPLE_STRING: u32 = 1;
    const POWER_REQUEST_SYSTEM_REQUIRED: i32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn PowerCreateRequest(context: *const REASON_CONTEXT) -> isize;
        fn PowerSetRequest(power_request: isize, request_type: i32) -> i32;
        fn PowerClearRequest(power_request: isize, request_type: i32) -> i32;
        fn CloseHandle(handle: isize) -> i32;
        fn SetThreadExecutionState(es_flags: u32) -> u32;
    }

    const ES_CONTINUOUS: u32 = 0x80000000;
    const ES_SYSTEM_REQUIRED: u32 = 0x00000001;

    pub struct WindowsInhibitor {
        handle: Option<isize>,
    }

    impl WindowsInhibitor {
        pub fn new() -> Self {
            Self { handle: None }
        }

        pub async fn acquire(&mut self) {
            // 1. Thread execution state (ES_SYSTEM_REQUIRED allows screen lock and monitor power off)
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
            }

            // 2. Process-level power request (visible in `powercfg -requests`, thread-independent)
            if self.handle.is_none() {
                let reason: Vec<u16> = "正在播放音乐\0".encode_utf16().collect();
                let ctx = REASON_CONTEXT {
                    version: POWER_REQUEST_CONTEXT_VERSION,
                    flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                    simple_reason_string: reason.as_ptr(),
                };
                let h = unsafe { PowerCreateRequest(&ctx) };
                if h != 0 && h != -1 {
                    self.handle = Some(h);
                }
            }

            if let Some(h) = self.handle {
                unsafe {
                    PowerSetRequest(h, POWER_REQUEST_SYSTEM_REQUIRED);
                }
            }
            eprintln!("✅ [SleepInhibitor] Windows PowerRequest (SystemRequired, allows lock screen)");
        }

        pub async fn release(&mut self) {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
            if let Some(h) = self.handle.take() {
                unsafe {
                    PowerClearRequest(h, POWER_REQUEST_SYSTEM_REQUIRED);
                    CloseHandle(h);
                }
            }
            eprintln!("✅ [SleepInhibitor] Windows PowerRequest released");
        }
    }
}

#[cfg(target_os = "windows")]
type PlatformInhibitor = windows_power::WindowsInhibitor;

#[cfg(target_os = "macos")]
struct PlatformInhibitor {
    child: Option<std::process::Child>,
}

#[cfg(target_os = "macos")]
impl PlatformInhibitor {
    fn new() -> Self {
        Self { child: None }
    }

    async fn acquire(&mut self) {
        if self.child.is_some() {
            return;
        }
        let pid = std::process::id().to_string();
        // -i: prevent idle sleep
        // -s: prevent system sleep
        // -w <pid>: terminate when this process terminates (avoids orphaned caffeinate)
        // Notice: -d (display sleep) is NOT passed, allowing screen to sleep and lock!
        match std::process::Command::new("caffeinate")
            .args(["-i", "-s", "-w", &pid])
            .spawn()
        {
            Ok(child) => {
                self.child = Some(child);
                eprintln!("✅ [SleepInhibitor] macOS caffeinate spawned (pid={pid}, allows screen lock)");
            }
            Err(e) => {
                eprintln!("⚠️ [SleepInhibitor] Failed to spawn caffeinate: {e}");
            }
        }
    }

    async fn release(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("✅ [SleepInhibitor] macOS caffeinate stopped");
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
struct PlatformInhibitor;

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
impl PlatformInhibitor {
    fn new() -> Self {
        Self
    }
    async fn acquire(&mut self) {}
    async fn release(&mut self) {}
}

#[cfg(test)]
pub static TEST_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_inhibit_toggle() {
        let _guard = TEST_MUTEX.lock();
        set_playback_state(true);
        assert!(is_playing());
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        assert!(is_inhibited());

        #[cfg(target_os = "linux")]
        if let Ok(out) = std::process::Command::new("systemd-inhibit").arg("--list").output() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let pid_str = std::process::id().to_string();
            assert!(
                stdout.lines().any(|l| l.contains(&pid_str) && l.contains("sleep")),
                "systemd-inhibit should list current test process inhibitor"
            );
        }

        set_playback_state(false);
        assert!(!is_playing());
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        assert!(!is_inhibited());

        #[cfg(target_os = "linux")]
        if let Ok(out) = std::process::Command::new("systemd-inhibit").arg("--list").output() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let pid_str = std::process::id().to_string();
            assert!(
                !stdout.lines().any(|l| l.contains(&pid_str)),
                "systemd-inhibit should have released current test process inhibitor"
            );
        }
    }
}