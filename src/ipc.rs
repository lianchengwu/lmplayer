use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

use crate::{HomeApi, LoginApi, Player, SearchApi};

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(|| PathBuf::from(".")).join("wmplayer")
}
fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("wmplayer")
}
fn read_json(path: &PathBuf, default: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(default)
}
fn write_json(path: &PathBuf, v: &Value) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, serde_json::to_vec_pretty(v).unwrap_or_default());
}
fn ok(data: Value) -> Value {
    json!({ "success": true, "message": "ok", "error_code": 0, "status": 1, "data": data })
}
fn fail(msg: impl Into<String>) -> Value {
    json!({ "success": false, "message": msg.into() })
}
fn wrap<T: serde::Serialize>(r: crate::ApiResponse<T>) -> Value {
    serde_json::to_value(r).unwrap_or_else(|_| fail("serialize"))
}
fn empty_playlist() -> Value {
    json!({
        "songs": [], "current_index": 0, "play_mode": "normal",
        "shuffle_mode": false, "repeat_mode": "off", "name": "", "shuffle_order": []
    })
}
fn arg_str(args: &Value, k: &str) -> String {
    args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn arg_u32(args: &Value, k: &str, d: u32) -> u32 {
    args.get(k).and_then(|v| v.as_u64()).map(|n| n as u32).unwrap_or(d)
}
fn arg_i64(args: &Value, k: &str, d: i64) -> i64 {
    args.get(k).and_then(|v| v.as_i64()).unwrap_or(d)
}
fn arg_bool(args: &Value, k: &str) -> bool {
    match args.get(k) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => matches!(s.as_str(), "true" | "1"),
        _ => false,
    }
}
fn fm_params(args: &Value, default_action: &str) -> kugou::PersonalFmParams {
    let mut mode = arg_str(args, "mode");
    if mode.is_empty() {
        mode = "normal".into();
    }
    let mut action = arg_str(args, "action");
    if action.is_empty() {
        action = default_action.into();
    }
    kugou::PersonalFmParams {
        mode,
        action,
        song_pool_id: arg_i64(args, "songPoolID", 0),
        remain_songcnt: arg_i64(args, "remainSongCnt", 0),
        is_overplay: arg_bool(args, "isOverplay"),
        hash: arg_str(args, "hash"),
        songid: arg_str(args, "songID"),
        playtime: arg_i64(args, "playTime", 0),
    }
}

fn youth_card_id(category: &str) -> i64 {
    if let Ok(n) = category.parse::<i64>() {
        if n > 0 {
            return n;
        }
    }
    match category {
        "personal" => 3001,
        "classic" => 3014,
        "popular" => 3101,
        "treasure" => 3004,
        "trendy" => 3005,
        "vip" => 3006,
        _ => 3001,
    }
}

