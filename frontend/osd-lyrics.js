/**
 * OSD歌词功能模块
 * 负责桌面歌词的显示和控制
 */

// OSD歌词状态
let osdLyricsEnabled = true; // 桌面歌词是否打开
let osdLyricsLocked = false; // 桌面歌词是否锁定 (鼠标穿透)
let osdLyricsService = null; // 服务对象，初始化时设置
let osdLyricsInitialized = false; // 服务是否已初始化

// 存储需要清理的资源
const osdResources = {
    timers: new Set(),
    intervals: new Set(),
    listeners: new Map()
};

// 清理OSD资源
function cleanupOSDResources() {
    // 清理定时器
    osdResources.timers.forEach(id => clearTimeout(id));
    osdResources.intervals.forEach(id => clearInterval(id));
    
    // 清理事件监听器
    osdResources.listeners.forEach((listeners, element) => {
        listeners.forEach(({ event, handler }) => {
            try {
                element.removeEventListener(event, handler);
            } catch (error) {
                console.warn('清理OSD事件监听器时出错:', error);
            }
        });
    });
    
    // 清空集合
    osdResources.timers.clear();
    osdResources.intervals.clear();
    osdResources.listeners.clear();
    
    console.log('✅ OSD资源已清理');
}

// 页面卸载时清理OSD资源
window.addEventListener('beforeunload', cleanupOSDResources);

// 初始化OSD歌词功能
async function initOSDLyrics() {
    console.log('🎵 初始化OSD歌词功能');

    try {
        // 导入所有必要的绑定服务方法
        const { UpdateCurrentLyrics, SetEnabled, IsEnabled, ToggleOSDLock, SetOSDLocked, IsOSDLocked } = await import('./bindings/wmplayer/cacheservice.js');
        osdLyricsService = { UpdateCurrentLyrics, SetEnabled, IsEnabled, ToggleOSDLock, SetOSDLocked, IsOSDLocked };
        osdLyricsInitialized = true;
        console.log('✅ OSD歌词服务初始化完成');
        await updateOSDLockStatus();

        // 初始化UI
        initOSDLyricsUI();

    } catch (error) {
        console.error('❌ OSD歌词服务初始化失败:', error);
        osdLyricsInitialized = false;
    }
}

// 初始化OSD歌词UI
function initOSDLyricsUI() {
    const osdBtn = document.getElementById('osdLyricsBtn');
    if (osdBtn) {
        osdBtn.addEventListener('click', toggleOSDLyrics);
        console.log('✅ OSD歌词按钮事件已绑定');
    }

    const lockBtn = document.getElementById('osdLockBtn');
    if (lockBtn) {
        lockBtn.addEventListener('click', toggleOSDLock);
        console.log('✅ OSD歌词锁定按钮事件已绑定');
    }

    if (window.Events && window.Events.On) {
        window.Events.On('systray:toggle-osd-lock', () => {
            toggleOSDLock();
        });
    }
}

// 切换OSD歌词显示
async function toggleOSDLyrics() {
    console.log('🎵 toggleOSDLyrics 被调用');
    console.log('🎵 osdLyricsService:', osdLyricsService);
    console.log('🎵 osdLyricsInitialized:', osdLyricsInitialized);

    // 如果服务还没初始化，等待一下
    if (!osdLyricsInitialized) {
        console.log('⏳ OSD歌词服务正在初始化，等待...');
        showMessage('正在初始化桌面歌词服务...', 'info');

        // 等待最多3秒让服务初始化
        for (let i = 0; i < 30; i++) {
            if (osdLyricsInitialized) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!osdLyricsInitialized) {
            console.error('❌ OSD歌词服务初始化超时');
            showMessage('桌面歌词服务初始化失败', 'error');
            return osdLyricsEnabled;
        }
    }

    if (!osdLyricsService) {
        console.error('❌ OSD歌词服务未初始化');
        showMessage('OSD歌词服务未初始化', 'error');
        return osdLyricsEnabled; // 返回当前状态
    }

    try {
        console.log('🎵 切换OSD歌词状态，当前状态:', osdLyricsEnabled);
        console.log('🎵 调用 SetEnabled 方法...');

        const newState = !osdLyricsEnabled;
        const response = await osdLyricsService.SetEnabled(newState);

        console.log('🎵 SetEnabled 响应:', response);

        if (response && response.success) {
            osdLyricsEnabled = newState;
            updateOSDLyricsButtonState();

            // 如果启用了OSD歌词，立即更新当前歌词
            if (osdLyricsEnabled) {
                await updateCurrentOSDLyrics();
            }

            showMessage(response.message, 'success');
            console.log('✅ OSD歌词状态切换成功:', osdLyricsEnabled);
            return osdLyricsEnabled; // 返回新状态
        } else {
            const message = response ? response.message : '未知错误';
            showMessage(message, 'error');
            console.error('❌ OSD歌词状态切换失败:', message);
            return osdLyricsEnabled; // 返回当前状态
        }
    } catch (error) {
        console.error('❌ 切换OSD歌词失败:', error);
        showMessage('OSD歌词控制失败: ' + error.message, 'error');
        return osdLyricsEnabled; // 返回当前状态
    }
}

