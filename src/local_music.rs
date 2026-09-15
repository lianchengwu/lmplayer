use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMusicFile {
    pub file_path: String,
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub album_name: String,
    #[serde(default)]
    pub year: i32,
    #[serde(default)]
    pub genre: String,
    pub time_length: i64,
    #[serde(default)]
    pub bitrate: u32,
    pub file_size: u64,
    pub format: String,
    pub hash: String,
    pub last_modified: i64,
    #[serde(default)]
    pub union_cover: String,
    #[serde(default)]
    pub lyrics: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocalMusicStats {
    pub total_songs: usize,
    pub total_author_names: usize,
    pub total_albums: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderMusicGroup {
    pub folder_path: String,
    pub folder_name: String,
    pub music_files: Vec<LocalMusicFile>,
    pub stats: LocalMusicStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMusicResponse {
    pub success: bool,
    pub message: String,
    pub data: Vec<LocalMusicFile>,
    pub folder_groups: Vec<FolderMusicGroup>,
    pub stats: LocalMusicStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheData {
    pub timestamp: i64,
    pub music_files: Vec<LocalMusicFile>,
}

static LOCAL_MUSIC_MAP: LazyLock<RwLock<HashMap<String, PathBuf>>> =
    LazyLock::new(|| RwLock::new(load_persisted_map()));

fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wmplayer")
}

fn music_cache_file() -> PathBuf {
    cache_dir().join("music_cache.json")
}

fn local_map_file() -> PathBuf {
    cache_dir().join("local_music_map.json")
}

fn covers_dir() -> PathBuf {
    cache_dir().join("covers")
}

fn load_persisted_map() -> HashMap<String, PathBuf> {
    let p = local_map_file();
    if let Ok(raw) = fs::read_to_string(&p) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
            return map
                .into_iter()
                .map(|(k, v)| (k, PathBuf::from(v)))
                .collect();
        }
    }
    // Fallback: populate from music_cache.json if map file doesn't exist
    let c = music_cache_file();
    if let Ok(raw) = fs::read_to_string(&c) {
        if let Ok(data) = serde_json::from_str::<CacheData>(&raw) {
            let mut map = HashMap::new();
            for f in data.music_files {
                map.insert(f.hash.clone(), PathBuf::from(&f.file_path));
            }
            return map;
        }
    }
    HashMap::new()
}

fn save_persisted_map(map: &HashMap<String, PathBuf>) {
    let p = local_map_file();
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let strmap: HashMap<&str, String> = map
        .iter()
        .map(|(k, v)| (k.as_str(), v.to_string_lossy().to_string()))
        .collect();
    if let Ok(json) = serde_json::to_vec_pretty(&strmap) {
        let _ = fs::write(&p, json);
    }
}

pub fn lookup_path(hash: &str) -> Option<PathBuf> {
    let clean = hash.trim_start_matches("local-");
    let map = LOCAL_MUSIC_MAP.read().ok()?;
    map.get(clean).cloned()
}

pub fn lookup_hash_by_path(path: &str) -> Option<String> {
    let target = Path::new(path);
    let map = LOCAL_MUSIC_MAP.read().ok()?;
    for (hash, p) in map.iter() {
        if p == target {
            return Some(hash.clone());
        }
    }
    None
}

pub fn lookup_cover_path(hash: &str) -> Option<PathBuf> {
    let clean = hash.trim_start_matches("local-");
    let base = covers_dir().join(clean);
    for ext in &["jpg", "jpeg", "png", "webp"] {
        let candidate = base.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn register_file(path: &Path) -> String {
    let hash = calculate_file_hash(path).unwrap_or_else(|| {
        format!("{:x}", md5::compute(path.to_string_lossy().as_bytes()))
    });
    if let Ok(mut map) = LOCAL_MUSIC_MAP.write() {
        map.insert(hash.clone(), path.to_path_buf());
        save_persisted_map(&map);
    }
    hash
}

pub fn is_supported_audio(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "mp3" | "flac" | "wav" | "m4a" | "aac" | "ogg" | "wma"
    )
}

pub fn calculate_file_hash(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = md5::Context::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.consume(&buf[..n]);
    }
    Some(format!("{:x}", hasher.compute()))
}

fn save_cover_to_cache(hash: &str, data: &[u8], mime_type: Option<&str>) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let ext = match mime_type.unwrap_or("") {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let dir = covers_dir();
    let _ = fs::create_dir_all(&dir);
    let filename = format!("{hash}.{ext}");
    let file_path = dir.join(&filename);
    if !file_path.exists() {
        let _ = fs::write(&file_path, data);
    }
    Some(format!("/__local_cover/{hash}"))
}

pub fn parse_music_file(path: &Path) -> Option<LocalMusicFile> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let file_size = meta.len();
    let last_modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let filename = path.file_name()?.to_string_lossy().to_string();
    let format = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let name_without_ext = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.clone());

    let file_path = path.to_string_lossy().to_string();
    let hash = calculate_file_hash(path).unwrap_or_else(|| {
        format!("{:x}", md5::compute(file_path.as_bytes()))
    });

    let mut title = name_without_ext.clone();
    let mut artist = "未知艺术家".to_string();
    let mut album_name = "未知专辑".to_string();
    let mut year = 0;
    let mut genre = String::new();
    let mut time_length = 0i64;
    let mut bitrate = 0u32;
    let mut union_cover = String::new();
    let mut lyrics = String::new();

    // Check sibling .lrc file
    let lrc_path = path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(lrc_content) = fs::read_to_string(&lrc_path) {
            lyrics = lrc_content;
        }
    }

    // Try parsing tags and properties with lofty
    if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
        let properties = tagged_file.properties();
        time_length = properties.duration().as_secs() as i64;
        bitrate = properties.audio_bitrate().unwrap_or(0);

        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            if let Some(t) = tag.title() {
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    title = trimmed.to_string();
                }
            }
            if let Some(a) = tag.artist() {
                let trimmed = a.trim();
                if !trimmed.is_empty() {
                    artist = trimmed.to_string();
                }
            }
            if let Some(alb) = tag.album() {
                let trimmed = alb.trim();
                if !trimmed.is_empty() {
                    album_name = trimmed.to_string();
                }
            }
            if let Some(y_item) = tag.get(lofty::tag::ItemKey::Year) {
                if let Some(text) = y_item.value().text() {
                    if let Ok(parsed) = text.trim().parse::<i32>() {
                        year = parsed;
                    }
                }
            }
            if let Some(g) = tag.genre() {
                genre = g.trim().to_string();
            }

            if lyrics.is_empty() {
                if let Some(lyr) = tag.get(lofty::tag::ItemKey::Lyrics) {
                    if let Some(text) = lyr.value().text() {
                        lyrics = text.trim().to_string();
                    }
                }
            }

            if let Some(pic) = tag.pictures().first() {
                let mime = pic.mime_type().map(|m| m.as_str());
                if let Some(cover_url) = save_cover_to_cache(&hash, pic.data(), mime) {
                    union_cover = cover_url;
                }
            }
        }
    }

    Some(LocalMusicFile {
        file_path,
        filename,
        title,
        artist,
        album_name,
        year,
        genre,
        time_length,
        bitrate,
        file_size,
        format,
        hash,
        last_modified,
        union_cover,
        lyrics,
    })
}

