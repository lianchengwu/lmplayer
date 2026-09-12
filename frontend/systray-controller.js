// 系统托盘控制器
// 处理来自系统托盘的播放控制事件

class SystrayController {
    constructor() {
        this.eventListenersInitialized = false;
        this.initializeEventListeners();
        console.log('🎵 系统托盘控制器初始化完成');
    }

    // 初始化事件监听器
    initializeEventListeners() {
        // 检查 Events 是否可用
        if (window.Events) {
            console.log('🎵 Events 对象可用，注册系统托盘事件监听器');
            this.registerEventListeners();
        } else {
            console.log('⚠️ Events 对象不可用，延迟初始化事件监听器');
            // 延迟初始化，等待 Events 对象准备好
            this.waitForEvents();
        }
    }

    // 等待 Events 对象准备好
    waitForEvents() {
        const checkEvents = () => {
            if (window.Events && !this.eventListenersInitialized) {
                console.log('🎵 Events 对象现在可用，注册系统托盘事件监听器');
                this.registerEventListeners();
            } else if (!this.eventListenersInitialized) {
                // 继续等待
                setTimeout(checkEvents, 100);
            }
        };
        setTimeout(checkEvents, 100);
    }

    // 注册事件监听器
    registerEventListeners() {
        if (this.eventListenersInitialized) {
            console.log('⚠️ 事件监听器已经初始化，跳过重复注册');
            return;
        }

        try {
            // 播放/暂停
            window.Events.On('systray:toggle-play-pause', () => {
                console.log('🎵 收到系统托盘事件: toggle-play-pause');
                this.handleTogglePlayPause();
            });

            // 上一首
            window.Events.On('systray:previous-song', () => {
                console.log('🎵 收到系统托盘事件: previous-song');
                this.handlePreviousSong();
            });

            // 下一首
            window.Events.On('systray:next-song', () => {
                console.log('🎵 收到系统托盘事件: next-song');
                this.handleNextSong();
            });

            // 喜欢当前歌曲
            window.Events.On('systray:favorite-song', () => {
                console.log('🎵 收到系统托盘事件: favorite-song');
                this.handleFavoriteSong();
            });

            // 桌面歌词开关
            window.Events.On('systray:toggle-osd-lyrics', () => {
                console.log('🎵 收到系统托盘事件: toggle-osd-lyrics');
                this.handleToggleOSDLyrics();
            });

            this.eventListenersInitialized = true;
            console.log('✅ 系统托盘事件监听器注册完成');
        } catch (error) {
            console.error('❌ 注册系统托盘事件监听器失败:', error);
        }
    }

    // 处理播放/暂停
    async handleTogglePlayPause() {
        console.log('🎵 系统托盘: 播放/暂停');

        try {
            // 直接调用前端的播放/暂停操作
            if (window.PlayerController && window.PlayerController.togglePlayPause) {
                console.log('🎵 调用 PlayerController.togglePlayPause()');
                window.PlayerController.togglePlayPause();
                this.showNotification('播放控制', '播放/暂停切换');
            } else {
                console.error('❌ PlayerController 不可用');
                this.showNotification('错误', '播放器不可用');
            }
        } catch (error) {
            console.error('❌ 播放/暂停失败:', error);
            this.showNotification('错误', '播放/暂停失败');
        }
    }

    // 处理上一首
    async handlePreviousSong() {
        console.log('🎵 系统托盘: 上一首');
        console.log('🎵 检查 PlayerController:', !!window.PlayerController);
        console.log('🎵 检查 playPrevious 方法:', !!(window.PlayerController && window.PlayerController.playPrevious));

        try {
            if (window.PlayerController && window.PlayerController.playPrevious) {
                console.log('🎵 调用 PlayerController.playPrevious()');
                const success = await window.PlayerController.playPrevious();
                console.log('🎵 playPrevious 结果:', success);

                if (success) {
                    // 获取当前歌曲信息
                    const currentSong = window.PlayerController.getCurrentSong();
                    const songName = currentSong ? currentSong.songname : '未知歌曲';
                    this.showNotification('上一首', `正在播放: ${songName}`);
                } else {
                    this.showNotification('提示', '没有上一首歌曲');
                }
            } else {
                console.error('❌ PlayerController 不可用');
                console.log('🎵 window.PlayerController:', window.PlayerController);
                this.showNotification('错误', '播放器不可用');
            }
        } catch (error) {
            console.error('❌ 播放上一首失败:', error);
            this.showNotification('错误', '播放上一首失败');
        }
    }

