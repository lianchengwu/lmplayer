// 首页功能模块
import {HomepageService} from "./bindings/wmplayer";
import {DiscoverService} from "./bindings/wmplayer";

// 主页功能状态变量 - 现在由 PlaylistManager 统一管理播放状态
let currentFmSong = null;
let currentAiSong = null;
let currentAiRecommendList = []; // 存储完整的AI推荐列表

// 每日推荐状态变量
let currentDailyRecommendList = [];

// 新增推荐状态变量
let currentPersonalRecommendList = []; // 私人专属好歌
let currentVipRecommendList = []; // VIP专属推荐

// 缓存配置
const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24小时（毫秒）
const CACHE_KEYS = {
    DAILY_RECOMMEND: 'dailyRecommendCache',
    PERSONAL_RECOMMEND: 'personalRecommendCache',
    VIP_RECOMMEND: 'vipRecommendCache'
};

// 缓存工具函数
function setCache(key, data) {
    try {
        const cacheData = {
            data: data,
            timestamp: Date.now(),
            expiry: Date.now() + CACHE_EXPIRY_TIME
        };
        localStorage.setItem(key, JSON.stringify(cacheData));
        console.log(`✅ 缓存已保存: ${key}`);
    } catch (error) {
        console.error(`❌ 保存缓存失败: ${key}`, error);
    }
}

// 每日推荐专用缓存函数（24小时过期）
function setDailyRecommendCache(data) {
    try {
        const cacheData = {
            data: data,
            timestamp: Date.now(),
            expiry: Date.now() + CACHE_EXPIRY_TIME
        };
        localStorage.setItem(CACHE_KEYS.DAILY_RECOMMEND, JSON.stringify(cacheData));
        console.log(`✅ 每日推荐缓存已保存，有效期24小时`);
    } catch (error) {
        console.error(`❌ 保存每日推荐缓存失败`, error);
    }
}

function getCache(key) {
    try {
        const cached = localStorage.getItem(key);
        if (!cached) {
            console.log(`📭 无缓存数据: ${key}`);
            return null;
        }

        const cacheData = JSON.parse(cached);
        if (Date.now() > cacheData.expiry) {
            console.log(`⏰ 缓存已过期: ${key}`);
            localStorage.removeItem(key);
            return null;
        }

        console.log(`📦 读取缓存成功: ${key}`);
        return cacheData.data;
    } catch (error) {
        console.error(`❌ 读取缓存失败: ${key}`, error);
        localStorage.removeItem(key);
        return null;
    }
}

function clearCache(key) {
    try {
        localStorage.removeItem(key);
        console.log(`🗑️ 缓存已清除: ${key}`);
    } catch (error) {
        console.error(`❌ 清除缓存失败: ${key}`, error);
    }
}

function isCacheValid(key) {
    try {
        const cached = localStorage.getItem(key);
        if (!cached) return false;

        const cacheData = JSON.parse(cached);
        return Date.now() <= cacheData.expiry;
    } catch (error) {
        return false;
    }
}

// 重置计数器（保留函数以避免调用错误）
function resetRetryCounters() {
    console.log('🔄 重试计数器已重置（FM和AI推荐不再自动播放）');
}

// 新歌速递数据缓存（播放状态由 PlaylistManager 统一管理，此变量仅用于兼容性）
let currentNewSongsList = [];

// 歌词相关状态（播放状态现在由 PlayerController 和 PlaylistManager 统一管理）
let currentSongLyrics = null; // 当前歌曲的歌词
let currentLyricsLines = []; // 解析后的歌词行数据

// 可用的图片尺寸
const AVAILABLE_IMAGE_SIZES = [480, 400, 240, 150, 135, 120, 110, 100, 93, 64];

// 根据需要的尺寸获取最合适的封面图片URL
function getCoverImageUrl(unionCover, targetSize = 120) {
    if (!unionCover || !unionCover.includes('{size}')) {
        return unionCover;
    }

    // 找到最接近目标尺寸的可用尺寸
    let bestSize = AVAILABLE_IMAGE_SIZES[0]; // 默认使用最大尺寸
    let minDiff = Math.abs(AVAILABLE_IMAGE_SIZES[0] - targetSize);

    for (const size of AVAILABLE_IMAGE_SIZES) {
        const diff = Math.abs(size - targetSize);
        if (diff < minDiff) {
            minDiff = diff;
            bestSize = size;
        }
    }

    // 替换URL中的{size}占位符
    return unionCover.replace('{size}', bestSize.toString());
}

// 获取多种尺寸的封面图片URL
function getCoverImageUrls(unionCover) {
    if (!unionCover || !unionCover.includes('{size}')) {
        return {
            small: unionCover,    // 64px
            medium: unionCover,   // 120px
            large: unionCover,    // 240px
            xlarge: unionCover    // 480px
        };
    }

    return {
        small: unionCover.replace('{size}', '64'),    // 小尺寸：用于列表项
        medium: unionCover.replace('{size}', '120'),  // 中等尺寸：用于播放器
        large: unionCover.replace('{size}', '240'),   // 大尺寸：用于详情页
        xlarge: unionCover.replace('{size}', '480')   // 超大尺寸：用于全屏播放
    };
}

// 预加载封面图片
function preloadCoverImage(url) {
    if (!url) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
    });
}

// 获取歌曲播放地址和歌词
async function getSongPlayUrls(hash) {
    try {
        console.log('🎵 正在获取播放地址和歌词...', hash);

        // 检查是否是本地音乐hash（以"local-"开头）
        if (hash.startsWith('local-')) {
            console.log('🎵 检测到本地音乐hash，获取播放地址和歌词');
            try {
                // 动态导入 CacheService 和 LocalMusicService
                const { GetCachedURL } = await import('./bindings/wmplayer/cacheservice.js');
                const { GetLocalMusicLyrics } = await import('./bindings/wmplayer/localmusicservice.js');
                
                // 获取播放地址
                const cacheResponse = await GetCachedURL(hash);

                if (cacheResponse.success && cacheResponse.data) {
                    console.log('🎵 本地音乐播放地址获取成功:', cacheResponse.data);
                    
                    // 尝试获取本地音乐的歌词
                    let lyrics = null;
                    try {
                        // 从缓存服务获取文件路径，然后获取歌词
                        // 这里需要从hash映射中获取文件路径
                        console.log('🎵 尝试获取本地音乐歌词...');
                        
                        // 先尝试从当前播放的本地音乐文件中获取歌词
                        if (window.localMusicFiles && Array.isArray(window.localMusicFiles)) {
                            const currentFile = window.localMusicFiles.find(file => {
                                const localHash = 'local-' + (file.hash || file.file_path || file.filename);
                                return localHash === hash;
                            });
                            
                            if (currentFile && currentFile.file_path) {
                                console.log('🎵 找到本地音乐文件，获取歌词:', currentFile.file_path);
                                const lyricsResponse = await GetLocalMusicLyrics(currentFile.file_path);
                                if (lyricsResponse.success && lyricsResponse.data) {
                                    lyrics = lyricsResponse.data;
                                    console.log('🎵 本地音乐歌词获取成功，长度:', lyrics.length);
                                } else {
                                    console.log('🎵 本地音乐没有歌词信息');
                                }
                            }
                        }
                    } catch (lyricsError) {
                        console.warn('⚠️ 获取本地音乐歌词失败:', lyricsError);
                    }
                    
                    // 保存歌词到全局变量
                    currentSongLyrics = lyrics;
                    window.currentSongLyrics = lyrics;
                    
                    // 更新右侧歌词显示
                    updateLyricsDisplay(lyrics);

                    return [cacheResponse.data];
                } else {
                    console.error('❌ 获取本地音乐播放地址失败:', cacheResponse.message);
                    return [];
                }
            } catch (error) {
                console.error('❌ 获取本地音乐播放地址失败:', error);
                return [];
            }
        }

        // 在线音乐：使用原有逻辑
        const response = await HomepageService.GetSongUrl(hash);
        console.log('🎵 GetSongUrl API响应:', response);

        if (response.success) {
            let lyrics = null;
            if (response.data && response.data.lyrics) {
                lyrics = response.data.lyrics;
            }
            // 保存歌词到全局变量
            currentSongLyrics = lyrics;
            // 同时保存到window对象，供其他模块访问
            window.currentSongLyrics = lyrics;

            // 更新右侧歌词显示
            updateLyricsDisplay(lyrics);

            console.log('🎵 ========== 播放地址汇总 ==========');
            console.log(`🎵 歌曲Hash: ${hash}`)
            console.log(`🎵 主播放地址: ${response.data.url}`);
            console.log(`🎵 备用播放地址: ${response.data.backupUrl}`);
            console.log('🎵 =====================================');

            if (lyrics) {
                console.log('获取歌词成功，歌词长度:', lyrics.length);
            } else {
                console.log('未获取到歌词');
            }

            // 返回播放地址数组，优先使用主地址，备用地址作为后备
            const urls = [];
            if (response.data.url && response.data.url.trim() !== '') {
                urls.push(response.data.url);
            }
            if (response.data.backupUrl && response.data.backupUrl.trim() !== '') {
                urls.push(response.data.backupUrl);
            }

            if (urls.length === 0) {
                console.error('❌ 没有有效的播放地址');
                return [];
            }

            console.log('🎵 获取播放地址成功，共', urls.length, '个');
            return urls;
        } else {
            console.error('❌ 获取播放地址失败:', response.message);
            console.error('❌ 完整响应:', response);
            return [];
        }
    } catch (error) {
        console.error('❌ 获取播放地址API调用失败:', error);
        return [];
    }
}

// 播放函数现在统一由 PlayerController 提供，无需在此定义
// 将播放列表更新函数暴露到全局作用域
window.updateRightSidebarPlaylist = updateRightSidebarPlaylist;
// 为了兼容性，也暴露为 updatePlaylist
window.updatePlaylist = (playlist, currentIndex) => {
    updateRightSidebarPlaylist(playlist, currentIndex, '播放列表');
};
// 暴露新歌速递控制函数（现在统一使用 PlayerController）
window.nextNewSong = nextNewSong;
window.previousNewSong = previousNewSong;

// 暴露核心播放函数供播放器控制模块使用
window.getSongPlayUrls = getSongPlayUrls;
window.addPlayHistory = addPlayHistory;
window.updatePlayerBarCover = updatePlayerBarCover; // 供 HTML5 音频集成调用
window.updateLyricsHighlight = updateLyricsHighlight; // 供 HTML5 音频集成调用
window.getCoverImageUrl = getCoverImageUrl; // 供沉浸式播放器使用
window.addToFavorites = addToFavorites; // 供沉浸式播放器使用
// 暴露FM相关函数
window.handleFmSongEnded = handleFmSongEnded; // 供播放器调用
window.preloadMoreFmSongs = preloadMoreFmSongs; // 供播放器调用
window.isFmPlaying = isFmPlaying; // 供播放器调用
// 暴露首页刷新函数
window.refreshHomePage = refreshHomePage; // 供标题栏刷新按钮调用
// updatePlayerBar 现在由 HTML5 音频集成统一提供

// 暴露当前播放歌曲到全局作用域（从 PlayerController 获取）
Object.defineProperty(window, 'currentPlayingSong', {
    get: () => window.PlayerController ? window.PlayerController.getCurrentSong() : null,
    set: (value) => {
        // 播放状态现在由 PlayerController 管理，这里只保留兼容性
        console.warn('currentPlayingSong 设置已废弃，请使用 PlayerController 管理播放状态');
    }
});

// 播放状态现在由 PlaylistManager 统一管理，无需手动重置

// 原有的音频加载函数已移除，现在使用 HTML5 Audio API 处理

// 原有的 tryPlayUrl 函数已移除，现在使用 HTML5 Audio API 处理播放逻辑

// 停止播放 - 现在统一使用 PlayerController
function stopPlaying() {
    console.log('🛑 停止播放 - 委托给 PlayerController');

    // 使用统一的播放控制器停止播放
    if (window.PlayerController) {
        window.PlayerController.stop();
    } else {
        console.warn('PlayerController 不可用，执行本地清理');
        // 清理歌词状态
        currentLyricsLines = []; // 清空歌词数据
        currentActiveLyricsIndex = -1; // 重置高亮索引

        // 清除防抖定时器
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }

        // 清除歌词高亮
        const lyricsLines = document.querySelectorAll('.lyrics-line');
        lyricsLines.forEach(line => line.classList.remove('active'));

        updatePlayerBar();
    }
}

// updatePlayerBar 函数现在由 HTML5 音频集成统一提供，支持加载状态管理

// 更新底栏播放器封面
function updatePlayerBarCover(coverUrl) {
    const songCover = document.querySelector('.player-bar .song-cover');
    if (!songCover) return;

    if (coverUrl) {
        // 使用64px尺寸的封面图片（适合底栏显示）
        const coverImageUrl = getCoverImageUrl(coverUrl, 64);
        console.log('🖼️ 更新播放器封面:', {
            原始URL: coverUrl,
            处理后URL: coverImageUrl,
            目标尺寸: '64px'
        });

        // 创建或更新封面图片
        let imgEl = songCover.querySelector('img');
        if (!imgEl) {
            imgEl = document.createElement('img');
            imgEl.alt = '歌曲封面';
            songCover.innerHTML = '';
            songCover.appendChild(imgEl);
        }

        imgEl.src = coverImageUrl;

        // 图片加载失败时显示默认图标
        imgEl.onerror = function() {
            songCover.innerHTML = `
                <div class="cover-placeholder">
                    <i class="fas fa-music"></i>
                </div>
            `;
        };
    } else {
        // 显示默认占位符
        songCover.innerHTML = `
            <div class="cover-placeholder">
                <i class="fas fa-music"></i>
            </div>
        `;
    }
}

