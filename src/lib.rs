//! wmPlayer backend. Linux shell is GTK4 + WebKitGTK; Windows shell is a WebView2 window (`src/bin/wmplayer.rs`).
//! Replaces Go HTTP-to-Node with [`kugou::Client`] (Lite).
//!
//! JSON shape matches the old Wails `ApiResponse`.

mod app;
pub mod audio_cache;
pub mod local_music;
pub mod osd;
pub mod osd_window;
pub mod sleep_inhibitor;
mod home;
mod ipc;
mod login;
mod resp;
mod search;

pub use app::Player;
pub use home::{HomeApi, SongUrlData};
pub use ipc::dispatch;
pub use login::LoginApi;
pub use resp::ApiResponse;
pub use search::SearchApi;


/// Open a URL or filesystem path with the OS handler. External links only; the app window stays put.
pub fn open_with_system(target: impl AsRef<std::ffi::OsStr>) {
    let target = target.as_ref();
    if target.is_empty() {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(target)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(target).spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    }
}
pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Kugou(#[from] kugou::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}
