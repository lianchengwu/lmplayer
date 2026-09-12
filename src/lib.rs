//! wmPlayer backend. Desktop shell is GTK4 + WebKitGTK (`src/bin/wmplayer.rs`).
//! Replaces Go HTTP-to-Node with [`kugou::Client`] (Lite).
//!
//! JSON shape matches the old Wails `ApiResponse`.

mod app;
pub mod audio_cache;
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
