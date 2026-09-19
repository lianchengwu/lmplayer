use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "linux")]
use parking_lot::Mutex;
#[cfg(target_os = "linux")]
use std::sync::LazyLock;
#[cfg(target_os = "linux")]
use zbus::connection::Connection;
#[cfg(target_os = "linux")]
use zbus::zvariant::OwnedFd;

#[cfg(target_os = "linux")]
struct InhibitorHandles {
    login1_fd: Option<OwnedFd>,
    pm_cookie: Option<u32>,
}

#[cfg(target_os = "linux")]
static HANDLES: LazyLock<Mutex<InhibitorHandles>> = LazyLock::new(|| {
    Mutex::new(InhibitorHandles {
        login1_fd: None,
        pm_cookie: None,
    })
});

#[cfg(target_os = "macos")]
use parking_lot::Mutex;
#[cfg(target_os = "macos")]
use std::sync::LazyLock;
#[cfg(target_os = "macos")]
static CAFFEINATE_CHILD: LazyLock<Mutex<Option<std::process::Child>>> = LazyLock::new(|| Mutex::new(None));

static IS_PLAYING: AtomicBool = AtomicBool::new(false);
static INHIBITED: AtomicBool = AtomicBool::new(false);

/// Check whether sleep is currently inhibited
pub fn is_inhibited() -> bool {
    INHIBITED.load(Ordering::Relaxed)
}

/// Check whether playback is currently marked as active
pub fn is_playing() -> bool {
    IS_PLAYING.load(Ordering::Relaxed)
}

/// Update playback state and acquire or release sleep inhibitors accordingly
pub fn set_playback_state(playing: bool) {
    let prev = IS_PLAYING.swap(playing, Ordering::Relaxed);
    if prev == playing {
        return;
    }

    if playing {
        acquire_inhibitors();
    } else {
        release_inhibitors();
    }
}

/// Acquire sleep inhibitors
fn acquire_inhibitors() {
    if INHIBITED.swap(true, Ordering::Relaxed) {
        return; // Already inhibited
    }

    #[cfg(target_os = "linux")]
    {
        tokio::spawn(async move {
            // 1. Inhibit systemd-logind via System Bus (handles system-wide suspend/idle sleep)
            let login1_fd = match Connection::system().await {
                Ok(sys_conn) => {
                    match sys_conn
                        .call_method(
                            Some("org.freedesktop.login1"),
                            "/org/freedesktop/login1",
                            Some("org.freedesktop.login1.Manager"),
                            "Inhibit",
                            &("sleep:idle", "wmplayer", "正在播放音乐", "block"),
                        )
                        .await
                    {
                        Ok(reply) => match reply.body().deserialize::<OwnedFd>() {
                            Ok(fd) => {
                                eprintln!("✅ [SleepInhibitor] systemd-logind sleep:idle inhibited");
                                Some(fd)
                            }
                            Err(e) => {
                                eprintln!("⚠️ [SleepInhibitor] Failed to deserialize logind fd: {e}");
                                None
                            }
                        },
                        Err(e) => {
                            eprintln!("⚠️ [SleepInhibitor] logind Inhibit call failed: {e}");
                            None
                        }
                    }
                }
                Err(e) => {
                    eprintln!("⚠️ [SleepInhibitor] Could not connect to system bus: {e}");
                    None
                }
            };

            // 2. Inhibit Desktop Power Management via Session Bus (KDE PowerDevil / Freedesktop)
            let pm_cookie = match Connection::session().await {
                Ok(sess_conn) => {
                    match sess_conn
                        .call_method(
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "/org/freedesktop/PowerManagement/Inhibit",
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "Inhibit",
                            &("wmplayer", "正在播放音乐"),
                        )
                        .await
                    {
                        Ok(reply) => match reply.body().deserialize::<u32>() {
                            Ok(cookie) => {
                                eprintln!("✅ [SleepInhibitor] PowerManagement inhibited (cookie={cookie})");
                                Some(cookie)
                            }
                            Err(e) => {
                                eprintln!("⚠️ [SleepInhibitor] Failed to deserialize PM cookie: {e}");
                                None
                            }
                        },
                        Err(e) => {
                            eprintln!("⚠️ [SleepInhibitor] PowerManagement Inhibit call failed: {e}");
                            None
                        }
                    }
                }
                Err(e) => {
                    eprintln!("⚠️ [SleepInhibitor] Could not connect to session bus: {e}");
                    None
                }
            };

            // If playback stopped while we were connecting/calling DBus, immediately release
            if !IS_PLAYING.load(Ordering::Relaxed) {
                eprintln!("ℹ️ [SleepInhibitor] Playback stopped before acquisition completed; releasing immediately");
                drop(login1_fd);
                if let Some(cookie) = pm_cookie {
                    if let Ok(sess_conn) = Connection::session().await {
                        let _ = sess_conn
                            .call_method(
                                Some("org.freedesktop.PowerManagement.Inhibit"),
                                "/org/freedesktop/PowerManagement/Inhibit",
                                Some("org.freedesktop.PowerManagement.Inhibit"),
                                "UnInhibit",
                                &(cookie,),
                            )
                            .await;
                    }
                }
                INHIBITED.store(false, Ordering::Relaxed);
                return;
            }

            let mut handles = HANDLES.lock();
            handles.login1_fd = login1_fd;
            handles.pm_cookie = pm_cookie;
        });
    }

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn SetThreadExecutionState(esFlags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;
        const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
        eprintln!("✅ [SleepInhibitor] Windows SetThreadExecutionState (ES_SYSTEM_REQUIRED)");
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, caffeinate -i -s inhibits idle sleep and system sleep
        if let Ok(child) = std::process::Command::new("caffeinate")
            .args(["-i", "-s"])
            .spawn()
        {
            let mut guard = CAFFEINATE_CHILD.lock();
            *guard = Some(child);
            eprintln!("✅ [SleepInhibitor] macOS caffeinate spawned");
        }
    }
}

