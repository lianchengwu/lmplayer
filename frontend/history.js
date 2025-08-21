// ==================== 播放历史页面功能 ====================

// 播放历史页面状态（已移至管理器类中）
// 保留 isLoadingHistory 用于向后兼容
let isLoadingHistory = false;

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

// 播放历史页面管理器
class HistoryPageManager {
    constructor() {
        this.initialized = false;
        this.currentPage = 1;
        this.pageSize = 50;
        this.currentFilter = 'all';
        this.isRendering = false; // 渲染状态标记
        this.renderCancelled = false; // 渲染取消标记
        this.currentHistoryData = []; // 保存当前的历史数据，用于播放时获取完整信息
    }

    // 初始化播放历史页面
    init() {
        if (this.initialized) {
            console.log('ℹ️ 播放历史页面已初始化，跳过重复初始化');
            // 只重新加载数据，不重新绑定事件
            this.loadHistoryPage();
            return;
        }

        console.log('🎵 初始化播放历史页面');

        // 绑定过滤按钮事件
        this.bindHistoryFilterEvents();

        // 绑定清空历史按钮事件
        this.bindClearHistoryEvent();

        // 加载播放历史
        this.loadHistoryPage();

        // 标记为已初始化
        this.initialized = true;
        console.log('✅ 播放历史页面初始化完成');
    }

    // 绑定过滤按钮事件
    bindHistoryFilterEvents() {
        const filterButtons = document.querySelectorAll('#historyPage .filter-btn');

        filterButtons.forEach(button => {
            // 移除可能存在的旧事件监听器
            button.removeEventListener('click', this.handleFilterClick);
            // 绑定新的事件监听器
            button.addEventListener('click', this.handleFilterClick.bind(this));
        });
    }

    // 过滤按钮点击处理
    handleFilterClick(event) {
        const button = event.target;
        const filterButtons = document.querySelectorAll('#historyPage .filter-btn');

        // 移除所有按钮的active类
        filterButtons.forEach(btn => btn.classList.remove('active'));

        // 添加当前按钮的active类
        button.classList.add('active');

        // 获取过滤条件
        const filterText = button.textContent.trim();
        let filter = 'all';

        switch (filterText) {
            case '今天':
                filter = 'today';
                break;
            case '昨天':
                filter = 'yesterday';
                break;
            case '本周':
                filter = 'week';
                break;
            default:
                filter = 'all';
                break;
        }

        // 更新过滤条件并重新加载
        this.currentFilter = filter;
        this.currentPage = 1;
        this.loadHistoryPage();
    }

    // 绑定清空历史按钮事件
    bindClearHistoryEvent() {
        const clearButton = document.getElementById('clearHistoryBtn');

        if (clearButton) {
            // 移除可能存在的旧事件监听器
            clearButton.removeEventListener('click', this.handleClearHistory);
            // 绑定新的事件监听器
            clearButton.addEventListener('click', this.handleClearHistory.bind(this));
        }
    }

    // 清空历史按钮点击处理
    async handleClearHistory() {
        // 确认对话框
        if (confirm('确定要清空所有播放历史吗？此操作不可撤销。')) {
            try {
                const clearButton = document.getElementById('clearHistoryBtn');
                // 显示加载状态
                if (clearButton) {
                    clearButton.disabled = true;
                    clearButton.textContent = '清空中...';
                }

                const success = await clearPlayHistory();

                if (success) {
                    console.log('清空播放历史成功');
                    // 重新加载页面数据
                    this.loadHistoryPage();
                } else {
                    console.error('清空播放历史失败');
                }
            } catch (error) {
                console.error('清空播放历史时出错:', error);
            } finally {
                const clearButton = document.getElementById('clearHistoryBtn');
                if (clearButton) {
                    clearButton.disabled = false;
                    clearButton.textContent = '清空历史';
                }
            }
        }
    }

    // 取消当前渲染
    cancelRendering() {
        if (this.isRendering) {
            this.renderCancelled = true;
            console.log('🚫 取消播放历史渲染');
        }
    }

    // 清理资源
    cleanup() {
        this.cancelRendering();
        // 清空容器
        const historyListContainer = document.querySelector('#historyPage .history-list');
        if (historyListContainer) {
            historyListContainer.innerHTML = '';
        }
    }

