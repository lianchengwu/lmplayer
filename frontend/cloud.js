// 音乐云盘页面模块
import { GetCloudSongs } from './bindings/wmplayer/cloudservice.js';

class CloudPageManager {
    constructor() {
        this.songs = [];
        this.filteredSongs = [];
        this.loading = false;
        this.total = 0;
        this.searchKeyword = '';
        this.initialized = false;
        this.eventsBound = false;
    }

    init() {
        if (!this.eventsBound) {
            this.bindEvents();
            this.eventsBound = true;
        }

        if (!this.initialized || this.songs.length === 0) {
            this.loadCloudSongs();
            this.initialized = true;
        } else {
            this.updatePlayingState();
        }
    }

    bindEvents() {
        const playAllBtn = document.getElementById('cloudPlayAllBtn');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => this.playAll());
        }

        const refreshBtn = document.getElementById('cloudRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refresh());
        }

        const searchInput = document.getElementById('cloudSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchKeyword = (e.target.value || '').trim().toLowerCase();
                this.filterSongs();
            });
        }

        // 监听播放歌曲变更，同步高亮状态
        if (window.Events) {
            window.Events.On('player:song-changed', () => {
                this.updatePlayingState();
            });
        }
    }

    async loadCloudSongs() {
        if (this.loading) return;
        this.loading = true;
        this.renderLoading();

        try {
            const res = await GetCloudSongs({ page: 1, pageSize: 100 });
            if (res && res.success && res.data) {
                const songs = res.data.songs || [];
                this.songs = songs;
                this.total = res.data.total || songs.length;
                this.filterSongs();
            } else {
                const msg = res?.message || '获取云盘歌曲失败';
                this.renderError(msg);
            }
        } catch (err) {
            console.error('获取云盘歌曲异常:', err);
            this.renderError(err.message || '网络或服务端异常');
        } finally {
            this.loading = false;
        }
    }

    filterSongs() {
        if (!this.searchKeyword) {
            this.filteredSongs = [...this.songs];
        } else {
            this.filteredSongs = this.songs.filter(s => {
                const title = (s.songname || s.filename || '').toLowerCase();
                const artist = (s.author_name || '').toLowerCase();
                const album = (s.album_name || '').toLowerCase();
                return title.includes(this.searchKeyword) ||
                    artist.includes(this.searchKeyword) ||
                    album.includes(this.searchKeyword);
            });
        }

        this.updateStats();
        this.renderSongs();
    }

    updateStats() {
        const countEl = document.getElementById('cloudSongCount');
        if (countEl) {
            countEl.textContent = this.songs.length;
        }
    }

    renderLoading() {
        const container = document.getElementById('cloudSongList');
        if (!container) return;
        container.innerHTML = `
            <div class="cloud-loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>正在读取云盘歌曲...</p>
            </div>
        `;
    }

    renderError(msg) {
        const container = document.getElementById('cloudSongList');
        if (!container) return;
        container.innerHTML = `
            <div class="cloud-empty-state">
                <i class="fas fa-exclamation-circle"></i>
                <p>${this.escapeHtml(msg)}</p>
            </div>
        `;
    }

    renderSongs() {
        const container = document.getElementById('cloudSongList');
        if (!container) return;

        if (this.filteredSongs.length === 0) {
            container.innerHTML = `
                <div class="cloud-empty-state">
                    <i class="fas fa-cloud"></i>
                    <p>${this.searchKeyword ? '未找到匹配的云盘歌曲' : '云盘暂无歌曲或未登录酷狗账号'}</p>
                </div>
            `;
            return;
        }

        const currentSong = window.PlayerController?.currentSong;
        const currentHash = currentSong?.hash || '';

        container.innerHTML = this.filteredSongs.map((song, index) => {
            const isPlaying = currentHash && song.hash && currentHash.toLowerCase() === song.hash.toLowerCase();
            const duration = this.formatDuration(song.time_length);
            const cover = song.union_cover || '';

            return `
                <div class="cloud-song-item ${isPlaying ? 'playing' : ''}" data-index="${index}" data-hash="${this.escapeHtml(song.hash)}">
                    <div class="cloud-col-index">
                        ${isPlaying ? '<i class="fas fa-volume-up"></i>' : index + 1}
                    </div>
                    <div class="cloud-col-title">
                        <div class="cloud-song-cover">
                            ${cover ? `<img src="${this.escapeHtml(cover)}" alt="cover" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><i class="fas fa-music" style="display:none;"></i>` : '<i class="fas fa-music"></i>'}
                        </div>
                        <div class="cloud-song-meta">
                            <span class="cloud-song-name" title="${this.escapeHtml(song.songname || song.filename)}">
                                <span>${this.escapeHtml(song.songname || song.filename)}</span>
                                <span class="cloud-badge">云盘</span>
                            </span>
                        </div>
                    </div>
                    <div class="cloud-col-artist" title="${this.escapeHtml(song.author_name || '未知歌手')}">
                        ${this.escapeHtml(song.author_name || '未知歌手')}
                    </div>
                    <div class="cloud-col-album" title="${this.escapeHtml(song.album_name || '未知专辑')}">
                        ${this.escapeHtml(song.album_name || '未知专辑')}
                    </div>
                    <div class="cloud-col-duration">${duration}</div>
                    <div class="cloud-col-actions">
                        <button class="cloud-action-btn btn-play-single" title="播放" data-index="${index}">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="cloud-action-btn btn-add-single" title="添加到播放列表" data-index="${index}">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // 事件委托：行点击、双击与行内按钮
        this.bindListEvents(container);
    }

    bindListEvents(container) {
        container.querySelectorAll('.cloud-song-item').forEach(item => {
            const index = parseInt(item.dataset.index, 10);
            const song = this.filteredSongs[index];
            if (!song) return;

            item.addEventListener('dblclick', () => {
                this.playSong(index);
            });

            const playBtn = item.querySelector('.btn-play-single');
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.playSong(index);
                });
            }

            const addBtn = item.querySelector('.btn-add-single');
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addToPlaylist(song);
                });
            }
        });
    }

    async playSong(index) {
        const song = this.filteredSongs[index];
        if (!song) return;

        // 如果播放列表没有或者不是当前列表，同步当前过滤歌单到播放列表
        if (window.PlaylistManager) {
            window.PlaylistManager.setPlaylist(this.filteredSongs, index);
        }

        if (window.PlayerController) {
            await window.PlayerController.playSong(song);
        }

        this.updatePlayingState();
    }

    async playAll() {
        if (!this.filteredSongs || this.filteredSongs.length === 0) return;
        if (window.PlaylistManager) {
            window.PlaylistManager.setPlaylist(this.filteredSongs, 0);
        }
        if (window.PlayerController) {
            await window.PlayerController.playSong(this.filteredSongs[0]);
        }
        this.updatePlayingState();
    }

    addToPlaylist(song) {
        if (window.PlaylistManager) {
            window.PlaylistManager.addToPlaylist(song);
        }
    }

    updatePlayingState() {
        const currentSong = window.PlayerController?.currentSong;
        const currentHash = (currentSong?.hash || '').toLowerCase();
        const items = document.querySelectorAll('.cloud-song-item');
        items.forEach(item => {
            const hash = (item.dataset.hash || '').toLowerCase();
            const isPlaying = currentHash && hash && currentHash === hash;
            item.classList.toggle('playing', !!isPlaying);
            const indexEl = item.querySelector('.cloud-col-index');
            const idx = parseInt(item.dataset.index, 10);
            if (indexEl) {
                indexEl.innerHTML = isPlaying ? '<i class="fas fa-volume-up"></i>' : (idx + 1);
            }
        });
    }

    async refresh() {
        const refreshBtn = document.getElementById('cloudRefreshBtn');
        const icon = refreshBtn?.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
        try {
            await this.loadCloudSongs();
        } finally {
            if (icon) icon.classList.remove('fa-spin');
        }
    }

    formatDuration(seconds) {
        if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

export const cloudPageManager = new CloudPageManager();

export function initCloudPage() {
    cloudPageManager.init();
}

export function refreshCloudPage() {
    cloudPageManager.refresh();
}

window.initCloudPage = initCloudPage;
window.refreshCloudPage = refreshCloudPage;
window.cloudPageManager = cloudPageManager;