/// Release all active sleep inhibitors
fn release_inhibitors() {
    if !INHIBITED.swap(false, Ordering::Relaxed) {
        return; // Not currently inhibited
    }

    #[cfg(target_os = "linux")]
    {
        let (login1_fd, pm_cookie) = {
            let mut handles = HANDLES.lock();
            (handles.login1_fd.take(), handles.pm_cookie.take())
        };

        // Dropping login1_fd closes the file descriptor, which informs logind to remove the lock
        drop(login1_fd);

        if let Some(cookie) = pm_cookie {
            tokio::spawn(async move {
                if let Ok(sess_conn) = Connection::session().await {
                    let _ = sess_conn
                        .call_method(
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "/org/freedesktop/PowerManagement/Inhibit",
                            Some("org.freedesktop.PowerManagement.Inhibit"),
                            "UnInhibit",
                            &(cookie,),
                        )
                        .await;
                    eprintln!("✅ [SleepInhibitor] PowerManagement uninhibited (cookie={cookie})");
                }
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn SetThreadExecutionState(esFlags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
        eprintln!("✅ [SleepInhibitor] Windows SetThreadExecutionState (ES_CONTINUOUS)");
    }

    #[cfg(target_os = "macos")]
    {
        let mut guard = CAFFEINATE_CHILD.lock();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("✅ [SleepInhibitor] macOS caffeinate stopped");
        }
    }

    eprintln!("✅ [SleepInhibitor] Released sleep inhibitors");
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
            assert!(stdout.lines().any(|l| l.contains(&pid_str) && l.contains("sleep:idle")), "systemd-inhibit should list current test process inhibitor");
        }

        set_playback_state(false);
        assert!(!is_playing());
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        assert!(!is_inhibited());

        #[cfg(target_os = "linux")]
        if let Ok(out) = std::process::Command::new("systemd-inhibit").arg("--list").output() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let pid_str = std::process::id().to_string();
            assert!(!stdout.lines().any(|l| l.contains(&pid_str)), "systemd-inhibit should have released current test process inhibitor");
        }
    }
}
