use serde_json::json;

use crate::http::{Call, Response};
use crate::proto::{md5_str, now_ms, random_string};
use crate::types::Quality;
use crate::{Client, Platform, Result};

pub struct SongUrlRequest<'a> {
    client: &'a Client,
    hash: String,
    quality: Quality,
    album_id: i64,
    album_audio_id: i64,
    free_part: bool,
}

impl Client {
    pub fn song_url(&self, hash: impl Into<String>) -> SongUrlRequest<'_> {
        SongUrlRequest {
            client: self,
            hash: hash.into().to_lowercase(),
            quality: Quality::P128,
            album_id: 0,
            album_audio_id: 0,
            free_part: false,
        }
    }

    pub async fn song_url_v6(&self, hash: impl Into<String>) -> Result<Response> {
        let hash = hash.into();
        let session = self.session();
        let token = session.token().unwrap_or("").to_string();
        let vip_token = session.vip_token().unwrap_or("").to_string();
        let userid: i64 = session.user_id().and_then(|s| s.parse().ok()).unwrap_or(0);
        let vip_type: i64 = session.vip_type().and_then(|s| s.parse().ok()).unwrap_or(0);
        let dfid = session
            .dfid()
            .map(|s| s.to_string())
            .unwrap_or_else(|| random_string(24));
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set("dfid", &dfid);
        let clienttime_ms = now_ms();
        let mid = self.device.mid.clone();
        let key = md5_str(&format!(
            "{hash}185672dd44712f60bb1736df5a377e82{}{mid}{userid}",
            self.appid()
        ));
        self.execute(
            Call::post("/v6/priv_url")
                .base("http://tracker.kugou.com")
                .json(json!({
                    "area_code": "1",
                    "behavior": "play",
                    "qualities": ["128", "320", "flac", "high", "multitrack", "viper_atmos", "viper_tape", "viper_clear", "super"],
                    "resource": {
                        "album_audio_id": 0,
                        "collect_list_id": "3",
                        "collect_time": clienttime_ms,
                        "hash": hash,
                        "id": 0,
                        "page_id": 1,
                        "type": "audio",
                    },
                    "token": token,
                    "tracker_param": {
                        "all_m": 1,
                        "auth": "",
                        "is_free_part": 0,
                        "key": key,
                        "module_id": 0,
                        "need_climax": 1,
                        "need_xcdn": 1,
                        "open_time": "",
                        "pid": "411",
                        "pidversion": "3001",
                        "priv_vip_type": "6",
                        "viptoken": vip_token,
                    },
                    "userid": userid.to_string(),
                    "vip": vip_type,
                }))?,
        )
        .await
    }
}

impl SongUrlRequest<'_> {
    pub fn quality(mut self, q: Quality) -> Self {
        self.quality = q;
        self
    }

    pub fn album_id(mut self, id: i64) -> Self {
        self.album_id = id;
        self
    }

    pub fn album_audio_id(mut self, id: i64) -> Self {
        self.album_audio_id = id;
        self
    }

    pub fn free_part(mut self, yes: bool) -> Self {
        self.free_part = yes;
        self
    }

    pub async fn send(self) -> Result<Response> {
        let lite = self.client.platform == Platform::Lite;
        let page_id = if lite { 967177915 } else { 151369488 };
        let ppage_id = if lite {
            "356753938,823673182,967485191"
        } else {
            "463467626,350369493,788954147"
        };
        {
            let mut s = self.client.session.lock().unwrap_or_else(|e| e.into_inner());
            if s.dfid().is_none() {
                s.set("dfid", random_string(24));
            }
        }
        self.client
            .execute(
                Call::get("/v5/url")
                    .query("album_id", self.album_id)
                    .query("area_code", 1)
                    .query("hash", self.hash)
                    .query("ssa_flag", "is_fromtrack")
                    .query("version", 11430)
                    .query("page_id", page_id)
                    .query("quality", self.quality.as_str().to_string())
                    .query("album_audio_id", self.album_audio_id)
                    .query("behavior", "play")
                    .query("pid", if lite { 411 } else { 2 })
                    .query("cmd", 26)
                    .query("pidversion", 3001)
                    .query("IsFreePart", if self.free_part { 1 } else { 0 })
                    .query("ppage_id", ppage_id)
                    .query("cdnBackup", 1)
                    .query("module", "")
                    .query("clientver", 11430)
                    .router("trackercdn.kugou.com")
                    .tracker_key(),
            )
            .await
    }
}