pub async fn dispatch(player: &Player, cmd: &str, args: Value) -> Value {
    let search = SearchApi { player };
    let home = HomeApi { player };
    let login = LoginApi { player };
    match cmd {
        "search" => wrap(search.search(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30)).await),
        "search_songs" => wrap(search.search_songs(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30)).await),
        "search_artists" => wrap(search.search_kind(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30), kugou::SearchKind::Author).await),
        "search_playlists" => wrap(search.search_kind(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30), kugou::SearchKind::Special).await),
        "search_albums" => wrap(search.search_kind(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30), kugou::SearchKind::Album).await),
        "search_mvs" => wrap(search.search_kind(&arg_str(&args, "keyword"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30), kugou::SearchKind::Mv).await),
        "get_hot_search" => wrap(search.hot_search().await),
        "get_search_suggest" => wrap(search.suggest(&arg_str(&args, "keyword")).await),
        "get_song_url" => wrap(home.song_url(&arg_str(&args, "hash")).await),
        "get_personal_fm_with_params" | "get_personal_fm_advanced" => wrap(home.personal_fm(fm_params(&args, "play")).await),
        "report_fm_action" => wrap(home.fm_action(
            &arg_str(&args, "hash"),
            &arg_str(&args, "songID"),
            &arg_str(&args, "action"),
            arg_i64(&args, "playTime", 0),
        ).await),
        "get_daily_recommend" => wrap(home.daily_recommend(&arg_str(&args, "platform")).await),
        "get_ai_recommend" => wrap(home.ai_recommend().await),
        "get_new_songs" => wrap(home.top_song(21608).await),
        "get_new_albums" => wrap(home.top_album(arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30), &arg_str(&args, "type")).await),
        "get_recommend_songs" => {
            wrap(home.recommend_card(youth_card_id(&arg_str(&args, "category")), arg_u32(&args, "pageSize", 30)).await)
        }
        "get_album_detail" => wrap(home.album_detail(&arg_str(&args, "albumID")).await),
        "get_album_songs" => wrap(home.album_songs(&arg_str(&args, "albumID"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 30)).await),
        "get_playlist_detail" => wrap(home.playlist_detail(&arg_str(&args, "playlistID")).await),
        "get_playlist_songs_album" => wrap(home.playlist_songs(&arg_str(&args, "playlistID"), arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 150)).await),
        "get_user_playlists" => wrap(home.user_playlist().await),
        "get_favorite_playlist_songs" => wrap(home.playlist_songs(&arg_str(&args, "globalCollectionID"), 1, 200).await),
        "add_favorite" => {
            let req = args.get("request").cloned().unwrap_or_else(|| args.clone());
            wrap(home.add_favorite(
                req.get("songname").and_then(|v| v.as_str()).unwrap_or(""),
                req.get("hash").and_then(|v| v.as_str()).unwrap_or(""),
            ).await)
        }
        "send_captcha" => wrap(login.send_captcha(&arg_str(&args, "mobile")).await),
        "login_with_phone" => wrap(login.login_cellphone(&arg_str(&args, "mobile"), &arg_str(&args, "code")).await),
        "generate_qr_key" => wrap(login.qr_key().await),
        "create_qr_code" => wrap(login.qr_create(&arg_str(&args, "key")).await),
        "check_qr_status" => wrap(login.qr_check(&arg_str(&args, "key")).await),
        "get_user_detail" => wrap(login.user_detail().await),
        "check_login_status" => wrap(login.check_login_status().await),
        "get_vip_detail" => wrap(login.vip_detail().await),
        "claim_daily_vip" => wrap(login.claim_daily_vip(&arg_str(&args, "receive_day")).await),
        "logout" => wrap(login.logout()),
        "get_playlist" => ok(read_json(&cache_dir().join("playlist.json"), empty_playlist())),
        "set_playlist" => {
            let path = cache_dir().join("playlist.json");
            let mut data = read_json(&path, empty_playlist());
            if let Some(req) = args.get("request") {
                if req.get("clear_first").and_then(|v| v.as_bool()).unwrap_or(false) {
                    data = empty_playlist();
                }
                if let Some(s) = req.get("songs") {
                    data["songs"] = s.clone();
                }
                if let Some(i) = req.get("current_index") {
                    data["current_index"] = i.clone();
                }
                if let Some(n) = req.get("name") {
                    data["name"] = n.clone();
                }
                if let Some(m) = req.get("play_mode") {
                    data["play_mode"] = m.clone();
                }
            }
            write_json(&path, &data);
            ok(data)
        }
        "add_to_playlist" => {
            let path = cache_dir().join("playlist.json");
            let mut data = read_json(&path, empty_playlist());
            if let Some(song) = args.get("request").and_then(|r| r.get("song")) {
                if let Some(arr) = data["songs"].as_array_mut() { arr.push(song.clone()); }
            }
            write_json(&path, &data);
            ok(data)
        }
        "set_current_index" => {
            let path = cache_dir().join("playlist.json");
            let mut data = read_json(&path, empty_playlist());
            data["current_index"] = json!(arg_i64(&args, "index", 0));
            write_json(&path, &data);
            ok(data)
        }
        "update_play_mode" => {
            let path = cache_dir().join("playlist.json");
            let mut data = read_json(&path, empty_playlist());
            if let Some(req) = args.get("request") {
                if let Some(v) = req.get("shuffle_mode") { data["shuffle_mode"] = v.clone(); }
                if let Some(v) = req.get("repeat_mode") { data["repeat_mode"] = v.clone(); }
            }
            write_json(&path, &data);
            ok(data)
        }
        "get_next_song" | "get_previous_song" => {
            let path = cache_dir().join("playlist.json");
            let mut data = read_json(&path, empty_playlist());
            let n = data["songs"].as_array().map(|a| a.len() as i64).unwrap_or(0);
            if n == 0 { return fail("empty playlist"); }
            let mut idx = data["current_index"].as_i64().unwrap_or(0);
            idx = if cmd == "get_next_song" { (idx + 1) % n } else { (idx - 1 + n) % n };
            data["current_index"] = json!(idx);
            write_json(&path, &data);
            ok(data)
        }
        "clear_playlist" => {
            let data = empty_playlist();
            write_json(&cache_dir().join("playlist.json"), &data);
            ok(data)
        }
        "add_play_history" => {
            let path = cache_dir().join("history.json");
            let mut data = read_json(&path, json!({ "records": [], "total_count": 0 }));
            let req = args.get("request").cloned().unwrap_or_else(|| args.clone());
            add_history_record(&mut data, &req);
            write_json(&path, &data);
            ok(data)
        }
        "get_play_history" => {
            let path = cache_dir().join("history.json");
            let mut data = read_json(&path, json!({ "records": [], "total_count": 0 }));
            let compacted = compact_history(
                data.get("records").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
            );
            data["records"] = json!(compacted);
            data["total_count"] = json!(compacted.len());
            write_json(&path, &data);
            let req = args.get("request").cloned().unwrap_or_else(|| args.clone());
            ok(filter_history(&data, &req))
        }
        "clear_play_history" => {
            let data = json!({ "records": [], "total_count": 0 });
            write_json(&cache_dir().join("history.json"), &data);
            ok(data)
        }
        "load_settings" => {
            let data = read_json(&config_dir().join("settings.json"), json!({}));
            json!({ "success": true, "Success": true, "message": "ok", "Message": "ok", "data": data, "Data": data })
        }
        "save_settings" => {
            if let Some(s) = args.get("settings") {
                write_json(&config_dir().join("settings.json"), s);
            }
            json!({ "success": true, "Success": true, "message": "已保存", "data": true })
        }
        "get_settings_path" => {
            let s = config_dir().join("settings.json").to_string_lossy().to_string();
            json!({ "success": true, "Success": true, "data": s, "Data": s })
        }
        "get_cached_url" => {
            let hash = arg_str(&args, "songHash");
            if hash.starts_with("local-") {
                let clean = hash.trim_start_matches("local-");
                if crate::local_music::lookup_path(clean).is_some() {
                    ok(json!(format!("/__local/{clean}")))
                } else {
                    json!({ "success": false, "message": "local music not found" })
                }
            } else {
                match crate::audio_cache::lookup_url(&hash) {
                    Some(u) => ok(json!(u)),
                    None => json!({ "success": false, "message": "no cache" }),
                }
            }
        }
        "cache_audio_file" => {
            let hash = arg_str(&args, "songHash");
            let urls = args
                .get("urls")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            match crate::audio_cache::store(&hash, &urls).await {
                Ok(u) => ok(json!(u)),
                Err(e) => fail(e),
            }
        }
        "update_current_lyrics" => {
            let text = arg_str(&args, "text");
            let song = arg_str(&args, "song");
            let artist = arg_str(&args, "artist");
            let current_time = args
                .get("currentTime")
                .or_else(|| args.get("current_time"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            crate::osd::update_lyrics(&text, &song, &artist, current_time);
            ok(json!("ok"))
        }
        "set_osd_enabled" => {
            let enabled = arg_bool(&args, "enabled");
            crate::osd::set_osd_enabled(enabled);
            json!({
                "success": true,
                "message": if enabled { "桌面歌词已开启" } else { "桌面歌词已关闭" }
            })
        }
        "is_osd_enabled" => json!(crate::osd::is_osd_enabled()),
        "toggle_osd_lock" => {
            let locked = crate::osd::toggle_osd_lock();
            json!({
                "success": true,
                "locked": locked,
                "message": if locked { "桌面歌词已锁定 (鼠标穿透)" } else { "桌面歌词已解锁" }
            })
        }
        "set_osd_locked" => {
            let locked = arg_bool(&args, "locked");
            crate::osd::set_osd_locked(locked);
            json!({
                "success": true,
                "locked": locked,
                "message": if locked { "桌面歌词已锁定 (鼠标穿透)" } else { "桌面歌词已解锁" }
            })
        }
        "is_osd_locked" => json!(crate::osd::is_osd_locked()),
        "get_media_key_status" => json!({ "registered": false }),
        "check_for_updates" => json!({ "success": true, "hasUpdate": false }),
        "get_current_version" => json!("0.1.0"),
        "get_download_records" => ok(json!({ "records": [], "total_count": 0 })),
        "add_download_record" | "delete_download_record" | "clear_download_records" => ok(json!({})),
        "open_file_folder" => {
            let fp = arg_str(&args, "filePath");
            let p = std::path::Path::new(&fp);
            let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
            ok(json!("ok"))
        }
        "select_music_folder" => match crate::local_music::select_folder().await {
            Ok(Some(path)) => json!({ "success": true, "message": "ok", "path": path }),
            Ok(None) => json!({ "success": false, "message": "用户取消了选择", "path": "" }),
            Err(e) => fail(e),
        },
        "scan_music_folders" => {
            let folder_paths: Vec<String> = args
                .get("folderPaths")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let resp = crate::local_music::scan_folders(&folder_paths);
            serde_json::to_value(resp).unwrap_or_else(|_| fail("serialize"))
        }
        "scan_music_folder" => {
            let folder_path = arg_str(&args, "folderPath");
            let resp = crate::local_music::scan_folder(&folder_path);
            serde_json::to_value(resp).unwrap_or_else(|_| fail("serialize"))
        }
        "get_cached_music_files" => {
            let resp = crate::local_music::get_cached_music();
            serde_json::to_value(resp).unwrap_or_else(|_| fail("serialize"))
        }
        "get_local_audio_url" => {
            let fp = arg_str(&args, "file_path");
            if let Some(hash) = crate::local_music::lookup_hash_by_path(&fp) {
                ok(json!(format!("/__local/{hash}")))
            } else {
                let p = std::path::Path::new(&fp);
                if p.exists() {
                    let hash = crate::local_music::register_file(p);
                    ok(json!(format!("/__local/{hash}")))
                } else {
                    fail("file not found")
                }
            }
        }
        "get_local_music_lyrics" => {
            let fp = arg_str(&args, "file_path");
            match crate::local_music::get_lyrics(&fp) {
                Some(s) if !s.is_empty() => ok(json!(s)),
                _ => fail("no lyrics"),
            }
        }
        other => fail(format!("unknown cmd {other}")),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn play_time_ms(v: &Value) -> i64 {
    match v.get("play_time").or_else(|| v.get("last_play_time")) {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_u64().map(|u| u as i64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn restore_cover_template(url: &str) -> String {
    if url.contains("{size}") {
        return url.to_string();
    }
    url.replace("/120/", "/{size}/")
}

fn compact_history(recs: Vec<Value>) -> Vec<Value> {
    let now = now_ms();
    let mut out: Vec<Value> = Vec::new();
    for mut r in recs {
        let hash = r.get("hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if hash.is_empty() {
            continue;
        }
        let mut t = play_time_ms(&r);
        if t <= 0 {
            t = now;
        }
        r["play_time"] = json!(t);
        r["last_play_time"] = json!(t);
        if r.get("play_count").and_then(|v| v.as_i64()).unwrap_or(0) <= 0 {
            r["play_count"] = json!(1);
        }
        if let Some(c) = r.get("union_cover").and_then(|v| v.as_str()) {
            r["union_cover"] = json!(restore_cover_template(c));
        }
        if let Some(existing) = out.iter_mut().find(|e| e.get("hash").and_then(|v| v.as_str()) == Some(hash.as_str())) {
            let c1 = existing.get("play_count").and_then(|v| v.as_i64()).unwrap_or(1);
            let c2 = r.get("play_count").and_then(|v| v.as_i64()).unwrap_or(1);
            existing["play_count"] = json!(c1 + c2);
            if t >= play_time_ms(existing) {
                existing["play_time"] = json!(t);
                existing["last_play_time"] = json!(t);
                for k in ["songname", "filename", "author_name", "album_name", "album_id", "union_cover", "time_length"] {
                    if let Some(v) = r.get(k) {
                        if !v.is_null() && v != "" {
                            existing[k] = v.clone();
                        }
                    }
                }
            }
        } else {
            out.push(r);
        }
    }
    out.sort_by(|a, b| play_time_ms(b).cmp(&play_time_ms(a)));
    out.truncate(1000);
    out
}

fn add_history_record(data: &mut Value, req: &Value) {
    let hash = req.get("hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if hash.is_empty() {
        return;
    }
    if !data.get("records").map(|v| v.is_array()).unwrap_or(false) {
        data["records"] = json!([]);
    }
    let recs = data.get("records").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut recs = compact_history(recs);
    let now = now_ms();
    if let Some(existing) = recs.iter_mut().find(|r| r.get("hash").and_then(|v| v.as_str()) == Some(hash.as_str())) {
        let count = existing.get("play_count").and_then(|v| v.as_i64()).unwrap_or(0) + 1;
        existing["play_count"] = json!(count);
        existing["play_time"] = json!(now);
        existing["last_play_time"] = json!(now);
        for k in ["songname", "filename", "author_name", "album_name", "album_id", "time_length"] {
            if let Some(v) = req.get(k) {
                existing[k] = v.clone();
            }
        }
        if let Some(c) = req.get("union_cover").and_then(|v| v.as_str()) {
            existing["union_cover"] = json!(restore_cover_template(c));
        }
    } else {
        let cover = req.get("union_cover").and_then(|v| v.as_str()).unwrap_or("");
        recs.push(json!({
            "id": hash,
            "hash": hash,
            "songname": req.get("songname").cloned().unwrap_or(json!("")),
            "filename": req.get("filename").cloned().unwrap_or(json!("")),
            "author_name": req.get("author_name").cloned().unwrap_or(json!("")),
            "album_name": req.get("album_name").cloned().unwrap_or(json!("")),
            "album_id": req.get("album_id").cloned().unwrap_or(json!("")),
            "time_length": req.get("time_length").cloned().unwrap_or(json!(0)),
            "union_cover": restore_cover_template(cover),
            "play_time": now,
            "play_count": 1,
            "last_play_time": now,
        }));
    }
    recs.sort_by(|a, b| play_time_ms(b).cmp(&play_time_ms(a)));
    recs.truncate(1000);
    data["total_count"] = json!(recs.len());
    data["records"] = json!(recs);
}

fn filter_history(data: &Value, req: &Value) -> Value {
    let page = req.get("page").and_then(|v| v.as_u64()).unwrap_or(1).max(1);
    let page_size = req.get("page_size").and_then(|v| v.as_u64()).unwrap_or(50).max(1);
    let filter = req.get("filter").and_then(|v| v.as_str()).unwrap_or("all");
    let now = now_ms();
    let day = 86_400_000i64;
    let today_start = now - (now % day);
    let mut recs = compact_history(
        data.get("records").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
    );
    recs.retain(|r| {
        let t = play_time_ms(r);
        match filter {
            "today" => t >= today_start,
            "yesterday" => t >= today_start - day && t < today_start,
            "week" => t >= now - 7 * day,
            _ => true,
        }
    });
    recs.sort_by(|a, b| play_time_ms(b).cmp(&play_time_ms(a)));
    let total = recs.len();
    let start = ((page - 1) * page_size) as usize;
    let page_recs: Vec<Value> = recs.into_iter().skip(start).take(page_size as usize).collect();
    json!({
        "records": page_recs,
        "total_count": total,
    })
}