// 格式化时间显示
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 私人FM当前参数
let currentFmMode = 'normal';
let currentFmSongPoolId = 0;
let currentFmHash = '';
let currentFmSongId = '';
let currentFmIsOverplay = false;
let currentFmRemainSongCnt = 0;

// FM播放列表管理
let fmPlaylist = [];
let fmCurrentIndex = 0;

// 初始化首页功能
export function initHomePage() {
    // 私人FM功能
    const fmCover = document.querySelector('.fm-song-cover');
    const fmActionBtns = document.querySelectorAll('.fm-action-btn');
    
    // 初始化FM参数选择器
    initFmControls();
    
    // 初始化FM播放跟踪
    initFmPlaybackTracking();

    if (fmCover) {
        fmCover.addEventListener('click', toggleFM);
    }

    // 添加FM播放按钮的直接播放功能
    const fmPlayOverlay = document.querySelector('.fm-play-overlay');
    if (fmPlayOverlay) {
        fmPlayOverlay.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡

            if (currentFmSong && window.PlayerController) {
                console.log('🎵 直接播放FM歌曲:', currentFmSong.title);
                const success = await window.PlayerController.playSong(currentFmSong);
                if (success) {
                    console.log('✅ FM歌曲播放成功');
                } else {
                    console.error('❌ FM歌曲播放失败');
                }
            } else {
                console.log('🎵 FM歌曲未加载，先加载歌曲');
                await toggleFM();
            }
        });
    }

    // FM操作按钮
    fmActionBtns.forEach((btn, index) => {
        btn.addEventListener('click', () => {
            switch (index) {
                case 0: // 喜欢
                    likeFmSong();
                    break;
                case 1: // 不喜欢
                    dislikeFmSong();
                    break;
                case 2: // 下一首
                    nextFmSong();
                    break;
            }
        });
    });

    // AI推荐功能
    const aiCover = document.querySelector('.ai-song-cover');
    const aiActionBtns = document.querySelectorAll('.ai-action-btn');

    if (aiCover) {
        aiCover.addEventListener('click', toggleAI);
    }

    // 添加AI推荐播放按钮的直接播放功能
    const aiPlayOverlay = document.querySelector('.ai-play-overlay');
    if (aiPlayOverlay) {
        aiPlayOverlay.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡

            if (currentAiSong && window.PlayerController) {
                console.log('🎵 直接播放AI推荐歌曲:', currentAiSong.title);
                const success = await window.PlayerController.playSong(currentAiSong);
                if (success) {
                    console.log('✅ AI推荐歌曲播放成功');
                } else {
                    console.error('❌ AI推荐歌曲播放失败');
                }
            } else {
                console.log('🎵 AI推荐歌曲未加载，先加载歌曲');
                await toggleAI();
            }
        });
    }

    // AI操作按钮
    aiActionBtns.forEach((btn, index) => {
        btn.addEventListener('click', () => {
            switch (index) {
                case 0: // 喜欢
                    likeAiSong();
                    break;
                case 1: // 不喜欢
                    dislikeAiSong();
                    break;
                case 2: // 下一首
                    nextAiSong();
                    break;
            }
        });
    });

    // 每日推荐功能
    const dailyCover = document.querySelector('.daily-cover');
    console.log('🔍 查找每日推荐卡片元素:', !!dailyCover);

    if (dailyCover) {
        dailyCover.addEventListener('click', playDailyRecommendation);
        console.log('✅ 每日推荐卡片点击事件已绑定');
    } else {
        console.warn('❌ 未找到每日推荐卡片元素 (.daily-cover)');
    }

    // 注意：每日推荐歌曲的播放按钮事件在updateDailyRecommendDisplay函数中动态绑定

    // 私人专属好歌播放全部按钮
    const playAllPersonalBtn = document.getElementById('playAllPersonalRecommend');
    if (playAllPersonalBtn) {
        playAllPersonalBtn.addEventListener('click', () => {
            if (currentPersonalRecommendList.length > 0 && window.PlayerController) {
                console.log('播放全部私人专属好歌，共', currentPersonalRecommendList.length, '首');
                window.PlayerController.playPlaylist(currentPersonalRecommendList, 0, '私人专属好歌');
            } else {
                console.warn('私人专属好歌列表为空或PlayerController不可用');
            }
        });
    }

    // VIP专属推荐播放全部按钮
    const playAllVipBtn = document.getElementById('playAllVipRecommend');
    if (playAllVipBtn) {
        playAllVipBtn.addEventListener('click', () => {
            if (currentVipRecommendList.length > 0 && window.PlayerController) {
                console.log('播放全部VIP专属推荐，共', currentVipRecommendList.length, '首');
                window.PlayerController.playPlaylist(currentVipRecommendList, 0, 'VIP专属推荐');
            } else {
                console.warn('VIP专属推荐列表为空或PlayerController不可用');
            }
        });
    }

    // 私人专属好歌刷新按钮
    const refreshPersonalBtn = document.getElementById('refreshPersonalRecommend');
    if (refreshPersonalBtn) {
        refreshPersonalBtn.addEventListener('click', refreshPersonalRecommend);
    }

    // VIP专属推荐刷新按钮
    const refreshVipBtn = document.getElementById('refreshVipRecommend');
    if (refreshVipBtn) {
        refreshVipBtn.addEventListener('click', refreshVipRecommend);
    }

    // 历史推荐功能
    const historyPlaylists = document.querySelectorAll('.history-playlist');
    historyPlaylists.forEach((playlist, index) => {
        playlist.addEventListener('click', () => playHistoryPlaylist(index));
    });

    // 初始化当前日期
    updateDailyDate();

    // 初始化底栏播放器事件
    initPlayerBarEvents();

    // 立即加载缓存数据，然后异步预加载新数据
    loadCachedDataFirst();

    // 异步预加载新数据（不阻塞页面初始化）
    preloadSongInfoAsync();
}

// 立即加载缓存数据（同步，快速）
function loadCachedDataFirst() {
    console.log('🚀 立即加载缓存数据...');

    // 检查并加载每日推荐缓存
    const dailyCache = getCache(CACHE_KEYS.DAILY_RECOMMEND);
    if (dailyCache && dailyCache.length > 0) {
        console.log('✅ 加载每日推荐缓存，共', dailyCache.length, '首歌曲');
        currentDailyRecommendList = dailyCache;
        updateDailyRecommendDisplay();
    }

    // 检查并加载私人专属好歌缓存
    const personalCache = getCache(CACHE_KEYS.PERSONAL_RECOMMEND);
    if (personalCache && personalCache.length > 0) {
        console.log('✅ 加载私人专属好歌缓存，共', personalCache.length, '首歌曲');
        currentPersonalRecommendList = personalCache;
        updatePersonalRecommendDisplay();
    }

    // 检查并加载VIP专属推荐缓存
    const vipCache = getCache(CACHE_KEYS.VIP_RECOMMEND);
    if (vipCache && vipCache.length > 0) {
        console.log('✅ 加载VIP专属推荐缓存，共', vipCache.length, '首歌曲');
        currentVipRecommendList = vipCache;
        updateVipRecommendDisplay();
    }

    console.log('✅ 缓存数据加载完成');
}

// 异步预加载新数据（并行执行，不阻塞页面）
async function preloadSongInfoAsync() {
    console.log('🔄 开始异步预加载新数据...');

    // 并行执行所有预加载任务
    const preloadTasks = [
        preloadFmSong().catch(error => console.error('预加载FM歌曲失败:', error)),
        preloadAiSong().catch(error => console.error('预加载AI推荐歌曲失败:', error)),
        preloadDailyRecommend().catch(error => console.error('预加载每日推荐失败:', error)),
        preloadPersonalRecommend().catch(error => console.error('预加载私人专属好歌失败:', error)),
        preloadVipRecommend().catch(error => console.error('预加载VIP专属推荐失败:', error))
    ];

    // 等待所有任务完成（并行执行）
    await Promise.allSettled(preloadTasks);

    console.log('✅ 异步预加载完成');
}

// 预加载歌曲信息（保留原函数以兼容）
async function preloadSongInfo() {
    console.log('开始预加载歌曲信息...');

    // 预加载私人FM歌曲
    try {
        await preloadFmSong();
    } catch (error) {
        console.error('预加载FM歌曲失败:', error);
    }

    // 预加载AI推荐歌曲
    try {
        await preloadAiSong();
    } catch (error) {
        console.error('预加载AI推荐歌曲失败:', error);
    }

    // 预加载每日推荐歌曲
    try {
        await preloadDailyRecommend();
    } catch (error) {
        console.error('预加载每日推荐失败:', error);
    }

    // 预加载私人专属好歌
    try {
        await preloadPersonalRecommend();
    } catch (error) {
        console.error('预加载私人专属好歌失败:', error);
    }

    // 预加载VIP专属推荐
    try {
        await preloadVipRecommend();
    } catch (error) {
        console.error('预加载VIP专属推荐失败:', error);
    }

    console.log('歌曲信息预加载完成');
}

