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

const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/lianchengwu/lmplayer/releases/latest";

fn version_parts(raw: &str) -> Vec<u64> {
    raw.trim()
        .trim_start_matches(['v', 'V'])
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let latest = version_parts(latest);
    let current = version_parts(current);
    let len = latest.len().max(current.len());
    for i in 0..len {
        let next = latest.get(i).copied().unwrap_or(0);
        let now = current.get(i).copied().unwrap_or(0);
        if next != now {
            return next > now;
        }
    }
    false
}

fn update_result(ok_check: bool, message: &str, has_update: bool, latest: &str, notes: &str, url: &str) -> Value {
    let current = env!("CARGO_PKG_VERSION");
    json!({
        "Success": ok_check,
        "success": ok_check,
        "HasUpdate": has_update,
        "hasUpdate": has_update,
        "LatestVersion": latest,
        "latestVersion": latest,
        "CurrentVersion": current,
        "currentVersion": current,
        "ReleaseNotes": notes,
        "releaseNotes": notes,
        "ReleaseURL": url,
        "releaseURL": url,
        "Message": message,
        "message": message,
    })
}

async fn check_github_updates() -> Value {
    let current = env!("CARGO_PKG_VERSION");
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("wmplayer/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(err) => return update_result(false, &format!("无法发起更新检查: {err}"), false, current, "", ""),
    };

    let response = match client
        .get(GITHUB_LATEST_RELEASE)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => return update_result(false, &format!("无法连接 GitHub: {err}"), false, current, "", ""),
    };

    if !response.status().is_success() {
        let status = response.status();
        let message = if status.as_u16() == 404 {
            "GitHub 上还没有已发布的版本".to_string()
        } else {
            format!("GitHub 返回 {status}")
        };
        return update_result(false, &message, false, current, "", "");
    }

    let body = match response.text().await {
        Ok(body) => body,
        Err(err) => return update_result(false, &format!("读取版本信息失败: {err}"), false, current, "", ""),
    };
    let release: Value = match serde_json::from_str(&body) {
        Ok(release) => release,
        Err(_) => return update_result(false, "GitHub 返回了无法解析的版本信息", false, current, "", ""),
    };

    let tag = release.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").trim();
    if tag.is_empty() {
        return update_result(false, "GitHub 发布信息缺少版本号", false, current, "", "");
    }
    let latest = tag.trim_start_matches(['v', 'V']);
    let mut notes = release.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if notes.chars().count() > 4000 {
        notes = notes.chars().take(4000).collect();
        notes.push_str("…");
    }
    let url = release
        .get("html_url")
        .and_then(|v| v.as_str())
        .filter(|url| url.starts_with("https://github.com/"))
        .unwrap_or("https://github.com/lianchengwu/lmplayer/releases");
    let has_update = is_newer_version(latest, current);
    let message = if has_update { "发现新版本" } else { "当前已是最新版本" };
    update_result(true, message, has_update, latest, &notes, url)
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
        "get_cloud_songs" | "user_cloud" => wrap(home.user_cloud(arg_u32(&args, "page", 1), arg_u32(&args, "pageSize", 50)).await),
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
            let settings_path = config_dir().join("settings.json");
            let save_history = read_json(&settings_path, json!({}))
                .pointer("/privacy/saveHistory")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            let path = cache_dir().join("history.json");
            let mut data = read_json(&path, json!({ "records": [], "total_count": 0 }));
            if save_history {
                let req = args.get("request").cloned().unwrap_or_else(|| args.clone());
                add_history_record(&mut data, &req);
                write_json(&path, &data);
            }
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
        "set_osd_color" => {
            let color = arg_str(&args, "color");
            crate::osd::set_osd_color(&color);
            json!({ "success": true, "color": color })
        }
        "get_osd_color" => json!({ "success": true, "color": crate::osd::get_osd_color() }),
        "set_osd_align" => {
            let align = crate::osd::set_osd_align(&arg_str(&args, "align"));
            json!({ "success": true, "align": align })
        }
        "get_osd_align" => json!({ "success": true, "align": crate::osd::get_osd_align() }),
        "set_osd_font" => {
            let font = crate::osd::set_osd_font(&arg_str(&args, "font"));
            json!({ "success": true, "font": font })
        }
        "get_osd_font" => json!({ "success": true, "font": crate::osd::get_osd_font() }),
        "set_playback_state" => {
            let playing = arg_bool(&args, "playing");
            crate::sleep_inhibitor::set_playback_state(playing);
            ok(json!({
                "success": true,
                "playing": playing,
                "inhibited": crate::sleep_inhibitor::is_inhibited()
            }))
        }
        "is_sleep_inhibited" => json!({
            "success": true,
            "inhibited": crate::sleep_inhibitor::is_inhibited(),
            "playing": crate::sleep_inhibitor::is_playing(),
        }),
        "update_mpris_playback_status" => {
            let status = arg_str(&args, "status");
            let is_playing = status.eq_ignore_ascii_case("playing");
            crate::sleep_inhibitor::set_playback_state(is_playing);
            ok(json!({ "success": true, "status": status }))
        }
        "get_media_key_status" => json!({ "registered": false }),
        "check_for_updates" => check_github_updates().await,
        "get_current_version" => json!(env!("CARGO_PKG_VERSION")),
        "get_download_records" => ok(json!({ "records": [], "total_count": 0 })),
        "add_download_record" | "delete_download_record" | "clear_download_records" => ok(json!({})),
        "open_file_folder" => {
            let fp = arg_str(&args, "filePath");
            let p = std::path::Path::new(&fp);
            let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
            crate::open_with_system(dir);
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
        "list_system_fonts" => {
            let fonts = match tokio::task::spawn_blocking(list_system_fonts).await {
                Ok(fonts) => fonts,
                Err(_) => Vec::new(),
            };
            ok(json!(fonts))
        }
        other => fail(format!("unknown cmd {other}")),
    }
}