// 更新OSD歌词状态
async function updateOSDLyricsStatus() {
    if (!osdLyricsService) return;
    
    try {
        const enabled = await osdLyricsService.IsEnabled();
        osdLyricsEnabled = enabled;
        updateOSDLyricsButtonState();
        await updateOSDLockStatus();
        console.log('🎵 OSD歌词状态已更新:', osdLyricsEnabled);
    } catch (error) {
        console.error('❌ 获取OSD歌词状态失败:', error);
    }
}

async function updateOSDLockStatus() {
    if (!osdLyricsService || !osdLyricsService.IsOSDLocked) return;
    try {
        const locked = await osdLyricsService.IsOSDLocked();
        osdLyricsLocked = !!locked;
        updateOSDLockButtonState();
    } catch (e) {
        console.error('❌ 获取OSD锁定状态失败:', e);
    }
}

async function toggleOSDLock() {
    if (!osdLyricsService) return osdLyricsLocked;
    try {
        const res = await osdLyricsService.ToggleOSDLock();
        if (res && res.success) {
            osdLyricsLocked = res.locked;
            updateOSDLockButtonState();
            if (typeof showMessage === 'function') {
                showMessage(res.message, 'info');
            }
        }
        return osdLyricsLocked;
    } catch (error) {
        console.error('❌ 切换OSD锁定状态失败:', error);
        return osdLyricsLocked;
    }
}

function updateOSDLockButtonState() {
    const lockBtn = document.getElementById('osdLockBtn');
    if (lockBtn) {
        if (osdLyricsLocked) {
            lockBtn.classList.add('active');
            lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
            lockBtn.title = '桌面歌词已锁定 (鼠标穿透中，点击解锁)';
        } else {
            lockBtn.classList.remove('active');
            lockBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
            lockBtn.title = '锁定桌面歌词 (开启鼠标穿透)';
        }
    }
}

// 更新OSD歌词按钮状态
function updateOSDLyricsButtonState() {
    const osdBtn = document.getElementById('osdLyricsBtn');
    if (osdBtn) {
        if (osdLyricsEnabled) {
            osdBtn.classList.add('active');
            osdBtn.title = '关闭桌面歌词';
        } else {
            osdBtn.classList.remove('active');
            osdBtn.title = '开启桌面歌词';
        }
    }
    updateOSDLockButtonState();
}

// 更新OSD歌词内容
async function updateOSDLyrics(lyricsText, songName = '', artist = '') {
    if (!osdLyricsService) {
        console.warn('⚠️ OSD歌词服务未初始化');
        return;
    }

    try {
        const player = window.audioPlayer && (typeof window.audioPlayer === 'function' ? window.audioPlayer() : window.audioPlayer);
        const currentTime = player?.getCurrentTime ? player.getCurrentTime() : (player?.audio?.currentTime || 0);

        console.log('🎵 发送歌词到桌面:', lyricsText, `(${currentTime.toFixed(2)}s)`);
        const response = await osdLyricsService.UpdateCurrentLyrics(lyricsText, songName, artist, currentTime);

        if (!response.success) {
            console.warn('⚠️ 更新OSD歌词失败:', response.message);
        }
    } catch (error) {
        console.error('❌ 更新OSD歌词失败:', error);
    }
}

// 发送原始歌词行到OSD（简化版本，只发送当前行，OSD自己计算播放进度）
async function sendKRCLineToOSD(lyricsLine) {
    if (!osdLyricsService) {
        return;
    }

    try {
        // 获取当前播放的歌曲信息
        const currentSong = getCurrentSong();
        const songName = currentSong?.songname || currentSong?.title || '';
        const artist = currentSong?.author_name || currentSong?.artist || '';

        // 获取原始歌词行文本
        const originalLine = lyricsLine.originalLine || '';
        const format = lyricsLine.format || 'lrc';

        if (!originalLine) {
            console.warn('⚠️ 没有原始歌词行文本');
            return;
        }

        // console.log(`🎵 发送原始${format.toUpperCase()}歌词行到OSD:`, originalLine);

        // 发送原始歌词行与精确当前播放时间戳，OSD毫秒级对齐杜绝延后
        const player = window.audioPlayer && (typeof window.audioPlayer === 'function' ? window.audioPlayer() : window.audioPlayer);
        const currentTime = player?.getCurrentTime ? player.getCurrentTime() : (player?.audio?.currentTime || 0);

        const response = await osdLyricsService.UpdateCurrentLyrics(
            originalLine,
            songName,
            artist,
            currentTime
        );
        if (!response.success) {
            console.warn('⚠️ 发送歌词失败:', response.message);
        }

    } catch (error) {
        console.error('❌ 发送歌词失败:', error);
    }
}