// 初始化FM控制器
function initFmControls() {
    // 模式选择器 - 循环点击样式
    const fmModeBtn = document.querySelector('.fm-mode-btn');
    if (fmModeBtn) {
        fmModeBtn.addEventListener('click', () => {
            // 循环切换模式
            const modes = [
                { mode: 'normal', name: '红心', icon: 'fas fa-heart', title: '红心Radio - 根据你的习惯为你推荐音乐' },
                { mode: 'small', name: '小众', icon: 'fas fa-gem', title: '小众Radio - 红心技术上推荐更多小众前卫的音乐' },
                { mode: 'peak', name: '新歌', icon: 'fas fa-star', title: '新歌Radio - 红心Radio基础上推荐更多新发行的音乐' }
            ];
            
            // 找到当前模式的索引
            const currentIndex = modes.findIndex(m => m.mode === currentFmMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            const nextMode = modes[nextIndex];
            
            // 更新按钮显示
            fmModeBtn.dataset.mode = nextMode.mode;
            fmModeBtn.querySelector('i').className = nextMode.icon;
            fmModeBtn.querySelector('span').textContent = nextMode.name;
            fmModeBtn.title = nextMode.title;
            
            // 更新当前模式
            currentFmMode = nextMode.mode;
            console.log('FM模式切换为:', nextMode.name, '(', nextMode.mode, ')');
            // 重置参数状态
            resetFmParams();
            // 重新加载FM歌曲
            loadRandomFmSong(true);
        });
    }

    // AI模式选择器
    const fmAiBtn = document.querySelector('.fm-ai-btn');
    if (fmAiBtn) {
        fmAiBtn.addEventListener('click', () => {
            // 循环切换AI模式
            const currentPoolId = parseInt(fmAiBtn.dataset.poolId);
            const nextPoolId = (currentPoolId + 1) % 3;
            
            // 更新按钮显示
            fmAiBtn.dataset.poolId = nextPoolId;
            const aiModes = [
                { id: 0, name: 'Alpha', title: 'Alpha - 根据你的推荐源歌曲，为你推荐口味相近的歌曲' },
                { id: 1, name: 'Beta', title: 'Beta - 擅长分类，会根据你喜欢的风格，集中为你推荐同类型的歌曲' },
                { id: 2, name: 'Gamma', title: 'Gamma - 推荐口味更丰富多样，会为你推荐不同类型的歌曲' }
            ];
            
            const currentMode = aiModes[nextPoolId];
            fmAiBtn.querySelector('span').textContent = currentMode.name;
            fmAiBtn.title = currentMode.title;
            
            // 更新当前AI模式
            currentFmSongPoolId = nextPoolId;
            console.log('AI模式切换为:', currentMode.name, '(ID:', nextPoolId, ')');
            // 重置参数状态
            resetFmParams();
            // 重新加载FM歌曲
            loadRandomFmSong(true);
        });
    }
}

// 预加载更多FM歌曲（当播放到倒数第二首时调用）
async function preloadMoreFmSongs() {
    console.log('🔄 预加载更多FM歌曲...');

    try {
        // 使用当前播放参数获取更多歌曲
        let response;
        if (currentFmHash || currentFmSongId) {
            console.log('🔄 使用高级FM API获取更多歌曲，参数:', {
                hash: currentFmHash,
                songId: currentFmSongId,
                mode: currentFmMode,
                poolId: currentFmSongPoolId,
                isOverplay: currentFmIsOverplay,
                remainSongCnt: currentFmRemainSongCnt
            });

            response = await HomepageService.GetPersonalFMAdvanced(
                currentFmHash,
                currentFmSongId,
                0, // playtime 固定为0
                currentFmMode,
                currentFmSongPoolId,
                currentFmIsOverplay,
                currentFmRemainSongCnt
            );
        } else {
            console.log('🔄 使用基础FM API获取更多歌曲，参数:', {
                mode: currentFmMode,
                poolId: currentFmSongPoolId
            });
            response = await HomepageService.GetPersonalFMWithParams(currentFmMode, currentFmSongPoolId);
        }

        if (response.success && response.data && response.data.length > 0) {
            // 将新歌曲添加到播放列表末尾
            const newFmSongs = response.data.map(songData => ({
                hash: songData.hash,
                title: songData.songname,
                songname: songData.songname,
                author_name: songData.author_name,
                album: songData.album_name,
                album_name: songData.album_name,
                duration: songData.time_length,
                time_length: songData.time_length,
                cover: getCoverImageUrl(songData.union_cover, 120),
                coverOriginal: songData.union_cover,
                union_cover: songData.union_cover,
                filename: songData.filename || '',
                album_id: songData.album_id || ''
            }));

            // 添加到FM播放列表末尾
            const oldLength = fmPlaylist.length;
            fmPlaylist = [...fmPlaylist, ...newFmSongs];

            console.log(`✅ 预加载成功，新增${newFmSongs.length}首歌曲，播放列表从${oldLength}首增加到${fmPlaylist.length}首`);

            // 更新播放列表到PlayerController（如果正在播放FM）
            if (window.PlayerController && isFmPlaying()) {
                console.log('🔄 更新PlayerController中的FM播放列表...');
                await window.PlayerController.updatePlaylist(fmPlaylist, fmCurrentIndex, '私人FM');
            }
        } else {
            console.warn('⚠️ 预加载FM歌曲失败: 无数据', response);
        }
    } catch (error) {
        console.error('❌ 预加载FM歌曲失败:', error);
    }
}

// 重置FM参数状态
function resetFmParams() {
    currentFmHash = '';
    currentFmSongId = '';
    currentFmIsOverplay = false;
    currentFmRemainSongCnt = 0;
    
    // 清空播放列表，重新开始
    fmPlaylist = [];
    fmCurrentIndex = 0;
    currentFmSong = null;
    
    console.log('🔄 FM参数和播放列表已重置');
}

// 更新FM播放参数
function updateFmPlayParams(song, isOverplay = false) {
    if (song) {
        currentFmHash = song.hash || '';
        currentFmSongId = song.songid || song.song_id || '';
        currentFmIsOverplay = isOverplay;
        // 根据播放列表中的剩余歌曲数计算
        currentFmRemainSongCnt = Math.max(0, fmPlaylist.length - fmCurrentIndex - 1);
        
        console.log('📊 FM播放参数已更新:', {
            hash: currentFmHash,
            songId: currentFmSongId,
            isOverplay: currentFmIsOverplay,
            remainSongCnt: currentFmRemainSongCnt
        });
    }
}

// 监听播放器状态变化，更新FM参数
function initFmPlaybackTracking() {
    // 延迟初始化，等待播放器加载完成
    setTimeout(() => {
        try {
            // 尝试多种方式获取音频播放器
            let audioElement = null;

            // 方式1: 通过window.audioPlayer函数
            if (window.audioPlayer && typeof window.audioPlayer === 'function') {
                const audioObj = window.audioPlayer();
                if (audioObj && audioObj.audio) {
                    audioElement = audioObj.audio;
                }
            }

            // 方式2: 直接查找audio元素
            if (!audioElement) {
                audioElement = document.querySelector('audio');
            }

            // 方式3: 通过PlayerController获取
            if (!audioElement && window.PlayerController && window.PlayerController.getAudioElement) {
                audioElement = window.PlayerController.getAudioElement();
            }

            if (audioElement && typeof audioElement.addEventListener === 'function') {
                console.log('✅ FM播放跟踪初始化成功');

                audioElement.addEventListener('timeupdate', () => {
                    checkFmPlaybackStatus();
                });

                audioElement.addEventListener('ended', async () => {
                    const currentSong = window.PlayerController ? window.PlayerController.getCurrentSong() : null;
                    if (currentSong && isFmPlaying()) {
                        updateFmPlayParams(currentSong, true);

                        // 处理FM播放完成逻辑
                        console.log('🎵 FM歌曲播放完成，处理续播逻辑...');
                        await handleFmSongEnded();

                        // 延迟一下再播放下一首，确保预加载完成
                        setTimeout(() => {
                            nextFmSong();
                        }, 1000); // 延迟1秒确保预加载完成
                    }
                });
            } else {
                console.warn('⚠️ 无法找到音频播放器元素，FM播放跟踪功能暂时不可用');
            }
        } catch (error) {
            console.error('❌ FM播放跟踪初始化失败:', error);
        }
    }, 2000); // 延迟2秒等待播放器初始化
}

// 检查是否正在播放FM
function isFmPlaying() {
    const currentPlaylist = window.PlaylistManager ? window.PlaylistManager.getCurrentPlaylist() : null;
    return currentPlaylist && currentPlaylist.name === '私人FM';
}

// 检查FM播放状态并处理预加载
function checkFmPlaybackStatus() {
    if (!isFmPlaying()) return;

    const currentSong = window.PlayerController ? window.PlayerController.getCurrentSong() : null;
    if (!currentSong) return;

    // 获取当前播放列表状态
    const currentPlaylist = window.PlaylistManager.getCurrentPlaylist();
    if (!currentPlaylist || !currentPlaylist.songs) return;

    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? -1;
    const totalSongs = currentPlaylist.songs.length;

    // 同步FM索引
    if (currentIndex >= 0 && currentIndex < fmPlaylist.length) {
        fmCurrentIndex = currentIndex;
    }

    // 检查是否需要预加载更多歌曲（播放到倒数第2首时）
    if (currentIndex >= totalSongs - 2 && !currentSong._preloadTriggered) {
        currentSong._preloadTriggered = true;
        console.log(`🔄 FM播放到倒数第2首 (${currentIndex + 1}/${totalSongs})，预加载更多歌曲...`);
        setTimeout(() => {
            preloadMoreFmSongs();
        }, 2000);
    }

    // 检查是否播放完4首歌曲（或更多）需要获取新歌曲
    if (currentIndex >= 3 && (currentIndex + 1) % 4 === 0 && !currentSong._batchPreloadTriggered) {
        currentSong._batchPreloadTriggered = true;
        console.log(`🔄 FM已播放完${currentIndex + 1}首歌曲，获取新的推荐歌曲...`);
        setTimeout(() => {
            preloadMoreFmSongs();
        }, 1000);
    }
}

// 处理FM播放完成后的逻辑
async function handleFmSongEnded() {
    if (!isFmPlaying()) return;

    const currentPlaylist = window.PlaylistManager.getCurrentPlaylist();
    if (!currentPlaylist || !currentPlaylist.songs) return;

    const currentIndex = currentPlaylist.current_index ?? currentPlaylist.CurrentIndex ?? -1;
    const totalSongs = currentPlaylist.songs.length;

    console.log(`🎵 FM歌曲播放完成，当前索引: ${currentIndex + 1}/${totalSongs}`);

    // 检查是否播放完4首歌曲的倍数，需要获取新歌曲
    if ((currentIndex + 1) % 4 === 0 && currentIndex >= 3) {
        console.log(`🔄 FM已播放完${currentIndex + 1}首歌曲，主动获取新的推荐歌曲...`);
        await preloadMoreFmSongs();
    }

    // 检查是否接近播放列表末尾
    if (currentIndex >= totalSongs - 2) {
        console.log(`🔄 FM播放列表即将用完 (${currentIndex + 1}/${totalSongs})，预加载更多歌曲...`);
        await preloadMoreFmSongs();
    }
}

// 预加载私人FM歌曲
async function preloadFmSong() {
    console.log('预加载私人FM歌曲...');

    try {
        const response = await HomepageService.GetPersonalFMWithParams(currentFmMode, currentFmSongPoolId);

        if (response.success && response.data && response.data.length > 0) {
            // 将所有返回的歌曲转换为播放列表格式
            const newFmSongs = response.data.map(songData => ({
                hash: songData.hash,
                title: songData.songname,
                songname: songData.songname,
                author_name: songData.author_name,
                album: songData.album_name,
                album_name: songData.album_name,
                duration: songData.time_length,
                time_length: songData.time_length,
                cover: getCoverImageUrl(songData.union_cover, 120),
                coverOriginal: songData.union_cover,
                union_cover: songData.union_cover,
                filename: songData.filename || '',
                album_id: songData.album_id || ''
            }));

            // 添加到FM播放列表
            fmPlaylist = [...fmPlaylist, ...newFmSongs];
            
            // 设置当前FM歌曲为第一首（如果还没有当前歌曲）
            if (!currentFmSong && fmPlaylist.length > 0) {
                currentFmSong = fmPlaylist[fmCurrentIndex];
            }

            // 更新FM界面显示
            updateFmDisplay();

            console.log(`预加载FM歌曲成功，新增${newFmSongs.length}首，播放列表共${fmPlaylist.length}首`);
            console.log('当前显示歌曲:', currentFmSong?.title);
        } else {
            console.warn('预加载FM歌曲失败: 无数据');
        }
    } catch (error) {
        console.error('预加载FM歌曲API调用失败:', error);
    }
}

// 预加载AI推荐歌曲
async function preloadAiSong() {
    console.log('预加载AI推荐歌曲...');

    try {
        const response = await HomepageService.GetAIRecommend();

        if (response.success && response.data && response.data.length > 0) {
            // 保存完整的AI推荐列表
            currentAiRecommendList = response.data.map(songData => ({
                hash: songData.hash,
                title: songData.songname,
                songname: songData.songname,
                author_name: songData.author_name,
                album: songData.album_name,
                album_name: songData.album_name,
                duration: songData.time_length,
                time_length: songData.time_length,
                cover: getCoverImageUrl(songData.union_cover, 120),
                coverOriginal: songData.union_cover,
                union_cover: songData.union_cover,
                filename: songData.filename || '',
                album_id: songData.album_id || ''
            }));

            // 随机选择一首歌曲用于显示
            const randomIndex = Math.floor(Math.random() * currentAiRecommendList.length);
            currentAiSong = currentAiRecommendList[randomIndex];

            // 更新AI推荐界面显示
            updateAiDisplay();

            console.log(`预加载AI推荐列表成功，共${currentAiRecommendList.length}首，当前显示:`, currentAiSong.title);
        } else {
            console.warn('预加载AI推荐歌曲失败: 无数据');
        }
    } catch (error) {
        console.error('预加载AI推荐歌曲API调用失败:', error);
    }
}

// 预加载每日推荐歌曲
async function preloadDailyRecommend(forceRefresh = false) {
    console.log('🎵 预加载每日推荐歌曲...');

    // 显示加载状态
    const dailySongsPreview = document.querySelector('.daily-songs-preview');
    if (dailySongsPreview) {
        dailySongsPreview.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> 正在加载每日推荐...</div>';
    }

    // 检查缓存（除非强制刷新）
    if (!forceRefresh) {
        const cachedData = getCache(CACHE_KEYS.DAILY_RECOMMEND);
        if (cachedData && cachedData.length > 0) {
            console.log('✅ 使用每日推荐缓存数据，共', cachedData.length, '首歌曲');
            currentDailyRecommendList = cachedData;
            updateDailyRecommendDisplay();
            return;
        }
    }

    console.log('🔄 从API获取每日推荐数据...');

    try {
        const response = await HomepageService.GetDailyRecommend("ios");

        if (response.success && response.data && response.data.length > 0) {
            // 保存每日推荐列表
            currentDailyRecommendList = response.data.map(songData => ({
                hash: songData.hash || '',
                title: songData.songname || '未知歌曲',
                songname: songData.songname || '未知歌曲',
                author_name: songData.author_name || '未知艺术家',
                album: songData.album_name || '未知专辑',
                album_name: songData.album_name || '未知专辑',
                duration: songData.time_length || 0,
                time_length: songData.time_length || 0,
                cover: getCoverImageUrl(songData.union_cover, 120),
                coverOriginal: songData.union_cover || '',
                union_cover: songData.union_cover || '',
                filename: songData.filename || `${songData.author_name || '未知艺术家'} - ${songData.songname || '未知歌曲'}`,
                albumId: songData.album_id || '',
                album_id: songData.album_id || ''
            }));

            // 保存到缓存
            setDailyRecommendCache(currentDailyRecommendList);

            // 更新每日推荐界面显示
            console.log('🔄 开始更新每日推荐界面显示...');
            updateDailyRecommendDisplay();

            console.log('✅ 预加载每日推荐成功，共', currentDailyRecommendList.length, '首歌曲');
        } else {
            console.warn('预加载每日推荐失败: 无数据');
            // 显示无数据状态
            if (dailySongsPreview) {
                dailySongsPreview.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i> 暂无每日推荐数据</div>';
            }
        }
    } catch (error) {
        console.error('预加载每日推荐API调用失败:', error);
        // 显示错误状态
        if (dailySongsPreview) {
            dailySongsPreview.innerHTML = '<div class="error-state"><i class="fas fa-exclamation-triangle"></i> 加载失败，请稍后重试</div>';
        }
    }
}

// 预加载私人专属好歌
async function preloadPersonalRecommend(forceRefresh = false) {
    console.log('预加载私人专属好歌...', forceRefresh ? '(强制刷新)' : '');

    // 如果不是强制刷新，先检查缓存
    if (!forceRefresh) {
        const cachedData = getCache(CACHE_KEYS.PERSONAL_RECOMMEND);
        if (cachedData && cachedData.length > 0) {
            currentPersonalRecommendList = cachedData;
            updatePersonalRecommendDisplay();
            console.log('✅ 从缓存加载私人专属好歌成功，共', currentPersonalRecommendList.length, '首歌曲');
            return;
        }
    }

    try {
        const response = await DiscoverService.GetRecommendSongs("personal");

        if (response.success && response.data && response.data.length > 0) {
            // 保存私人专属好歌列表
            currentPersonalRecommendList = response.data.map(songData => ({
                hash: songData.hash || '',
                title: songData.songname || '未知歌曲',
                songname: songData.songname || '未知歌曲',
                author_name: songData.author_name || '未知艺术家',
                album: songData.album_name || '未知专辑',
                album_name: songData.album_name || '未知专辑',
                duration: songData.time_length || 0,
                time_length: songData.time_length || 0,
                cover: getCoverImageUrl(songData.union_cover, 45),
                coverOriginal: songData.union_cover || '',
                union_cover: songData.union_cover || '',
                filename: songData.filename || `${songData.author_name || '未知艺术家'} - ${songData.songname || '未知歌曲'}`,
                albumId: songData.album_id || '',
                album_id: songData.album_id || ''
            }));

            // 保存到缓存
            setCache(CACHE_KEYS.PERSONAL_RECOMMEND, currentPersonalRecommendList);

            // 更新私人专属好歌界面显示
            updatePersonalRecommendDisplay();

            console.log('✅ 预加载私人专属好歌成功，共', currentPersonalRecommendList.length, '首歌曲');
        } else {
            console.warn('预加载私人专属好歌失败: 无数据');
        }
    } catch (error) {
        console.error('预加载私人专属好歌API调用失败:', error);
    }
}

// 预加载VIP专属推荐
async function preloadVipRecommend(forceRefresh = false) {
    console.log('预加载VIP专属推荐...', forceRefresh ? '(强制刷新)' : '');

    // 如果不是强制刷新，先检查缓存
    if (!forceRefresh) {
        const cachedData = getCache(CACHE_KEYS.VIP_RECOMMEND);
        if (cachedData && cachedData.length > 0) {
            currentVipRecommendList = cachedData;
            updateVipRecommendDisplay();
            console.log('✅ 从缓存加载VIP专属推荐成功，共', currentVipRecommendList.length, '首歌曲');
            return;
        }
    }

    try {
        const response = await DiscoverService.GetRecommendSongs("vip");

        if (response.success && response.data && response.data.length > 0) {
            // 保存VIP专属推荐列表
            currentVipRecommendList = response.data.map(songData => ({
                hash: songData.hash || '',
                title: songData.songname || '未知歌曲',
                songname: songData.songname || '未知歌曲',
                author_name: songData.author_name || '未知艺术家',
                album: songData.album_name || '未知专辑',
                album_name: songData.album_name || '未知专辑',
                duration: songData.time_length || 0,
                time_length: songData.time_length || 0,
                cover: getCoverImageUrl(songData.union_cover, 45),
                coverOriginal: songData.union_cover || '',
                union_cover: songData.union_cover || '',
                filename: songData.filename || `${songData.author_name || '未知艺术家'} - ${songData.songname || '未知歌曲'}`,
                albumId: songData.album_id || '',
                album_id: songData.album_id || ''
            }));

            // 保存到缓存
            setCache(CACHE_KEYS.VIP_RECOMMEND, currentVipRecommendList);

            // 更新VIP专属推荐界面显示
            updateVipRecommendDisplay();

            console.log('✅ 预加载VIP专属推荐成功，共', currentVipRecommendList.length, '首歌曲');
        } else {
            console.warn('预加载VIP专属推荐失败: 无数据');
        }
    } catch (error) {
        console.error('预加载VIP专属推荐API调用失败:', error);
    }
}

// 刷新私人专属好歌
async function refreshPersonalRecommend() {
    console.log('🔄 刷新私人专属好歌...');

    // 显示刷新动画
    const refreshBtn = document.getElementById('refreshPersonalRecommend');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.querySelector('i').style.animation = 'spin 1s linear infinite';
    }

    try {
        // 清除缓存并强制刷新
        clearCache(CACHE_KEYS.PERSONAL_RECOMMEND);
        await preloadPersonalRecommend(true);
        console.log('✅ 私人专属好歌刷新完成');
    } catch (error) {
        console.error('❌ 私人专属好歌刷新失败:', error);
    } finally {
        // 恢复按钮状态
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.querySelector('i').style.animation = '';
        }
    }
}