    // 加载播放历史页面
    async loadHistoryPage() {
        try {
            // 取消之前的渲染
            this.cancelRendering();

            console.log(`加载播放历史页面 - 页码: ${this.currentPage}, 过滤: ${this.currentFilter}`);

            // 显示加载状态
            const historyListContainer = document.querySelector('#historyPage .history-list');
            if (historyListContainer) {
                historyListContainer.innerHTML = `
                    <div class="loading-state">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">正在加载播放历史...</div>
                    </div>
                `;
            }

            const historyData = await getPlayHistory(this.currentPage, this.pageSize, this.currentFilter);

            // 检查是否被取消
            if (this.renderCancelled) {
                console.log('⏹️ 播放历史加载被取消');
                return;
            }

            if (historyData && historyData.records && historyData.records.length > 0) {
                // 保存当前历史数据，供播放函数使用
                this.currentHistoryData = historyData.records;

                // 标记开始渲染
                this.isRendering = true;
                this.renderCancelled = false;

                renderHistoryList(historyData);
                // 更新统计信息
                updateHistoryStats(historyData.records);

                // 渲染完成
                this.isRendering = false;
            } else {
                // 清空历史数据
                this.currentHistoryData = [];
                renderEmptyHistory();
                // 重置统计信息
                updateHistoryStats(0, 0, 0);
            }
        } catch (error) {
            console.error('加载播放历史失败:', error);
            this.isRendering = false;
            renderEmptyHistory();
        }
    }
}





// 显示通知消息
function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;

    // 添加样式
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: var(--${type === 'success' ? 'accent' : type === 'error' ? 'danger' : 'primary'}-color);
        color: var(--text-inverse);
        border-radius: 8px;
        box-shadow: var(--shadow-md);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        animation: slideInRight 0.3s ease-out;
    `;

    // 添加到页面
    document.body.appendChild(notification);

    // 3秒后自动移除
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}



// 更新历史统计信息
function updateHistoryStats(records) {
    let totalSongs = 0;
    let totalDuration = 0;
    let totalPlays = 0;

    if (Array.isArray(records)) {
        totalSongs = records.length;
        totalDuration = Math.round(records.reduce((sum, record) => sum + (record.time_length || 0), 0) / 60);
        totalPlays = records.reduce((sum, record) => sum + (record.play_count || 0), 0);
    } else if (typeof records === 'number') {
        // 如果传入的是数字，则直接使用
        totalSongs = arguments[0] || 0;
        totalDuration = arguments[1] || 0;
        totalPlays = arguments[2] || 0;
    }

    // 更新DOM元素
    const totalSongsEl = document.getElementById('totalSongs');
    const totalDurationEl = document.getElementById('totalDuration');
    const totalPlaysEl = document.getElementById('totalPlays');

    if (totalSongsEl) totalSongsEl.textContent = totalSongs;
    if (totalDurationEl) totalDurationEl.textContent = totalDuration;
    if (totalPlaysEl) totalPlaysEl.textContent = totalPlays;
}

// 渲染播放历史列表 - 优化版本，支持分批渲染
function renderHistoryList(historyData) {
    const historyListContainer = document.querySelector('#historyPage .history-list');

    if (!historyListContainer) {
        console.error('找不到播放历史列表容器');
        return;
    }

    if (!historyData.records || historyData.records.length === 0) {
        renderEmptyHistory();
        return;
    }

    console.log(`开始渲染播放历史 - 共 ${historyData.records.length} 条记录`);

    // 显示加载状态
    historyListContainer.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <div class="loading-text">正在渲染播放历史...</div>
        </div>
    `;

    // 使用 requestAnimationFrame 进行分批渲染，避免阻塞主线程
    requestAnimationFrame(() => {
        renderHistoryListOptimized(historyData, historyListContainer);
    });
}