// getCurrentPlayTime 函数已移除，OSD歌词自己计算播放进度

// 更新当前OSD歌词（从当前播放的歌曲获取信息）
async function updateCurrentOSDLyrics() {
    try {
        // 获取当前播放的歌曲信息
        const currentSong = getCurrentSong();
        if (!currentSong) {
            await updateOSDLyrics('暂无播放', '', '');
            return;
        }

        // 获取当前歌词行
        const currentLyricsText = getCurrentLyricsText();
        const songName = currentSong.songname || currentSong.title || '';
        const artist = currentSong.author_name || currentSong.artist || '';

        await updateOSDLyrics(currentLyricsText, songName, artist);

    } catch (error) {
        console.error('❌ 更新当前OSD歌词失败:', error);
    }
}

// 获取当前歌词文本
function getCurrentLyricsText() {
    // 尝试从活跃的歌词行获取文本
    const activeLyricsLine = document.querySelector('.lyrics-line.active');
    if (activeLyricsLine && activeLyricsLine.textContent.trim() !== '') {
        return activeLyricsLine.textContent.trim();
    }
    
    // 如果没有活跃的歌词行，返回默认文本
    return '♪ ♫ ♪ ♫';
}

// 获取当前播放的歌曲
function getCurrentSong() {
    // 尝试从播放器获取当前歌曲
    if (window.audioPlayer && typeof window.audioPlayer === 'function') {
        const player = window.audioPlayer();
        if (player && player.currentSong) {
            return player.currentSong;
        }
    }
    
    // 尝试从播放列表管理器获取
    if (window.PlaylistManager && window.PlaylistManager.getCurrentSong) {
        return window.PlaylistManager.getCurrentSong();
    }
    
    return null;
}

// 显示消息提示
function showMessage(message, type = 'info') {
    // 如果存在全局消息显示函数，使用它
    if (window.showMessage && typeof window.showMessage === 'function') {
        window.showMessage(message, type);
        return;
    }
    
    // 否则使用简单的控制台输出
    console.log(`${type.toUpperCase()}: ${message}`);
}

// 监听歌词高亮变化（已移除MutationObserver，改为直接在歌词高亮函数中调用）
function setupLyricsHighlightListener() {
    // 不再使用MutationObserver，因为会导致频繁更新
    // 现在直接在updateLRCLyricsHighlight和updateKRCLyricsHighlight中调用updateCurrentOSDLyrics
    console.log('✅ 歌词高亮监听器已设置（使用直接调用方式）');
}

// 监听歌曲切换
function setupSongChangeListener() {
    // 监听歌曲信息更新事件
    document.addEventListener('songInfoUpdated', (e) => {
        if (e.detail) {
            // 歌曲切换时，先显示歌曲信息，然后等待歌词加载
            const song = e.detail;
            const songName = song.songname || song.title || '';
            const artist = song.author_name || song.artist || '';

            // 先显示歌曲信息
            updateOSDLyrics('♪ ♫ ♪ ♫', songName, artist);

            // 延迟一段时间后更新歌词（等待歌词加载）
            setTimeout(() => {
                updateCurrentOSDLyrics();
            }, 1000);
        }
    });
    
    console.log('✅ 歌曲切换监听器已设置');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎵 页面加载完成，初始化OSD歌词功能');
    initOSDLyrics();
    setupLyricsHighlightListener();
    setupSongChangeListener();
});

// 导出函数供其他模块使用
window.OSDLyrics = {
    toggleOSDLock,
    isLocked: () => osdLyricsLocked,
    updateOSDLyrics,
    updateCurrentOSDLyrics,
    toggleOSDLyrics,
    sendKRCLineToOSD,
    isEnabled: () => osdLyricsEnabled
};

// 同时暴露主要函数到全局作用域
window.sendKRCLineToOSD = sendKRCLineToOSD;
window.toggleOSDLyrics = toggleOSDLyrics;