// 刷新VIP专属推荐
async function refreshVipRecommend() {
    console.log('🔄 刷新VIP专属推荐...');

    // 显示刷新动画
    const refreshBtn = document.getElementById('refreshVipRecommend');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.querySelector('i').style.animation = 'spin 1s linear infinite';
    }

    try {
        // 清除缓存并强制刷新
        clearCache(CACHE_KEYS.VIP_RECOMMEND);
        await preloadVipRecommend(true);
        console.log('✅ VIP专属推荐刷新完成');
    } catch (error) {
        console.error('❌ VIP专属推荐刷新失败:', error);
    } finally {
        // 恢复按钮状态
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.querySelector('i').style.animation = '';
        }
    }
}

// 刷新整个首页
async function refreshHomePage() {
    console.log('🔄 刷新首页内容...');

    try {
        // 清除所有缓存
        clearCache(CACHE_KEYS.PERSONAL_RECOMMEND);
        clearCache(CACHE_KEYS.VIP_RECOMMEND);

        // 重置当前数据，强制重新获取
        currentFmSong = null;
        currentAiSong = null;
        currentAiRecommendList = [];
        currentDailyRecommendList = [];
        currentPersonalRecommendList = [];
        currentVipRecommendList = [];

        // 重新预加载所有内容
        await preloadSongInfo();

        console.log('✅ 首页内容刷新完成');
    } catch (error) {
        console.error('❌ 首页内容刷新失败:', error);
    }
}

// 更新FM界面显示
function updateFmDisplay() {
    const fmTitle = document.querySelector('.fm-songname');
    const fmArtist = document.querySelector('.fm-author_name');
    const fmCover = document.querySelector('.fm-song-cover');

    if (currentFmSong) {
        // 更新歌曲信息
        if (fmTitle) fmTitle.textContent = currentFmSong.title;
        if (fmArtist) {
            // 显示艺术家和专辑信息
            let author_nameInfo = currentFmSong.author_name;
            if (currentFmSong.album) {
                author_nameInfo += ` • ${currentFmSong.album}`;
            }
            fmArtist.textContent = author_nameInfo;
        }

        // 设置封面图片
        if (currentFmSong.cover && fmCover) {
            // 创建或更新封面图片元素
            let imgEl = fmCover.querySelector('.cover-image');
            if (!imgEl) {
                imgEl = document.createElement('img');
                imgEl.className = 'cover-image';
                imgEl.style.cssText = `
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 12px;
                `;
                // 清空原有内容并添加图片
                fmCover.innerHTML = '';
                fmCover.appendChild(imgEl);

                // 保留播放覆盖层
                const overlay = document.createElement('div');
                overlay.className = 'fm-play-overlay';
                overlay.innerHTML = '<i class="fas fa-play"></i>';
                fmCover.appendChild(overlay);
            }

            imgEl.src = currentFmSong.cover;
            imgEl.alt = `${currentFmSong.title} - ${currentFmSong.author_name}`;

            // 图片加载失败时显示默认图标
            imgEl.onerror = function() {
                fmCover.innerHTML = `
                    <i class="fas fa-music"></i>
                    <div class="fm-play-overlay">
                        <i class="fas fa-play"></i>
                    </div>
                `;
            };
        }
    } else {
        // 重置为默认状态
        if (fmTitle) fmTitle.textContent = '正在为您推荐音乐...';
        if (fmArtist) fmArtist.textContent = '点击开始播放私人FM';
        if (fmCover) {
            fmCover.innerHTML = `
                <i class="fas fa-music"></i>
                <div class="fm-play-overlay">
                    <i class="fas fa-play"></i>
                </div>
            `;
        }
    }
}

// 更新AI推荐界面显示
function updateAiDisplay() {
    const aiTitle = document.querySelector('.ai-songname');
    const aiArtist = document.querySelector('.ai-author_name');
    const aiCover = document.querySelector('.ai-song-cover');

    if (currentAiSong) {
        // 更新歌曲信息
        if (aiTitle) aiTitle.textContent = currentAiSong.title;
        if (aiArtist) {
            // 显示艺术家和专辑信息
            let author_nameInfo = currentAiSong.author_name;
            if (currentAiSong.album) {
                author_nameInfo += ` • ${currentAiSong.album}`;
            }
            aiArtist.textContent = author_nameInfo;
        }

        // 设置封面图片
        if (currentAiSong.cover && aiCover) {
            // 创建或更新封面图片元素
            let imgEl = aiCover.querySelector('.cover-image');
            if (!imgEl) {
                imgEl = document.createElement('img');
                imgEl.className = 'cover-image';
                imgEl.style.cssText = `
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 12px;
                `;
                // 清空原有内容并添加图片
                aiCover.innerHTML = '';
                aiCover.appendChild(imgEl);

                // 保留播放覆盖层
                const overlay = document.createElement('div');
                overlay.className = 'ai-play-overlay';
                overlay.innerHTML = '<i class="fas fa-play"></i>';
                aiCover.appendChild(overlay);
            }

            imgEl.src = currentAiSong.cover;
            imgEl.alt = `${currentAiSong.title} - ${currentAiSong.author_name}`;

            // 图片加载失败时显示默认图标
            imgEl.onerror = function() {
                aiCover.innerHTML = `
                    <i class="fas fa-brain"></i>
                    <div class="ai-play-overlay">
                        <i class="fas fa-play"></i>
                    </div>
                `;
            };
        }
    } else {
        // 重置为默认状态
        if (aiTitle) aiTitle.textContent = '正在为您AI推荐音乐...';
        if (aiArtist) aiArtist.textContent = '点击开始播放AI推荐';
        if (aiCover) {
            aiCover.innerHTML = `
                <i class="fas fa-brain"></i>
                <div class="ai-play-overlay">
                    <i class="fas fa-play"></i>
                </div>
            `;
        }
    }
}

// 更新每日推荐界面显示
function updateDailyRecommendDisplay() {
    if (currentDailyRecommendList.length === 0) {
        return;
    }

    // 更新每日推荐歌曲列表显示
    const dailySongsPreview = document.querySelector('.daily-songs-preview');
    if (dailySongsPreview) {
        // 显示加载状态
        dailySongsPreview.innerHTML = '<div class="loading-state">正在加载每日推荐...</div>';

        // 使用 requestAnimationFrame 优化DOM更新
        requestAnimationFrame(() => {
        // 格式化时长函数
        const formatDuration = (seconds) => {
            if (!seconds || seconds <= 0) return '--:--';
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        // 显示所有推荐歌曲，使用通用的 song-list-item 样式
        dailySongsPreview.innerHTML = currentDailyRecommendList.map((song, index) => {
            // 使用全局统一的歌曲信息格式化函数
            const formattedInfo = window.formatSongInfo ? window.formatSongInfo(song) : {
                songname: song.songname || song.title || song.name || song.filename || '未知歌曲',
                author_name: song.author_name || '未知艺术家'
            };

            return `
            <div class="song-list-item" data-index="${index}" data-song-id="${song.hash}">
                <div class="song-cover">
                    <img src="${song.cover}" alt="${formattedInfo.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="cover-placeholder" style="display: none;">
                        <i class="fas fa-music"></i>
                    </div>
                </div>
                <div class="song-info">
                    <div class="songname">${formattedInfo.songname}</div>
                    <div class="author_name">${formattedInfo.author_name}</div>
                </div>
                <div class="song-actions">
                    <button class="action-btn play-btn" title="播放" data-index="${index}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="action-btn like-btn" title="收藏" data-song-id="${song.hash}">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
                <div class="song-duration">${formatDuration(song.time_length)}</div>
            </div>`;
        }).join('');

        // 重新绑定播放按钮事件 - 使用统一的 PlayerController
        const playBtns = dailySongsPreview.querySelectorAll('.song-play-btn');
        console.log('绑定每日推荐播放按钮事件，按钮数量:', playBtns.length);
        playBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                console.log('每日推荐播放按钮被点击，索引:', index);
                e.stopPropagation();

                // 使用 PlayerController 播放指定索引的歌曲
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentDailyRecommendList, index, '每日推荐');
                }
            });
        });

        // 绑定歌曲项事件 - 使用统一的 PlayerController
        const songItems = dailySongsPreview.querySelectorAll('.song-list-item');
        console.log('绑定每日推荐歌曲项点击事件，歌曲数量:', songItems.length);

        // 绑定播放按钮事件
        dailySongsPreview.addEventListener('click', (e) => {
            if (e.target.closest('.play-btn')) {
                const songItem = e.target.closest('.song-list-item');
                const index = parseInt(songItem.dataset.index);
                console.log('每日推荐播放按钮被点击，索引:', index);

                // 使用 PlayerController 播放指定索引的歌曲
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentDailyRecommendList, index, '每日推荐');
                }
            }

            // 绑定收藏按钮事件
            if (e.target.closest('.like-btn')) {
                const songId = e.target.closest('.like-btn').dataset.songId;
                console.log('每日推荐收藏按钮被点击，歌曲ID:', songId);

                // 调用全局收藏函数
                if (window.addToFavorites) {
                    window.addToFavorites(songId);
                }
            }
        });

        // 绑定双击播放事件
        songItems.forEach((item) => {
            item.addEventListener('dblclick', () => {
                const index = parseInt(item.dataset.index);
                console.log('每日推荐歌曲项被双击，索引:', index);

                // 使用 PlayerController 播放指定索引的歌曲
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentDailyRecommendList, index, '每日推荐');
                }
            });
        });

        }); // 关闭 requestAnimationFrame 回调
    }

    console.log('每日推荐界面显示已更新');
}

