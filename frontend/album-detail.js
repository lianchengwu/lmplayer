// 专辑详情页面功能模块
import { AlbumService } from "./bindings/wmplayer/index.js";

// 缓存配置
const FAVORITES_CACHE_EXPIRY = 10 * 60 * 60 * 1000; // 10小时缓存
const PLAYLIST_CACHE_EXPIRY = 10 * 60 * 60 * 1000;  // 10小时缓存

// 专辑详情页面管理器
class AlbumDetailManager {
    constructor() {
        this.currentAlbumId = null;
        this.currentPlaylistId = null;
        this.currentType = 'album'; // 'album' 或 'playlist'
        this.albumData = null;
        this.playlistData = null;
        this.songsData = [];
        this.loading = false;

        // 分页相关
        this.currentPage = 1;
        this.pageSize = 150;  // 修改单页大小为150
        this.hasMoreData = true;
        this.totalSongs = 0;
        this.loadingMore = false;

        // 缓存相关
        this.cache = new Map();
    }

    // 缓存相关方法
    getCacheKey(type, id, page = 1) {
        return `${type}_${id}_${page}`;
    }

    setCache(key, data, expiry = PLAYLIST_CACHE_EXPIRY) {
        const cacheData = {
            data: data,
            timestamp: Date.now(),
            expiry: expiry
        };
        this.cache.set(key, cacheData);
        console.log(`💾 缓存数据: ${key}`);
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }

        const now = Date.now();
        if (now - cached.timestamp > cached.expiry) {
            this.cache.delete(key);
            console.log(`🗑️ 缓存过期已清理: ${key}`);
            return null;
        }

