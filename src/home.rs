use serde::Serialize;
use serde_json::{json, Value};

use crate::resp::{s, ApiResponse};
use crate::Player;

#[derive(Clone, Debug, Default, Serialize)]
pub struct SongUrlData {
    pub urls: Vec<String>,
    pub lyrics: String,
}

pub struct HomeApi<'a> {
    pub player: &'a Player,
}

impl HomeApi<'_> {
    pub async fn song_url(&self, hash: &str) -> ApiResponse<SongUrlData> {
        if hash.is_empty() {
            return ApiResponse::fail("歌曲hash不能为空");
        }
        let url_res = match self.player.kg.song_url(hash).send().await {
            Ok(r) => r,
            Err(e) => return ApiResponse::fail(e.to_string()),
        };
        let mut urls = match url_res.body.get("url") {
            Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
            Some(Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect(),
            _ => Vec::new(),
        };
        if urls.is_empty() {
            if let Ok(cloud_res) = self.player.kg.user_cloud_url(hash, "", 0).await {
                if let Some(arr) = cloud_res.body.pointer("/data/url").and_then(|v| v.as_array()) {
                    urls = arr.iter().filter_map(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
                } else if let Some(s) = cloud_res.body.pointer("/data/url").and_then(|v| v.as_str()) {
                    if !s.is_empty() {
                        urls = vec![s.to_string()];
                    }
                }
            }
        }
        if urls.is_empty() {
            return ApiResponse::fail(format!("无播放地址: {}", url_res.body));
        }
        let lyrics = self.lyrics_for(hash).await.unwrap_or_default();
        ApiResponse::ok("获取播放地址成功", SongUrlData { urls, lyrics })
    }

    async fn lyrics_for(&self, hash: &str) -> Option<String> {
        let found = self.player.kg.search_lyric(hash).await.ok()?;
        let cand = found
            .body
            .pointer("/candidates/0")
            .or_else(|| found.data().get("candidates").and_then(|v| v.get(0)))?;
        let id = s(cand.get("id"));
        let accesskey = s(cand.get("accesskey"));
        if id.is_empty() || accesskey.is_empty() {
            return None;
        }
        let ly = self
            .player
            .kg
            .lyric(id, accesskey)
            .fmt("krc")
            .decode(true)
            .send()
            .await
            .ok()?;
        ly.body
            .get("decodeContent")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    pub async fn personal_fm(&self, p: kugou::PersonalFmParams) -> ApiResponse<Value> {
        match self.player.kg.personal_fm(p).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取私人FM成功", map_song_array(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn daily_recommend(&self, platform: &str) -> ApiResponse<Value> {
        let p = if platform.is_empty() { "ios" } else { platform };
        match self.player.kg.everyday_recommend(p).await {
            Ok(res) if res.kugou_ok() => {
                ApiResponse::ok("获取每日推荐成功", map_song_array(res.data()))
            }
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn ai_recommend(&self) -> ApiResponse<Value> {
        let session = self.player.kg.session();
        let Some(uid) = session.user_id() else {
            return ApiResponse::fail("未登录，无法获取AI推荐");
        };
        let pid = format!("collection_3_{uid}_2_0");
        let fav = match self.player.kg.playlist_track_all(pid.as_str(), 1, 150).await {
            Ok(res) if res.kugou_ok() => res,
            Ok(res) => return ApiResponse::fail(format!("获取我喜欢的歌曲失败: {}", res.body)),
            Err(e) => return ApiResponse::fail(e.to_string()),
        };
        let mut ids = collect_album_audio_ids(fav.data());
        if ids.is_empty() {
            let preview = fav
                .data()
                .get("songs")
                .or_else(|| fav.data().get("info"))
                .and_then(|v| v.get(0))
                .cloned()
                .unwrap_or_else(|| fav.data().clone());
            return ApiResponse::fail(format!("我喜欢的歌曲中没有 MixSongID / album_audio_id: {preview}"));
        }
        ids.truncate(30);
        let joined = ids.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        match self.player.kg.ai_recommend(&joined).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取AI推荐成功", map_song_array(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn top_song(&self, rank_id: i64) -> ApiResponse<Value> {
        match self.player.kg.top_song(rank_id, 1, 30).await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn top_album(&self, page: u32, pagesize: u32, album_type: &str) -> ApiResponse<Value> {
        let page = if page == 0 { 1 } else { page };
        let pagesize = if pagesize == 0 { 30 } else { pagesize };
        match self.player.kg.top_album(page, pagesize).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取新碟上架成功", map_album_array(res.data(), album_type)),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn user_playlist(&self) -> ApiResponse<Value> {
        match self.player.kg.user_playlist(1, 100).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取用户歌单成功", map_user_playlists(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn user_cloud(&self, page: u32, pagesize: u32) -> ApiResponse<Value> {
        let pagesize = if pagesize == 0 { 50 } else { pagesize };
        let page = if page == 0 { 1 } else { page };
        match self.player.kg.user_cloud(page, pagesize).await {
            Ok(res) if res.kugou_ok() => {
                let data = res.data();
                let songs = map_cloud_songs(data);
                let total = data
                    .get("total")
                    .or_else(|| data.get("count"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                ApiResponse::ok("获取云盘歌曲成功", json!({
                    "songs": songs,
                    "total": total,
                    "page": page,
                    "pagesize": pagesize,
                }))
            }
            Ok(res) => ApiResponse::fail(format!("获取云盘歌曲失败: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn playlist_detail(&self, id: &str) -> ApiResponse<Value> {
        if id.is_empty() {
            return ApiResponse::fail("歌单ID不能为空");
        }
        match self.player.kg.playlist_detail(id).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取歌单详情成功", map_playlist_detail(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn playlist_songs(&self, id: &str, page: u32, pagesize: u32) -> ApiResponse<Value> {
        if id.is_empty() {
            return ApiResponse::fail("歌单ID不能为空");
        }
        let page = if page == 0 { 1 } else { page };
        let pagesize = if pagesize == 0 { 150 } else { pagesize };
        match self.player.kg.playlist_track_all(id, page, pagesize).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取歌单歌曲成功", map_playlist_songs(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn add_favorite(&self, name: &str, hash: &str) -> ApiResponse<Value> {
        if hash.is_empty() {
            return ApiResponse::fail("歌曲hash不能为空");
        }
        let data = json!([{
            "number": 1,
            "name": name,
            "hash": hash,
            "size": 0,
            "sort": 0,
            "timelen": 0,
            "bitrate": 0,
            "album_id": 0,
            "mixsongid": 0,
        }]);
        match self.player.kg.playlist_tracks_add(2, data).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("添加收藏成功", json!({})),
            Ok(res) => ApiResponse::fail(format!("收藏失败: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn recommend_card(&self, card_id: i64, pagesize: u32) -> ApiResponse<Value> {
        let pagesize = if pagesize == 0 { 30 } else { pagesize };
        match self.player.kg.top_card_youth(card_id, pagesize).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取推荐歌曲成功", map_song_array(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn album_detail(&self, id: &str) -> ApiResponse<Value> {
        let album_id = album_id_value(id);
        match self.player.kg.album_detail(album_id).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取专辑详情成功", map_album_detail(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn album_songs(&self, id: &str, page: u32, pagesize: u32) -> ApiResponse<Value> {
        let page = if page == 0 { 1 } else { page };
        let pagesize = if pagesize == 0 { 30 } else { pagesize };
        let album_id = album_id_value(id);
        match self.player.kg.album_songs(album_id, page, pagesize).await {
            Ok(res) if res.kugou_ok() => ApiResponse::ok("获取专辑歌曲成功", map_album_songs(res.data())),
            Ok(res) => ApiResponse::fail(format!("无数据: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }
    pub async fn fm_action(&self, hash: &str, songid: &str, action: &str, playtime: i64) -> ApiResponse<Value> {
        self.personal_fm(kugou::PersonalFmParams {
            hash: hash.into(),
            songid: songid.into(),
            playtime,
            action: action.into(),
            ..Default::default()
        })
        .await
    }
}

fn map_song_array(data: &Value) -> Value {
    use crate::resp::{i, s};
    let list = data
        .get("song_list")
        .or_else(|| data.get("list"))
        .or_else(|| data.get("songs"))
        .cloned()
        .unwrap_or_else(|| {
            if data.is_array() {
                data.clone()
            } else {
                Value::Array(vec![])
            }
        });
    let mapped: Vec<Value> = list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|item| {
            let songname = s(item
                .get("songname")
                .or_else(|| item.get("SongName"))
                .or_else(|| item.get("ori_audio_name")));
            let author = s(item.get("author_name").or_else(|| item.get("SingerName")));
            let cover = s(item
                .get("sizable_cover")
                .or_else(|| item.get("union_cover"))
                .or_else(|| item.get("cover"))
                .or_else(|| item.pointer("/trans_param/union_cover"))
                .or_else(|| item.pointer("/album_info/sizable_cover"))
                .or_else(|| item.pointer("/audio_info/trans_param/union_cover")));
            let album_name = first_nonempty(&[
                s(item.get("album_name").or_else(|| item.get("AlbumName"))),
                s(item.pointer("/album_info/album_name")),
                s(item.pointer("/relate_goods/0/albumname")),
                s(item.pointer("/relate_goods/0/album_name")),
            ]);
            let album_id = first_nonempty(&[
                s(item.get("album_id").or_else(|| item.get("AlbumID"))),
                s(item.pointer("/album_info/album_id")),
                s(item.pointer("/relate_goods/1/album_id")),
            ]);
            let mut filename = s(item.get("filename").or_else(|| item.get("FileName")));
            if filename.is_empty() && (!author.is_empty() || !songname.is_empty()) {
                filename = format!("{author} - {songname}");
            }
            let mut time_length = i(item
                .get("time_length")
                .or_else(|| item.get("timelength_320"))
                .or_else(|| item.get("timelength"))
                .or_else(|| item.get("Duration"))
                .or_else(|| item.pointer("/audio_info/timelength")));
            if time_length > 10_000 {
                time_length /= 1000;
            }
            json!({
                "hash": s(item.get("hash").or_else(|| item.get("FileHash"))),
                "songname": songname,
                "author_name": author,
                "album_name": album_name,
                "album_id": album_id,
                "filename": filename,
                "time_length": time_length,
                "union_cover": cover,
            })
        })
        .collect();
    Value::Array(mapped)
}

fn first_nonempty(vals: &[String]) -> String {
    vals.iter().find(|s| !s.is_empty()).cloned().unwrap_or_default()
}

fn map_album_array(data: &Value, album_type: &str) -> Value {
    use crate::resp::{i, s};
    let cats: &[&str] = match album_type {
        "1" | "chn" => &["chn"],
        "2" | "eur" => &["eur"],
        "3" | "jpn" => &["jpn"],
        "4" | "kor" => &["kor"],
        _ => &["chn", "eur", "jpn", "kor"],
    };
    let mut items: Vec<Value> = Vec::new();
    if let Some(arr) = data.as_array() {
        items.extend(arr.iter().cloned());
    } else {
        for c in cats {
            if let Some(arr) = data.get(*c).and_then(|v| v.as_array()) {
                items.extend(arr.iter().cloned());
            }
        }
        if items.is_empty() {
            if let Some(arr) = data
                .get("list")
                .or_else(|| data.get("albums"))
                .and_then(|v| v.as_array())
            {
                items.extend(arr.iter().cloned());
            }
        }
    }
    Value::Array(
        items
            .iter()
            .map(|item| {
                let publishtime = s(item.get("publishtime").or_else(|| item.get("publish_date")));
                let release_date = if publishtime.len() >= 10 {
                    publishtime[..10].to_string()
                } else {
                    publishtime
                };
                json!({
                    "id": s(item.get("albumid").or_else(|| item.get("album_id")).or_else(|| item.get("id"))),
                    "album_name": s(item.get("albumname").or_else(|| item.get("album_name"))),
                    "author_name": s(item.get("singername").or_else(|| item.get("author_name"))),
                    "release_date": release_date,
                    "song_count": i(item.get("songcount").or_else(|| item.get("song_count"))),
                    "union_cover": s(item.get("imgurl").or_else(|| item.get("sizable_cover")).or_else(|| item.get("union_cover"))),
                    "description": s(item.get("intro").or_else(|| item.get("description"))),
                })
            })
            .collect(),
    )
}

fn album_id_value(id: &str) -> Value {
    id.parse::<i64>().map(|n| json!(n)).unwrap_or_else(|_| json!(id))
}

fn map_album_detail(data: &Value) -> Value {
    use crate::resp::{i, s};
    let item = data.as_array().and_then(|a| a.first()).unwrap_or(data);
    json!({
        "id": s(item.get("album_id").or_else(|| item.get("albumid")).or_else(|| item.get("id"))),
        "album_name": s(item.get("album_name").or_else(|| item.get("albumname"))),
        "author_name": s(item.get("author_name").or_else(|| item.get("singername"))),
        "publish_date": s(item.get("publish_date").or_else(|| item.get("publishtime"))),
        "song_count": i(item.get("song_count").or_else(|| item.get("songcount"))),
        "union_cover": s(item.get("sizable_cover").or_else(|| item.get("union_cover")).or_else(|| item.get("imgurl"))),
        "description": s(item.get("intro").or_else(|| item.get("description"))),
        "publish_company": s(item.get("publish_company")),
        "language": s(item.get("language")),
        "category": s(item.get("category")),
    })
}

fn map_album_songs(data: &Value) -> Value {
    use crate::resp::{i, s};
    let list = data
        .get("songs")
        .or_else(|| data.get("info"))
        .or_else(|| data.get("list"))
        .or_else(|| data.get("song_list"))
        .cloned()
        .unwrap_or_else(|| {
            if data.is_array() {
                data.clone()
            } else {
                Value::Array(vec![])
            }
        });
    Value::Array(
        list.as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|item| {
                let songname = first_nonempty(&[
                    s(item.pointer("/base/audio_name")),
                    s(item.get("songname")),
                    s(item.get("ori_audio_name")),
                    s(item.get("SongName")),
                ]);
                let author = first_nonempty(&[
                    s(item.pointer("/base/author_name")),
                    s(item.pointer("/singerinfo/0/name")),
                    s(item.get("author_name")),
                    s(item.get("SingerName")),
                ]);
                let album_name = first_nonempty(&[
                    s(item.pointer("/album_info/album_name")),
                    s(item.pointer("/albuminfo/name")),
                    s(item.get("album_name")),
                ]);
                let album_id = first_nonempty(&[
                    s(item.pointer("/base/album_id")),
                    s(item.pointer("/albuminfo/id")),
                    s(item.get("album_id")),
                ]);
                let cover = first_nonempty(&[
                    s(item.pointer("/album_info/cover")),
                    s(item.pointer("/album_info/sizable_cover")),
                    s(item.get("union_cover")),
                    s(item.get("cover")),
                    s(item.pointer("/trans_param/union_cover")),
                ]);
                let mut filename = first_nonempty(&[s(item.get("filename")), s(item.get("name"))]);
                if filename.is_empty() && (!author.is_empty() || !songname.is_empty()) {
                    filename = format!("{author} - {songname}");
                }
                let songname = if songname.is_empty() {
                    filename
                        .split_once(" - ")
                        .map(|(_, title)| title.to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| filename.clone())
                } else {
                    songname
                };
                let mut time_length = i(item
                    .pointer("/audio_info/duration")
                    .or_else(|| item.pointer("/audio_info/timelength"))
                    .or_else(|| item.get("time_length"))
                    .or_else(|| item.get("timelength"))
                    .or_else(|| item.get("timelen")));
                if time_length > 10_000 {
                    time_length /= 1000;
                }
                json!({
                    "hash": first_nonempty(&[
                        s(item.pointer("/audio_info/hash")),
                        s(item.get("hash")),
                        s(item.get("FileHash")),
                    ]),
                    "songname": songname,
                    "author_name": author,
                    "album_name": album_name,
                    "album_id": album_id,
                    "filename": filename,
                    "time_length": time_length,
                    "union_cover": cover,
                })
            })
            .collect(),
    )
}

fn map_playlist_songs(data: &Value) -> Value {
    map_album_songs(data)
}

fn map_cloud_songs(data: &Value) -> Value {
    use crate::resp::{i, s};
    let list = data
        .get("songs")
        .or_else(|| data.get("info"))
        .or_else(|| data.get("list"))
        .or_else(|| data.get("song_list"))
        .cloned()
        .unwrap_or_else(|| {
            if data.is_array() {
                data.clone()
            } else {
                Value::Array(vec![])
            }
        });
    Value::Array(
        list.as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|item| {
                let songname = first_nonempty(&[
                    s(item.pointer("/base/audio_name")),
                    s(item.get("songname")),
                    s(item.get("ori_audio_name")),
                    s(item.get("SongName")),
                ]);
                let author = first_nonempty(&[
                    s(item.pointer("/base/author_name")),
                    s(item.pointer("/singerinfo/0/name")),
                    s(item.get("author_name")),
                    s(item.get("SingerName")),
                    s(item.get("singername")),
                ]);
                let album_name = first_nonempty(&[
                    s(item.pointer("/album_info/album_name")),
                    s(item.pointer("/albuminfo/name")),
                    s(item.get("album_name")),
                ]);
                let album_id = first_nonempty(&[
                    s(item.pointer("/base/album_id")),
                    s(item.pointer("/albuminfo/id")),
                    s(item.get("album_id")),
                ]);
                let album_audio_id = first_nonempty(&[
                    s(item.pointer("/base/album_audio_id")),
                    s(item.get("album_audio_id")),
                ]);
                let cover = first_nonempty(&[
                    s(item.pointer("/album_info/cover")),
                    s(item.pointer("/album_info/sizable_cover")),
                    s(item.get("union_cover")),
                    s(item.get("cover")),
                    s(item.get("sizable_cover")),
                    s(item.get("pic")),
                    s(item.pointer("/trans_param/union_cover")),
                ]);
                let mut filename = first_nonempty(&[s(item.get("filename")), s(item.get("name"))]);
                if filename.is_empty() && (!author.is_empty() || !songname.is_empty()) {
                    filename = format!("{author} - {songname}");
                }
                let songname = if songname.is_empty() {
                    filename
                        .split_once(" - ")
                        .map(|(_, title)| title.to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| filename.clone())
                } else {
                    songname
                };
                let mut time_length = i(item
                    .pointer("/audio_info/duration")
                    .or_else(|| item.pointer("/audio_info/timelength"))
                    .or_else(|| item.get("time_length"))
                    .or_else(|| item.get("timelength"))
                    .or_else(|| item.get("timelen")));
                if time_length > 10_000 {
                    time_length /= 1000;
                }
                json!({
                    "hash": first_nonempty(&[
                        s(item.pointer("/audio_info/hash")),
                        s(item.get("hash")),
                        s(item.get("FileHash")),
                    ]),
                    "songname": songname,
                    "author_name": author,
                    "album_name": album_name,
                    "album_id": album_id,
                    "album_audio_id": album_audio_id,
                    "filename": filename,
                    "time_length": time_length,
                    "union_cover": cover,
                    "filesize": i(item.get("filesize")),
                    "fileid": s(item.get("kv_id").or_else(|| item.get("fileid"))),
                    "addtime": s(item.get("addtime")),
                    "is_cloud": true,
                })
            })
            .collect(),
    )
}

fn map_user_playlists(data: &Value) -> Value {
    use crate::resp::{i, s};
    let list = data
        .get("info")
        .or_else(|| data.get("list"))
        .or_else(|| data.get("playlists"))
        .cloned()
        .unwrap_or_else(|| {
            if data.is_array() {
                data.clone()
            } else {
                Value::Array(vec![])
            }
        });
    Value::Array(
        list.as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|item| {
                json!({
                    "global_collection_id": s(item.get("global_collection_id")),
                    "listid": i(item.get("listid")),
                    "name": s(item.get("name")),
                    "intro": s(item.get("intro")),
                    "union_cover": s(item.get("pic").or_else(|| item.get("union_cover")).or_else(|| item.get("sizable_cover"))),
                    "count": i(item.get("count")),
                    "type": i(item.get("type")),
                    "create_time": i(item.get("create_time")),
                    "update_time": i(item.get("update_time")),
                    "create_user_pic": s(item.get("create_user_pic")),
                    "create_username": s(item.get("list_create_username").or_else(|| item.get("create_username"))),
                })
            })
            .collect(),
    )
}

fn map_playlist_detail(data: &Value) -> Value {
    use crate::resp::{i, s};
    let item = data.as_array().and_then(|a| a.first()).unwrap_or(data);
    json!({
        "id": s(item.get("global_collection_id").or_else(|| item.get("id"))),
        "album_name": s(item.get("name").or_else(|| item.get("album_name"))),
        "author_name": s(item.get("list_create_username").or_else(|| item.get("create_username")).or_else(|| item.get("author_name"))),
        "publish_date": s(item.get("publish_date").or_else(|| item.get("create_time"))),
        "song_count": i(item.get("count").or_else(|| item.get("song_count"))),
        "union_cover": s(item.get("pic").or_else(|| item.get("union_cover")).or_else(|| item.get("sizable_cover"))),
        "description": s(item.get("intro").or_else(|| item.get("description"))),
    })
}

fn collect_album_audio_ids(data: &Value) -> Vec<i64> {
    use crate::resp::i;
    let list = data
        .get("songs")
        .or_else(|| data.get("info"))
        .or_else(|| data.get("list"))
        .or_else(|| data.get("song_list"))
        .or_else(|| data.pointer("/data/songs"))
        .or_else(|| data.pointer("/data/info"));
    let Some(arr) = list.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for item in arr {
        let n = [
            "MixSongID",
            "mixsongid",
            "album_audio_id",
            "albumAudioId",
            "mixsongid64",
        ]
        .iter()
        .map(|k| i(item.get(*k)))
        .find(|n| *n > 0)
        .unwrap_or(0);
        if n > 0 && !ids.contains(&n) {
            ids.push(n);
        }
    }
    ids
}
