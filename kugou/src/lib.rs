//! KuGou Music client.
//!
//! Protocol (signing, AES/RSA, device fingerprint) stays crate-private.
//! Domain APIs are typed builders on [`Client`]. Anything missing can go through
//! [`Client::execute`] + [`Call`].
//!
//! ```ignore
//! use kugou::Client;
//!
//! # async fn demo() -> kugou::Result<()> {
//! let kg = Client::new()?;
//! let page = kg.search("海阔天空").page(1).pagesize(2).send().await?;
//! for song in page.songs {
//!     println!("{} — {}", song.singer, song.name);
//! }
//! # Ok(())
//! # }
//! ```

mod api;
mod client;
mod device;
mod error;
mod http;
mod platform;
mod proto;
mod session;
mod types;

pub use api::{LyricRequest, SearchPage, SearchRequest, SongUrlRequest};
pub use client::{Builder as ClientBuilder, Client};
pub use device::Device;
pub use error::{Error, Result};
pub use http::{Body, Call, Response, SignKind};
pub use platform::Platform;
pub use proto::{decode_krc, decode_krc_base64};
pub use session::Session;
pub use types::{PersonalFmParams, Quality, SearchKind, Song};

pub use serde_json::{json, Value};