// 更新私人专属好歌界面显示
function updatePersonalRecommendDisplay() {
    if (currentPersonalRecommendList.length === 0) {
        return;
    }

    const personalRecommendList = document.getElementById('personalRecommendList');
    if (personalRecommendList) {
        // 显示私人专属好歌列表
        personalRecommendList.innerHTML = currentPersonalRecommendList.map((song, index) => `
            <div class="personal-recommend-item" data-index="${index}">
                <div class="song-cover">
                    <img src="${song.cover}" alt="${song.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="cover-placeholder" style="display: none;">
                        <i class="fas fa-music"></i>
                    </div>
                </div>
                <div class="song-info">
                    <div class="songname">${song.songname}</div>
                    <div class="author_name">${song.author_name}</div>
                </div>
                <div class="song-actions">
                    <button class="action-btn play-btn" title="播放" data-index="${index}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="action-btn like-btn" title="收藏" data-index="${index}">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
                <div class="song-duration">${formatDuration(song.time_length)}</div>
            </div>
        `).join('');

        // 绑定播放按钮事件
        const playBtns = personalRecommendList.querySelectorAll('.play-btn');
        playBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                e.stopPropagation();
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentPersonalRecommendList, index, '私人专属好歌');
                }
            });
        });

        // 绑定歌曲项点击事件
        const songItems = personalRecommendList.querySelectorAll('.personal-recommend-item');
        songItems.forEach((item) => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentPersonalRecommendList, index, '私人专属好歌');
                }
            });
        });

        // 绑定收藏按钮事件
        const likeBtns = personalRecommendList.querySelectorAll('.like-btn');
        likeBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                e.stopPropagation();
                const song = currentPersonalRecommendList[index];
                if (window.addToFavorites && song) {
                    window.addToFavorites(song.hash, song.songname, song.author_name);
                }
            });
        });
    }

    console.log('私人专属好歌界面显示已更新');
}

// 更新VIP专属推荐界面显示
function updateVipRecommendDisplay() {
    if (currentVipRecommendList.length === 0) {
        return;
    }

    const vipRecommendList = document.getElementById('vipRecommendList');
    if (vipRecommendList) {
        // 显示VIP专属推荐列表
        vipRecommendList.innerHTML = currentVipRecommendList.map((song, index) => `
            <div class="vip-recommend-item" data-index="${index}">
                <div class="song-cover">
                    <img src="${song.cover}" alt="${song.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="cover-placeholder" style="display: none;">
                        <i class="fas fa-music"></i>
                    </div>
                </div>
                <div class="song-info">
                    <div class="songname">${song.songname}</div>
                    <div class="author_name">${song.author_name}</div>
                </div>
                <div class="song-actions">
                    <button class="action-btn play-btn" title="播放" data-index="${index}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="action-btn like-btn" title="收藏" data-index="${index}">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
                <div class="song-duration">${formatDuration(song.time_length)}</div>
            </div>
        `).join('');

        // 绑定播放按钮事件
        const playBtns = vipRecommendList.querySelectorAll('.play-btn');
        playBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                e.stopPropagation();
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentVipRecommendList, index, 'VIP专属推荐');
                }
            });
        });

        // 绑定歌曲项点击事件
        const songItems = vipRecommendList.querySelectorAll('.vip-recommend-item');
        songItems.forEach((item) => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                if (window.PlayerController) {
                    window.PlayerController.playPlaylist(currentVipRecommendList, index, 'VIP专属推荐');
                }
            });
        });

        // 绑定收藏按钮事件
        const likeBtns = vipRecommendList.querySelectorAll('.like-btn');
        likeBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                e.stopPropagation();
                const song = currentVipRecommendList[index];
                if (window.addToFavorites && song) {
                    window.addToFavorites(song.hash, song.songname, song.author_name);
                }
            });
        });
    }

    console.log('VIP专属推荐界面显示已更新');
}

// 防止重复绑定的标志
let playerEventsInitialized = false;

// 初始化底栏播放器事件（简化版本，主要播放器控制由 html5-audio-player-unified.js 处理）
function initPlayerBarEvents() {
    if (playerEventsInitialized) {
        console.log('播放器事件已经初始化过了，跳过重复绑定');
        return;
    }

    console.log('🚀 initPlayerBarEvents() 函数被调用了！');
    console.log('当前时间:', new Date().toLocaleTimeString());

    // 只处理收藏按钮，其他播放器控制由 html5-audio-player-unified.js 统一处理
    // 特别选择播放器底栏中的喜欢按钮，而不是沉浸式播放器中的
    const favoriteBtn = document.querySelector('.player-control-btn.favorite-btn');

    console.log('播放器元素查找结果:');
    console.log('- favoriteBtn:', !!favoriteBtn);

    // 收藏按钮
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', async () => {
            console.log('收藏按钮被点击');

            // 尝试多种方式获取当前播放歌曲
            let currentPlayingSong = null;

            // 方式1：从 PlaylistManager 获取
            if (window.PlaylistManager) {
                currentPlayingSong = window.PlaylistManager.getCurrentSong();
                console.log('从 PlaylistManager 获取当前歌曲:', currentPlayingSong);
            }

            // 方式2：从 PlayerController 获取
            if (!currentPlayingSong && window.PlayerController) {
                currentPlayingSong = window.PlayerController.getCurrentSong();
                console.log('从 PlayerController 获取当前歌曲:', currentPlayingSong);
            }

            if (currentPlayingSong) {
                console.log('收藏歌曲:', currentPlayingSong.songname || currentPlayingSong.title || '未知歌曲');
                console.log('歌曲完整信息:', currentPlayingSong);
                await addToFavorites(currentPlayingSong);
            } else {
                console.warn('没有正在播放的歌曲');
                showToast('没有正在播放的歌曲', 'warning');
            }
        });
    }

    // 设置初始化标志
    playerEventsInitialized = true;
    console.log('✅ 播放器事件初始化完成（简化版本）');
    console.log('🎵 主要播放器控制（播放/暂停/进度条/音量等）由 html5-audio-player-unified.js 统一处理');
}

// ==================== 私人FM功能 ====================
async function toggleFM() {
    // 确保有FM播放列表
    if (fmPlaylist.length === 0) {
        await loadRandomFmSong();
    }

    if (fmPlaylist.length > 0 && window.PlayerController) {
        console.log(`🎵 设置FM播放列表，共${fmPlaylist.length}首歌曲，从第${fmCurrentIndex + 1}首开始播放`);
        console.log('🎵 当前播放:', fmPlaylist[fmCurrentIndex]?.title);

        // 使用PlayerController设置完整的FM播放列表
        const success = await window.PlayerController.playPlaylist(fmPlaylist, fmCurrentIndex, '私人FM', 'list');
        if (success) {
            console.log('✅ FM播放列表已设置，可以使用播放按钮播放');
        } else {
            console.error('❌ 设置FM播放列表失败');
        }
    } else {
        console.log('🎵 FM播放列表已加载，点击播放按钮开始播放');
    }
}

async function startFM() {
    console.log('🎵 准备FM歌曲（不自动播放）');

    try {
        await loadRandomFmSong();

        if (currentFmSong) {
            console.log('✅ FM歌曲已准备就绪:', currentFmSong.title);
            updateFmDisplay();
        } else {
            console.error('❌ 无法加载FM歌曲');
        }
    } catch (error) {
        console.error('❌ 准备FM歌曲异常:', error);
    }
}

// pauseFM 函数已移除，现在统一使用 PlayerController.togglePlayPause()

async function loadRandomFmSong(forceNew = false) {
    // 如果已有预加载的歌曲且不强制获取新歌曲，直接使用
    if (currentFmSong && !forceNew) {
        console.log('使用预加载的FM歌曲:', currentFmSong.title);
        updateFmDisplay();
        return;
    }

    try {
        console.log('正在获取新的私人FM歌曲...');

        // 调用后端API获取私人FM歌曲
        // 如果有当前播放的歌曲信息，使用高级参数版本
        let response;
        if (currentFmHash || currentFmSongId) {
            response = await HomepageService.GetPersonalFMAdvanced(
                currentFmHash,
                currentFmSongId, 
                0, // playtime 固定为0
                currentFmMode,
                currentFmSongPoolId,
                currentFmIsOverplay,
                currentFmRemainSongCnt
            );
        } else {
            response = await HomepageService.GetPersonalFMWithParams(currentFmMode, currentFmSongPoolId);
        }

        if (response.success && response.data && response.data.length > 0) {
            // 随机选择一首歌曲
            const randomIndex = Math.floor(Math.random() * response.data.length);
            const songData = response.data[randomIndex];

            // 转换为前端使用的格式
            currentFmSong = {
                hash: songData.hash,
                title: songData.songname,
                songname: songData.songname,  // 为播放历史记录添加
                author_name: songData.author_name,
                author_name: songData.author_name,  // 为播放历史记录添加
                album: songData.album_name,
                album_name: songData.album_name,  // 为播放历史记录添加
                duration: songData.time_length,
                time_length: songData.time_length,  // 为播放历史记录添加
                cover: getCoverImageUrl(songData.union_cover, 120), // 使用120px尺寸的封面
                coverOriginal: songData.union_cover, // 保留原始URL模板
                union_cover: songData.union_cover,  // 为播放历史记录添加
                filename: songData.filename || '',  // 为播放历史记录添加
                album_id: songData.album_id || ''  // 为播放历史记录添加
            };

            console.log('获取新的私人FM歌曲成功:', currentFmSong);
            updateFmDisplay();
        } else {
            console.warn('API返回数据为空，使用本地数据');
        }
    } catch (error) {
        console.error('获取私人FM歌曲失败:', error);
    }
}

 


async function likeFmSong() {
    if (currentFmSong) {
        console.log('喜欢歌曲:', currentFmSong.title);

        try {
            // 调用API报告喜欢操作
            if (currentFmSong.hash) {
                const response = await HomepageService.ReportFMAction(
                    currentFmSong.hash,
                    '', // songID 可选
                    'play', // 喜欢操作
                    0 // 播放时间
                );

                if (response.success) {
                    console.log('喜欢操作成功');
                } else {
                    console.warn('喜欢操作失败:', response.message);
                }
            }
        } catch (error) {
            console.error('喜欢操作API调用失败:', error);
        }

        // 切换到下一首
        nextFmSong();
    }
}

async function dislikeFmSong() {
    if (currentFmSong) {
        console.log('不喜欢歌曲:', currentFmSong.title);

        try {
            // 调用API报告不喜欢操作
            if (currentFmSong.hash) {
                const response = await HomepageService.ReportFMAction(
                    currentFmSong.hash,
                    '', // songID 可选
                    'garbage', // 不喜欢操作
                    0 // 播放时间
                );

                if (response.success) {
                    console.log('不喜欢操作成功');
                } else {
                    console.warn('不喜欢操作失败:', response.message);
                }
            }
        } catch (error) {
            console.error('不喜欢操作API调用失败:', error);
        }

        // 切换到下一首
        nextFmSong();
    }
}

async function nextFmSong() {
    console.log('🎵 切换到下一首FM歌曲');

    try {
        // 先尝试从现有播放列表中获取下一首
        if (fmCurrentIndex + 1 < fmPlaylist.length) {
            fmCurrentIndex++;
            currentFmSong = fmPlaylist[fmCurrentIndex];
            console.log(`✅ 从播放列表中选择下一首 (${fmCurrentIndex + 1}/${fmPlaylist.length}):`, currentFmSong.title);
        } else {
            // 播放列表用完了，获取新的歌曲
            console.log('🔄 播放列表已播放完毕，获取新的FM歌曲...');
            await loadRandomFmSong(true);
            
            if (fmPlaylist.length > 0) {
                // 重置索引到新歌曲的开始（假设API返回了新歌曲）
                fmCurrentIndex = Math.max(0, fmPlaylist.length - 10); // 指向最近添加的歌曲
                currentFmSong = fmPlaylist[fmCurrentIndex];
                console.log(`✅ 新的FM歌曲已准备就绪 (${fmCurrentIndex + 1}/${fmPlaylist.length}):`, currentFmSong.title);
            }
        }

        if (currentFmSong && window.PlayerController) {
            updateFmDisplay();
            
            // 重置自动播放标志
            if (currentFmSong) {
                currentFmSong._autoNextTriggered = false;
            }

            // 更新播放列表并播放当前歌曲
            const success = await window.PlayerController.playPlaylist(fmPlaylist, fmCurrentIndex, '私人FM', 'list');
            if (success) {
                console.log('✅ 下一首FM歌曲已开始播放');
                // 更新FM参数跟踪
                updateFmPlayParams(currentFmSong, false);
            } else {
                console.error('❌ 播放下一首FM歌曲失败');
            }
        } else {
            console.error('❌ 无法加载下一首FM歌曲');
        }
    } catch (error) {
        console.error(`❌ FM歌曲切换异常:`, error);
    }
}