    // 处理下一首
    async handleNextSong() {
        console.log('🎵 系统托盘: 下一首');
        console.log('🎵 检查 PlayerController:', !!window.PlayerController);
        console.log('🎵 检查 playNext 方法:', !!(window.PlayerController && window.PlayerController.playNext));

        try {
            if (window.PlayerController && window.PlayerController.playNext) {
                console.log('🎵 调用 PlayerController.playNext()');
                const success = await window.PlayerController.playNext();
                console.log('🎵 playNext 结果:', success);

                if (success) {
                    // 获取当前歌曲信息
                    const currentSong = window.PlayerController.getCurrentSong();
                    const songName = currentSong ? currentSong.songname : '未知歌曲';
                    this.showNotification('下一首', `正在播放: ${songName}`);
                } else {
                    this.showNotification('提示', '没有下一首歌曲');
                }
            } else {
                console.error('❌ PlayerController 不可用');
                console.log('🎵 window.PlayerController:', window.PlayerController);
                this.showNotification('错误', '播放器不可用');
            }
        } catch (error) {
            console.error('❌ 播放下一首失败:', error);
            this.showNotification('错误', '播放下一首失败');
        }
    }

    // 处理喜欢当前歌曲
    async handleFavoriteSong() {
        console.log('🎵 系统托盘: 喜欢当前歌曲');
        
        try {
            // 获取当前播放歌曲
            const currentSong = window.PlayerController ? window.PlayerController.getCurrentSong() : null;
            
            if (!currentSong) {
                this.showNotification('提示', '当前没有播放歌曲');
                return;
            }

            // 调用添加收藏功能
            const success = await this.addToFavorites(currentSong);
            
            if (success) {
                this.showNotification('收藏成功', `已收藏: ${currentSong.songname}`);
            } else {
                this.showNotification('收藏失败', '可能已经收藏过了');
            }
        } catch (error) {
            console.error('❌ 收藏歌曲失败:', error);
            this.showNotification('错误', '收藏歌曲失败');
        }
    }

    // 处理桌面歌词开关
    async handleToggleOSDLyrics() {
        console.log('🎵 系统托盘: 切换桌面歌词');

        try {
            // 调用全局的桌面歌词切换函数
            if (window.toggleOSDLyrics) {
                const newState = await window.toggleOSDLyrics();
                const statusText = newState ? '已开启' : '已关闭';
                this.showNotification('桌面歌词', `桌面歌词${statusText}`);
                console.log(`🎵 桌面歌词状态: ${statusText}`);
            } else {
                console.error('全局 toggleOSDLyrics 函数不可用');
                this.showNotification('错误', '桌面歌词功能不可用');
            }
        } catch (error) {
            console.error('❌ 切换桌面歌词失败:', error);
            this.showNotification('错误', '切换桌面歌词失败');
        }
    }

    // 添加到收藏 - 调用全局函数
    async addToFavorites(song) {
        try {
            // 调用全局的 addToFavorites 函数
            if (window.addToFavorites) {
                return await window.addToFavorites(song);
            } else {
                console.error('全局 addToFavorites 函数不可用');
                return false;
            }
        } catch (error) {
            console.error('系统托盘添加收藏失败:', error);
            return false;
        }
    }

    // 显示通知（简单的控制台输出，可以扩展为桌面通知）
    showNotification(title, message) {
        console.log(`🔔 ${title}: ${message}`);
        
        // 如果有toast功能，可以显示toast
        if (window.showToast) {
            window.showToast(message, 'info');
        }
        
        // 可以扩展为系统桌面通知
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: message,
                icon: '/favicon.ico'
            });
        }
    }

    // 获取当前播放状态信息
    getCurrentPlaybackInfo() {
        const currentSong = window.PlayerController ? window.PlayerController.getCurrentSong() : null;
        const audioPlayer = window.PlayerController ? window.PlayerController.getAudioPlayer() : null;
        const isPlaying = audioPlayer ? audioPlayer.isPlaying() : false;

        return {
            song: currentSong,
            isPlaying: isPlaying,
            hasPlaylist: currentSong !== null
        };
    }
}

// 初始化系统托盘控制器
let systrayController = null;

// 确保在DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        systrayController = new SystrayController();
    });
} else {
    systrayController = new SystrayController();
}

// 测试函数
window.testSystrayController = function() {
    console.log('🧪 测试系统托盘控制器');
    console.log('🧪 Events 对象:', !!window.Events);
    console.log('🧪 PlayerController 对象:', !!window.PlayerController);
    console.log('🧪 systrayController 实例:', !!window.systrayController);

    if (window.systrayController) {
        console.log('🧪 事件监听器已初始化:', window.systrayController.eventListenersInitialized);

        // 手动测试播放/暂停
        console.log('🧪 手动测试播放/暂停');
        window.systrayController.handleTogglePlayPause();
    }
};

// 暴露到全局作用域
window.SystrayController = SystrayController;
window.systrayController = systrayController;