// 优化的渲染函数 - 分批处理避免阻塞
function renderHistoryListOptimized(historyData, container) {
    try {
        // 按日期分组
        const groupedRecords = groupRecordsByDate(historyData.records);

        // 创建文档片段，减少DOM操作
        const fragment = document.createDocumentFragment();

        // 分批渲染，每批处理30条记录（减少批次大小，提高响应性）
        const batchSize = 30;
        let processedCount = 0;
        const totalRecords = historyData.records.length;

        function renderBatch() {
            // 检查是否被取消
            if (window.historyPageManager && window.historyPageManager.renderCancelled) {
                console.log('⏹️ 渲染被取消，停止处理');
                return;
            }

            const startTime = performance.now();
            let currentBatchCount = 0;

            for (const [date, records] of Object.entries(groupedRecords)) {
                if (processedCount >= totalRecords) break;

                // 创建日期组容器
                const groupDiv = document.createElement('div');
                groupDiv.className = 'history-group';

                // 添加日期标题
                const dateDiv = document.createElement('div');
                dateDiv.className = 'history-date';
                dateDiv.textContent = date;
                groupDiv.appendChild(dateDiv);

                // 添加表头
                const headerDiv = document.createElement('div');
                headerDiv.className = 'history-header';
                headerDiv.innerHTML = `
                    <div class="header-index">#</div>
                    <div class="header-cover"></div>
                    <div class="header-song">歌曲</div>
                    <div class="header-count">播放次数</div>
                    <div class="header-duration">时长</div>
                    <div class="header-time">播放时间</div>
                `;
                groupDiv.appendChild(headerDiv);

                // 创建歌曲容器
                const songsContainer = document.createElement('div');
                songsContainer.className = 'songs-container';

                // 渲染当前批次的记录
                for (let i = 0; i < records.length && currentBatchCount < batchSize; i++) {
                    const record = records[i];
                    const songItem = createSongItemElement(record, i);
                    songsContainer.appendChild(songItem);

                    processedCount++;
                    currentBatchCount++;

                    // 如果达到批次大小或时间限制，暂停并安排下一批
                    if (currentBatchCount >= batchSize || (performance.now() - startTime) > 16) {
                        break;
                    }
                }

                groupDiv.appendChild(songsContainer);
                fragment.appendChild(groupDiv);

                if (currentBatchCount >= batchSize) break;
            }

            // 将当前批次添加到DOM
            if (processedCount === currentBatchCount) {
                // 第一批，清空容器并添加
                container.innerHTML = '';
                container.appendChild(fragment);
            } else {
                // 后续批次，追加到现有内容
                container.appendChild(fragment);
            }

            // 如果还有未处理的记录，继续下一批
            if (processedCount < totalRecords) {
                // 使用 setTimeout 而不是 requestAnimationFrame，给其他任务更多时间
                setTimeout(renderBatch, 10);
            } else {
                console.log(`✅ 播放历史渲染完成 - 共 ${totalRecords} 条记录`);
            }
        }

        // 开始第一批渲染
        renderBatch();

    } catch (error) {
        console.error('渲染播放历史时出错:', error);
        container.innerHTML = `
            <div class="error-state">
                <div class="error-text">渲染播放历史时出错</div>
            </div>
        `;
    }
}

// 创建单个歌曲项元素
function createSongItemElement(record, index) {
    const songItem = document.createElement('div');
    songItem.className = 'song-item';
    songItem.setAttribute('data-hash', record.hash);

    // 处理封面URL
    const coverUrl = record.union_cover ?
        (record.union_cover.includes('{size}') ?
            getCoverImageUrl(record.union_cover, 64) :
            record.union_cover) : '';

    const playTime = new Date(record.play_time).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const duration = formatDuration(record.time_length);

    songItem.innerHTML = `
        <div class="song-index medium">${index + 1}</div>
        <div class="song-cover">
            ${coverUrl ?
                `<img src="${coverUrl}" alt="封面" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <i class="fas fa-music" style="display: none;"></i>` :
                `<i class="fas fa-music"></i>`
            }
        </div>
        <div class="song-info">
            <div class="songname">${escapeHtml(record.songname)}</div>
            <div class="author_name">${escapeHtml(record.author_name)} ${record.album_name ? '· ' + escapeHtml(record.album_name) : ''}</div>
        </div>
        <div class="play-count-col">
            <span class="play-count">${record.play_count}</span>
        </div>
        <div class="duration-col">
            ${duration ? `<span class="song-duration">${duration}</span>` : '<span class="song-duration">--:--</span>'}
        </div>
        <div class="play-time-col">
            <span class="play-time">${playTime}</span>
        </div>
    `;

    // 添加双击播放事件
    songItem.addEventListener('dblclick', () => {
        console.log('双击播放歌曲:', record.songname);
        if (window.playHistorySong) {
            window.playHistorySong(record.hash);
        }
    });

    return songItem;
}

