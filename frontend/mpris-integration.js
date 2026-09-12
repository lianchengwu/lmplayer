/**
 * MPRIS D-Bus集成模块
 * 负责与后端MPRIS服务通信，同步播放状态和元数据
 */

console.log('🎵 MPRIS集成模块加载中...');

class MPRISIntegration {
    constructor() {
        this.isEnabled = false;
        this.lastSong = null;
        this.lastPlaybackStatus = null;
        this.lastVolume = null;
        this.lastPosition = 0;
        this.updateInterval = null;
        
        this.init();
    }
    
    // 初始化MPRIS集成
    async init() {
        console.log('🎵 初始化MPRIS集成...');
        
        try {
            // 检查MPRIS服务状态
            await this.checkMPRISStatus();
            
            // 设置状态同步
            this.setupStatusSync();
            
            // 监听播放器事件
            this.setupPlayerEventListeners();
            
            console.log('✅ MPRIS集成初始化完成');
        } catch (error) {
            console.error('❌ MPRIS集成初始化失败:', error);
        }
    }
    
    // 检查MPRIS服务状态
    async checkMPRISStatus() {
        try {
            // 动态导入MediaKeyService绑定
            const { GetMediaKeyStatus } = await import('./bindings/wmplayer/mediakeyservice.js');
            
            const status = await GetMediaKeyStatus();
            console.log('🎵 媒体键服务状态:', status);
            
            if (status && status.mode === 'mpris_dbus' && status.mpris && status.mpris.active) {
                this.isEnabled = true;
                console.log('✅ MPRIS D-Bus服务已启用');
                console.log('📡 D-Bus信息:', status.mpris);
            } else {
                this.isEnabled = false;
                console.log('⚠️ MPRIS D-Bus服务未启用，使用前端键盘监听');
            }
        } catch (error) {
            console.error('❌ 检查MPRIS状态失败:', error);
            this.isEnabled = false;
        }
    }
    
    // 设置状态同步
    setupStatusSync() {
        if (!this.isEnabled) {
            return;
        }
        
        // 每秒同步一次状态
        this.updateInterval = setInterval(() => {
            this.syncPlaybackState();
        }, 1000);
        
        console.log('🔄 MPRIS状态同步已启动');
    }
    
    // 设置播放器事件监听
    setupPlayerEventListeners() {
        if (!this.isEnabled) {
            return;
        }
        
        // 监听歌曲变化
        if (window.PlaylistManager) {
            const originalSetCurrentSong = window.PlaylistManager.setCurrentSong;
            if (originalSetCurrentSong) {
                window.PlaylistManager.setCurrentSong = (song) => {
                    const result = originalSetCurrentSong.call(window.PlaylistManager, song);
                    this.onSongChanged(song);
                    return result;
                };
            }
        }
        
        // 监听音量变化
        if (window.UnifiedPlayerController) {
            window.UnifiedPlayerController.on('volumeChanged', (data) => {
                this.onVolumeChanged(data.volume);
            });
            
            window.UnifiedPlayerController.on('playStateChanged', (isPlaying) => {
                this.onPlayStateChanged(isPlaying);
            });
        }
        
        console.log('🎧 播放器事件监听已设置');
    }
    
    // 同步播放状态
    async syncPlaybackState() {
        if (!this.isEnabled) {
            return;
        }
        
        try {
            // 获取当前播放状态
            const audioElement = document.querySelector('audio');
            if (!audioElement) {
                return;
            }
            
            // 检查播放状态变化
            const isPlaying = !audioElement.paused;
            const playbackStatus = isPlaying ? 'Playing' : (audioElement.ended ? 'Stopped' : 'Paused');
            
            if (this.lastPlaybackStatus !== playbackStatus) {
                await this.updatePlaybackStatus(playbackStatus);
                this.lastPlaybackStatus = playbackStatus;
            }
            
            // 检查音量变化
            const volume = audioElement.volume;
            if (this.lastVolume !== volume) {
                await this.updateVolume(volume);
                this.lastVolume = volume;
            }
            
            // 检查播放位置变化
            const position = Math.floor(audioElement.currentTime * 1000000); // 转换为微秒
            if (Math.abs(this.lastPosition - position) > 1000000) { // 超过1秒差异才更新
                await this.updatePosition(position);
                this.lastPosition = position;
            }
            
        } catch (error) {
            console.error('❌ 同步播放状态失败:', error);
        }
    }
    
