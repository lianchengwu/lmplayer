// 播放列表管理模块
// 统一管理播放列表和播放控制逻辑

// 全局播放状态
let currentPlaylist = {
    songs: [],
    currentIndex: -1,
    playMode: 'normal', // normal, shuffle, repeat_one, repeat_all
    shuffleMode: false,
    repeatMode: 'off', // off, one, all
    name: '播放列表'
};

// 播放状态标志
let isPlaylistLoaded = false;

// 初始化播放列表管理器
async function initPlaylistManager() {
    console.log('🎵 初始化播放列表管理器');
    
    try {
        // 从后端加载播放列表
        await loadPlaylistFromCache();
        console.log('✅ 播放列表管理器初始化完成');
    } catch (error) {
        console.error('❌ 播放列表管理器初始化失败:', error);
    }
}

// 从缓存加载播放列表
async function loadPlaylistFromCache() {
    try {
        // 动态导入 PlaylistService
        const { GetPlaylist } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await GetPlaylist();
        
        if (response && response.success) {
            currentPlaylist = response.data;
            isPlaylistLoaded = true;
            console.log('📋 从缓存加载播放列表成功:', currentPlaylist);

            // 更新UI显示
            updatePlaylistUI();
            return true;
        } else {
            console.warn('⚠️ 加载播放列表失败:', response?.message || '未知错误');
            // 即使加载失败，也要设置为已加载状态并显示空播放列表
            isPlaylistLoaded = true;
            updatePlaylistUI();
            return false;
        }
    } catch (error) {
        console.error('❌ 加载播放列表失败，已回退为空播放列表:', error);
        // 即使出现异常，也要设置为已加载状态并显示空播放列表
        currentPlaylist = {
            songs: [],
            currentIndex: -1,
            playMode: 'normal',
            shuffleMode: false,
            repeatMode: 'off',
            name: '播放列表'
        };
        isPlaylistLoaded = true;
        updatePlaylistUI();
        return false;
    }
}

// 设置播放列表（歌单播放）
async function setPlaylist(songs, currentIndex = 0, name = '播放列表', clearFirst = true, playMode = 'repeat_all') {
    try {
        console.log('🎵 设置播放列表:', { songs: songs.length, currentIndex, name, clearFirst, playMode });
        console.log('🎵 第一首歌曲原始数据:', songs[0]);

        // 转换歌曲格式
        const playlistSongs = songs.map((song, index) => {
            const convertedSong = {
                hash: song.hash || '',
                songname: song.songname || '',
                filename: song.filename || '',
                author_name: song.author_name || '',
                album_name: song.album_name || song.album || '',
                album_id: song.album_id || '',
                time_length: parseInt(song.time_length) || 0,
                union_cover: song.union_cover || ''
            };

            if (index === 0) {
                console.log('🎵 第一首歌曲原始数据:', song);
                console.log('🎵 第一首歌曲转换后数据:', convertedSong);
                console.log('🎵 歌名字段检查:', {
                    'song.songname': song.songname,
                    'convertedSong.songname': convertedSong.songname,
                    'songname类型': typeof song.songname
                });
            }

            return convertedSong;
        });

        const request = {
            songs: playlistSongs,
            current_index: currentIndex,
            name: name,
            play_mode: playMode,
            clear_first: clearFirst
        };

        console.log('🎵 发送到后端的请求:', request);

        // 动态导入 PlaylistService
        const { SetPlaylist } = await import('./bindings/wmplayer/playlistservice.js');

        if (!SetPlaylist) {
            console.error('❌ SetPlaylist服务不可用');
            return false;
        }

        const response = await SetPlaylist(request);

        console.log('🎵 后端响应:', response);

        if (response && response.success) {
            currentPlaylist = response.data;
            isPlaylistLoaded = true;
            console.log('✅ 设置播放列表成功');
            console.log('✅ 播放列表数据:', currentPlaylist);

            // 更新UI显示
            updatePlaylistUI();
            return true;
        } else {
            console.error('❌ 设置播放列表失败:', response?.message || '未知错误');
            console.error('❌ 完整响应:', response);
            return false;
        }
    } catch (error) {
        console.error('❌ 设置播放列表失败:', error);
        return false;
    }
}