fn command_stdout(program: &str, args: &[&str], timeout: std::time::Duration) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut child = std::process::Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut buf = Vec::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_end(&mut buf);
                }
                return Some(buf);
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(_) => return None,
        }
    }
}

fn decode_command_output(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if bytes.len() >= 4 && bytes[1] == 0 && bytes[3] == 0 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|u| *u != 0)
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg_attr(all(target_os = "windows", not(test)), allow(dead_code))]
fn is_font_style_variant(name: &str) -> bool {
    const WORDS: &[&str] = &[
        "thin", "hairline", "extralight", "ultralight", "light", "regular", "book", "normal",
        "medium", "semibold", "demibold", "bold", "extrabold", "ultrabold", "black", "heavy",
        "italic", "oblique", "condensed", "extracondensed", "semicondensed", "expanded", "narrow",
    ];
    const CJK: &[&str] = &["细体", "特细", "粗体", "特粗", "常规", "中黑", "中等"];
    if CJK.iter().any(|w| name.contains(w)) {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    lower
        .split(|c: char| matches!(c, ' ' | '_' | '-'))
        .any(|tok| WORDS.contains(&tok))
}

#[cfg_attr(all(target_os = "windows", not(test)), allow(dead_code))]
fn preferred_font_label(names: &[&str]) -> String {
    let has_cjk = |s: &str| s.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    names
        .iter()
        .copied()
        .find(|s| has_cjk(s) && !is_font_style_variant(s))
        .or_else(|| names.iter().copied().find(|s| !is_font_style_variant(s)))
        .unwrap_or(names[0])
        .to_string()
}

fn usable_font_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 120 && !name.chars().any(|c| c.is_control())
}

#[cfg_attr(all(target_os = "windows", not(test)), allow(dead_code))]
fn parse_fontconfig_families(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in text.lines() {
        let names: Vec<&str> = line
            .split(',')
            .map(str::trim)
            .filter(|s| usable_font_name(s))
            .collect();
        if names.is_empty() {
            continue;
        }
        let family = names[0];
        if !seen.insert(family.to_string()) {
            continue;
        }
        out.push((family.to_string(), preferred_font_label(&names)));
        if out.len() >= 2000 {
            break;
        }
    }
    out
}