    // 歌曲变化事件
    async onSongChanged(song) {
        if (!this.isEnabled || !song) {
            return;
        }
        
        console.log('🎵 MPRIS: 歌曲变化', song.songname);
        
        try {
            // 准备元数据
            const title = song.songname || '未知歌曲';
            const artist = song.author_name || '未知艺术家';
            const album = song.album_name || '未知专辑';
            const artUrl = song.union_cover || '';
            const duration = (song.time_length || 0) * 1000000; // 转换为微秒
            
            // 更新MPRIS元数据
            await this.updateMetadata(title, artist, album, artUrl, duration);
            
            this.lastSong = song;
        } catch (error) {
            console.error('❌ 更新MPRIS歌曲信息失败:', error);
        }
    }
    
    // 播放状态变化事件
    async onPlayStateChanged(isPlaying) {
        if (!this.isEnabled) {
            return;
        }
        
        const status = isPlaying ? 'Playing' : 'Paused';
        await this.updatePlaybackStatus(status);
    }
    
    // 音量变化事件
    async onVolumeChanged(volume) {
        if (!this.isEnabled) {
            return;
        }
        
        // 音量范围转换：0-100 -> 0.0-1.0
        const volumeFloat = volume / 100.0;
        await this.updateVolume(volumeFloat);
    }
    
    // ==================== MPRIS更新方法 ====================
    
    // 更新播放状态
    async updatePlaybackStatus(status) {
        try {
            console.log('🎵 MPRIS: 更新播放状态为', status);

            // 动态导入MediaKeyService绑定
            const { UpdateMPRISPlaybackStatus } = await import('./bindings/wmplayer/mediakeyservice.js');

            if (UpdateMPRISPlaybackStatus) {
                await UpdateMPRISPlaybackStatus(status);
                console.log('✅ MPRIS播放状态更新成功');
            }

        } catch (error) {
            console.error('❌ 更新MPRIS播放状态失败:', error);
        }
    }
    
    // 更新元数据
    async updateMetadata(title, artist, album, artUrl, duration) {
        try {
            console.log('🎵 MPRIS: 更新元数据', { title, artist, album, duration });

            // 动态导入MediaKeyService绑定
            const { UpdateMPRISMetadata } = await import('./bindings/wmplayer/mediakeyservice.js');

            if (UpdateMPRISMetadata) {
                await UpdateMPRISMetadata(title, artist, album, artUrl, duration);
                console.log('✅ MPRIS元数据更新成功');
            }

        } catch (error) {
            console.error('❌ 更新MPRIS元数据失败:', error);
        }
    }
    
    // 更新音量
    async updateVolume(volume) {
        try {
            console.log('🎵 MPRIS: 更新音量', volume);

            // 动态导入MediaKeyService绑定
            const { UpdateMPRISVolume } = await import('./bindings/wmplayer/mediakeyservice.js');

            if (UpdateMPRISVolume) {
                await UpdateMPRISVolume(volume);
                // console.log('✅ MPRIS音量更新成功');
            }

        } catch (error) {
            console.error('❌ 更新MPRIS音量失败:', error);
        }
    }

    // 更新播放位置
    async updatePosition(position) {
        try {
            // 位置更新比较频繁，减少日志输出
            // console.log('🎵 MPRIS: 更新播放位置', position);

            // 动态导入MediaKeyService绑定
            const { UpdateMPRISPosition } = await import('./bindings/wmplayer/mediakeyservice.js');

            if (UpdateMPRISPosition) {
                await UpdateMPRISPosition(position);
            }

        } catch (error) {
            console.error('❌ 更新MPRIS播放位置失败:', error);
        }
    }
    
    // 销毁
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        this.isEnabled = false;
        console.log('🎵 MPRIS集成已销毁');
    }
}

// 创建全局实例
let mprisIntegration = null;

// 初始化函数
function initMPRISIntegration() {
    if (mprisIntegration) {
        mprisIntegration.destroy();
    }
    
    mprisIntegration = new MPRISIntegration();
    
    // 暴露到全局作用域
    window.MPRISIntegration = mprisIntegration;
}

// DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMPRISIntegration);
} else {
    initMPRISIntegration();
}

console.log('✅ MPRIS集成模块加载完成');
