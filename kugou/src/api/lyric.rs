use base64::Engine;

use crate::http::{Call, Response};
use crate::proto::decode_krc_base64;
use crate::{Client, Result};

pub struct LyricRequest<'a> {
    client: &'a Client,
    id: String,
    accesskey: String,
    fmt: String,
    decode: bool,
}

impl Client {
    pub fn lyric(&self, id: impl Into<String>, accesskey: impl Into<String>) -> LyricRequest<'_> {
        LyricRequest {
            client: self,
            id: id.into(),
            accesskey: accesskey.into(),
            fmt: "krc".into(),
            decode: true,
        }
    }
}

impl LyricRequest<'_> {
    pub fn fmt(mut self, fmt: impl Into<String>) -> Self {
        self.fmt = fmt.into();
        self
    }

    pub fn decode(mut self, yes: bool) -> Self {
        self.decode = yes;
        self
    }

    pub async fn send(self) -> Result<Response> {
        let mut res = self
            .client
            .execute(
                Call::get("/download")
                    .base("https://lyrics.kugou.com")
                    .query("ver", 1)
                    .query("client", "android")
                    .query("id", self.id)
                    .query("accesskey", self.accesskey)
                    .query("fmt", self.fmt.as_str())
                    .query("charset", "utf8"),
            )
            .await?;
        if self.decode {
            if let Some(content) = res
                .body
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            {
                let contenttype = res.body.get("contenttype").and_then(|v| v.as_i64()).unwrap_or(0);
                let decoded = if self.fmt == "lrc" || contenttype != 0 {
                    String::from_utf8(
                        base64::engine::general_purpose::STANDARD
                            .decode(&content)
                            .unwrap_or_default(),
                    )
                    .unwrap_or_default()
                } else {
                    decode_krc_base64(&content)
                };
                if let serde_json::Value::Object(m) = &mut res.body {
                    m.insert("decodeContent".into(), serde_json::Value::String(decoded));
                }
            }
        }
        Ok(res)
    }
}
