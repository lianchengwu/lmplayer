use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, OnceLock};
use zbus::object_server::SignalEmitter;
use zbus::{connection, interface};

#[derive(Clone, Default, Debug, serde::Serialize, serde::Deserialize)]
pub struct LyricPayload {
    pub song_name: String,
    pub artist: String,
    pub lyric: String,
    pub format: String,
    pub current_time: f64,
}

#[derive(Default)]
pub struct LyricState {
    pub payload: LyricPayload,
    pub is_playing: bool,
    pub is_locked: bool,
}

static LYRIC_STATE: LazyLock<RwLock<LyricState>> =
    LazyLock::new(|| RwLock::new(LyricState::default()));
static OSD_ENABLED: AtomicBool = AtomicBool::new(false);
static OSD_LOCKED: AtomicBool = AtomicBool::new(false);
static DBUS_CONN: OnceLock<connection::Connection> = OnceLock::new();

pub struct LyricDbus;

impl LyricDbus {
    pub fn new() -> Self {
        Self
    }
}

#[interface(name = "org.wmplayer.Lyric")]
impl LyricDbus {
    #[zbus(property)]
    async fn song_name(&self) -> String {
        LYRIC_STATE.read().payload.song_name.clone()
    }

    #[zbus(property)]
    async fn artist(&self) -> String {
        LYRIC_STATE.read().payload.artist.clone()
    }

    #[zbus(property)]
    async fn lyric(&self) -> String {
        LYRIC_STATE.read().payload.lyric.clone()
    }

    #[zbus(property)]
    async fn format(&self) -> String {
        LYRIC_STATE.read().payload.format.clone()
    }

    #[zbus(property)]
    async fn is_playing(&self) -> bool {
        LYRIC_STATE.read().is_playing
    }
    #[zbus(property)]
    async fn is_osd_enabled(&self) -> bool {
        OSD_ENABLED.load(Ordering::Relaxed)
    }

    #[zbus(property)]
    async fn is_locked(&self) -> bool {
        OSD_LOCKED.load(Ordering::Relaxed)
    }

    #[zbus(property)]
    async fn color(&self) -> String {
        crate::osd::get_osd_color()
    }

    async fn set_color(&self, color: String) {
        crate::osd::set_osd_color(&color);
    }
    #[zbus(signal)]
    pub async fn lyric_updated(
        emitter: &SignalEmitter<'_>,
        song_name: &str,
        artist: &str,
        lyric: &str,
        format: &str,
    ) -> zbus::Result<()>;

    async fn toggle_play_pause(&self) {
        crate::osd::send_player_action(PlayerAction::TogglePlayPause);
    }

    async fn next(&self) {
        crate::osd::send_player_action(PlayerAction::Next);
    }

    async fn previous(&self) {
        crate::osd::send_player_action(PlayerAction::Previous);
    }

    async fn toggle_osd(&self) {
        let new_state = !OSD_ENABLED.load(Ordering::Relaxed);
        set_osd_enabled(new_state);
    }

    async fn toggle_lock(&self) {
        crate::osd::toggle_osd_lock();
    }

    async fn set_locked(&self, locked: bool) {
        crate::osd::set_osd_locked(locked);
    }
}

#[derive(Clone, Copy, Debug)]
pub enum PlayerAction {
    TogglePlayPause,
    Next,
    Previous,
}

static ACTION_TX: OnceLock<std::sync::mpsc::Sender<PlayerAction>> = OnceLock::new();

pub fn register_action_sender(tx: std::sync::mpsc::Sender<PlayerAction>) {
    let _ = ACTION_TX.set(tx);
}

pub fn send_player_action(action: PlayerAction) {
    if let Some(tx) = ACTION_TX.get() {
        let _ = tx.send(action);
    }
}

pub async fn start_dbus_service() -> zbus::Result<()> {
    let lyric_iface = LyricDbus::new();
    let conn = connection::Builder::session()?
        .name("org.wmplayer.Lyric")?
        .serve_at("/org/wmplayer/Lyric", lyric_iface)?
        .build()
        .await?;

    let _ = DBUS_CONN.set(conn);
    eprintln!("✅ [D-Bus] Registered org.wmplayer.Lyric on session bus");
    Ok(())
}

pub fn is_osd_enabled() -> bool {
    OSD_ENABLED.load(Ordering::Relaxed)
}

pub fn is_osd_locked() -> bool {
    OSD_LOCKED.load(Ordering::Relaxed)
}

pub fn set_osd_locked(locked: bool) {
    OSD_LOCKED.store(locked, Ordering::Relaxed);
    if let Some(tx) = OSD_CMD_TX.get() {
        let _ = tx.send(OsdCommand::SetLocked(locked));
    }
}

pub fn toggle_osd_lock() -> bool {
    let new_locked = !OSD_LOCKED.load(Ordering::Relaxed);
    set_osd_locked(new_locked);
    new_locked
}

pub fn set_osd_color(color: &str) {
    if let Some(tx) = OSD_CMD_TX.get() {
        let _ = tx.send(OsdCommand::SetColor(color.to_string()));
    }
}

pub fn get_osd_color() -> String {
    crate::osd_window::load_config().color
}

pub fn set_osd_enabled(enabled: bool) {
    OSD_ENABLED.store(enabled, Ordering::Relaxed);
    notify_osd_visibility(enabled);
}

// OSD window communication channel
pub enum OsdCommand {
    UpdateLyrics(LyricPayload),
    SetVisible(bool),
    SetLocked(bool),
    ToggleLock,
    SetColor(String),
}

static OSD_CMD_TX: OnceLock<std::sync::mpsc::Sender<OsdCommand>> = OnceLock::new();

pub fn register_osd_cmd_sender(tx: std::sync::mpsc::Sender<OsdCommand>) {
    let _ = OSD_CMD_TX.set(tx);
}

fn notify_osd_visibility(visible: bool) {
    if let Some(tx) = OSD_CMD_TX.get() {
        let _ = tx.send(OsdCommand::SetVisible(visible));
    }
}

pub fn update_lyrics(text: &str, song: &str, artist: &str, current_time: f64) {
    let format = if text.contains("]<") || (text.contains('<') && text.contains('>')) {
        "krc".to_string()
    } else {
        "lrc".to_string()
    };

    let payload = LyricPayload {
        song_name: song.to_string(),
        artist: artist.to_string(),
        lyric: text.to_string(),
        format: format.clone(),
        current_time,
    };

    // 1. Update memory state
    {
        let mut st = LYRIC_STATE.write();
        st.payload = payload.clone();
        st.is_playing = true;
    }

    // 2. Notify internal GTK4 OSD window
    if let Some(tx) = OSD_CMD_TX.get() {
        let _ = tx.send(OsdCommand::UpdateLyrics(payload));
    }

    // 3. Emit D-Bus signal for external subscribers (KDE Plasma plugin)
    if let Some(conn) = DBUS_CONN.get() {
        let conn = conn.clone();
        let song_str = song.to_string();
        let artist_str = artist.to_string();
        let lyric_str = text.to_string();
        let fmt_str = format.clone();

        tokio::spawn(async move {
            let iface_ref = conn
                .object_server()
                .interface::<_, LyricDbus>("/org/wmplayer/Lyric")
                .await;
            if let Ok(iface) = iface_ref {
                let emitter = iface.signal_emitter();
                let _ = LyricDbus::lyric_updated(
                    &emitter,
                    &song_str,
                    &artist_str,
                    &lyric_str,
                    &fmt_str,
                )
                .await;
            }
        });
    }
}
