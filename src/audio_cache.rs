use std::path::PathBuf;
use std::time::Duration;

fn sanitize_hash(hash: &str) -> Option<String> {
    let h: String = hash
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect();
    if h.is_empty() {
        None
    } else {
        Some(h)
    }
}

pub fn dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wmplayer")
        .join("audio")
}

pub fn file_path(hash: &str) -> Option<PathBuf> {
    Some(dir().join(sanitize_hash(hash)?))
}

pub fn lookup_url(hash: &str) -> Option<String> {
    let name = sanitize_hash(hash)?;
    let path = dir().join(&name);
    let meta = std::fs::metadata(&path).ok()?;
    if meta.is_file() && meta.len() > 1024 {
        Some(format!("/__cache/{name}"))
    } else {
        None
    }
}

pub fn detect_audio_mime(path: &std::path::Path) -> mime_guess::mime::Mime {
    if let Ok(mut f) = std::fs::File::open(path) {
        use std::io::Read;
        let mut magic = [0u8; 12];
        if let Ok(n) = f.read(&mut magic) {
            if n >= 4 && &magic[0..4] == b"fLaC" {
                return "audio/flac".parse().unwrap();
            }
            if n >= 4 && &magic[0..4] == b"OggS" {
                return "audio/ogg".parse().unwrap();
            }
            if n >= 8 && (&magic[4..8] == b"ftyp" || &magic[4..8] == b"M4A ") {
                return "audio/mp4".parse().unwrap();
            }
            if n >= 4 && &magic[0..4] == b"RIFF" {
                return "audio/wav".parse().unwrap();
            }
        }
    }
    "audio/mpeg".parse().unwrap()
}

pub async fn store(hash: &str, urls: &[String]) -> Result<String, String> {
    if let Some(u) = lookup_url(hash) {
        return Ok(u);
    }
    let path = file_path(hash).ok_or_else(|| "invalid hash".to_string())?;
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("part");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    for url in urls {
        let url = url.trim();
        if url.is_empty() {
            continue;
        }
        match fetch_to(&client, url, &tmp).await {
            Ok(()) => {
                std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
                return lookup_url(hash).ok_or_else(|| "cache missing after write".into());
            }
            Err(_) => {
                let _ = std::fs::remove_file(&tmp);
            }
        }
    }
    Err("all urls failed".into())
}

async fn fetch_to(client: &reqwest::Client, url: &str, dest: &PathBuf) -> Result<(), String> {
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("http {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() < 1024 {
        return Err("too small".into());
    }
    std::fs::write(dest, &bytes).map_err(|e| e.to_string())
}