pub fn calculate_stats(files: &[LocalMusicFile]) -> LocalMusicStats {
    let mut artists = HashSet::new();
    let mut albums = HashSet::new();
    for f in files {
        let art = f.artist.trim();
        if !art.is_empty() && art != "未知艺术家" {
            artists.insert(art.to_string());
        }
        let alb = f.album_name.trim();
        if !alb.is_empty() && alb != "未知专辑" {
            albums.insert(alb.to_string());
        }
    }
    LocalMusicStats {
        total_songs: files.len(),
        total_author_names: artists.len(),
        total_albums: albums.len(),
    }
}

pub fn group_by_folder(files: &[LocalMusicFile]) -> Vec<FolderMusicGroup> {
    let mut map: BTreeMap<String, Vec<LocalMusicFile>> = BTreeMap::new();
    for f in files {
        let p = Path::new(&f.file_path);
        let folder_path = p
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        map.entry(folder_path).or_default().push(f.clone());
    }
    let mut groups = Vec::new();
    for (folder_path, mfiles) in map {
        let folder_name = Path::new(&folder_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_path.clone());
        let stats = calculate_stats(&mfiles);
        groups.push(FolderMusicGroup {
            folder_path,
            folder_name,
            stats,
            music_files: mfiles,
        });
    }
    groups
}