// 添加歌曲到播放列表（单曲播放）
async function addToPlaylist(song, insert = false) {
    try {
        console.log('🎵 添加歌曲到播放列表:',  song.songname);

        // 转换歌曲格式
        const playlistSong = {
            hash: song.hash || '',
            songname: song.songname || '',
            filename: song.filename || '',
            author_name: song.author_name || song.author_name || '',
            album_name: song.album_name || song.album || '',
            album_id: song.album_id || '',
            time_length: parseInt(song.time_length) || 0,
            union_cover: song.union_cover || ''
        };
        
        const request = {
            song: playlistSong,
            insert: insert
        };
        
        // 动态导入 PlaylistService
        const { AddToPlaylist } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await AddToPlaylist(request);
        
        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('✅ 添加歌曲到播放列表成功');
            
            // 更新UI显示
            updatePlaylistUI();
            return true;
        } else {
            console.warn('⚠️ 添加歌曲到播放列表失败:', response?.message || '未知错误');
            return false;
        }
    } catch (error) {
        console.error('❌ 添加歌曲到播放列表失败:', error);
        return false;
    }
}

// 获取当前播放的歌曲
function getCurrentSong() {
    // 减少日志输出频率 - 只在调试模式下输出详细日志
    const isDebugMode = window.location.search.includes('debug=true');

    if (isDebugMode) {
        console.log('🎵 获取当前歌曲 - isPlaylistLoaded:', isPlaylistLoaded);
        console.log('🎵 获取当前歌曲 - currentPlaylist:', currentPlaylist);
    }

    if (!isPlaylistLoaded) {
        if (isDebugMode) console.log('❌ 播放列表未加载');
        return null;
    }

    if (!currentPlaylist || !currentPlaylist.songs) {
        if (isDebugMode) console.log('❌ 播放列表数据无效');
        return null;
    }

    // 兼容不同的字段名格式（Go 后端可能返回 CurrentIndex 或 current_index）
    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? -1;

    if (isDebugMode) {
        console.log('🎵 当前索引:', currentIndex, '歌曲总数:', currentPlaylist.songs.length);
    }

    if (currentIndex < 0 || currentIndex >= currentPlaylist.songs.length) {
        if (isDebugMode) console.log('❌ 当前索引超出范围');
        return null;
    }

    const currentSong = currentPlaylist.songs[currentIndex];
    // console.log('🎵 当前歌曲:', currentSong);
    return currentSong;
}

// 获取下一首歌曲
async function getNextSong() {
    try {
        // 动态导入 PlaylistService
        const { GetNextSong } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await GetNextSong();
        
        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('🎵 获取下一首歌曲成功');
            console.log('🎵 更新后的播放列表:', currentPlaylist);
            console.log('🎵 当前索引:', currentPlaylist.current_index ?? currentPlaylist.CurrentIndex);
            console.log('🎵 歌曲总数:', currentPlaylist.songs?.length);

            // 更新UI显示
            updatePlaylistUI();
            const nextSong = getCurrentSong();
            console.log('🎵 下一首歌曲:', nextSong);
            return nextSong;
        } else {
            console.warn('⚠️ 获取下一首歌曲失败:', response?.message || '未知错误');
            console.warn('⚠️ 完整响应:', response);
            return null;
        }
    } catch (error) {
        console.error('❌ 获取下一首歌曲失败:', error);
        return null;
    }
}

// 获取上一首歌曲
async function getPreviousSong() {
    try {
        // 动态导入 PlaylistService
        const { GetPreviousSong } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await GetPreviousSong();
        
        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('🎵 获取上一首歌曲成功');
            
            // 更新UI显示
            updatePlaylistUI();
            return getCurrentSong();
        } else {
            console.warn('⚠️ 获取上一首歌曲失败:', response?.message || '未知错误');
            return null;
        }
    } catch (error) {
        console.error('❌ 获取上一首歌曲失败:', error);
        return null;
    }
}

// 设置当前播放索引
async function setCurrentIndex(index) {
    try {
        // 动态导入 PlaylistService
        const { SetCurrentIndex } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await SetCurrentIndex(index);
        
        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('🎵 设置当前播放索引成功:', index);
            
            // 更新UI显示
            updatePlaylistUI();
            return getCurrentSong();
        } else {
            console.error('❌ 设置当前播放索引失败:', response?.message || '未知错误');
            return null;
        }
    } catch (error) {
        console.error('❌ 设置当前播放索引失败:', error);
        return null;
    }
}

