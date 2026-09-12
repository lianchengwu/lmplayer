/**
 * 内存监控工具
 * 用于监控和报告内存使用情况，帮助发现内存泄漏
 */

class MemoryMonitor {
    constructor() {
        this.isMonitoring = false;
        this.monitorInterval = null;
        this.memoryHistory = [];
        this.maxHistoryLength = 100;
        this.alertThreshold = 50 * 1024 * 1024; // 50MB
        this.lastAlertTime = 0;
        this.alertCooldown = 30000; // 30秒冷却时间
        
        console.log('📊 内存监控器已创建');
    }
    
    /**
     * 获取当前内存使用情况
     */
    getMemoryInfo() {
        if (!performance.memory) {
            return {
                supported: false,
                message: '浏览器不支持内存监控'
            };
        }
        
        const memory = performance.memory;
        return {
            supported: true,
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024 * 100) / 100,
            totalMB: Math.round(memory.totalJSHeapSize / 1024 / 1024 * 100) / 100,
            limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024 * 100) / 100,
            usage: Math.round(memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100 * 100) / 100
        };
    }
    
    /**
     * 获取资源统计信息
     */
    getResourceStats() {
        const stats = {
            globalResourceManager: null,
            audioInstances: 0,
            timers: 0,
            intervals: 0,
            listeners: 0,
            observers: 0,
            animationFrames: 0
        };
        
        if (window.GlobalResourceManager) {
            stats.globalResourceManager = window.GlobalResourceManager.getStats();
            stats.timers = stats.globalResourceManager.timers;
            stats.intervals = stats.globalResourceManager.intervals;
            stats.listeners = stats.globalResourceManager.listeners;
            stats.observers = stats.globalResourceManager.observers;
            stats.animationFrames = stats.globalResourceManager.animationFrames;
            stats.audioInstances = stats.globalResourceManager.audioInstances;
        }
        
        return stats;
    }
    
    /**
     * 记录内存使用情况
     */
    recordMemoryUsage() {
        const memoryInfo = this.getMemoryInfo();
        const resourceStats = this.getResourceStats();
        
        if (!memoryInfo.supported) {
            return null;
        }
        
        const record = {
            timestamp: Date.now(),
            memory: memoryInfo,
            resources: resourceStats
        };
        
        this.memoryHistory.push(record);
        
        // 保持历史记录长度
        if (this.memoryHistory.length > this.maxHistoryLength) {
            this.memoryHistory.shift();
        }
        
        // 检查是否需要警告
        this.checkMemoryAlert(memoryInfo);
        
        return record;
    }
    
    /**
     * 检查内存警告
     */
    checkMemoryAlert(memoryInfo) {
        const now = Date.now();
        
        // 检查冷却时间
        if (now - this.lastAlertTime < this.alertCooldown) {
            return;
        }
        
        // 检查内存使用是否超过阈值
        if (memoryInfo.usedJSHeapSize > this.alertThreshold) {
            console.warn(`⚠️ 内存使用警告: ${memoryInfo.usedMB}MB (${memoryInfo.usage}%)`);
            console.warn('📊 当前资源统计:', this.getResourceStats());
            this.lastAlertTime = now;
            
            // 建议垃圾回收
            if (window.gc) {
                console.log('🗑️ 尝试手动垃圾回收...');
                window.gc();
            }
        }
    }
    
    /**
     * 开始监控
     */
    startMonitoring(interval = 5000) {
        if (this.isMonitoring) {
            console.warn('📊 内存监控已在运行');
            return;
        }
        
        console.log(`📊 开始内存监控，间隔: ${interval}ms`);
        this.isMonitoring = true;
        
        // 立即记录一次
        this.recordMemoryUsage();
        
        // 使用全局资源管理器管理定时器
        this.monitorInterval = window.GlobalResourceManager.addInterval(() => {
            this.recordMemoryUsage();
        }, interval);
    }
    
    /**
     * 停止监控
     */
    stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }
        
        console.log('📊 停止内存监控');
        this.isMonitoring = false;
        
        if (this.monitorInterval) {
            window.GlobalResourceManager.removeInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }
    
    /**
     * 获取内存趋势分析
     */
    getMemoryTrend() {
        if (this.memoryHistory.length < 2) {
            return {
                trend: 'insufficient_data',
                message: '数据不足，无法分析趋势'
            };
        }
        
        const recent = this.memoryHistory.slice(-10); // 最近10个记录
        const first = recent[0];
        const last = recent[recent.length - 1];
        
        const memoryChange = last.memory.usedJSHeapSize - first.memory.usedJSHeapSize;
        const timeChange = last.timestamp - first.timestamp;
        const rate = memoryChange / timeChange * 1000; // 每秒变化量
        
        let trend = 'stable';
        let message = '内存使用稳定';
        
        if (rate > 1024 * 10) { // 每秒增长超过10KB
            trend = 'increasing';
            message = `内存持续增长，速率: ${Math.round(rate / 1024)}KB/s`;
        } else if (rate < -1024 * 10) { // 每秒减少超过10KB
            trend = 'decreasing';
            message = `内存正在释放，速率: ${Math.round(-rate / 1024)}KB/s`;
        }
        
        return {
            trend,
            message,
            rate: Math.round(rate),
            memoryChange: Math.round(memoryChange / 1024), // KB
            timeSpan: Math.round(timeChange / 1000) // 秒
        };
    }
    
    /**
     * 生成内存报告
     */
    generateReport() {
        const currentMemory = this.getMemoryInfo();
        const resourceStats = this.getResourceStats();
        const trend = this.getMemoryTrend();
        
        const report = {
            timestamp: new Date().toISOString(),
            memory: currentMemory,
            resources: resourceStats,
            trend: trend,
            history: this.memoryHistory.slice(-20) // 最近20条记录
        };
        
        console.log('📊 内存监控报告:', report);
        return report;
    }
    
    /**
     * 清理历史记录
     */
    clearHistory() {
        this.memoryHistory = [];
        console.log('📊 内存监控历史记录已清理');
    }
}

// 创建全局内存监控器
window.MemoryMonitor = new MemoryMonitor();

// 在开发模式下自动开始监控
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // 延迟启动，确保其他组件已初始化
    setTimeout(() => {
        window.MemoryMonitor.startMonitoring(10000); // 每10秒监控一次
        console.log('📊 开发模式：自动启动内存监控');
    }, 5000);
}

// 暴露一些便捷方法到控制台
window.memoryReport = () => window.MemoryMonitor.generateReport();
window.memoryInfo = () => window.MemoryMonitor.getMemoryInfo();
window.resourceStats = () => window.MemoryMonitor.getResourceStats();

console.log('📊 内存监控工具已加载');
console.log('💡 使用 memoryReport() 查看内存报告');
console.log('💡 使用 memoryInfo() 查看当前内存信息');
console.log('💡 使用 resourceStats() 查看资源统计');