// ==================== AI推荐功能 ====================
async function toggleAI() {
    // 加载AI推荐歌曲列表
    await loadRandomAiSong();

    if (currentAiRecommendList.length > 0 && window.PlayerController) {
        // 找到当前显示歌曲在列表中的索引
        const currentIndex = currentAiRecommendList.findIndex(song => song.hash === currentAiSong.hash);
        const startIndex = currentIndex >= 0 ? currentIndex : 0;

        console.log(`🎵 设置AI推荐播放列表，共${currentAiRecommendList.length}首，从第${startIndex + 1}首开始播放:`, currentAiSong.title);

        // 使用PlayerController设置完整的AI推荐播放列表
        const success = await window.PlayerController.playPlaylist(currentAiRecommendList, startIndex, 'AI推荐', 'list');
        if (success) {
            console.log('✅ AI推荐播放列表已设置，可以使用播放按钮播放');
        } else {
            console.error('❌ 设置AI推荐播放列表失败');
        }
    } else {
        console.log('🎵 AI推荐列表已加载，点击播放按钮开始播放');
    }
}

async function startAI() {
    console.log('🎵 准备AI推荐歌曲（不自动播放）');

    try {
        await loadRandomAiSong();

        if (currentAiSong) {
            console.log('✅ AI推荐歌曲已准备就绪:', currentAiSong.title);
            updateAiDisplay();
        } else {
            console.error('❌ 无法加载AI推荐歌曲');
        }
    } catch (error) {
        console.error('❌ 准备AI推荐歌曲异常:', error);
    }
}

// pauseAI 函数已移除，现在统一使用 PlayerController.togglePlayPause()

async function loadRandomAiSong(forceNew = false) {
    // 如果已有预加载的歌曲且不强制获取新歌曲，直接使用
    if (currentAiSong && !forceNew) {
        console.log('使用预加载的AI推荐歌曲:', currentAiSong.title);
        updateAiDisplay();
        return;
    }

    try {
        console.log('🤖 正在获取新的AI推荐歌曲...');

        // 调用新的AI推荐接口
        console.log('🤖 调用 HomepageService.GetAIRecommend()...');
        const response = await HomepageService.GetAIRecommend();
        console.log('🤖 AI推荐接口响应:', response);

        if (response.success && response.data && response.data.length > 0) {
            // 保存完整的AI推荐列表
            currentAiRecommendList = response.data.map(songData => ({
                hash: songData.hash,
                title: songData.songname,
                songname: songData.songname,
                author_name: songData.author_name,
                album: songData.album_name,
                album_name: songData.album_name,
                duration: songData.time_length,
                time_length: songData.time_length,
                cover: getCoverImageUrl(songData.union_cover, 120),
                coverOriginal: songData.union_cover,
                union_cover: songData.union_cover,
                filename: songData.filename || '',
                album_id: songData.album_id || ''
            }));

            // 随机选择一首歌曲用于显示
            const randomIndex = Math.floor(Math.random() * currentAiRecommendList.length);
            currentAiSong = currentAiRecommendList[randomIndex];

            console.log(`获取AI推荐列表成功，共${currentAiRecommendList.length}首，当前显示:`, currentAiSong.title);
            updateAiDisplay();
        } else {
            console.warn('AI推荐API返回数据为空');
        }
    } catch (error) {
        console.error('获取AI推荐歌曲失败:', error);
    }
}

 



async function likeAiSong() {
    if (currentAiSong) {
        console.log('喜欢AI推荐歌曲:', currentAiSong.title);

        try {
            // 调用API报告喜欢操作
            if (currentAiSong.hash) {
                const response = await HomepageService.ReportFMAction(
                    currentAiSong.hash,
                    '', // songID 可选
                    'play', // 喜欢操作
                    0 // 播放时间
                );

                if (response.success) {
                    console.log('AI推荐喜欢操作成功');
                } else {
                    console.warn('AI推荐喜欢操作失败:', response.message);
                }
            }
        } catch (error) {
            console.error('AI推荐喜欢操作API调用失败:', error);
        }

        // 准备下一首（不自动播放）
        nextAiSong();
    }
}

async function dislikeAiSong() {
    if (currentAiSong) {
        console.log('不喜欢AI推荐歌曲:', currentAiSong.title);

        try {
            // 调用API报告不喜欢操作
            if (currentAiSong.hash) {
                const response = await HomepageService.ReportFMAction(
                    currentAiSong.hash,
                    '', // songID 可选
                    'garbage', // 不喜欢操作
                    0 // 播放时间
                );

                if (response.success) {
                    console.log('AI推荐不喜欢操作成功');
                } else {
                    console.warn('AI推荐不喜欢操作失败:', response.message);
                }
            }
        } catch (error) {
            console.error('AI推荐不喜欢操作API调用失败:', error);
        }

        // 准备下一首（不自动播放）
        nextAiSong();
    }
}

async function nextAiSong() {
    console.log('🎵 切换到下一首AI推荐歌曲');

    try {
        // 如果当前有AI推荐列表，从中选择下一首
        if (currentAiRecommendList.length > 0) {
            // 找到当前歌曲在列表中的索引
            const currentIndex = currentAiRecommendList.findIndex(song => song.hash === currentAiSong.hash);

            // 选择下一首歌曲（如果是最后一首，则重新获取新的推荐列表）
            if (currentIndex >= 0 && currentIndex < currentAiRecommendList.length - 1) {
                // 选择列表中的下一首
                currentAiSong = currentAiRecommendList[currentIndex + 1];
                console.log('✅ 从AI推荐列表中选择下一首:', currentAiSong.title);
                updateAiDisplay();
                return;
            }
        }

        // 如果没有列表或已经是最后一首，重新获取新的推荐列表
        console.log('🔄 重新获取AI推荐列表...');
        await loadRandomAiSong(true); // 强制获取新歌曲

        if (currentAiSong) {
            console.log('✅ 新的AI推荐歌曲已准备就绪:', currentAiSong.title);
            updateAiDisplay();
        } else {
            console.error('❌ 无法加载下一首AI推荐歌曲');
        }
    } catch (error) {
        console.error(`❌ AI推荐歌曲切换异常:`, error);
    }
}

// ==================== 每日推荐功能 ====================
async function playDailyRecommendation() {
    console.log('🎵 每日推荐卡片被点击，开始播放每日推荐歌单');

    // 详细调试信息
    console.log('🔍 调试信息:');
    console.log('  - window.PlayerController 存在:', !!window.PlayerController);
    console.log('  - window.PlaylistManager 存在:', !!window.PlaylistManager);
    console.log('  - currentDailyRecommendList 长度:', currentDailyRecommendList.length);

    if (window.PlayerController) {
        console.log('  - PlayerController 方法:', Object.keys(window.PlayerController));
    }

    if (currentDailyRecommendList.length === 0) {
        console.warn('每日推荐列表为空，尝试重新加载...');
        try {
            await preloadDailyRecommend();
            if (currentDailyRecommendList.length === 0) {
                console.error('无法获取每日推荐歌曲');
                return;
            }
        } catch (error) {
            console.error('重新加载每日推荐失败:', error);
            return;
        }
    }

    // 使用统一的播放控制器播放歌单
    if (window.PlayerController) {
        console.log('🎵 使用PlayerController播放每日推荐，歌曲数量:', currentDailyRecommendList.length);
        console.log('🎵 第一首歌曲数据:', currentDailyRecommendList[0]);

        try {
            const success = await window.PlayerController.playPlaylist(currentDailyRecommendList, 0, '每日推荐');
            if (success) {
                console.log('✅ 每日推荐歌单播放成功');
                resetRetryCounters(); // 重置重试计数器
            } else {
                console.error('❌ 每日推荐歌单播放失败');
            }
        } catch (error) {
            console.error('❌ 每日推荐歌单播放异常:', error);
            console.error('❌ 错误堆栈:', error.stack);
        }
    } else {
        console.error('❌ PlayerController不可用');
        console.error('❌ 当前 window 对象上的属性:', Object.keys(window).filter(key => key.includes('Player') || key.includes('play')));
    }
}

// 旧的播放函数已移除，现在统一使用 PlayerController

// ==================== 历史推荐功能 ====================
function playHistoryPlaylist(index) {
    console.log('播放历史推荐歌单:', index);
    // 这里可以添加播放历史歌单的逻辑
}

// ==================== 播放列表管理 ====================

// 🔧 内存泄漏修复：使用虚拟滚动优化大播放列表
let virtualPlaylistData = [];
let virtualPlaylistCurrentIndex = 0;
let virtualPlaylistName = '当前播放列表';

// 更新右侧栏播放列表
function updateRightSidebarPlaylist(playlist, currentIndex = 0, playlistName = '当前播放列表') {
    const playlistHeader = document.querySelector('#playlistTab .playlist-header h3');
    const playlistCount = document.querySelector('#playlistTab .playlist-count');
    const playlistItems = document.querySelector('#playlistTab .playlist-items');

    if (!playlistItems) {
        console.warn('未找到播放列表容器');
        return;
    }

    // 更新播放列表标题和数量
    if (playlistHeader) {
        playlistHeader.textContent = playlistName;
    }
    if (playlistCount) {
        playlistCount.textContent = `${playlist.length} 首歌曲`;
    }

    // 🔧 内存泄漏修复：保存数据到虚拟列表变量
    virtualPlaylistData = playlist;
    virtualPlaylistCurrentIndex = currentIndex;
    virtualPlaylistName = playlistName;

    // 处理空播放列表的情况
    if (playlist.length === 0) {
        playlistItems.innerHTML = `
            <div class="empty-playlist">
                <div class="empty-icon">
                    <i class="fas fa-music"></i>
                </div>
                <div class="empty-text">播放列表为空</div>
                <div class="empty-subtext">选择歌曲开始播放</div>
            </div>
        `;
        return;
    }

    // 🔧 内存泄漏修复：对于大播放列表使用虚拟滚动
    if (playlist.length > 100) {
        console.log(`🚀 使用虚拟滚动优化大播放列表 (${playlist.length} 首歌曲)`);
        renderVirtualPlaylist(playlistItems);
    } else {
        console.log(`📋 渲染普通播放列表 (${playlist.length} 首歌曲)`);
        renderNormalPlaylist(playlistItems, playlist, currentIndex);
    }

    console.log(`✅ 播放列表已更新: ${playlistName}，共 ${playlist.length} 首歌曲`);
}