// 按日期分组记录
function groupRecordsByDate(records) {
    const groups = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    records.forEach(record => {
        const recordDate = new Date(record.play_time);
        let dateKey;
        
        if (isSameDay(recordDate, today)) {
            dateKey = '今天';
        } else if (isSameDay(recordDate, yesterday)) {
            dateKey = '昨天';
        } else {
            dateKey = recordDate.toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric'
            });
        }
        
        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        
        groups[dateKey].push(record);
    });
    
    return groups;
}

// 判断两个日期是否为同一天
function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

// 渲染空历史状态
function renderEmptyHistory() {
    const historyListContainer = document.querySelector('#historyPage .history-list');

    if (!historyListContainer) {
        return;
    }

    historyListContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🎵</div>
            <div class="empty-title">暂无播放历史</div>
            <div class="empty-description">开始播放音乐，这里将显示您的播放记录</div>
            <button class="empty-action" onclick="showMainContent('homepage')">
                <i class="fas fa-music"></i>
                去听音乐
            </button>
        </div>
    `;
}

// 播放历史中的歌曲
async function playHistorySong(hash) {
    if (!hash) {
        console.error('无法播放：歌曲hash为空');
        return;
    }

    try {
        // 首先尝试从当前渲染的历史记录中获取完整信息
        let songData = null;

        // 查找当前页面中的歌曲数据
        if (window.historyPageManager && window.historyPageManager.currentHistoryData) {
            const allRecords = window.historyPageManager.currentHistoryData;
            songData = allRecords.find(record => record.hash === hash);
        }

        // 如果没有找到，从DOM元素中获取基本信息
        if (!songData) {
            const songItem = document.querySelector(`[data-hash="${hash}"]`);
            if (!songItem) {
                console.error('找不到歌曲信息');
                return;
            }

            const songTitle = songItem.querySelector('.songname').textContent;
            const songArtist = songItem.querySelector('.author_name').textContent.split('·')[0].trim();

            // 尝试从img元素获取封面URL
            const coverImg = songItem.querySelector('.song-cover img');
            const coverUrl = coverImg ? coverImg.src : '';

            songData = {
                hash: hash,
                songname: songTitle,
                author_name: songArtist,
                union_cover: coverUrl
            };
        }

        // 确保有完整的歌曲信息，包括封面
        const song = {
            hash: songData.hash,
            songname: songData.songname,
            author_name: songData.author_name,
            album_name: songData.album_name || '',
            album_id: songData.album_id || '',
            time_length: songData.time_length || 0,
            filename: songData.filename || '',
            union_cover: songData.union_cover || ''
        };

        console.log('播放历史歌曲（包含封面）:', song);

        // 使用统一的播放控制器播放歌曲
        if (window.PlayerController) {
            const success = await window.PlayerController.playSong(song);
            if (success) {
                console.log('历史歌曲播放成功');
            } else {
                console.error('历史歌曲播放失败');
            }
        } else {
            console.error('PlayerController不可用');
        }
    } catch (error) {
        console.error('播放历史歌曲失败:', error);
    }
}

// 将播放历史歌曲函数暴露到全局作用域
window.playHistorySong = playHistorySong;

// 格式化时长
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) {
        return '';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// HTML转义
function escapeHtml(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 全局播放历史页面管理器实例
let historyPageManager = null;

// 初始化播放历史页面
window.initHistoryPage = () => {
    if (!historyPageManager) {
        historyPageManager = new HistoryPageManager();
        // 将管理器暴露到全局作用域
        window.historyPageManager = historyPageManager;
    }
    historyPageManager.init();
};

// 当页面切换到播放历史时调用（保持向后兼容）
window.showHistoryPage = function() {
    console.log('显示播放历史页面');
    window.initHistoryPage();
};
