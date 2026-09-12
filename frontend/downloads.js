// 下载管理模块
class DownloadManager {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.totalPages = 1;
        this.records = [];
        this.init();
    }

    // 初始化
    init() {
        console.log('🔧 初始化下载管理模块');
        this.bindEvents();
        this.loadDownloadRecords();
    }

    // 绑定事件
    bindEvents() {
        // 清空记录按钮
        const clearBtn = document.getElementById('clearDownloadsBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAllRecords());
        }

        // 分页按钮
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.goToPreviousPage());
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.goToNextPage());
        }

        // 记录操作事件（事件委托）
        const recordsList = document.getElementById('downloadRecordsList');
        if (recordsList) {
            recordsList.addEventListener('click', (e) => this.handleRecordAction(e));
        }
    }

    // 加载下载记录
    async loadDownloadRecords() {
        try {
            console.log('📥 加载下载记录，页码:', this.currentPage);

            // 动态导入下载服务
            const { GetDownloadRecords } = await import('./bindings/wmplayer/downloadservice.js');
            
            const request = {
                page: this.currentPage,
                page_size: this.pageSize,
                filter: 'all'
            };

            const response = await GetDownloadRecords(request);

            if (response && response.success) {
                console.log('✅ 下载记录加载成功:', response.data);
                this.records = response.data.records || [];
                this.updatePagination(response.data.total_count);
                this.renderRecords();
            } else {
                console.warn('⚠️ 下载记录加载失败:', response?.message || '未知错误');
                this.showEmptyState();
            }
        } catch (error) {
            console.error('❌ 下载记录加载失败:', error);
            this.showEmptyState();
        }
    }

    // 渲染下载记录
    renderRecords() {
        const recordsList = document.getElementById('downloadRecordsList');
        if (!recordsList) return;

        if (this.records.length === 0) {
            this.showEmptyState();
            return;
        }

        recordsList.innerHTML = this.records.map(record => this.createRecordHTML(record)).join('');
    }

    // 创建记录HTML
    createRecordHTML(record) {
        const downloadTime = new Date(record.download_time).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="download-record-item" data-hash="${record.hash}">
                <div class="download-cell download-song" title="${record.songname}">
                    ${record.songname || '未知歌曲'}
                </div>
                <div class="download-cell download-artist" title="${record.artist_name}">
                    ${record.artist_name || '未知艺术家'}
                </div>
                <div class="download-cell download-filename" title="${record.filename}">
                    ${record.filename || '未知文件'}
                </div>
                <div class="download-cell download-time" title="${downloadTime}">
                    ${downloadTime}
                </div>
                <div class="download-cell download-actions">
                    <button class="action-btn play-btn" title="播放" data-hash="${record.hash}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="action-btn folder-btn" title="打开文件夹" data-path="${record.file_path}">
                        <i class="fas fa-folder-open"></i>
                    </button>
                    <button class="action-btn delete-btn" title="删除记录" data-hash="${record.hash}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    // 显示空状态
    showEmptyState() {
        const recordsList = document.getElementById('downloadRecordsList');
        if (!recordsList) return;

        recordsList.innerHTML = `
            <div class="download-empty-state">
                <i class="fas fa-download"></i>
                <h3>暂无下载记录</h3>
                <p>您还没有下载过任何歌曲</p>
            </div>
        `;
    }

    // 处理记录操作
    async handleRecordAction(e) {
        const target = e.target.closest('button');
        if (!target) return;

        const hash = target.dataset.hash;
        const path = target.dataset.path;

        if (target.classList.contains('play-btn')) {
            await this.playRecord(hash);
        } else if (target.classList.contains('folder-btn')) {
            await this.openFolder(path);
        } else if (target.classList.contains('delete-btn')) {
            await this.deleteRecord(hash);
        }
    }

    // 播放记录
    async playRecord(hash) {
        try {
            console.log('🎵 播放下载记录:', hash);
            
            // 查找对应的记录
            const record = this.records.find(r => r.hash === hash);
            if (!record) {
                console.warn('⚠️ 未找到下载记录');
                return;
            }

            // 构造歌曲对象
            const song = {
                hash: record.hash,
                songname: record.songname,
                filename: record.filename,
                author_name: record.artist_name,
                time_length: 0, // 下载记录中没有时长信息
                union_cover: '', // 下载记录中没有封面信息
                // 使用本地文件路径
                local_path: record.file_path
            };

            // 使用播放控制器播放
            if (window.PlayerController) {
                const success = await window.PlayerController.playSong(song);
                if (success) {
                    console.log('✅ 下载记录播放成功');
                } else {
                    console.error('❌ 下载记录播放失败');
                }
            } else {
                console.error('❌ PlayerController不可用');
            }
        } catch (error) {
            console.error('❌ 播放下载记录失败:', error);
        }
    }

    // 打开文件夹
    async openFolder(filePath) {
        try {
            console.log('📁 打开文件夹:', filePath);

            // 动态导入下载服务
            const { OpenFileFolder } = await import('./bindings/wmplayer/downloadservice.js');

            const response = await OpenFileFolder(filePath);

            if (response && response.success) {
                console.log('✅ 文件夹打开成功');
            } else {
                console.warn('⚠️ 文件夹打开失败:', response?.message || '未知错误');
                alert('打开文件夹失败: ' + (response?.message || '未知错误'));
            }

        } catch (error) {
            console.error('❌ 打开文件夹失败:', error);
            alert('打开文件夹失败: ' + error.message);
        }
    }

    // 删除记录
    async deleteRecord(hash) {
        try {
            if (!confirm('确定要删除这条下载记录吗？')) {
                return;
            }

            console.log('🗑️ 删除下载记录:', hash);

            // 动态导入下载服务
            const { DeleteDownloadRecord } = await import('./bindings/wmplayer/downloadservice.js');
            
            const request = { hash: hash };
            const response = await DeleteDownloadRecord(request);

            if (response && response.success) {
                console.log('✅ 下载记录删除成功');
                // 重新加载记录
                await this.loadDownloadRecords();
            } else {
                console.warn('⚠️ 下载记录删除失败:', response?.message || '未知错误');
            }
        } catch (error) {
            console.error('❌ 删除下载记录失败:', error);
        }
    }

    // 清空所有记录
    async clearAllRecords() {
        try {
            if (!confirm('确定要清空所有下载记录吗？此操作不可撤销。')) {
                return;
            }

            console.log('🗑️ 清空所有下载记录');

            // 动态导入下载服务
            const { ClearDownloadRecords } = await import('./bindings/wmplayer/downloadservice.js');
            
            const response = await ClearDownloadRecords();

            if (response && response.success) {
                console.log('✅ 下载记录清空成功');
                // 重新加载记录
                await this.loadDownloadRecords();
            } else {
                console.warn('⚠️ 下载记录清空失败:', response?.message || '未知错误');
            }
        } catch (error) {
            console.error('❌ 清空下载记录失败:', error);
        }
    }

    // 更新分页信息
    updatePagination(totalCount) {
        this.totalPages = Math.ceil(totalCount / this.pageSize);
        
        const currentPageSpan = document.getElementById('currentPage');
        const totalPagesSpan = document.getElementById('totalPages');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');

        if (currentPageSpan) currentPageSpan.textContent = this.currentPage;
        if (totalPagesSpan) totalPagesSpan.textContent = this.totalPages;
        
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    // 上一页
    async goToPreviousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            await this.loadDownloadRecords();
        }
    }

    // 下一页
    async goToNextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            await this.loadDownloadRecords();
        }
    }

    // 添加下载记录（供其他模块调用）
    async addDownloadRecord(songData, filePath, fileSize) {
        try {
            console.log('➕ 添加下载记录:', songData.songname);

            // 动态导入下载服务
            const { AddDownloadRecord } = await import('./bindings/wmplayer/downloadservice.js');
            
            const request = {
                hash: songData.hash,
                songname: songData.songname || songData.title,
                artist_name: songData.author_name || songData.artist,
                filename: songData.filename,
                file_path: filePath,
                file_size: fileSize
            };

            const response = await AddDownloadRecord(request);

            if (response && response.success) {
                console.log('✅ 下载记录添加成功');
                // 如果当前在下载管理页面，重新加载记录
                if (document.getElementById('downloadsPage').style.display !== 'none') {
                    await this.loadDownloadRecords();
                }
            } else {
                console.warn('⚠️ 下载记录添加失败:', response?.message || '未知错误');
            }
        } catch (error) {
            console.error('❌ 添加下载记录失败:', error);
        }
    }
}

// 创建全局下载管理器实例
window.DownloadManager = new DownloadManager();

// 导出供其他模块使用
window.addDownloadRecord = (songData, filePath, fileSize) => {
    return window.DownloadManager.addDownloadRecord(songData, filePath, fileSize);
};
