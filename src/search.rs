use serde::Serialize;
use serde_json::{json, Value};

use crate::resp::{i, s, ApiResponse};
use crate::Player;

#[derive(Clone, Debug, Default, Serialize)]
pub struct SearchSongData {
    pub hash: String,
    pub songname: String,
    pub filename: String,
    pub time_length: i64,
    pub album_name: String,
    pub album_id: String,
    pub author_name: String,
    pub union_cover: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ListTotal<T: Serialize> {
    pub list: Vec<T>,
    pub total: i64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SearchResults {
    pub songs: ListTotal<SearchSongData>,
    pub artists: ListTotal<Value>,
    pub playlists: ListTotal<Value>,
    pub albums: ListTotal<Value>,
    pub mvs: ListTotal<Value>,
}

pub struct SearchApi<'a> {
    pub player: &'a Player,
}

impl SearchApi<'_> {
    pub async fn search(&self, keyword: &str, page: u32, page_size: u32) -> ApiResponse<SearchResults> {
        if keyword.is_empty() {
            return ApiResponse::fail("搜索关键词不能为空");
        }
        match self.player.kg.search_complex(keyword).await {
            Ok(res) if res.kugou_ok() => {
                let mut results = SearchResults::default();
                let data = res.data();
                if let Some(list) = data.pointer("/song/list").and_then(|v| v.as_array()) {
                    results.songs.list = list.iter().map(map_song).collect();
                    results.songs.total = i(data.pointer("/song/total"));
                }
                if let Some(list) = data.pointer("/author/list").and_then(|v| v.as_array()) {
                    results.artists.list = list.iter().map(map_artist).collect();
                    results.artists.total = i(data.pointer("/author/total"));
                }
                if let Some(list) = data.pointer("/special/list").and_then(|v| v.as_array()) {
                    results.playlists.list = list.iter().map(map_playlist).collect();
                    results.playlists.total = i(data.pointer("/special/total"));
                }
                if let Some(list) = data.pointer("/album/list").and_then(|v| v.as_array()) {
                    results.albums.list = list.iter().map(map_album).collect();
                    results.albums.total = i(data.pointer("/album/total"));
                }
                if let Some(list) = data.pointer("/mv/list").and_then(|v| v.as_array()) {
                    results.mvs.list = list.iter().map(map_mv).collect();
                    results.mvs.total = i(data.pointer("/mv/total"));
                }
                let _ = (page, page_size);
                ApiResponse::ok("搜索成功", results)
            }
            Ok(res) => ApiResponse::fail(format!("搜索失败: {}", res.body)),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn search_songs(&self, keyword: &str, page: u32, page_size: u32) -> ApiResponse<SearchResults> {
        if keyword.is_empty() {
            return ApiResponse::fail("搜索关键词不能为空");
        }
        match self
            .player
            .kg
            .search(keyword)
            .page(page.max(1))
            .pagesize(page_size.max(1))
            .send()
            .await
        {
            Ok(page) => {
                let songs: Vec<SearchSongData> = page.songs.iter().map(|s| SearchSongData {
                    hash: s.hash.clone(),
                    songname: if s.name.is_empty() {
                        s.extra
                            .get("FileName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string()
                    } else {
                        s.name.clone()
                    },
                    filename: s
                        .extra
                        .get("FileName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    time_length: s.duration,
                    album_name: s.album.clone(),
                    album_id: s.album_id.clone(),
                    author_name: s.singer.clone(),
                    union_cover: s
                        .extra
                        .get("Image")
                        .or_else(|| s.extra.get("union_cover"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                }).collect();
                let total = page.total;
                ApiResponse::ok(
                    "搜索成功",
                    SearchResults {
                        songs: ListTotal { list: songs, total },
                        ..Default::default()
                    },
                )
            }
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn search_kind(&self, keyword: &str, page: u32, page_size: u32, kind: kugou::SearchKind) -> ApiResponse<SearchResults> {
        if keyword.is_empty() {
            return ApiResponse::fail("搜索关键词不能为空");
        }
        match self
            .player
            .kg
            .search(keyword)
            .page(page.max(1))
            .pagesize(page_size.max(1))
            .kind(kind)
            .send()
            .await
        {
            Ok(pg) => {
                let lists = pg
                    .response
                    .data()
                    .get("lists")
                    .cloned()
                    .unwrap_or(Value::Array(vec![]));
                let arr = lists.as_array().cloned().unwrap_or_default();
                let mut results = SearchResults::default();
                let total = pg.total;
                match kind {
                    kugou::SearchKind::Author => {
                        results.artists = ListTotal { total, list: arr.iter().map(map_artist).collect() };
                    }
                    kugou::SearchKind::Special => {
                        results.playlists = ListTotal { total, list: arr.iter().map(map_playlist).collect() };
                    }
                    kugou::SearchKind::Album => {
                        results.albums = ListTotal { total, list: arr.iter().map(map_album).collect() };
                    }
                    kugou::SearchKind::Mv => {
                        results.mvs = ListTotal { total, list: arr.iter().map(map_mv).collect() };
                    }
                    _ => results.songs.total = total,
                }
                ApiResponse::ok("搜索成功", results)
            }
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn hot_search(&self) -> ApiResponse<Value> {
        match self.player.kg.search_hot().await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn suggest(&self, keyword: &str) -> ApiResponse<Value> {
        match self.player.kg.search_suggest(keyword).await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }
}

fn map_song(v: &Value) -> SearchSongData {
    SearchSongData {
        hash: s(v.get("hash")),
        songname: s(v.get("songname")),
        filename: s(v.get("filename")),
        time_length: i(v.get("timelength").or_else(|| v.get("duration"))),
        album_name: s(v.get("album_name")),
        album_id: s(v.get("album_id")),
        author_name: s(v.get("author_name")),
        union_cover: s(v.get("union_cover")),
    }
}

fn map_artist(v: &Value) -> Value {
    json!({
        "author_id": s(v.get("SingerID").or_else(|| v.get("author_id"))),
        "author_name": s(v.get("AuthorName").or_else(|| v.get("author_name")).or_else(|| v.get("singername"))),
        "avatar": s(v.get("Avatar").or_else(|| v.get("avatar")).or_else(|| v.get("sizable_avatar"))),
        "song_count": i(v.get("AudioCount").or_else(|| v.get("song_count"))),
    })
}

fn map_playlist(v: &Value) -> Value {
    json!({
        "special_id": s(v.get("gid").or_else(|| v.get("special_id")).or_else(|| v.get("global_collection_id"))),
        "special_name": s(v.get("specialname").or_else(|| v.get("special_name")).or_else(|| v.get("name"))),
        "img_url": s(v.get("img").or_else(|| v.get("img_url")).or_else(|| v.get("pic"))),
        "play_count": i(v.get("play_count")),
        "song_count": i(v.get("song_count").or_else(|| v.get("count"))),
        "author_name": s(v.get("nickname").or_else(|| v.get("author_name"))),
    })
}

fn map_album(v: &Value) -> Value {
    json!({
        "album_id": s(v.get("albumid").or_else(|| v.get("album_id"))),
        "album_name": s(v.get("albumname").or_else(|| v.get("album_name"))),
        "img_url": s(v.get("img").or_else(|| v.get("img_url")).or_else(|| v.get("sizable_cover"))),
        "author_name": s(v.get("singer").or_else(|| v.get("author_name")).or_else(|| v.get("singername"))),
        "song_count": i(v.get("songcount").or_else(|| v.get("song_count"))),
    })
}

fn map_mv(v: &Value) -> Value {
    json!({
        "hash": s(v.get("MvHash").or_else(|| v.get("hash"))),
        "mv_name": s(v.get("MvName").or_else(|| v.get("mv_name")).or_else(|| v.get("filename"))),
        "img_url": s(v.get("ThumbGif").or_else(|| v.get("img_url")).or_else(|| v.get("img")).or_else(|| v.get("Pic"))),
        "author_name": s(v.get("SingerName").or_else(|| v.get("author_name"))),
        "time_length": i(v.get("Duration").or_else(|| v.get("time_length")).or_else(|| v.get("duration"))),
    })
}
