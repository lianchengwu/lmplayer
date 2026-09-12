/**
 * 资源管理器 - 统一管理定时器、事件监听器、观察器等资源
 * 用于防止内存泄漏
 */

class ResourceManager {
    constructor(name = 'ResourceManager') {
        this.name = name;
        this.timers = new Set();
        this.intervals = new Set();
        this.listeners = new Map();
        this.observers = new Set();
        this.animationFrames = new Set();
        this.audioInstances = new Set();
        this.isDestroyed = false;
        
        console.log(`🧹 ${this.name} 已创建`);
    }
    
    /**
     * 添加定时器（setTimeout）
     */
    addTimer(callback, delay, ...args) {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法添加定时器`);
            return null;
        }
        
        const timerId = setTimeout(() => {
            this.timers.delete(timerId);
            callback(...args);
        }, delay);
        
        this.timers.add(timerId);
        return timerId;
    }
    
    /**
     * 添加间隔定时器（setInterval）
     */
    addInterval(callback, interval, ...args) {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法添加间隔定时器`);
            return null;
        }
        
        const intervalId = setInterval(callback, interval, ...args);
        this.intervals.add(intervalId);
        return intervalId;
    }
    
    /**
     * 添加事件监听器
     */
    addEventListener(element, event, handler, options) {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法添加事件监听器`);
            return;
        }
        
        element.addEventListener(event, handler, options);
        
        if (!this.listeners.has(element)) {
            this.listeners.set(element, []);
        }
        this.listeners.get(element).push({ event, handler, options });
    }
    
    /**
     * 添加MutationObserver
     */
    addObserver(target, callback, options) {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法添加观察器`);
            return null;
        }
        
        const observer = new MutationObserver(callback);
        observer.observe(target, options);
        this.observers.add(observer);
        return observer;
    }
    
    /**
     * 添加requestAnimationFrame
     */
    addAnimationFrame(callback) {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法添加动画帧`);
            return null;
        }
        
        const frameId = requestAnimationFrame(() => {
            this.animationFrames.delete(frameId);
            callback();
        });
        
        this.animationFrames.add(frameId);
        return frameId;
    }
    
    /**
     * 创建并管理Audio实例
     */
    createAudio() {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已销毁，无法创建音频实例`);
            return null;
        }
        
        const audio = new Audio();
        this.audioInstances.add(audio);
        return audio;
    }
    
    /**
     * 移除特定定时器
     */
    removeTimer(timerId) {
        if (timerId && this.timers.has(timerId)) {
            clearTimeout(timerId);
            this.timers.delete(timerId);
        }
    }
    
    /**
     * 移除特定间隔定时器
     */
    removeInterval(intervalId) {
        if (intervalId && this.intervals.has(intervalId)) {
            clearInterval(intervalId);
            this.intervals.delete(intervalId);
        }
    }
    
    /**
     * 移除特定事件监听器
     */
    removeEventListener(element, event, handler) {
        if (this.listeners.has(element)) {
            const events = this.listeners.get(element);
            const index = events.findIndex(e => e.event === event && e.handler === handler);
            if (index !== -1) {
                element.removeEventListener(event, handler);
                events.splice(index, 1);
                if (events.length === 0) {
                    this.listeners.delete(element);
                }
            }
        }
    }
    
    /**
     * 销毁音频实例
     */
    destroyAudio(audio) {
        if (audio && this.audioInstances.has(audio)) {
            try {
                audio.pause();
                audio.removeAttribute('src');
                audio.load();
            } catch (error) {
                console.warn('销毁音频实例时出错:', error);
            }
            this.audioInstances.delete(audio);
        }
    }
    
    /**
     * 获取资源统计信息
     */
    getStats() {
        return {
            timers: this.timers.size,
            intervals: this.intervals.size,
            listeners: Array.from(this.listeners.values()).reduce((sum, events) => sum + events.length, 0),
            observers: this.observers.size,
            animationFrames: this.animationFrames.size,
            audioInstances: this.audioInstances.size
        };
    }
    
    /**
     * 清理所有资源
     */
    cleanup() {
        if (this.isDestroyed) {
            console.warn(`⚠️ ${this.name} 已经被清理过了`);
            return;
        }
        
        console.log(`🧹 开始清理 ${this.name} 的资源...`);
        const stats = this.getStats();
        console.log(`📊 清理前资源统计:`, stats);
        
        // 清理所有定时器
        this.timers.forEach(id => clearTimeout(id));
        this.timers.clear();
        
        // 清理所有间隔定时器
        this.intervals.forEach(id => clearInterval(id));
        this.intervals.clear();
        
        // 清理所有事件监听器
        this.listeners.forEach((events, element) => {
            events.forEach(({event, handler}) => {
                try {
                    element.removeEventListener(event, handler);
                } catch (error) {
                    console.warn('移除事件监听器时出错:', error);
                }
            });
        });
        this.listeners.clear();
        
        // 清理所有观察器
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (error) {
                console.warn('断开观察器时出错:', error);
            }
        });
        this.observers.clear();
        
        // 清理所有动画帧
        this.animationFrames.forEach(id => cancelAnimationFrame(id));
        this.animationFrames.clear();
        
        // 清理所有音频实例
        this.audioInstances.forEach(audio => this.destroyAudio(audio));
        this.audioInstances.clear();
        
        this.isDestroyed = true;
        console.log(`✅ ${this.name} 资源清理完成`);
    }
    
    /**
     * 销毁资源管理器
     */
    destroy() {
        this.cleanup();
    }
}

// 创建全局资源管理器
window.GlobalResourceManager = new ResourceManager('GlobalResourceManager');

// 页面卸载时自动清理全局资源
window.addEventListener('beforeunload', () => {
    console.log('🧹 页面即将卸载，清理全局资源...');
    if (window.GlobalResourceManager) {
        window.GlobalResourceManager.cleanup();
    }
});

// 导出ResourceManager类
window.ResourceManager = ResourceManager;

console.log('🧹 资源管理器已加载');