fn font_entries(pairs: Vec<(String, String)>) -> Vec<Value> {
    pairs
        .into_iter()
        .map(|(family, label)| json!({ "family": family, "label": label }))
        .collect()
}

#[cfg(target_os = "windows")]
fn list_system_fonts() -> Vec<Value> {
    let script = r#"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"#;
    let Some(buf) = command_stdout(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", script],
        std::time::Duration::from_secs(8),
    ) else {
        return Vec::new();
    };
    let mut pairs = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in decode_command_output(&buf).lines() {
        let name = line.trim();
        if !usable_font_name(name) || !seen.insert(name.to_string()) {
            continue;
        }
        pairs.push((name.to_string(), name.to_string()));
        if pairs.len() >= 2000 {
            break;
        }
    }
    font_entries(pairs)
}

#[cfg(not(target_os = "windows"))]
fn list_system_fonts() -> Vec<Value> {
    let Some(buf) = command_stdout(
        "fc-list",
        &["-f", "%{family}\n"],
        std::time::Duration::from_secs(3),
    ) else {
        return Vec::new();
    };
    font_entries(parse_fontconfig_families(&decode_command_output(&buf)))
}

#[cfg(test)]
mod font_tests {
    use super::parse_fontconfig_families;

    #[test]
    fn parses_fontconfig_families() {
        let text = "\
Microsoft YaHei,微软雅黑,Microsoft YaHei Light,微软雅黑 Light
Noto Sans CJK JP
Source Han Serif CN,思源宋体 CN,Source Han Serif CN Medium,思源宋体 CN Medium
PingFang SC,苹方_细体
Microsoft YaHei,微软雅黑
Noto Sans,Noto Sans ExtraCondensed Light

";
        let fonts = parse_fontconfig_families(text);
        assert_eq!(fonts.iter().filter(|f| f.0 == "Microsoft YaHei").count(), 1);
        assert_eq!(fonts.iter().find(|f| f.0 == "Microsoft YaHei").unwrap().1, "微软雅黑");
        assert_eq!(fonts.iter().find(|f| f.0 == "Source Han Serif CN").unwrap().1, "思源宋体 CN");
        assert_eq!(fonts.iter().find(|f| f.0 == "PingFang SC").unwrap().1, "PingFang SC");
        assert_eq!(fonts.iter().find(|f| f.0 == "Noto Sans CJK JP").unwrap().1, "Noto Sans CJK JP");
        assert_eq!(fonts.iter().find(|f| f.0 == "Noto Sans").unwrap().1, "Noto Sans");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_playback_state_ipc() {
        let _guard = crate::sleep_inhibitor::TEST_MUTEX.lock();
        let player = crate::Player::lite().unwrap();

        // Set playback state to true
        let res1 = dispatch(&player, "set_playback_state", json!({ "playing": true })).await;
        assert_eq!(res1["success"], true);
        assert_eq!(res1["data"]["playing"], true);
        assert!(crate::sleep_inhibitor::is_playing());

        // Query status
        let res2 = dispatch(&player, "is_sleep_inhibited", json!({})).await;
        assert_eq!(res2["success"], true);
        assert_eq!(res2["playing"], true);

        // Set playback state to false via update_mpris_playback_status
        let res3 = dispatch(&player, "update_mpris_playback_status", json!({ "status": "Paused" })).await;
        assert_eq!(res3["success"], true);
        assert!(!crate::sleep_inhibitor::is_playing());
    }

    #[test]
    fn newer_release_is_detected() {
        assert!(is_newer_version("v0.9.7", "0.9.6"));
        assert!(is_newer_version("0.10.0", "0.9.6"));
        assert!(!is_newer_version("v0.9.6", "0.9.6"));
        assert!(!is_newer_version("0.9.5", "0.9.6"));
        assert!(!is_newer_version("v0.9", "0.9.0"));
    }


    #[tokio::test]
    async fn test_cloud_songs_ipc_dispatch() {
        let player = crate::Player::lite().unwrap();
        let res = dispatch(&player, "get_cloud_songs", json!({ "page": 1, "pageSize": 10 })).await;
        // Should be a valid ApiResponse with success field
        assert!(res.get("success").is_some());
    }
}