        console.log(`✅ 使用缓存数据: ${key}`);
        return cached.data;
    }

    clearCache(pattern = null) {
        if (pattern) {
            // 清理匹配模式的缓存
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                    console.log(`🗑️ 清理缓存: ${key}`);
                }
            }
        } else {
            // 清理所有缓存
            this.cache.clear();
            console.log('🗑️ 清理所有缓存');
        }
    }

    // 初始化专辑详情页面
    async init() {
        console.log('🎵 初始化专辑详情页面');
        this.bindEvents();
    }

    // 绑定事件
    bindEvents() {
        // 播放全部按钮事件
        const playAllBtn = document.getElementById('albumPlayAllBtn');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                this.playAllSongs();
            });
        }

        // 歌曲列表事件委托
        const songsList = document.getElementById('albumSongsList');
        if (songsList) {
            songsList.addEventListener('click', (e) => {
                const songItem = e.target.closest('.album-song-item');
                if (songItem) {
                    const songIndex = parseInt(songItem.dataset.index);
                    this.playSong(songIndex);
                }
            });
        }

        // 刷新按钮事件
        const refreshBtn = document.getElementById('refreshAlbumBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshCurrentData();
            });
        }

        // 不再使用自动滚动加载，改为手动按钮加载
    }

    // 移除滚动监听器相关代码，改为手动按钮加载

    // 显示专辑详情
    async showAlbumDetail(albumId) {
        console.log('🎵 显示专辑详情:', albumId);

        if (!albumId) {
            console.error('❌ 专辑ID为空');
            return;
        }

        this.currentAlbumId = albumId;
        this.currentType = 'album'; // 设置当前类型为专辑

        // 移除默认状态（如果存在）
        const defaultState = document.querySelector('.album-default-state');
        if (defaultState) {
            defaultState.remove();
        }

        // 显示加载状态
        this.showLoading();

        console.log('📡 开始加载专辑详情和歌曲列表...');

        // 检查页面是否正确显示
        const albumDetailPage = document.getElementById('albumDetailPage');
        const container = document.querySelector('.album-detail-container');
        console.log('🔍 页面元素检查:', {
            'albumDetailPage存在': !!albumDetailPage,
            'albumDetailPage可见': albumDetailPage ? albumDetailPage.classList.contains('active') : false,
            'container存在': !!container
        });
        
        try {
            // 并发加载专辑详情和歌曲列表
            console.log('📡 调用API获取专辑详情和歌曲列表...');
            const [albumResponse, songsResponse] = await Promise.all([
                this.loadAlbumDetail(albumId),
                this.loadAlbumSongs(albumId)
            ]);

            console.log('📡 API调用完成');
            console.log('专辑详情响应:', albumResponse);
            console.log('歌曲列表响应:', songsResponse);

            if (albumResponse.success && songsResponse.success) {
                console.log('✅ 专辑数据加载成功');
                this.albumData = albumResponse.data;
                this.songsData = songsResponse.data;

                this.showContent();
                this.renderAlbumDetail();
                this.renderSongsList();
            } else {
                console.error('❌ API调用失败');
                this.showError('加载专辑信息失败');
            }
        } catch (error) {
            console.error('❌ 加载专辑详情失败:', error);
            this.showError('加载专辑信息失败');
        }
    }

    // 显示歌单详情
    async showPlaylistDetail(playlistId) {
        console.log('🎵 显示歌单详情:', playlistId);

        if (!playlistId) {
            console.error('❌ 歌单ID为空');
            return;
        }

        this.currentPlaylistId = playlistId;
        this.currentType = 'playlist'; // 设置当前类型为歌单

        // 重置分页状态
        this.currentPage = 1;
        this.hasMoreData = true;
        this.totalSongs = 0;
        this.songsData = [];

        // 移除默认状态（如果存在）
        const defaultState = document.querySelector('.album-default-state');
        if (defaultState) {
            defaultState.remove();
        }

        // 显示加载状态
        this.showLoading();

        console.log('📡 开始加载歌单详情和第一页歌曲列表...');

        try {
            // 并发加载歌单详情和第一页歌曲列表
            console.log('📡 调用API获取歌单详情和第一页歌曲列表...');
            const [playlistResponse, songsResponse] = await Promise.all([
                this.loadPlaylistDetail(playlistId),
                this.loadPlaylistSongs(playlistId, 1, this.pageSize)
            ]);

            console.log('📡 API调用完成');
            console.log('歌单详情响应:', playlistResponse);
            console.log('歌曲列表响应:', songsResponse);

            if (playlistResponse.success && songsResponse.success) {
                console.log('✅ 歌单数据加载成功');

                // 后端已经将歌单数据转换为专辑格式，直接使用
                this.albumData = playlistResponse.data;
                this.songsData = songsResponse.data;

                // 检查是否还有更多数据
                this.hasMoreData = songsResponse.data.length >= this.pageSize;

                // 更新总数（如果歌单详情中有总数信息）
                if (this.albumData && this.albumData.song_count) {
                    this.totalSongs = this.albumData.song_count;
                    this.hasMoreData = this.songsData.length < this.totalSongs;
                }

                this.showContent();
                this.renderAlbumDetail(); // 直接使用专辑渲染方法
                this.renderSongsList();
            } else {
                console.error('❌ API调用失败');
                this.showError('加载歌单信息失败');
            }
        } catch (error) {
            console.error('❌ 加载歌单详情失败:', error);
            this.showError('加载歌单信息失败');
        }
    }

    // 显示页面
    showPage() {
        // 不再直接操作DOM，让标准的导航系统处理页面切换
        // 这个方法现在主要用于确保专辑详情页面的内容正确显示
        console.log('🎵 专辑详情页面显示逻辑');
    }

    // 显示默认状态（当用户直接点击碟片导航时）
    showDefaultState() {
        console.log('🎵 显示专辑详情默认状态');

        // 页面显示由标准导航系统处理，这里只处理内容

        // 显示默认提示信息
        const container = document.querySelector('.album-detail-container');
        if (container) {
            // 移除之前的加载、错误状态和默认状态
            const existingLoading = container.querySelector('.album-loading');
            const existingError = container.querySelector('.album-error');
            const existingDefault = container.querySelector('.album-default-state');
            if (existingLoading) existingLoading.remove();
            if (existingError) existingError.remove();
            if (existingDefault) existingDefault.remove();

            // 隐藏专辑信息和歌曲列表
            const albumInfoSection = document.querySelector('.album-info-section');
            const albumSongsSection = document.querySelector('.album-songs-section');
            if (albumInfoSection) albumInfoSection.style.display = 'none';
            if (albumSongsSection) albumSongsSection.style.display = 'none';

            // 添加默认状态
            const defaultDiv = document.createElement('div');
            defaultDiv.className = 'album-default-state';
            defaultDiv.innerHTML = `
                <div class="default-state-content">
                    <i class="fas fa-compact-disc"></i>
                    <h3>碟片详情</h3>
                    <p>从发现音乐页面选择一张专辑来查看详情</p>
                </div>
            `;
            container.appendChild(defaultDiv);
        }
    }

    // 加载专辑详情
    async loadAlbumDetail(albumId) {
        console.log('📡 调用专辑详情API...');

        try {
            const response = await AlbumService.GetAlbumDetail(albumId);
            
            if (response && response.success) {
                console.log('✅ 专辑详情API调用成功');
                return response;
            } else {
                console.error('❌ 专辑详情API返回错误:', response);
                return { success: false, message: '获取专辑详情失败' };
            }
        } catch (error) {
            console.error('❌ 专辑详情API调用失败:', error);
            return { success: false, message: '网络请求失败' };
        }
    }

    // 加载专辑歌曲列表
    async loadAlbumSongs(albumId, page = 1, pageSize = 50) {
        console.log('📡 调用专辑歌曲列表API...');

        try {
            const response = await AlbumService.GetAlbumSongs(albumId, page, pageSize);
            
            if (response && response.success) {
                console.log('✅ 专辑歌曲列表API调用成功');
                return response;
            } else {
                console.error('❌ 专辑歌曲列表API返回错误:', response);
                return { success: false, message: '获取专辑歌曲失败' };
            }
        } catch (error) {
            console.error('❌ 专辑歌曲列表API调用失败:', error);
            return { success: false, message: '网络请求失败' };
        }
    }

    // 加载歌单详情（后端已转换为专辑格式）
    async loadPlaylistDetail(playlistId) {
        console.log('📡 调用歌单详情API（后端转换为专辑格式）...');

        // 检查缓存
        const cacheKey = this.getCacheKey('playlist_detail', playlistId);
        const cachedData = this.getCache(cacheKey);
        if (cachedData) {
            console.log('✅ 使用歌单详情缓存数据');
            return cachedData;
        }

        try {
            const response = await AlbumService.GetPlaylistDetail(playlistId);

            if (response && response.success) {
                console.log('✅ 歌单详情API调用成功，后端已转换为专辑格式');

                // 缓存数据 - 我喜欢的歌单使用更长的缓存时间
                const isMyFavorites = playlistId.includes('_2_0');
                const expiry = isMyFavorites ? FAVORITES_CACHE_EXPIRY : PLAYLIST_CACHE_EXPIRY;
                this.setCache(cacheKey, response, expiry);

                return response;
            } else {
                console.error('❌ 歌单详情API返回错误:', response);
                return { success: false, message: '获取歌单详情失败' };
            }
        } catch (error) {
            console.error('❌ 歌单详情API调用失败:', error);
            return { success: false, message: '网络请求失败' };
        }
    }

    // 加载歌单歌曲列表（后端已转换为专辑格式）
    async loadPlaylistSongs(playlistId, page = 1, pageSize = 50) {
        console.log('📡 调用歌单歌曲列表API（后端转换为专辑格式）...');

        // 检查缓存
        const cacheKey = this.getCacheKey('playlist_songs', playlistId, page);
        const cachedData = this.getCache(cacheKey);
        if (cachedData) {
            console.log('✅ 使用歌单歌曲缓存数据');
            return cachedData;
        }

        try {
            const response = await AlbumService.GetPlaylistSongs(playlistId, page, pageSize);

            if (response && response.success) {
                console.log('✅ 歌单歌曲列表API调用成功，后端已转换为专辑格式');

                // 缓存数据 - 我喜欢的歌单使用更长的缓存时间
                const isMyFavorites = playlistId.includes('_2_0'); // 我喜欢的歌单ID包含_2_0
                const expiry = isMyFavorites ? FAVORITES_CACHE_EXPIRY : PLAYLIST_CACHE_EXPIRY;
                this.setCache(cacheKey, response, expiry);

                return response;
            } else {
                console.error('❌ 歌单歌曲列表API返回错误:', response);
                return { success: false, message: '获取歌单歌曲失败' };
            }
        } catch (error) {
            console.error('❌ 歌单歌曲列表API调用失败:', error);
            return { success: false, message: '网络请求失败' };
        }
    }

    // 加载更多歌曲（分页加载）
    async loadMoreSongs() {
        console.log('🔍 loadMoreSongs 被调用，检查条件：', {
            loadingMore: this.loadingMore,
            hasMoreData: this.hasMoreData,
            currentType: this.currentType,
            currentPage: this.currentPage,
            totalSongs: this.totalSongs,
            currentSongsCount: this.songsData.length
        });

        if (this.loadingMore || !this.hasMoreData || this.currentType !== 'playlist') {
            console.log('⏸️ 跳过加载更多：', {
                loadingMore: this.loadingMore,
                hasMoreData: this.hasMoreData,
                currentType: this.currentType
            });
            return;
        }

        this.loadingMore = true;
        const nextPage = this.currentPage + 1;

        console.log(`🔄 开始加载第${nextPage}页歌曲...`);

        // 立即更新按钮状态
        this.renderSongsList();

        try {
            const songsResponse = await this.loadPlaylistSongs(this.currentPlaylistId, nextPage, this.pageSize);

            if (songsResponse.success && songsResponse.data && songsResponse.data.length > 0) {
                // 追加新数据
                this.songsData = [...this.songsData, ...songsResponse.data];
                this.currentPage = nextPage;

                console.log(`✅ 第${nextPage}页加载成功`);

                // 检查是否还有更多数据
                if (this.totalSongs > 0) {
                    this.hasMoreData = this.songsData.length < this.totalSongs;
                } else {
                    // 如果没有总数信息，使用返回数据量判断
                    this.hasMoreData = songsResponse.data.length >= this.pageSize;
                }

                // 重新渲染歌曲列表
                this.renderSongsList();
            } else {
                this.hasMoreData = false;
            }
        } catch (error) {
            console.error('❌ 加载更多歌曲失败:', error);
            this.hasMoreData = false;
        } finally {
            this.loadingMore = false;
            // 确保按钮状态正确更新
            this.renderSongsList();
        }
    }

    // 获取歌单信息
    getPlaylistInfo(playlistId) {
        // 尝试从全局的PlaylistsPageManager获取歌单信息
        if (window.playlistsPageManager && window.playlistsPageManager.data) {
            const playlistsData = window.playlistsPageManager.data;

            // 在我创建的歌单中查找
            const createdPlaylist = playlistsData.myPlaylists.find(p => p.listid == playlistId);
            if (createdPlaylist) {
                return {
                    name: createdPlaylist.name,
                    description: createdPlaylist.intro || '我创建的歌单',
                    creator: createdPlaylist.create_username || '我',
                    union_cover: createdPlaylist.union_cover
                };
            }

            // 在我收藏的歌单中查找
            const collectedPlaylist = playlistsData.collectedPlaylists.find(p => p.listid == playlistId);
            if (collectedPlaylist) {
                return {
                    name: collectedPlaylist.name,
                    description: collectedPlaylist.intro || '收藏的歌单',
                    creator: collectedPlaylist.create_username || '未知用户',
                    union_cover: collectedPlaylist.union_cover
                };
            }
        }

        // 如果找不到，返回默认信息
        return {
            name: `歌单 ${playlistId}`,
            description: '歌单详情',
            creator: '未知用户'
        };
    }

    // 渲染专辑详情（同时支持专辑和歌单）
    renderAlbumDetail() {
        if (!this.albumData) return;

        const album = this.albumData;

        // 更新类型标识
        const typeBadge = document.querySelector('.album-type-badge');
        if (typeBadge) {
            typeBadge.textContent = this.currentType === 'playlist' ? '歌单' : '专辑';
        }

        // 显示刷新按钮（仅歌单显示）
        this.showRefreshButton();

        // 更新封面
        const coverImage = document.getElementById('albumCoverImage');
        if (coverImage) {
            if (album.union_cover) {
                const coverUrl = this.getImageUrl(album.union_cover, 300);
                coverImage.src = coverUrl;
                coverImage.style.display = 'block';
                coverImage.nextElementSibling.style.display = 'none';
            } else {
                // 如果没有封面图片，显示默认图标
                coverImage.style.display = 'none';
                coverImage.nextElementSibling.style.display = 'flex';
            }
        }

        // 更新标题
        const titleElement = document.getElementById('albumTitle');
        if (titleElement) {
            titleElement.textContent = album.album_name || (this.currentType === 'playlist' ? '未知歌单' : '未知专辑');
        }

        // 更新艺术家/创建者
        const artistElement = document.getElementById('albumArtist');
        if (artistElement) {
            artistElement.textContent = album.author_name || (this.currentType === 'playlist' ? '未知创建者' : '未知艺术家');
        }

        // 更新发行年份/创建时间
        const yearElement = document.getElementById('albumYear');
        if (yearElement) {
            yearElement.textContent = album.publish_date || (this.currentType === 'playlist' ? '未知时间' : '未知年份');
        }

        // 更新歌曲数量 - 简化显示
        const songCountElement = document.getElementById('albumSongCount');
        if (songCountElement) {
            if (this.currentType === 'playlist' && album.song_count > 0) {
                // 歌单显示总数
                songCountElement.textContent = `${album.song_count}首歌曲`;
            } else {
                // 专辑或没有总数信息时显示当前加载数
                songCountElement.textContent = `${this.songsData.length}首歌曲`;
            }
        }

        // 更新描述
        const descriptionElement = document.getElementById('albumDescription');
        if (descriptionElement) {
            const defaultDesc = this.currentType === 'playlist' ? '暂无歌单简介' : '暂无专辑简介';
            descriptionElement.textContent = album.description || defaultDesc;
        }
    }



    // 渲染歌曲列表
    renderSongsList() {
        const container = document.getElementById('albumSongsList');
        if (!container) return;

        if (this.songsData.length === 0) {
            container.innerHTML = `
                <div class="album-error">
                    <i class="fas fa-music"></i>
                    <div>暂无歌曲</div>
                </div>
            `;
            return;
        }

        const html = this.songsData.map((song, index) => {
            const duration = this.formatDuration(song.time_length || 0);
            const coverUrl = song.union_cover ? this.getImageUrl(song.union_cover, 40) : '';

            // 使用全局统一的歌曲信息格式化函数
            const formattedInfo = window.formatSongInfo ? window.formatSongInfo(song) : {
                songname: song.songname || song.title || song.name || song.filename || '未知歌曲',
                author_name: song.author_name || '未知艺术家',
                album_name: song.album_name || '未知专辑'
            };

            return `
                <div class="album-song-item" data-index="${index}">
                    <div class="song-number">${index + 1}</div>
                    <div class="song-info-album">
                        <div class="song-cover-small">
                            ${coverUrl ?
                                `<img src="${coverUrl}" alt="${formattedInfo.songname}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                 <div class="cover-placeholder" style="display: none;"><i class="fas fa-music"></i></div>` :
                                `<div class="cover-placeholder"><i class="fas fa-music"></i></div>`
                            }
                        </div>
                        <div class="song-details">
                            <div class="song-name">${formattedInfo.songname}</div>
                            <div class="song-artist">${formattedInfo.author_name}</div>
                        </div>
                    </div>
                    <div class="song-album-column">${formattedInfo.album_name}</div>
                    <div class="song-duration">${duration}</div>
                    <div class="song-actions-album">
                        <button class="song-action-btn" title="播放">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="song-action-btn" title="收藏">
                            <i class="fas fa-heart"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // 单独处理右下角固定的加载更多按钮
        this.updateLoadMoreButton();
    }

    // 更新加载更多按钮
    updateLoadMoreButton() {
        // 先移除现有的按钮
        const existingButton = document.querySelector('.load-more-section');
        if (existingButton) {
            existingButton.remove();
        }

        // 只在歌单页面且有更多数据时显示按钮
        if (this.currentType === 'playlist' && this.hasMoreData) {
            const isLoading = this.loadingMore;
            const buttonHTML = `
                <div class="load-more-section">
                    <button class="load-more-btn"
                            onclick="window.AlbumDetailManager.loadMoreSongs()"
                            ${isLoading ? 'disabled' : ''}>
                        <i class="fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-plus'}"></i>
                        <span>${isLoading ? '加载中...' : '加载更多'}</span>
                    </button>
                </div>
            `;

            // 将按钮添加到body中，作为固定定位元素
            document.body.insertAdjacentHTML('beforeend', buttonHTML);
        }
    }

    // 清理加载更多按钮
    clearLoadMoreButton() {
        const existingButton = document.querySelector('.load-more-section');
        if (existingButton) {
            existingButton.remove();
        }
    }

    // 显示刷新按钮（仅在歌单页面显示）
    showRefreshButton() {
        const refreshBtn = document.getElementById('refreshAlbumBtn');
        if (refreshBtn) {
            if (this.currentType === 'playlist') {
                refreshBtn.style.display = 'flex';
            } else {
                refreshBtn.style.display = 'none';
            }
        }
    }

    // 隐藏刷新按钮
    hideRefreshButton() {
        const refreshBtn = document.getElementById('refreshAlbumBtn');
        if (refreshBtn) {
            refreshBtn.style.display = 'none';
        }
    }

    // 刷新当前数据
    async refreshCurrentData() {
        console.log('🔄 刷新当前数据...');

        // 显示刷新动画
        const refreshBtn = document.getElementById('refreshAlbumBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.querySelector('i').style.animation = 'spin 1s linear infinite';
        }

        try {
            if (this.currentType === 'playlist' && this.currentPlaylistId) {
                // 清除相关缓存
                this.clearCache(`playlist_detail_${this.currentPlaylistId}`);
                this.clearCache(`playlist_songs_${this.currentPlaylistId}`);

                // 重新加载歌单数据
                await this.showPlaylistDetail(this.currentPlaylistId);
                console.log('✅ 歌单数据刷新完成');
            } else if (this.currentType === 'album' && this.currentAlbumId) {
                // 专辑暂时不需要刷新功能，因为专辑数据相对固定
                console.log('专辑数据不需要刷新');
            }
        } catch (error) {
            console.error('❌ 数据刷新失败:', error);
        } finally {
            // 恢复按钮状态
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.querySelector('i').style.animation = '';
            }
        }
    }

    // 播放全部歌曲
    async playAllSongs() {
        if (this.songsData.length === 0) {
            console.warn('⚠️ 没有可播放的歌曲');
            return;
        }

        // 根据当前类型显示不同的日志信息
        if (this.currentType === 'playlist') {
            console.log('🎵 播放歌单全部歌曲:', this.albumData?.album_name, '共', this.songsData.length, '首');
        } else {
            console.log('🎵 播放专辑全部歌曲:', this.albumData?.album_name, '共', this.songsData.length, '首');
        }

        // 转换歌曲数据格式
        const songs = this.songsData.map(song => ({
            id: song.hash,
            hash: song.hash,
            songname: song.songname,
            author_name: song.author_name,
            album_name: song.album_name,
            album_id: song.album_id,
            time_length: song.time_length,
            filename: song.filename,
            union_cover: song.union_cover
        }));

        // 使用统一的 PlayerController 播放歌单
        if (window.PlayerController) {
            let playlistName;
            if (this.currentType === 'playlist') {
                // 对于歌单，从albumData中获取名称（因为后端已转换为专辑格式）
                playlistName = `歌单：${this.albumData?.album_name || '未知歌单'}`;
            } else {
                playlistName = `专辑：${this.albumData?.album_name || '未知专辑'}`;
            }

            const success = await window.PlayerController.playPlaylist(songs, 0, playlistName);
            if (success) {
                console.log('✅ 歌曲播放成功');
            } else {
                console.error('❌ 歌曲播放失败');
            }
        } else {
            console.error('❌ PlayerController不可用');
        }
    }

    // 播放指定歌曲
    async playSong(songIndex) {
        if (songIndex < 0 || songIndex >= this.songsData.length) {
            console.error('❌ 歌曲索引无效:', songIndex);
            return;
        }

        // 根据当前类型显示不同的日志信息
        if (this.currentType === 'playlist') {
            console.log('🎵 播放歌单歌曲:', songIndex, this.songsData[songIndex].songname);
        } else {
            console.log('🎵 播放专辑歌曲:', songIndex, this.songsData[songIndex].songname);
        }

        // 转换歌曲数据格式
        const songs = this.songsData.map(song => ({
            id: song.hash,
            hash: song.hash,
            songname: song.songname,
            author_name: song.author_name,
            album_name: song.album_name,
            album_id: song.album_id,
            time_length: song.time_length,
            filename: song.filename,
            union_cover: song.union_cover
        }));

        // 使用统一的 PlayerController 播放歌单
        if (window.PlayerController) {
            let playlistName;
            if (this.currentType === 'playlist') {
                // 对于歌单，从albumData中获取名称（因为后端已转换为专辑格式）
                playlistName = `歌单：${this.albumData?.album_name || '未知歌单'}`;
            } else {
                playlistName = `专辑：${this.albumData?.album_name || '未知专辑'}`;
            }

            const success = await window.PlayerController.playPlaylist(songs, songIndex, playlistName);
            if (success) {
                console.log('✅ 歌曲播放成功');
            } else {
                console.error('❌ 歌曲播放失败');
            }
        } else {
            console.error('❌ PlayerController不可用');
        }
    }

    // 显示专辑内容
    showContent() {
        // 移除加载、错误状态和默认状态
        const container = document.querySelector('.album-detail-container');
        if (container) {
            const existingLoading = container.querySelector('.album-loading');
            const existingError = container.querySelector('.album-error');
            const existingDefault = container.querySelector('.album-default-state');
            if (existingLoading) existingLoading.remove();
            if (existingError) existingError.remove();
            if (existingDefault) existingDefault.remove();
        }

        // 显示专辑信息和歌曲列表
        const albumInfoSection = document.querySelector('.album-info-section');
        const albumSongsSection = document.querySelector('.album-songs-section');

        if (albumInfoSection) {
            albumInfoSection.style.display = 'flex';
        }
        if (albumSongsSection) {
            albumSongsSection.style.display = 'block';
        }
    }

    // 显示加载状态
    showLoading() {
        // 清理加载更多按钮
        this.clearLoadMoreButton();

        // 隐藏刷新按钮
        this.hideRefreshButton();

        // 隐藏专辑信息和歌曲列表
        const albumInfoSection = document.querySelector('.album-info-section');
        const albumSongsSection = document.querySelector('.album-songs-section');

        if (albumInfoSection) {
            albumInfoSection.style.display = 'none';
        }
        if (albumSongsSection) {
            albumSongsSection.style.display = 'none';
        }

        // 显示加载状态
        const container = document.querySelector('.album-detail-container');
        if (container) {
            // 移除之前的加载、错误状态和默认状态
            const existingLoading = container.querySelector('.album-loading');
            const existingError = container.querySelector('.album-error');
            const existingDefault = container.querySelector('.album-default-state');
            if (existingLoading) existingLoading.remove();
            if (existingError) existingError.remove();
            if (existingDefault) existingDefault.remove();

            // 添加加载状态
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'album-loading';
            loadingDiv.innerHTML = `
                <i class="fas fa-spinner"></i>
                <div>正在加载专辑信息...</div>
            `;
            container.appendChild(loadingDiv);
        }
    }

    // 显示错误状态
    showError(message) {
        // 清理加载更多按钮
        this.clearLoadMoreButton();

        // 隐藏刷新按钮
        this.hideRefreshButton();

        // 隐藏专辑信息和歌曲列表
        const albumInfoSection = document.querySelector('.album-info-section');
        const albumSongsSection = document.querySelector('.album-songs-section');

        if (albumInfoSection) {
            albumInfoSection.style.display = 'none';
        }
        if (albumSongsSection) {
            albumSongsSection.style.display = 'none';
        }

        // 显示错误状态
        const container = document.querySelector('.album-detail-container');
        if (container) {
            // 移除之前的加载、错误状态和默认状态
            const existingLoading = container.querySelector('.album-loading');
            const existingError = container.querySelector('.album-error');
            const existingDefault = container.querySelector('.album-default-state');
            if (existingLoading) existingLoading.remove();
            if (existingError) existingError.remove();
            if (existingDefault) existingDefault.remove();

            // 添加错误状态
            const errorDiv = document.createElement('div');
            errorDiv.className = 'album-error';
            errorDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <div>${message}</div>
            `;
            container.appendChild(errorDiv);
        }
    }

    // 格式化时长
    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0:00';
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // 获取图片URL
    getImageUrl(unionCover, size = 300) {
        if (!unionCover) return '';
        return unionCover.replace('{size}', size.toString());
    }
}

// 创建全局实例
window.AlbumDetailManager = new AlbumDetailManager();

// 导出管理器
export { AlbumDetailManager };