pub fn scan_folders(folder_paths: &[String]) -> LocalMusicResponse {
    if folder_paths.is_empty() {
        return LocalMusicResponse {
            success: false,
            message: "文件夹路径列表不能为空".into(),
            data: Vec::new(),
            folder_groups: Vec::new(),
            stats: LocalMusicStats::default(),
        };
    }

    let mut all_files = Vec::new();
    let mut seen_hashes = HashSet::new();
    let mut failed_count = 0;

    for fp in folder_paths {
        if fp.trim().is_empty() {
            continue;
        }
        let p = Path::new(fp);
        if !p.exists() || !p.is_dir() {
            failed_count += 1;
            continue;
        }
        for entry in walkdir::WalkDir::new(p)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !is_supported_audio(ext) {
                continue;
            }
            if let Some(mf) = parse_music_file(path) {
                if seen_hashes.insert(mf.hash.clone()) {
                    all_files.push(mf);
                }
            }
        }
    }

    // Update in-memory mapping & persist
    if let Ok(mut map) = LOCAL_MUSIC_MAP.write() {
        for f in &all_files {
            map.insert(f.hash.clone(), PathBuf::from(&f.file_path));
        }
        save_persisted_map(&map);
    }

    // Persist music cache
    let cache_data = CacheData {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        music_files: all_files.clone(),
    };
    if let Ok(raw) = serde_json::to_vec_pretty(&cache_data) {
        let p = music_cache_file();
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(p, raw);
    }

    let stats = calculate_stats(&all_files);
    let folder_groups = group_by_folder(&all_files);
    let mut msg = format!("成功扫描到 {} 首音乐", all_files.len());
    if failed_count > 0 {
        msg.push_str(&format!("，{} 个文件夹无效或无法读取", failed_count));
    }

    LocalMusicResponse {
        success: true,
        message: msg,
        data: all_files,
        folder_groups,
        stats,
    }
}

pub fn scan_folder(folder_path: &str) -> LocalMusicResponse {
    scan_folders(&[folder_path.to_string()])
}

pub fn get_cached_music() -> LocalMusicResponse {
    let p = music_cache_file();
    let Ok(raw) = fs::read_to_string(&p) else {
        return LocalMusicResponse {
            success: false,
            message: "没有找到缓存的音乐文件".into(),
            data: Vec::new(),
            folder_groups: Vec::new(),
            stats: LocalMusicStats::default(),
        };
    };

    let Ok(cache_data) = serde_json::from_str::<CacheData>(&raw) else {
        return LocalMusicResponse {
            success: false,
            message: "缓存数据损坏".into(),
            data: Vec::new(),
            folder_groups: Vec::new(),
            stats: LocalMusicStats::default(),
        };
    };

    // Make sure map has these entries
    if let Ok(mut map) = LOCAL_MUSIC_MAP.write() {
        for f in &cache_data.music_files {
            map.insert(f.hash.clone(), PathBuf::from(&f.file_path));
        }
    }

    let stats = calculate_stats(&cache_data.music_files);
    let folder_groups = group_by_folder(&cache_data.music_files);
    LocalMusicResponse {
        success: true,
        message: format!("成功加载 {} 首缓存音乐", cache_data.music_files.len()),
        data: cache_data.music_files,
        folder_groups,
        stats,
    }
}

pub fn get_lyrics(file_path: &str) -> Option<String> {
    let p = Path::new(file_path);
    if !p.is_file() {
        return None;
    }
    // Check .lrc first
    let lrc_path = p.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(s) = fs::read_to_string(&lrc_path) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    // Try lofty embedded lyrics
    if let Ok(tagged_file) = Probe::open(p).and_then(|pr| pr.read()) {
        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            if let Some(lyr) = tag.get(lofty::tag::ItemKey::Lyrics) {
                if let Some(text) = lyr.value().text() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

pub async fn select_folder() -> Result<Option<String>, String> {
    // Try rfd native dialog first
    let res = rfd::AsyncFileDialog::new()
        .set_title("选择音乐文件夹")
        .pick_folder()
        .await;

    if let Some(handle) = res {
        return Ok(Some(handle.path().to_string_lossy().to_string()));
    }

    // If user cancelled, check if zenity / kdialog is installed and rfd returned None because user cancelled or no portal
    Ok(None)
}

pub async fn serve_audio(
    axum::extract::Path(hash): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use tower_http::services::ServeFile;
    use tower_service::Service;

    let clean = hash.trim_start_matches("local-");
    let Some(path) = lookup_path(clean) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !path.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut svc = ServeFile::new(path);
    match svc.call(req).await {
        Ok(res) => res.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub async fn serve_cover(
    axum::extract::Path(hash): axum::extract::Path<String>,
) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;

    let clean = hash.trim_start_matches("local-");
    let Some(path) = lookup_cover_path(clean) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !path.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match fs::read(&path) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&path).first_or(mime_guess::mime::IMAGE_JPEG);
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
                    (header::CACHE_CONTROL, "public, max-age=86400"),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