// 🔧 内存泄漏修复：虚拟滚动渲染大播放列表
function renderVirtualPlaylist(container) {
    // 清空现有内容
    container.innerHTML = '';

    // 创建虚拟滚动容器
    const virtualContainer = document.createElement('div');
    virtualContainer.className = 'virtual-playlist-container';
    virtualContainer.style.cssText = `
        height: 100%;
        overflow-y: auto;
        position: relative;
    `;

    // 创建虚拟内容区域（用于撑开滚动条）
    const virtualContent = document.createElement('div');
    virtualContent.className = 'virtual-content';
    virtualContent.style.height = `${virtualPlaylistData.length * 60}px`; // 每项60px高度
    virtualContent.style.position = 'relative';

    // 创建可视区域（只渲染可见的项目）
    const visibleArea = document.createElement('div');
    visibleArea.className = 'virtual-visible-area';
    visibleArea.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
    `;

    virtualContent.appendChild(visibleArea);
    virtualContainer.appendChild(virtualContent);
    container.appendChild(virtualContainer);

    // 渲染可见项目
    let lastScrollTop = 0;
    const renderVisibleItems = () => {
        const scrollTop = virtualContainer.scrollTop;
        const containerHeight = virtualContainer.clientHeight;
        const itemHeight = 60;
        
        // 计算可见范围
        const startIndex = Math.floor(scrollTop / itemHeight);
        const endIndex = Math.min(
            virtualPlaylistData.length - 1,
            Math.ceil((scrollTop + containerHeight) / itemHeight) + 5 // 多渲染5个作为缓冲
        );

        // 清空可视区域
        visibleArea.innerHTML = '';

        // 渲染可见项目
        for (let i = startIndex; i <= endIndex; i++) {
            const song = virtualPlaylistData[i];
            if (!song) continue;

            const isActive = i === virtualPlaylistCurrentIndex;
            const duration = formatDuration(song.time_length || 0);

            const playlistItem = document.createElement('div');
            playlistItem.className = `playlist-item-card${isActive ? ' active' : ''}`;
            playlistItem.dataset.index = i;
            playlistItem.style.cssText = `
                position: absolute;
                top: ${i * itemHeight}px;
                left: 0;
                right: 0;
                height: ${itemHeight}px;
                display: flex;
                align-items: center;
                padding: 8px 12px;
                cursor: pointer;
            `;

            // 处理封面图片
            const coverUrl = song.union_cover ? song.union_cover.replace('{size}', '36') : '';

            // 使用全局统一的歌曲信息格式化函数
            const formattedInfo = window.formatSongInfo ? window.formatSongInfo(song) : {
                songname: song.songname || song.title || song.name || song.filename || '未知歌曲',
                author_name: song.author_name || '未知艺术家'
            };

            playlistItem.innerHTML = `
                <div class="item-cover">
                    ${coverUrl ?
                        `<img src="${coverUrl}" alt="${formattedInfo.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                         <i class="fas fa-music" style="display: none;"></i>` :
                        `<i class="fas fa-music"></i>`
                    }
                </div>
                <div class="item-info">
                    <div class="item-title">${formattedInfo.songname}</div>
                    <div class="item-author_name">${formattedInfo.author_name}</div>
                </div>
                <div class="item-duration">${duration}</div>
            `;

            // 添加点击事件
            playlistItem.addEventListener('click', () => {
                console.log(`虚拟播放列表项被点击，索引: ${i}`);
                if (window.PlayerController) {
                    window.PlayerController.playByIndex(i);
                }
            });

            // 添加悬停效果（使用CSS类而不是内联样式）
            playlistItem.addEventListener('mouseenter', () => {
                playlistItem.classList.add('hover');
            });
            playlistItem.addEventListener('mouseleave', () => {
                playlistItem.classList.remove('hover');
            });

            visibleArea.appendChild(playlistItem);
        }

        lastScrollTop = scrollTop;
    };

    // 初始渲染
    renderVisibleItems();

    // 滚动事件监听（使用节流优化性能）
    let scrollTimeout = null;
    virtualContainer.addEventListener('scroll', () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(renderVisibleItems, 16); // 约60fps
    });

    // 滚动到当前播放项
    if (virtualPlaylistCurrentIndex >= 0) {
        const targetScrollTop = virtualPlaylistCurrentIndex * 60 - virtualContainer.clientHeight / 2;
        virtualContainer.scrollTop = Math.max(0, targetScrollTop);
    }
}

// 🔧 内存泄漏修复：普通播放列表渲染（小于100首歌曲）
function renderNormalPlaylist(container, playlist, currentIndex) {
    // 清空现有列表
    container.innerHTML = '';

    // 生成播放列表项（限制数量以防止内存问题）
    const maxItems = Math.min(playlist.length, 100);
    for (let index = 0; index < maxItems; index++) {
        const song = playlist[index];
        const isActive = index === currentIndex;
        const duration = formatDuration(song.time_length || 0);

        const playlistItem = document.createElement('div');
        playlistItem.className = `playlist-item-card${isActive ? ' active' : ''}`;
        playlistItem.dataset.index = index;

        // 处理封面图片
        const coverUrl = song.union_cover ? song.union_cover.replace('{size}', '36') : '';

        // 使用全局统一的歌曲信息格式化函数
        const formattedInfo = window.formatSongInfo ? window.formatSongInfo(song) : {
            songname: song.songname || song.title || song.name || song.filename || '未知歌曲',
            author_name: song.author_name || '未知艺术家'
        };

        playlistItem.innerHTML = `
            <div class="item-cover">
                ${coverUrl ?
                    `<img src="${coverUrl}" alt="${formattedInfo.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                     <i class="fas fa-music" style="display: none;"></i>` :
                    `<i class="fas fa-music"></i>`
                }
            </div>
            <div class="item-info">
                <div class="item-title">${formattedInfo.songname}</div>
                <div class="item-author_name">${formattedInfo.author_name}</div>
            </div>
            <div class="item-duration">${duration}</div>
        `;

        // 添加点击事件 - 使用统一的 PlayerController
        playlistItem.addEventListener('click', () => {
            console.log(`播放列表项被点击，索引: ${index}`);
            if (window.PlayerController) {
                window.PlayerController.playByIndex(index);
            }
        });

        container.appendChild(playlistItem);
    }

    // 如果歌曲数量被截断，显示提示
    if (playlist.length > 100) {
        const moreInfo = document.createElement('div');
        moreInfo.className = 'playlist-more-info';
        moreInfo.innerHTML = `
            <div style="padding: 16px; text-align: center; color: rgba(255,255,255,0.7); font-size: 14px;">
                <i class="fas fa-info-circle"></i> 
                显示前100首，共${playlist.length}首歌曲
            </div>
        `;
        container.appendChild(moreInfo);
    }
}

// 格式化时长（秒转换为 mm:ss 格式）
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '--:--';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 更新播放列表中的当前播放项
function updatePlaylistActiveItem(currentIndex) {
    const playlistItems = document.querySelectorAll('#playlistTab .playlist-item-card');

    playlistItems.forEach((item, index) => {
        if (index === currentIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// ==================== 工具函数 ====================
// 清除每日推荐缓存并强制刷新
async function refreshDailyRecommend() {
    console.log('🔄 清除每日推荐缓存并强制刷新...');

    // 清除缓存
    localStorage.removeItem(CACHE_KEYS.DAILY_RECOMMEND);

    // 强制刷新数据
    await preloadDailyRecommend(true);

    console.log('✅ 每日推荐已刷新');
}

// 清除所有推荐缓存
function clearAllRecommendCache() {
    console.log('🗑️ 清除所有推荐缓存...');

    Object.values(CACHE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });

    console.log('✅ 所有推荐缓存已清除');
}

// 更新每日推荐日期
function updateDailyDate() {
    const today = new Date();
    const dayEl = document.querySelector('.date-day');
    const monthEl = document.querySelector('.date-month');

    if (dayEl && monthEl) {
        dayEl.textContent = today.getDate().toString().padStart(2, '0');
        monthEl.textContent = (today.getMonth() + 1).toString().padStart(2, '0');
    }
}

// 更新右侧歌词显示
function updateLyricsDisplay(lyricsContent) {
    const lyricsDisplay = document.querySelector('.lyrics-display');
    if (!lyricsDisplay) return;

    if (!lyricsContent) {
        // 如果没有歌词，显示默认信息
        lyricsDisplay.innerHTML = '<div class="lyrics-line no-lyrics">纯音乐请欣赏</div>';
        currentLyricsLines = []; // 清空歌词数据
        window.currentLyricsLines = []; // 同时清空全局数据
        return;
    }

    try {
        // 使用统一的歌词解析函数
        const lyricsLines = parseLyrics(lyricsContent);

        if (lyricsLines.length === 0) {
            lyricsDisplay.innerHTML = '<div class="lyrics-line no-lyrics">歌词解析失败</div>';
            currentLyricsLines = []; // 清空歌词数据
            window.currentLyricsLines = []; // 同时清空全局数据
            return;
        }

        // 保存解析后的歌词数据供高亮使用
        currentLyricsLines = lyricsLines;
        // 同时暴露到全局作用域
        window.currentLyricsLines = lyricsLines;

        // 根据歌词格式生成不同的HTML
        const lyricsHTML = generateLyricsHTML(lyricsLines);

        lyricsDisplay.innerHTML = lyricsHTML;

        // 添加点击事件监听器
        addLyricsClickListeners();

        console.log('右侧歌词显示已更新，共', lyricsLines.length, '行，格式:', lyricsLines[0]?.format || 'unknown');
    } catch (error) {
        console.error('更新歌词显示失败:', error);
        lyricsDisplay.innerHTML = '<div class="lyrics-line no-lyrics">歌词显示错误</div>';
        currentLyricsLines = []; // 清空歌词数据
        window.currentLyricsLines = []; // 同时清空全局数据
    }
}

// 根据歌词格式生成HTML
function generateLyricsHTML(lyricsLines) {
    if (!lyricsLines || lyricsLines.length === 0) return '';

    const format = lyricsLines[0]?.format || 'lrc';

    if (format === 'krc') {
        // KRC格式：为每个字符创建单独的span，支持逐字高亮
        return lyricsLines.map((line, index) => {
            const wordsHTML = line.words ? line.words.map((word, wordIndex) =>
                `<span class="lyrics-word" data-start-time="${word.startTime}" data-end-time="${word.endTime}" data-word-index="${wordIndex}">${word.text}</span>`
            ).join('') : line.text;

            return `<div class="lyrics-line krc-line" data-time="${line.time}" data-end-time="${line.endTime}" data-index="${index}">${wordsHTML}</div>`;
        }).join('');
    } else {
        // LRC格式或纯文本：按行显示
        return lyricsLines.map((line, index) =>
            `<div class="lyrics-line lrc-line" data-time="${line.time}" data-index="${index}">${line.text}</div>`
        ).join('');
    }
}

// 检测歌词格式
function detectLyricsFormat(lyricsContent) {
    if (!lyricsContent) return 'unknown';

    // KRC格式特征：包含 [数字,数字] 和 <数字,数字,数字> 标记
    const krcPattern = /\[\d+,\d+\].*?<\d+,\d+,\d+>/;
    if (krcPattern.test(lyricsContent)) {
        return 'krc';
    }

    // LRC格式特征：包含 [mm:ss.xx] 时间标签
    const lrcPattern = /\[\d{2}:\d{2}\.\d{2}\]/;
    if (lrcPattern.test(lyricsContent)) {
        return 'lrc';
    }

    return 'plain'; // 纯文本
}

// 统一的歌词解析函数
function parseLyrics(lyricsContent) {
    const format = detectLyricsFormat(lyricsContent);
    console.log('🎵 检测到歌词格式:', format);

    switch (format) {
        case 'krc':
            return parseKRCLyrics(lyricsContent);
        case 'lrc':
            return parseLRCLyrics(lyricsContent);
        case 'plain':
            return parsePlainLyrics(lyricsContent);
        default:
            return [];
    }
}

// 解析KRC格式歌词（包含逐字时间戳）
function parseKRCLyrics(krcContent) {
    if (!krcContent) return [];

    const lines = krcContent.split('\n');
    const lyricsLines = [];

    // KRC格式正则表达式
    // [171960,5040]<0,240,0>你<240,150,0>走<390,300,0>之<690,570,0>后
    const lineRegex = /^\[(\d+),(\d+)\](.*)$/;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const lineMatch = trimmedLine.match(lineRegex);
        if (lineMatch) {
            const startTime = parseInt(lineMatch[1]) / 1000; // 转换为秒
            const duration = parseInt(lineMatch[2]) / 1000; // 转换为秒
            const content = lineMatch[3];

            // 解析每个字符的时间戳
            const words = [];
            const wordRegex = /<(\d+),(\d+),\d+>([^<]*)/g;
            let match;
            let currentTime = startTime;

            while ((match = wordRegex.exec(content)) !== null) {
                const wordStartOffset = parseInt(match[1]) / 1000; // 相对于行开始的偏移时间
                const wordDuration = parseInt(match[2]) / 1000; // 字符持续时间
                const text = match[3];

                if (text.trim()) {
                    words.push({
                        text: text,
                        startTime: startTime + wordStartOffset,
                        duration: wordDuration,
                        endTime: startTime + wordStartOffset + wordDuration
                    });
                }
            }

            if (words.length > 0) {
                lyricsLines.push({
                    time: startTime,
                    duration: duration,
                    endTime: startTime + duration,
                    text: words.map(w => w.text).join(''),
                    words: words,
                    format: 'krc',
                    originalLine: trimmedLine // 保存原始行文本
                });
            }
        }
    }

    // 按时间排序
    lyricsLines.sort((a, b) => a.time - b.time);

    return lyricsLines;
}

// 解析LRC格式歌词
function parseLRCLyrics(lrcContent) {
    if (!lrcContent) return [];

    const lines = lrcContent.split('\n');
    const lyricsLines = [];

    // LRC时间标签正则表达式: [mm:ss.xx]
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\]/g;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const matches = [...trimmedLine.matchAll(timeRegex)];
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const minutes = parseInt(lastMatch[1]);
            const seconds = parseInt(lastMatch[2]);
            const centiseconds = parseInt(lastMatch[3]);

            const time = minutes * 60 + seconds + centiseconds / 100;
            const text = trimmedLine.substring(lastMatch.index + lastMatch[0].length).trim();

            if (text) {
                lyricsLines.push({
                    time: time,
                    text: text,
                    format: 'lrc',
                    originalLine: trimmedLine // 保存原始LRC行文本
                });
            }
        }
    }

    // 按时间排序
    lyricsLines.sort((a, b) => a.time - b.time);

    return lyricsLines;
}

// 解析纯文本歌词
function parsePlainLyrics(plainContent) {
    if (!plainContent) return [];

    const lines = plainContent.split('\n');
    const lyricsLines = [];

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            lyricsLines.push({
                time: index * 3, // 假设每行3秒
                text: trimmedLine,
                format: 'plain'
            });
        }
    });

    return lyricsLines;
}

// 当前高亮的歌词行索引，用于避免重复滚动
let currentActiveLyricsIndex = -1;

// 防抖滚动函数
let scrollTimeout = null;
const debouncedScrollToLyrics = (activeLine) => {
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(() => {
        scrollToActiveLyrics(activeLine);
    }, 100); // 100ms防抖延迟
};

// 更新歌词高亮
function updateLyricsHighlight(currentTime) {
    if (!currentLyricsLines || currentLyricsLines.length === 0) {
        return;
    }

    const format = currentLyricsLines[0]?.format || 'lrc';

    if (format === 'krc') {
        updateKRCLyricsHighlight(currentTime);
    } else {
        updateLRCLyricsHighlight(currentTime);
    }
}

// 更新LRC格式歌词高亮（按行高亮）
function updateLRCLyricsHighlight(currentTime) {
    // 找到当前时间应该高亮的歌词行 - 使用更精确的时间匹配
    let activeIndex = -1;

    for (let i = 0; i < currentLyricsLines.length; i++) {
        const lyricTime = currentLyricsLines[i].time;
        const nextLyricTime = i < currentLyricsLines.length - 1 ?
                              currentLyricsLines[i + 1].time :
                              Infinity;

        // 当前时间在这句歌词的时间范围内
        if (currentTime >= lyricTime && currentTime < nextLyricTime) {
            activeIndex = i;
            break;
        }
        // 如果是最后一句歌词，只要时间超过就高亮
        else if (i === currentLyricsLines.length - 1 && currentTime >= lyricTime) {
            activeIndex = i;
            break;
        }
    }

    // 如果没有找到合适的歌词行，使用传统的查找方式作为备选
    if (activeIndex === -1) {
        for (let i = currentLyricsLines.length - 1; i >= 0; i--) {
            if (currentTime >= currentLyricsLines[i].time) {
                activeIndex = i;
                break;
            }
        }
    }

    // 只有当高亮行发生变化时才更新DOM和OSD歌词
    if (activeIndex !== currentActiveLyricsIndex && activeIndex >= 0) {
        currentActiveLyricsIndex = activeIndex;

        // 发送完整的行数据到OSD（与KRC格式保持一致）
        const currentLine = currentLyricsLines[activeIndex];
        if (currentLine && window.sendKRCLineToOSD) {
            window.sendKRCLineToOSD(currentLine);
        }
    } else if (activeIndex !== currentActiveLyricsIndex) {
        // 行变化但没有活跃行（可能是歌曲结束）
        currentActiveLyricsIndex = activeIndex;
    }

    // 更新歌词行的高亮状态
    const lyricsLines = document.querySelectorAll('.lyrics-line');

    lyricsLines.forEach((line, index) => {
        line.classList.remove('active');
        // 移除果冻效果类（如果存在）
        line.classList.remove('jelly-active');

        if (index === activeIndex) {
            line.classList.add('active');

            // 滚动到当前歌词行（使用防抖）
            debouncedScrollToLyrics(line);
        }
    });
}

// 全局变量来跟踪上次的高亮状态
let lastActiveLineIndex = -1;
let lastActiveWordIndex = -1;

// 更新KRC格式歌词高亮（逐字高亮）
function updateKRCLyricsHighlight(currentTime) {
    // 找到当前时间应该高亮的歌词行
    let activeLineIndex = -1;
    let activeWordIndex = -1;

    for (let i = 0; i < currentLyricsLines.length; i++) {
        const line = currentLyricsLines[i];

        // 检查是否在当前行的时间范围内
        if (currentTime >= line.time && currentTime <= line.endTime) {
            activeLineIndex = i;

            // 在当前行中找到应该高亮的字
            if (line.words) {
                for (let j = 0; j < line.words.length; j++) {
                    const word = line.words[j];
                    if (currentTime >= word.startTime && currentTime <= word.endTime) {
                        activeWordIndex = j;
                        break;
                    }
                }
            }
            break;
        }
    }

    // 检查是否有变化
    const hasLineChanged = activeLineIndex !== lastActiveLineIndex;

    // 只有当行发生变化时才更新OSD歌词（不需要字级变化触发）
    if (hasLineChanged && activeLineIndex >= 0) {
        // 更新记录的状态
        lastActiveLineIndex = activeLineIndex;
        lastActiveWordIndex = activeWordIndex;

        // 发送完整的KRC行数据到OSD
        const currentLine = currentLyricsLines[activeLineIndex];
        if (currentLine && window.sendKRCLineToOSD) {
            window.sendKRCLineToOSD(currentLine);
        }
    } else if (hasLineChanged) {
        // 行变化但没有活跃行（可能是歌曲结束）
        lastActiveLineIndex = activeLineIndex;
        lastActiveWordIndex = activeWordIndex;
    }

    // 更新行级高亮
    const lyricsLines = document.querySelectorAll('.lyrics-line');

    lyricsLines.forEach((line, index) => {
        line.classList.remove('active');
        line.classList.remove('jelly-active');

        if (index === activeLineIndex) {
            line.classList.add('active');

            // 滚动到当前歌词行（使用防抖）
            debouncedScrollToLyrics(line);
        }
    });

    // 更新字级高亮（仅对KRC格式）
    const allWords = document.querySelectorAll('.lyrics-word');
    allWords.forEach(word => {
        word.classList.remove('active-word');
    });

    if (activeLineIndex >= 0 && activeWordIndex >= 0) {
        const activeLine = lyricsLines[activeLineIndex];
        if (activeLine) {
            const wordsInLine = activeLine.querySelectorAll('.lyrics-word');
            if (wordsInLine[activeWordIndex]) {
                wordsInLine[activeWordIndex].classList.add('active-word');
            }
        }
    }
}

// 果冻效果函数已禁用
// function triggerMainLyricsJellyEffect(lyricsLine) {
//     // 果冻效果已移除
// }

// 滚动到当前歌词行
function scrollToActiveLyrics(activeLine) {
    if (!activeLine) return;

    const lyricsDisplay = document.querySelector('.lyrics-display');
    if (!lyricsDisplay) return;

    // 获取容器和元素的位置信息
    const containerRect = lyricsDisplay.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();

    // 计算当前行相对于容器的位置
    const lineRelativeTop = lineRect.top - containerRect.top + lyricsDisplay.scrollTop;
    const containerHeight = lyricsDisplay.clientHeight;
    const lineHeight = lineRect.height;

    // 计算目标滚动位置（让当前行显示在容器中央偏上一点）
    const targetScrollTop = lineRelativeTop - (containerHeight * 0.4) + (lineHeight / 2);

    // 检查是否需要滚动（避免不必要的滚动）
    const currentScrollTop = lyricsDisplay.scrollTop;
    const scrollDifference = Math.abs(targetScrollTop - currentScrollTop);

    // 只有当滚动距离超过阈值时才进行滚动
    if (scrollDifference > 50) {
        // 使用requestAnimationFrame优化滚动性能
        requestAnimationFrame(() => {
            lyricsDisplay.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth'
            });
        });
    }
}

// 添加歌词点击事件监听器
function addLyricsClickListeners() {
    const lyricsLines = document.querySelectorAll('.lyrics-line');

    lyricsLines.forEach(line => {
        line.addEventListener('click', () => {
            const time = parseFloat(line.dataset.time);

            // 如果有有效的时间且 HTML5 音频播放器存在
            if (!isNaN(time) && window.audioPlayer && window.audioPlayer() && window.audioPlayer().getDuration() > 0) {
                // 跳转到指定时间
                window.audioPlayer().setCurrentTime(time);
                console.log(`跳转到歌词时间: ${time.toFixed(2)}s`);

                // 立即更新歌词高亮
                updateLyricsHighlight(time);
            }
        });

        // 添加鼠标悬停效果提示
        line.title = '点击跳转到此处播放';
    });
}

// ==================== 播放历史功能 ====================

// 添加播放历史记录 - 简化版本，只发送必要信息给后端
async function addPlayHistory(song) {
    console.log('🎵 通知后端播放歌曲:', song?.songname || song?.title);
    if (!song || !song.hash) {
        console.warn('⚠️ 无法添加播放历史：歌曲hash不存在');
        return;
    }

    try {
        // 处理封面图片URL，将{size}替换为具体尺寸（使用120px作为播放历史的标准尺寸）
        const processedCoverUrl = song.union_cover ? getCoverImageUrl(song.union_cover, 120) : '';

        // 构建请求数据，让后端处理所有播放历史逻辑
        const request = {
            hash: song.hash,
            songname: song.songname || song.title || '',
            filename: song.filename || '',
            author_name: song.author_name || '',
            album_name: song.albumname || song.album || song.album_name || '',
            album_id: song.album_id || '',
            time_length: parseInt(song.time_length) || 0,
            union_cover: processedCoverUrl
        };

        // 动态导入 PlayHistoryService
        const { AddPlayHistory } = await import('./bindings/wmplayer/playhistoryservice.js');
        // 发送给后端处理，不关心返回结果
        AddPlayHistory(request);
        console.log('✅ 播放历史记录已发送给后端处理');
    } catch (error) {
        console.error('❌ 播放历史记录处理失败:', error);
    }
}

// 获取播放历史
async function getPlayHistory(page = 1, pageSize = 50, filter = 'all') {
    try {
        const request = {
            page: page,
            page_size: pageSize,
            filter: filter
        };

        console.log('获取播放历史:', request);

        // 动态导入 PlayHistoryService
        const { GetPlayHistory } = await import('./bindings/wmplayer/playhistoryservice.js');
        const response = await GetPlayHistory(request);

        if (response && response.success) {
            console.log('获取播放历史成功:', response.data);
            return response.data;
        } else {
            console.warn('获取播放历史失败:', response?.message || '未知错误');
            return null;
        }
    } catch (error) {
        console.error('获取播放历史失败:', error);
        return null;
    }
}

// 清空播放历史
async function clearPlayHistory() {
    try {
        console.log('清空播放历史');

        // 动态导入 PlayHistoryService
        const { ClearPlayHistory } = await import('./bindings/wmplayer/playhistoryservice.js');
        const response = await ClearPlayHistory();

        if (response && response.success) {
            console.log('清空播放历史成功');
            return true;
        } else {
            console.warn('清空播放历史失败:', response?.message || '未知错误');
            return false;
        }
    } catch (error) {
        console.error('清空播放历史失败:', error);
        return false;
    }
}

// ==================== 收藏功能 ====================

// 添加歌曲到收藏
async function addToFavorites(song) {
    console.log('addToFavorites 被调用，歌曲信息:', song);

    if (!song) {
        console.warn('无法添加收藏：歌曲对象为空');
        showToast('无法添加收藏：歌曲信息为空', 'error');
        return false;
    }

    if (!song.hash) {
        console.warn('无法添加收藏：歌曲hash不存在');
        console.warn('歌曲对象:', song);
        showToast('无法添加收藏：歌曲信息不完整', 'error');
        return false;
    }

    try {
        // 准备请求数据，尝试多种字段名
        const songname = song.songname || song.title || song.name || '';
        const request = {
            songname: songname,
            hash: song.hash
        };

        console.log('添加收藏请求:', request);

        if (!songname) {
            console.warn('歌曲名称为空，但仍尝试添加收藏');
        }

        // 动态导入 FavoritesService
        const { AddFavorite } = await import('./bindings/wmplayer/favoritesservice.js');
        const response = await AddFavorite(request);

        console.log('后端响应:', response);

        if (response && response.success) {
            console.log('添加收藏成功');

            // 更新收藏按钮状态 - 更新所有收藏按钮
            const favoriteBtns = document.querySelectorAll('.favorite-btn');
            favoriteBtns.forEach(btn => {
                btn.classList.add('active');
                btn.title = '已收藏';
            });

            // 显示成功提示
            showToast('已添加到我喜欢的', 'success');
            return true;
        } else {
            const errorMsg = response?.message || '未知错误';
            console.warn('添加收藏失败:', errorMsg);
            console.warn('完整响应:', response);
            showToast('收藏失败: ' + errorMsg, 'error');
            return false;
        }
    } catch (error) {
        console.error('添加收藏异常:', error);
        console.error('错误堆栈:', error.stack);
        showToast('收藏失败: ' + (error.message || '网络错误'), 'error');
        return false;
    }
}

// 显示提示消息
function showToast(message, type = 'info') {
    // 创建提示元素
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // 添加样式
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 14px;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;

    // 添加到页面
    document.body.appendChild(toast);

    // 显示动画
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 10);

    // 自动隐藏
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// ==================== 新歌速递播放功能 ====================

// 新歌速递播放状态现在由 PlaylistManager 统一管理，此函数已移除

// playNewSong 函数已移除，现在统一使用 PlayerController.playPlaylist

// 播放新歌速递下一首 - 统一使用 PlayerController
async function nextNewSong() {
    console.log('🎵 新歌速递下一首');
    if (window.PlayerController) {
        window.PlayerController.playNext();
    } else {
        console.error('❌ PlayerController不可用');
    }
}

// 播放新歌速递上一首 - 统一使用 PlayerController
async function previousNewSong() {
    console.log('🎵 新歌速递上一首');
    if (window.PlayerController) {
        window.PlayerController.playPrevious();
    } else {
        console.error('❌ PlayerController不可用');
    }
}

// 🔧 内存泄漏修复：页面卸载时清理资源
window.addEventListener('beforeunload', function() {
    console.log('🧹 页面即将卸载，清理资源...');

    // 清理播放器事件监听器
    if (typeof cleanupPlayerEvents === 'function') {
        cleanupPlayerEvents();
    }

    // 清理HTML5音频播放器
    if (window.audioPlayer && window.audioPlayer() && typeof window.audioPlayer().stop === 'function') {
        window.audioPlayer().stop();
    }

    console.log('✅ 资源清理完成');
});

// 暴露缓存管理函数到全局作用域
window.refreshDailyRecommend = refreshDailyRecommend;
window.clearAllRecommendCache = clearAllRecommendCache;
