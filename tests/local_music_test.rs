use std::fs;
use std::path::PathBuf;
use serde_json::json;
use wmplayer::Player;

// Helper to generate a minimal valid WAV file with silence
fn create_test_wav(path: &PathBuf, duration_secs: u32) {
    let sample_rate = 44100u32;
    let num_channels = 1u16;
    let bits_per_sample = 16u16;
    let byte_rate = sample_rate * num_channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = num_channels * (bits_per_sample / 8);
    let num_samples = sample_rate * duration_secs;
    let subchunk2_size = num_samples * num_channels as u32 * (bits_per_sample as u32 / 8);
    let chunk_size = 36 + subchunk2_size;

    let mut data = Vec::new();
    // RIFF header
    data.extend_from_slice(b"RIFF");
    data.extend_from_slice(&chunk_size.to_le_bytes());
    data.extend_from_slice(b"WAVE");

    // fmt subchunk
    data.extend_from_slice(b"fmt ");
    data.extend_from_slice(&16u32.to_le_bytes()); // subchunk1 size
    data.extend_from_slice(&1u16.to_le_bytes());  // PCM
    data.extend_from_slice(&num_channels.to_le_bytes());
    data.extend_from_slice(&sample_rate.to_le_bytes());
    data.extend_from_slice(&byte_rate.to_le_bytes());
    data.extend_from_slice(&block_align.to_le_bytes());
    data.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk
    data.extend_from_slice(b"data");
    data.extend_from_slice(&subchunk2_size.to_le_bytes());
    data.resize(data.len() + subchunk2_size as usize, 0);

    fs::write(path, data).expect("write test wav");
}

#[tokio::test]
async fn test_local_music_scan_and_ipc() {
    let tmp_dir = std::env::temp_dir().join(format!("lmplayer_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&tmp_dir).expect("create temp dir");

    let wav1 = tmp_dir.join("song1.wav");
    let wav2 = tmp_dir.join("song2.wav");
    let lrc2 = tmp_dir.join("song2.lrc");

    create_test_wav(&wav1, 2);
    create_test_wav(&wav2, 3);
    fs::write(&lrc2, "[00:01.00]Test Lyric Line 1\n[00:02.00]Test Lyric Line 2").expect("write lrc");

    let player = Player::lite().expect("player lite");

    // 1. Test scan_music_folders via IPC
    let scan_args = json!({
        "folderPaths": [tmp_dir.to_str().unwrap()]
    });
    let scan_resp = wmplayer::dispatch(&player, "scan_music_folders", scan_args).await;
    assert_eq!(scan_resp.get("success").and_then(|v| v.as_bool()), Some(true), "scan should succeed: {scan_resp:?}");

    let data = scan_resp.get("data").and_then(|v| v.as_array()).expect("data array");
    assert_eq!(data.len(), 2, "should scan 2 files");

    let first = &data[0];
    let hash = first.get("hash").and_then(|v| v.as_str()).expect("hash");
    let title = first.get("title").and_then(|v| v.as_str()).expect("title");
    assert!(title == "song1" || title == "song2", "title: {title}");

    // 2. Test get_cached_music_files via IPC
    let cached_resp = wmplayer::dispatch(&player, "get_cached_music_files", json!({})).await;
    assert_eq!(cached_resp.get("success").and_then(|v| v.as_bool()), Some(true));
    let cached_data = cached_resp.get("data").and_then(|v| v.as_array()).expect("cached data");
    assert_eq!(cached_data.len(), 2);

    // 3. Test get_cached_url with local- prefix (used by homepage.js for playback)
    let local_hash = format!("local-{hash}");
    let url_resp = wmplayer::dispatch(&player, "get_cached_url", json!({ "songHash": local_hash })).await;
    assert_eq!(url_resp.get("success").and_then(|v| v.as_bool()), Some(true));
    let local_url = url_resp.get("data").and_then(|v| v.as_str()).expect("local url");
    assert_eq!(local_url, format!("/__local/{hash}"));

    // 4. Test get_local_audio_url with file_path
    let local_audio_resp = wmplayer::dispatch(&player, "get_local_audio_url", json!({ "file_path": wav1.to_str().unwrap() })).await;
    assert_eq!(local_audio_resp.get("success").and_then(|v| v.as_bool()), Some(true));

    // 5. Test get_local_music_lyrics with file_path
    let lyrics_resp = wmplayer::dispatch(&player, "get_local_music_lyrics", json!({ "file_path": wav2.to_str().unwrap() })).await;
    assert_eq!(lyrics_resp.get("success").and_then(|v| v.as_bool()), Some(true));
    let lyrics_text = lyrics_resp.get("data").and_then(|v| v.as_str()).unwrap();
    assert!(lyrics_text.contains("Test Lyric Line 1"));

    // 6. Test HTTP streaming route /__local/{hash} with Range request
    use axum::extract::Path;
    use axum::http::Request;

    let req = Request::builder()
        .uri(format!("/__local/{hash}"))
        .header("Range", "bytes=0-100")
        .body(axum::body::Body::empty())
        .unwrap();

    let resp = wmplayer::local_music::serve_audio(Path(hash.to_string()), req).await;
    assert_eq!(resp.status(), axum::http::StatusCode::PARTIAL_CONTENT, "Range request should return 206 Partial Content");
    assert!(resp.headers().get("content-range").is_some(), "Should contain content-range header");

    // Full request
    let req_full = Request::builder()
        .uri(format!("/__local/{hash}"))
        .body(axum::body::Body::empty())
        .unwrap();
    let resp_full = wmplayer::local_music::serve_audio(Path(hash.to_string()), req_full).await;
    assert_eq!(resp_full.status(), axum::http::StatusCode::OK, "Full request should return 200 OK");
    assert_eq!(resp_full.headers().get("accept-ranges").and_then(|v| v.to_str().ok()), Some("bytes"));

    // Cleanup
    let _ = fs::remove_dir_all(&tmp_dir);
}
