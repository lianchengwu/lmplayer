use serde_json::json;

use crate::http::{Call, Response};
use crate::proto::{now_ms, now_s, sign_params_key};
use crate::{Client, Result};

impl Client {
    pub async fn search_lyric(&self, hash: impl Into<String>) -> Result<Response> {
        let hash = hash.into();
        self.execute(
            Call::get("/v1/search")
                .base("https://lyrics.kugou.com")
                .query("album_audio_id", 0)
                .query("appid", self.appid())
                .query("clientver", self.clientver())
                .query("duration", 0)
                .query("hash", hash)
                .query("keyword", "")
                .query("lrctxt", 1)
                .query("man", "no")
                .skip_defaults(),
        )
        .await
    }

    pub async fn personal_fm(&self, p: crate::PersonalFmParams) -> Result<Response> {
        let t = now_ms();
        let key = sign_params_key(&t.to_string(), self.appid(), self.clientver(), self.platform);
        let mode = if p.mode.is_empty() { "normal" } else { p.mode.as_str() };
        let action = if p.action.is_empty() { "play" } else { p.action.as_str() };
        let session = self.session();
        let mut body = json!({
            "appid": self.appid(),
            "clienttime": t,
            "mid": self.device.mid,
            "action": action,
            "recommend_source_locked": 0,
            "song_pool_id": p.song_pool_id,
            "callerid": 0,
            "m_type": 1,
            "platform": "ios",
            "area_code": 1,
            "remain_songcnt": p.remain_songcnt,
            "clientver": self.clientver(),
            "is_overplay": if p.is_overplay { 1 } else { 0 },
            "mode": mode,
            "fakem": "ca981cfc583a4c37f28d2d49000013c16a0a",
            "key": key,
        });
        if let Some(uid) = session.user_id().and_then(|s| s.parse::<i64>().ok()) {
            body["userid"] = json!(uid);
            body["kguid"] = json!(uid);
        }
        if let Some(token) = session.token() {
            body["token"] = json!(token);
        }
        if let Some(vip) = session.vip_type() {
            if vip != "0" {
                body["vip_type"] = json!(vip);
            }
        }
        if !p.hash.is_empty() {
            body["hash"] = json!(p.hash);
        }
        if !p.songid.is_empty() {
            body["songid"] = json!(p.songid);
        }
        if p.playtime > 0 {
            body["playtime"] = json!(p.playtime);
        }
        self.execute(
            Call::post("/v2/personal_recommend")
                .json(body)?
                .router("persnfm.service.kugou.com"),
        )
        .await
    }

    pub async fn everyday_recommend(&self, platform: &str) -> Result<Response> {
        self.execute(
            Call::post("/everyday_song_recommend")
                .query("platform", platform)
                .router("everydayrec.service.kugou.com"),
        )
        .await
    }

