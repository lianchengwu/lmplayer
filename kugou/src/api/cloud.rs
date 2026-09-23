use serde_json::json;

use crate::http::{Body, Call, Response};
use crate::proto::{
    json_bytes, now_s, playlist_aes_decrypt_bytes, playlist_aes_encrypt_raw, rsa_pkcs1_encrypt,
    sign_cloud_key, sign_params_key,
};
use crate::{Client, Result};

impl Client {
    /// 获取用户云盘音乐列表 (`/user/cloud`)
    pub async fn user_cloud(&self, page: u32, pagesize: u32) -> Result<Response> {
        let session = self.session();
        let token = session.token().unwrap_or("").to_string();
        let userid: i64 = session.user_id().and_then(|s| s.parse().ok()).unwrap_or(0);
        let clienttime = now_s();

        let data = json!({
            "page": page.max(1),
            "pagesize": pagesize.max(1),
            "getkmr": 1,
        });

        let (enc, raw_ct) = playlist_aes_encrypt_raw(&data)?;
        let p_json = json!({
            "aes": enc.key,
            "uid": userid,
            "token": token,
        });
        let p = rsa_pkcs1_encrypt(&json_bytes(&p_json), self.rsa_pem())?.to_uppercase();
        let key = sign_params_key(
            &clienttime.to_string(),
            self.appid(),
            self.clientver(),
            self.platform,
        );

        let mut res = self
            .execute(
                Call::post("/v1/get_list")
                    .base("https://mcloudservice.kugou.com")
                    .query("clienttime", clienttime)
                    .query("mid", self.device.mid.clone())
                    .query("key", key)
                    .query("clientver", self.clientver())
                    .query("appid", self.appid())
                    .query("p", p)
                    .body(Body::bytes(raw_ct))
                    .skip_defaults()
                    .unsigned()
                    .raw_bytes(),
            )
            .await?;

        if let Some(raw) = &res.raw {
            res.body = playlist_aes_decrypt_bytes(raw, &enc.key)?;
        }
        Ok(res)
    }

    /// 获取云盘音乐播放链接 (`/user/cloud/url`)
    pub async fn user_cloud_url(
        &self,
        hash: impl AsRef<str>,
        name: &str,
        album_audio_id: i64,
    ) -> Result<Response> {
        let hash = hash.as_ref().to_lowercase();
        let key = sign_cloud_key(&hash, "20026");
        self.execute(
            Call::get("/bsstrackercdngz/v2/query_musicclound_url")
                .query("hash", hash)
                .query("ssa_flag", "is_fromtrack")
                .query("version", "20102")
                .query("ssl", 0)
                .query("album_audio_id", album_audio_id)
                .query("pid", 20026)
                .query("audio_id", 0)
                .query("kv_id", 2)
                .query("key", key)
                .query("bucket", "musicclound")
                .query("name", name)
                .query("with_res_tag", 0),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cloud_key_signature() {
        let hash = "0123456789abcdef0123456789abcdef";
        let key = sign_cloud_key(hash, "20026");
        assert!(!key.is_empty());
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn test_cloud_payload_encryption_roundtrip() {
        let data = json!({
            "page": 1,
            "pagesize": 30,
            "getkmr": 1,
        });
        let (enc, raw_ct) = playlist_aes_encrypt_raw(&data).unwrap();
        assert!(!enc.key.is_empty());
        assert!(!raw_ct.is_empty());

        let decrypted = playlist_aes_decrypt_bytes(&raw_ct, &enc.key).unwrap();
        assert_eq!(decrypted["page"], 1);
        assert_eq!(decrypted["pagesize"], 30);
        assert_eq!(decrypted["getkmr"], 1);
    }
}
