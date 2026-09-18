function argsObject(name, args) {
    const maps = {
        search: ['keyword', 'page', 'pageSize'],
        search_songs: ['keyword', 'page', 'pageSize'],
        search_artists: ['keyword', 'page', 'pageSize'],
        search_playlists: ['keyword', 'page', 'pageSize'],
        search_albums: ['keyword', 'page', 'pageSize'],
        search_mvs: ['keyword', 'page', 'pageSize'],
        get_search_suggest: ['keyword'],
        get_song_url: ['hash'],
        get_personal_fm_with_params: ['mode', 'songPoolID'],
        get_personal_fm_advanced: ['hash', 'songID', 'playTime', 'mode', 'songPoolID', 'isOverplay', 'remainSongCnt'],
        report_fm_action: ['hash', 'songID', 'action', 'playTime'],
        get_daily_recommend: ['platform'],
        get_recommend_songs: ['category'],
        get_album_detail: ['albumID'],
        get_album_songs: ['albumID', 'page', 'pageSize'],
        get_playlist_detail: ['playlistID'],
        get_playlist_songs_album: ['playlistID', 'page', 'pageSize'],
        get_favorite_playlist_songs: ['globalCollectionID'],
        add_favorite: ['request'],
        send_captcha: ['mobile'],
        login_with_phone: ['mobile', 'code'],
        claim_daily_vip: ['receive_day'],
        create_qr_code: ['key'],
        check_qr_status: ['key'],
        set_playlist: ['request'],
        add_to_playlist: ['request'],
        set_current_index: ['index'],
        update_play_mode: ['request'],
        add_play_history: ['request'],
        get_play_history: ['request'],
        save_settings: ['settings'],
        get_cached_url: ['songHash'],
        cache_audio_file: ['songHash', 'urls'],
        update_current_lyrics: ['text', 'song', 'artist', 'currentTime'],
        set_osd_enabled: ['enabled'],
        toggle_osd_lock: [],
        set_osd_locked: ['locked'],
        is_osd_locked: [],
        update_mpris_playback_status: ['status'],
        update_mpris_metadata: ['title', 'artist', 'album', 'artUrl', 'duration'],
        update_mpris_volume: ['volume'],
        update_mpris_position: ['position'],
        get_download_records: ['request'],
        add_download_record: ['request'],
        delete_download_record: ['request'],
        open_file_folder: ['filePath'],
        select_music_folder: [],
        get_cached_music_files: [],
        scan_music_folder: ['folderPath'],
        scan_music_folders: ['folderPaths'],
        get_local_audio_url: ['file_path'],
        get_local_music_lyrics: ['file_path'],
    }
    const keys = maps[name] || []
    const obj = {}
    keys.forEach((k, i) => {
        obj[k] = args[i]
    })
    return obj
}

export function cmd(name) {
    return async (...args) => {
        const res = await fetch('/__ipc', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cmd: name, args: argsObject(name, args) }),
        })
        if (!res.ok) {
            throw new Error(`ipc ${name} ${res.status}`)
        }
        return res.json()
    }
}