    pub async fn ai_recommend(&self, album_audio_id: &str) -> Result<Response> {
        let t = now_ms();
        let key = sign_params_key(&t.to_string(), self.appid(), self.clientver(), self.platform);
        let recommend_source: Vec<serde_json::Value> = album_audio_id
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    return None;
                }
                s.parse::<i64>().ok().filter(|n| *n > 0).map(|id| json!({ "ID": id }))
            })
            .collect();
        self.execute(
            Call::post("/recommend")
                .json(json!({
                    "platform": "ios",
                    "clientver": self.clientver(),
                    "clienttime": t,
                    "userid": self.session_userid_json(),
                    "client_playlist": [],
                    "source_type": 2,
                    "playlist_ver": 2,
                    "area_code": 1,
                    "appid": self.appid(),
                    "key": key,
                    "mid": self.device.mid,
                    "recommend_source": recommend_source,
                }))?
                .router("songlistairec.kugou.com")
                .skip_defaults(),
        )
        .await
    }

    pub async fn album_detail(&self, id: impl Into<serde_json::Value>) -> Result<Response> {
        self.execute(
            Call::post("/kmr/v2/albums")
                .json(json!({
                    "data": [{ "album_id": id.into() }],
                    "is_buy": 0,
                    "fields": "album_id,album_name,publish_date,sizable_cover,intro,language,is_publish,heat,type,quality,authors,exclusive,author_name,trans_param,publish_company,category",
                }))?
                .header("x-router", "openapi.kugou.com")
                .header("kg-tid", "255"),
        )
        .await
    }

    pub async fn album_songs(&self, id: impl Into<serde_json::Value>, page: u32, pagesize: u32) -> Result<Response> {
        self.execute(
            Call::post("/v1/album_audio/lite")
                .json(json!({
                    "album_id": id.into(),
                    "is_buy": "",
                    "page": page.max(1),
                    "pagesize": pagesize.max(1),
                }))?
                .header("x-router", "openapi.kugou.com")
                .header("kg-tid", "255"),
        )
        .await
    }

    pub async fn playlist_detail(&self, ids: &str) -> Result<Response> {
        let data: Vec<serde_json::Value> = ids
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| json!({ "global_collection_id": s }))
            .collect();
        self.execute(
            Call::post("/v3/get_list_info")
                .json(json!({
                    "data": data,
                    "userid": self.session_userid_json(),
                    "token": self.session_token(),
                }))?
                .router("pubsongs.kugou.com"),
        )
        .await
    }

    pub async fn playlist_track_all(&self, id: impl Into<serde_json::Value>, page: u32, pagesize: u32) -> Result<Response> {
        let pagesize = pagesize.max(1);
        let page = page.max(1);
        self.execute(
            Call::get("/pubsongs/v2/get_other_list_file_nofilt")
                .query("area_code", 1)
                .query("begin_idx", i64::from((page - 1) * pagesize))
                .query("plat", 1)
                .query("type", 1)
                .query("mode", 1)
                .query("personal_switch", 1)
                .query("extend_fields", "abtags,hot_cmt,popularization")
                .query("pagesize", i64::from(pagesize))
                .query("global_collection_id", id.into()),
        )
        .await
    }

    pub async fn playlist_track_all_new(&self, listid: impl Into<serde_json::Value>, page: u32, pagesize: u32) -> Result<Response> {
        self.execute(
            Call::post("/v4/get_list_all_file")
                .json(json!({
                    "listid": listid.into(),
                    "userid": self.session_userid_json(),
                    "area_code": 1,
                    "show_relate_goods": 0,
                    "pagesize": pagesize.max(1),
                    "allplatform": 1,
                    "show_cover": 1,
                    "type": 0,
                    "token": self.session_token(),
                    "page": page.max(1),
                }))?
                .router("cloudlist.service.kugou.com"),
        )
        .await
    }

    pub async fn playlist_tracks_add(&self, listid: impl Into<serde_json::Value>, data: serde_json::Value) -> Result<Response> {
        let t = now_s();
        let uid = self.session_userid_json();
        let token = self.session_token();
        self.execute(
            Call::post("/cloudlist.service/v6/add_song")
                .query("last_time", t)
                .query("last_area", "gztx")
                .query("userid", uid.clone())
                .query("token", token.clone())
                .json(json!({
                    "userid": uid,
                    "token": token,
                    "listid": listid.into(),
                    "list_ver": 0,
                    "type": 0,
                    "slow_upload": 1,
                    "scene": "false;null",
                    "data": data,
                }))?,
        )
        .await
    }

    pub async fn user_playlist(&self, page: u32, pagesize: u32) -> Result<Response> {
        let uid = self.session_userid_json();
        let token = self.session_token();
        self.execute(
            Call::post("/v7/get_all_list")
                .query("plat", 1)
                .query("userid", uid.clone())
                .query("token", token.clone())
                .json(json!({
                    "userid": uid,
                    "token": token,
                    "total_ver": 979,
                    "type": 2,
                    "page": page.max(1),
                    "pagesize": pagesize.max(1),
                }))?
                .router("cloudlist.service.kugou.com"),
        )
        .await
    }

    pub async fn top_album(&self, page: u32, pagesize: u32) -> Result<Response> {
        self.execute(
            Call::post("/musicadservice/v1/mobile_newalbum_sp")
                .json(json!({
                    "apiver": 20,
                    "token": self.session_token(),
                    "page": page.max(1),
                    "pagesize": pagesize.max(1),
                    "withpriv": 1,
                }))?,
        )
        .await
    }

    pub async fn top_song(&self, rank_id: i64, page: u32, pagesize: u32) -> Result<Response> {
        self.execute(
            Call::post("/musicadservice/container/v1/newsong_publish")
                .json(json!({
                    "rank_id": rank_id,
                    "userid": self.session_userid_json(),
                    "page": page.max(1),
                    "pagesize": pagesize.max(1),
                    "tags": [],
                }))?,
        )
        .await
    }

    pub async fn top_card(&self, card_id: i64) -> Result<Response> {
        let t = now_ms();
        let fakem = "60f7ebf1f812edbac3c63a7310001701760f";
        let key = sign_params_key(&t.to_string(), self.appid(), self.clientver(), self.platform);
        self.execute(
            Call::post("/singlecardrec.service/v1/single_card_recommend")
                .query("card_id", card_id)
                .query("fakem", fakem)
                .query("area_code", 1)
                .query("platform", "ios")
                .json(json!({
                    "appid": self.appid(),
                    "clientver": self.clientver(),
                    "platform": "android",
                    "clienttime": t,
                    "userid": self.session_userid_json(),
                    "key": key,
                    "fakem": fakem,
                    "area_code": 1,
                    "mid": self.device.mid,
                    "uuid": "-",
                    "client_playlist": [],
                    "u_info": "a0c35cd40af564444b5584c2754dedec",
                }))?,
        )
        .await
    }

    /// 概念版歌曲推荐. card_id: 3001 私人 / 3004 宝藏 / 3005 潮流 / 3006 VIP / 3014 TA也喜欢 / 3101 概念er新推.
    pub async fn top_card_youth(&self, card_id: i64, pagesize: u32) -> Result<Response> {
        self.execute(
            Call::post("/youth/v1/song/single_card_recommend")
                .query("card_id", card_id)
                .query("area_code", 1)
                .query("platform", "ios")
                .query("module_id", 1)
                .query("ver", "v2")
                .query("pagesize", i64::from(pagesize.max(1)))
                .query("clientver", 11490)
                .json(json!({
                    "tagid": "",
                    "u_info": "",
                    "source_mixsong": "",
                }))?,
        )
        .await
    }

    pub async fn user_vip_detail(&self) -> Result<Response> {
        self.execute(
            Call::get("/v1/get_union_vip")
                .base("https://kugouvip.kugou.com")
                .query("busi_type", "concept"),
        )
        .await
    }

    pub async fn youth_day_vip(&self, receive_day: impl AsRef<str>) -> Result<Response> {
        let receive_day = receive_day.as_ref();
        self.execute(
            Call::post("/youth/v1/recharge/receive_vip_listen_song")
                .query("source_id", 90139)
                .query("receive_day", receive_day)
                .header("content-type", "application/x-www-form-urlencoded"),
        )
        .await
    }
}