// 更新播放模式
async function updatePlayMode(shuffleMode, repeatMode) {
    try {
        const request = {
            shuffle_mode: shuffleMode,
            repeat_mode: repeatMode
        };

        // 动态导入 PlaylistService
        const { UpdatePlayMode } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await UpdatePlayMode(request);

        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('🎵 更新播放模式成功:', { shuffleMode, repeatMode });

            // 更新UI显示
            updatePlaylistUI();
            return true;
        } else {
            console.error('❌ 更新播放模式失败:', response?.message || '未知错误');
            return false;
        }
    } catch (error) {
        console.error('❌ 更新播放模式失败:', error);
        return false;
    }
}

// 检查是否有下一首歌曲
function hasNext() {
    if (!isPlaylistLoaded || !currentPlaylist || !currentPlaylist.songs) {
        console.log('❌ 播放列表未加载或无效');
        return false;
    }

    // 兼容不同的字段名格式
    const playMode = currentPlaylist.play_mode || currentPlaylist.PlayMode || 'normal';
    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? 0;
    const songsLength = currentPlaylist.songs.length;

    console.log('🎵 检查是否有下一首:', { playMode, currentIndex, songsLength });

    // 如果播放列表为空
    if (songsLength === 0) {
        return false;
    }

    // 根据播放模式判断
    switch (playMode) {
        case 'repeat_one':
            // 单曲循环，总是有下一首（重复当前歌曲）
            return true;
        case 'repeat_all':
            // 列表循环，总是有下一首
            return true;
        case 'shuffle':
            // 随机播放，如果有随机队列或者可以重新生成，就有下一首
            return true;
        default:
            // 正常播放，检查是否还有下一首
            return currentIndex < songsLength - 1;
    }
}

// 获取下一首歌曲（只读，不改变当前播放列表状态）
function peekNextSong() {
    if (!isPlaylistLoaded || !currentPlaylist || !Array.isArray(currentPlaylist.songs)) {
        return null;
    }

    const songs = currentPlaylist.songs;
    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? -1;
    const repeatMode = currentPlaylist.repeat_mode ?? currentPlaylist.repeatMode ?? 'off';
    const shuffleMode = currentPlaylist.shuffle_mode ?? currentPlaylist.shuffleMode ?? false;
    const playlistName = currentPlaylist.name ?? '';

    if (songs.length === 0 || currentIndex < 0 || currentIndex >= songs.length) {
        return null;
    }

    // 安全策略：随机播放 / FM / 单曲循环不做预判，避免预缓存错歌
    if (shuffleMode || playlistName === '私人FM' || repeatMode === 'one') {
        return null;
    }

    if (currentIndex + 1 < songs.length) {
        return songs[currentIndex + 1];
    }

    if (repeatMode === 'all' && songs.length > 0) {
        return songs[0];
    }

    return null;
}

// 清空播放列表
async function clearPlaylist() {
    try {
        // 动态导入 PlaylistService
        const { ClearPlaylist } = await import('./bindings/wmplayer/playlistservice.js');
        const response = await ClearPlaylist();
        
        if (response && response.success) {
            currentPlaylist = response.data;
            console.log('🎵 清空播放列表成功');
            
            // 更新UI显示
            updatePlaylistUI();
            return true;
        } else {
            console.error('❌ 清空播放列表失败:', response?.message || '未知错误');
            return false;
        }
    } catch (error) {
        console.error('❌ 清空播放列表失败:', error);
        return false;
    }
}

// 更新播放列表UI显示
function updatePlaylistUI() {
    // 更新右侧播放列表显示
    if (window.updateRightSidebarPlaylist) {
        const songs = currentPlaylist.songs.map(song => ({
            hash: song.hash,
            songname: song.songname,
            filename: song.filename,
            author_name: song.author_name,
            album_name: song.album_name,
            album_id: song.album_id,
            time_length: song.time_length,
            union_cover: song.union_cover
        }));

        window.updateRightSidebarPlaylist(songs, currentPlaylist.current_index, currentPlaylist.name);
    }

    // 恢复上次播放的歌曲信息到播放器界面（但不播放）
    restoreLastPlayingSong();

    // 更新播放模式按钮状态
    updatePlayModeButtons();
}

