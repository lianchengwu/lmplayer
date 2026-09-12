/**
 * 统一播放器控制器
 * 提供底栏播放器和沉浸式播放器共享的后台逻辑
 * 只负责状态管理和控制逻辑，UI展现由各自的组件负责
 */
class UnifiedPlayerController {
    constructor() {
        // 播放器状态
        this.state = {
            volume: 50,
            isMuted: false,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            currentSong: null,
            lastVolume: 50 // 静音前的音量
        };
        
        // 事件监听器
        this.listeners = {
            volumeChanged: [],
            playStateChanged: [],
            progressChanged: [],
            songChanged: [],
            muteStateChanged: []
        };
        
        // 初始化
        this.init();
    }
    
    init() {
        // 从现有播放器获取初始状态
        this.syncWithExistingPlayer();
        
        // 启动状态同步定时器
        this.startStateSync();
        
        console.log('🎵 统一播放器控制器初始化完成');
    }
    
    // 从现有播放器同步状态
    syncWithExistingPlayer() {
        if (window.audioPlayer && window.audioPlayer()) {
            const player = window.audioPlayer();
            
            // 同步音量
            if (player.volume !== undefined) {
                this.state.volume = Math.round(player.volume * 100);
            } else if (player.audio && player.audio.volume !== undefined) {
                this.state.volume = Math.round(player.audio.volume * 100);
            }
            
            // 同步播放状态
            if (player.audio) {
                this.state.isPlaying = !player.audio.paused;
                this.state.currentTime = player.audio.currentTime || 0;
                this.state.duration = player.audio.duration || 0;
                this.state.isMuted = player.audio.muted || false;
            }
            
            // 同步当前歌曲
            if (window.PlayerController && window.PlayerController.getCurrentSong) {
                this.state.currentSong = window.PlayerController.getCurrentSong();
            }
        }
    }
    
    // 启动状态同步
    startStateSync() {
        setInterval(() => {
            this.syncWithExistingPlayer();
            this.emit('progressChanged', {
                currentTime: this.state.currentTime,
                duration: this.state.duration
            });
        }, 1000);
    }
    
    // ==================== 音量控制 ====================
    
    setVolume(volume) {
        volume = Math.max(0, Math.min(100, volume));
        const oldVolume = this.state.volume;
        
        this.state.volume = volume;
        
        // 更新实际播放器音量
        if (window.audioPlayer && window.audioPlayer()) {
            const player = window.audioPlayer();
            if (player.setVolume) {
                player.setVolume(volume / 100);
            } else if (player.audio) {
                player.audio.volume = volume / 100;
            }
        }
        
        // 如果从静音状态恢复，取消静音
        if (this.state.isMuted && volume > 0) {
            this.state.isMuted = false;
            this.emit('muteStateChanged', this.state.isMuted);
        }
        
        // 发射音量变化事件
        this.emit('volumeChanged', {
            volume: volume,
            oldVolume: oldVolume
        });
        
        console.log('🔊 音量设置为:', volume + '%');
    }
    
    getVolume() {
        return this.state.volume;
    }
    
    toggleMute() {
        if (this.state.isMuted) {
            // 取消静音，恢复之前的音量
            this.state.isMuted = false;
            this.setVolume(this.state.lastVolume);
        } else {
            // 静音，保存当前音量
            this.state.lastVolume = this.state.volume;
            this.state.isMuted = true;
            this.setVolume(0);
        }
        
        this.emit('muteStateChanged', this.state.isMuted);
        console.log('🔇 静音状态:', this.state.isMuted ? '开启' : '关闭');
    }
    
    isMuted() {
        return this.state.isMuted;
    }
    
    // ==================== 播放控制 ====================
    
    async play() {
        if (window.PlayerController && window.PlayerController.play) {
            const success = await window.PlayerController.play();
            if (success) {
                this.state.isPlaying = true;
                this.emit('playStateChanged', this.state.isPlaying);
            }
            return success;
        }
        return false;
    }
    
    async pause() {
        if (window.PlayerController && window.PlayerController.pause) {
            const success = await window.PlayerController.pause();
            if (success) {
                this.state.isPlaying = false;
                this.emit('playStateChanged', this.state.isPlaying);
            }
            return success;
        }
        return false;
    }
    
    async togglePlayPause() {
        if (this.state.isPlaying) {
            return await this.pause();
        } else {
            return await this.play();
        }
    }
    
    async playNext() {
        if (window.PlayerController && window.PlayerController.playNext) {
            const success = await window.PlayerController.playNext();
            if (success) {
                this.updateCurrentSong();
            }
            return success;
        }
        return false;
    }
    
    async playPrevious() {
        if (window.PlayerController && window.PlayerController.playPrevious) {
            const success = await window.PlayerController.playPrevious();
            if (success) {
                this.updateCurrentSong();
            }
            return success;
        }
        return false;
    }
    
    isPlaying() {
        return this.state.isPlaying;
    }
    
    // ==================== 进度控制 ====================
    
    seek(time) {
        if (window.audioPlayer && window.audioPlayer()) {
            const player = window.audioPlayer();
            if (player.audio) {
                player.audio.currentTime = time;
                this.state.currentTime = time;
                this.emit('progressChanged', {
                    currentTime: time,
                    duration: this.state.duration
                });
            }
        }
    }
    
    getCurrentTime() {
        return this.state.currentTime;
    }
    
    getDuration() {
        return this.state.duration;
    }
    
    // ==================== 歌曲信息 ====================
    
    getCurrentSong() {
        return this.state.currentSong;
    }
    
    updateCurrentSong() {
        const oldSong = this.state.currentSong;
        if (window.PlayerController && window.PlayerController.getCurrentSong) {
            this.state.currentSong = window.PlayerController.getCurrentSong();
            
            if (this.state.currentSong && this.state.currentSong.hash !== oldSong?.hash) {
                this.emit('songChanged', {
                    currentSong: this.state.currentSong,
                    previousSong: oldSong
                });
            }
        }
    }
    
    // ==================== 事件系统 ====================
    
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }
    
    off(event, callback) {
        if (this.listeners[event]) {
            const index = this.listeners[event].indexOf(callback);
            if (index > -1) {
                this.listeners[event].splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`事件 ${event} 的监听器执行出错:`, error);
                }
            });
        }
    }
    
    // ==================== 工具方法 ====================
    
    getState() {
        return { ...this.state };
    }
    
    // 格式化时间
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

// 创建全局实例
window.UnifiedPlayerController = window.UnifiedPlayerController || new UnifiedPlayerController();

console.log('🎵 统一播放器控制器已加载');