// 恢复上次播放的歌曲信息到播放器界面（但不播放）
function restoreLastPlayingSong() {
    // 检查是否有有效的播放列表和当前索引
    if (!currentPlaylist || !currentPlaylist.songs || currentPlaylist.songs.length === 0) {
        console.log('🎵 没有播放列表或播放列表为空，跳过歌曲信息恢复');
        return;
    }

    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? -1;
    if (currentIndex < 0 || currentIndex >= currentPlaylist.songs.length) {
        console.log('🎵 当前索引无效，跳过歌曲信息恢复');
        return;
    }

    const currentSong = currentPlaylist.songs[currentIndex];
    if (!currentSong) {
        console.log('🎵 当前歌曲不存在，跳过歌曲信息恢复');
        return;
    }

    console.log('🎵 恢复上次播放的歌曲信息:', currentSong.songname);

    // 只更新歌曲信息显示，不播放
    if (window.updateSongInfo && typeof window.updateSongInfo === 'function') {
        try {
            // 转换为统一格式
            const legacySong = {
                hash: currentSong.hash,
                songname: currentSong.songname,
                filename: currentSong.filename,
                author_name: currentSong.author_name,
                album_name: currentSong.album_name,
                album_id: currentSong.album_id,
                time_length: currentSong.time_length,
                union_cover: currentSong.union_cover
            };

            window.updateSongInfo(legacySong);
            console.log('✅ 歌曲信息恢复成功');

            // 同时更新播放器控制器的当前歌曲信息（但不播放）
            if (window.PlayerController && window.PlayerController.setCurrentSongInfo) {
                window.PlayerController.setCurrentSongInfo(legacySong);
            } else if (window.audioPlayer && typeof window.audioPlayer === 'function') {
                const player = window.audioPlayer();
                if (player) {
                    // 只设置歌曲信息，不设置播放地址
                    player.currentSong = legacySong;
                }
            }

        } catch (error) {
            console.error('❌ 恢复歌曲信息失败:', error);
        }
    } else {
        console.warn('⚠️ updateSongInfo 函数不可用，无法恢复歌曲信息');
    }
}

// 更新播放模式按钮状态
function updatePlayModeButtons() {
    // 更新随机播放按钮
    const shuffleBtn = document.querySelector('.shuffle-btn');
    const shuffleIcon = shuffleBtn?.querySelector('i');
    if (shuffleBtn && shuffleIcon) {
        if (currentPlaylist.shuffle_mode) {
            shuffleBtn.classList.add('active');
            shuffleIcon.className = 'fas fa-random';  // 激活状态：随机图标
            shuffleBtn.title = '关闭随机播放';
        } else {
            shuffleBtn.classList.remove('active');
            shuffleIcon.className = 'fas fa-list-ol';  // 非激活状态：顺序列表图标
            shuffleBtn.title = '随机播放';
        }
    }
    
    // 更新循环播放按钮
    const repeatBtn = document.querySelector('.repeat-btn');
    const repeatIcon = repeatBtn?.querySelector('i');
    if (repeatBtn && repeatIcon) {
        repeatBtn.classList.remove('active', 'one-mode', 'all-mode');

        switch (currentPlaylist.repeat_mode) {
            case 'off':
                repeatIcon.className = 'fas fa-list';  // 列表播放图标
                repeatBtn.title = '列表播放';
                break;
            case 'one':
                repeatIcon.className = 'fas fa-redo';  // 单曲循环图标
                repeatBtn.classList.add('active', 'one-mode');
                repeatBtn.title = '单曲循环';
                break;
            case 'all':
                repeatIcon.className = 'fas fa-retweet';  // 列表循环图标
                repeatBtn.classList.add('active', 'all-mode');
                repeatBtn.title = '列表循环';
                break;
        }
    }
}

// 暴露到全局作用域
window.PlaylistManager = {
    init: initPlaylistManager,
    setPlaylist,
    addToPlaylist,
    getCurrentSong,
    getNextSong,
    getPreviousSong,
    setCurrentIndex,
    updatePlayMode,
    clearPlaylist,
    hasNext,
    peekNextSong,
    getCurrentPlaylist: () => currentPlaylist,
    isLoaded: () => isPlaylistLoaded
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPlaylistManager);
