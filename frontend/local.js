// 本地音乐功能模块

import * as LocalMusicService from "./bindings/wmplayer/localmusicservice.js";

// 全局变量
let localMusicFiles = [];
let folderMusicGroups = []; // 存储按文件夹分组的音乐数据
let currentLocalSong = null;
let isScanning = false;
let musicFolderPaths = []; // 存储用户添加的文件夹路径
let expandedFolders = new Set(); // 存储展开的文件夹
let isPathListExpanded = true; // 文件夹路径列表是否展开

// 初始化本地音乐功能
function initLocalMusic() {
    console.log('初始化本地音乐功能...');

    // 加载保存的文件夹路径
    loadFolderPaths();

    // 绑定事件监听器
    bindLocalMusicEvents();

    // 加载缓存的音乐文件
    loadCachedMusicFiles();
}

// 绑定事件监听器
function bindLocalMusicEvents() {
    console.log('绑定本地音乐事件监听器');

    // 等待页面元素加载完成
    setTimeout(() => {
        // 添加文件夹按钮
        const addFolderBtn = document.querySelector('#localPage .local-btn-primary');
        if (addFolderBtn) {
            console.log('找到添加文件夹按钮，绑定事件');
            addFolderBtn.addEventListener('click', showAddFolderDialog);
        } else {
            console.warn('未找到添加文件夹按钮');
        }

        // 创建文件夹路径管理界面
        createFolderPathManager();
    }, 500);
}

// 创建文件夹路径管理界面
function createFolderPathManager() {
    const localPage = document.getElementById('localPage');
    if (!localPage) return;

    const localContent = localPage.querySelector('.local-content');
    if (!localContent) return;

    // 检查是否已经存在路径管理器
    let pathManager = localContent.querySelector('.folder-path-manager');
    if (!pathManager) {
        pathManager = document.createElement('div');
        pathManager.className = 'folder-path-manager';
        pathManager.innerHTML = `
            <div class="path-manager-header" onclick="togglePathManager()">
                <div class="path-manager-toggle">
                    <i class="fas fa-chevron-${isPathListExpanded ? 'down' : 'right'}"></i>
                </div>
                <div class="path-manager-icon">
                    <i class="fas fa-folder${isPathListExpanded ? '-open' : ''}"></i>
                </div>
                <h3>音乐文件夹路径</h3>
                <div class="path-manager-count">
                    <span class="path-count">${musicFolderPaths.length} 个路径</span>
                </div>
            </div>
            <div class="path-list ${isPathListExpanded ? 'expanded' : 'collapsed'}" id="musicPathList">
                <div class="empty-paths">
                    <i class="fas fa-folder-open"></i>
                    <p>还没有添加任何音乐文件夹路径</p>
                    <p class="hint">点击右上角"添加文件夹"按钮开始添加</p>
                </div>
            </div>
        `;

        // 将路径管理器插入到统计信息之后
        const statsElement = localContent.querySelector('.local-stats');
        if (statsElement) {
            statsElement.insertAdjacentElement('afterend', pathManager);
        } else {
            localContent.insertBefore(pathManager, localContent.firstChild);
        }
    }

    // 更新路径列表显示
    updatePathListDisplay();
}

// 显示添加文件夹对话框
function showAddFolderDialog() {
    // 检查浏览器是否支持 File System Access API
    if ('showDirectoryPicker' in window) {
        selectFolderWithAPI();
    } else {
        // 降级到传统的输入方式
        showTraditionalFolderDialog();
    }
}

// 使用 File System Access API 选择文件夹
async function selectFolderWithAPI() {
    try {
        const directoryHandle = await window.showDirectoryPicker();
        const folderPath = directoryHandle.name;

        // 存储目录句柄以供后续使用
        if (!window.directoryHandles) {
            window.directoryHandles = new Map();
        }
        window.directoryHandles.set(folderPath, directoryHandle);

        // 添加到文件夹路径列表
        if (!musicFolderPaths.includes(folderPath)) {
            musicFolderPaths.push(folderPath);
            saveFolderPaths();
            updatePathListDisplay();
            showMessage(`已添加文件夹: ${folderPath}`, 'success');
        } else {
            showMessage('该文件夹已存在', 'warning');
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('选择文件夹失败:', error);
            showMessage('选择文件夹失败', 'error');
        }
    }
}

// 传统的文件夹输入对话框
function showTraditionalFolderDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'folder-dialog-overlay';
    dialog.innerHTML = `
        <div class="folder-dialog">
            <div class="dialog-header">
                <h3>添加音乐文件夹路径</h3>
                <button class="dialog-close" onclick="closeFolderDialog()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="dialog-content">
                <label for="folderPathInput">文件夹路径:</label>
                <input type="text" id="folderPathInput" placeholder="例如: /home/user/Music 或 C:\\Users\\User\\Music" />
                <div class="dialog-hint">
                    <i class="fas fa-info-circle"></i>
                    请输入音乐文件夹的完整路径
                </div>
            </div>
            <div class="dialog-actions">
                <button class="dialog-btn dialog-btn-cancel" onclick="closeFolderDialog()">取消</button>
                <button class="dialog-btn dialog-btn-confirm" onclick="addFolderPath()">添加</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 聚焦到输入框
    setTimeout(() => {
        const input = document.getElementById('folderPathInput');
        if (input) {
            input.focus();
            // 绑定回车键
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    addFolderPath();
                }
            });
        }
    }, 100);
}

// 关闭文件夹对话框
window.closeFolderDialog = function() {
    const dialog = document.querySelector('.folder-dialog-overlay');
    if (dialog) {
        dialog.remove();
    }
};

// 添加文件夹路径
window.addFolderPath = function() {
    const input = document.getElementById('folderPathInput');
    if (!input) return;

    const path = input.value.trim();
    if (!path) {
        showMessage('请输入文件夹路径', 'warning');
        return;
    }

    // 检查路径是否已存在
    if (musicFolderPaths.includes(path)) {
        showMessage('该路径已经添加过了', 'warning');
        return;
    }

    // 添加路径
    musicFolderPaths.push(path);
    updatePathListDisplay();
    closeFolderDialog();

    showMessage(`已添加路径: ${path}`, 'success');

    // 保存到本地存储
    saveFolderPaths();
};

// 更新路径列表显示
function updatePathListDisplay() {
    const pathList = document.getElementById('musicPathList');
    if (!pathList) return;

    // 更新路径计数
    const pathCount = document.querySelector('.path-count');
    if (pathCount) {
        pathCount.textContent = `${musicFolderPaths.length} 个路径`;
    }

    if (musicFolderPaths.length === 0) {
        pathList.innerHTML = `
            <div class="empty-paths">
                <i class="fas fa-folder-open"></i>
                <p>还没有添加任何音乐文件夹路径</p>
                <p class="hint">点击上方"添加路径"按钮开始添加</p>
            </div>
        `;
    } else {
        pathList.innerHTML = musicFolderPaths.map((path, index) => `
            <div class="path-item">
                <div class="path-info">
                    <i class="fas fa-folder"></i>
                    <span class="path-text" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
                </div>
                <div class="path-actions">
                    <button class="path-action-btn" onclick="scanSingleFolder('${escapeHtml(path)}')" title="扫描此文件夹">
                        <i class="fas fa-sync"></i>
                    </button>
                    <button class="path-action-btn path-delete-btn" onclick="removeFolderPath(${index})" title="删除此路径">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }
}

// 删除文件夹路径
window.removeFolderPath = function(index) {
    if (index >= 0 && index < musicFolderPaths.length) {
        const path = musicFolderPaths[index];
        musicFolderPaths.splice(index, 1);
        updatePathListDisplay();
        saveFolderPaths();
        showMessage(`已删除路径: ${path}`, 'success');
    }
};

// 扫描单个文件夹
window.scanSingleFolder = async function(folderPath) {
    await scanMusicFolder(folderPath);
};

// 扫描所有音乐文件夹
async function scanAllMusicFolders() {
    if (musicFolderPaths.length === 0) {
        showMessage('请先添加音乐文件夹路径', 'warning');
        return;
    }

    if (isScanning) {
        showMessage('正在扫描中，请稍候...', 'warning');
        return;
    }

    isScanning = true;
    showLoadingState('正在扫描所有音乐文件夹...');

    try {
        let allMusicFiles = [];

        for (let i = 0; i < musicFolderPaths.length; i++) {
            const folderPath = musicFolderPaths[i];
            console.log(`扫描文件夹 ${i + 1}/${musicFolderPaths.length}: ${folderPath}`);

            showLoadingState(`正在扫描文件夹 ${i + 1}/${musicFolderPaths.length}: ${folderPath}`);

            try {
                const response = await LocalMusicService.ScanMusicFolder(folderPath);

                if (response.success) {
                    allMusicFiles.push(...(response.data || []));
                    console.log(`文件夹 ${folderPath} 扫描完成，找到 ${response.data?.length || 0} 首音乐`);
                } else {
                    console.warn(`扫描文件夹失败 ${folderPath}: ${response.message}`);
                    showMessage(`扫描 ${folderPath} 失败: ${response.message}`, 'warning');
                }
            } catch (error) {
                console.error(`扫描文件夹出错 ${folderPath}:`, error);
                showMessage(`扫描 ${folderPath} 出错`, 'error');
            }
        }

        // 更新显示
        localMusicFiles = allMusicFiles;
        updateLocalMusicDisplay();

        // 计算统计信息
        const stats = calculateLocalStats(allMusicFiles);
        updateLocalStats(stats);

        showMessage(`扫描完成！共找到 ${allMusicFiles.length} 首音乐`, 'success');

    } catch (error) {
        console.error('扫描所有文件夹失败:', error);
        showMessage('扫描失败', 'error');
    } finally {
        isScanning = false;
        hideLoadingState();
    }
}

// 保存文件夹路径到本地存储
function saveFolderPaths() {
    try {
        localStorage.setItem('musicFolderPaths', JSON.stringify(musicFolderPaths));
        // 同时保存路径列表展开状态
        localStorage.setItem('isPathListExpanded', JSON.stringify(isPathListExpanded));
    } catch (error) {
        console.warn('保存文件夹路径失败:', error);
    }
}

// 从本地存储加载文件夹路径
function loadFolderPaths() {
    try {
        const saved = localStorage.getItem('musicFolderPaths');
        if (saved) {
            musicFolderPaths = JSON.parse(saved);
        }

        // 加载路径列表展开状态
        const savedExpandedState = localStorage.getItem('isPathListExpanded');
        if (savedExpandedState !== null) {
            isPathListExpanded = JSON.parse(savedExpandedState);
        }

        updatePathListDisplay();
    } catch (error) {
        console.warn('加载文件夹路径失败:', error);
        musicFolderPaths = [];
        isPathListExpanded = true;
    }
}

// 计算本地统计信息
function calculateLocalStats(musicFiles) {
    const artistSet = new Set();
    const albumSet = new Set();

    musicFiles.forEach(file => {
        // 兼容不同的字段名
        const artist = file.artist || file.author_name;
        const album = file.album_name || file.album;

        if (artist && artist !== '未知艺术家') {
            artistSet.add(artist);
        }
        if (album && album !== '未知专辑') {
            albumSet.add(album);
        }
    });

    return {
        total_songs: musicFiles.length,
        total_author_names: artistSet.size,
        total_albums: albumSet.size
    };
}



// 显示添加文件夹对话框（全局函数）
window.showAddFolderDialog = showAddFolderDialog;

// 扫描音乐文件夹（全局函数）
window.scanMusicFolders = scanMusicFolders;

// 扫描音乐文件夹（调用后端API）
async function scanMusicFolders() {
    if (window.directoryHandles && window.directoryHandles.size > 0) {
        // 使用 File System Access API 扫描
        await scanMusicFoldersWithAPI();
    } else if (musicFolderPaths.length > 0) {
        // 使用后端API扫描
        await scanMusicFoldersWithBackend();
    } else {
        showMessage('请先添加音乐文件夹', 'warning');
    }
}

// 使用 File System Access API 扫描音乐文件夹
async function scanMusicFoldersWithAPI() {
    if (isScanning) {
        showMessage('正在扫描中，请稍候...', 'warning');
        return;
    }

    isScanning = true;
    const scanBtn = document.querySelector('.local-btn-secondary');
    const originalText = scanBtn ? scanBtn.textContent : '';

    if (scanBtn) {
        scanBtn.textContent = '扫描中...';
        scanBtn.disabled = true;
    }

    try {
        showMessage('开始扫描音乐文件...', 'info');
        localMusicFiles = [];

        for (const [folderName, directoryHandle] of window.directoryHandles) {
            await scanDirectoryRecursively(directoryHandle, folderName);
        }

        displayLocalMusic();
        showMessage(`扫描完成！找到 ${localMusicFiles.length} 个音乐文件`, 'success');

    } catch (error) {
        console.error('扫描音乐文件夹失败:', error);
        showMessage('扫描失败: ' + error.message, 'error');
    } finally {
        isScanning = false;
        if (scanBtn) {
            scanBtn.textContent = originalText;
            scanBtn.disabled = false;
        }
    }
}

// 递归扫描目录
async function scanDirectoryRecursively(directoryHandle, basePath = '') {
    try {
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file') {
                if (isSupportedAudioFile(entry.name)) {
                    const fileHandle = await directoryHandle.getFileHandle(entry.name);
                    const file = await fileHandle.getFile();

                    // 创建音乐文件对象
                    const musicFile = {
                        file_path: `${basePath}/${entry.name}`,
                        filename: entry.name,
                        title: entry.name.replace(/\.[^/.]+$/, ""), // 移除扩展名作为标题
                        author_name: '未知艺术家',
                        album: '未知专辑',
                        duration: 0, // 前端无法直接获取时长
                        file_size: file.size,
                        format: entry.name.split('.').pop().toLowerCase(),
                        _fileObject: file // 存储文件对象供播放使用
                    };

                    localMusicFiles.push(musicFile);
                }
            } else if (entry.kind === 'directory') {
                // 递归扫描子目录
                const subDirectoryHandle = await directoryHandle.getDirectoryHandle(entry.name);
                await scanDirectoryRecursively(subDirectoryHandle, `${basePath}/${entry.name}`);
            }
        }
    } catch (error) {
        console.warn(`扫描目录 ${basePath} 失败:`, error);
    }
}

// 使用后端API扫描音乐文件夹
async function scanMusicFoldersWithBackend() {
    if (isScanning) {
        showMessage('正在扫描中，请稍候...', 'warning');
        return;
    }

    isScanning = true;
    const scanBtn = document.querySelector('.local-btn-secondary');
    const originalText = scanBtn ? scanBtn.textContent : '';

    if (scanBtn) {
        scanBtn.textContent = '扫描中...';
        scanBtn.disabled = true;
    }

    try {
        showMessage('开始扫描音乐文件...', 'info');

        // 使用后端的ScanMusicFolders方法一次性扫描所有文件夹
        const response = await LocalMusicService.ScanMusicFolders(musicFolderPaths);

        if (response.success) {
            // 更新全局变量
            localMusicFiles = response.data || [];
            folderMusicGroups = response.folder_groups || [];

            // 如果后端没有返回分组数据，前端进行分组
            if (folderMusicGroups.length === 0 && localMusicFiles.length > 0) {
                folderMusicGroups = groupMusicFilesByFolder(localMusicFiles);
            }

            displayLocalMusicWithFolders();

            // 更新统计信息
            updateLocalStats(response.stats);

            showMessage(response.message, 'success');
        } else {
            showMessage(response.message || '扫描失败', 'error');
        }

    } catch (error) {
        console.error('扫描音乐文件夹失败:', error);
        showMessage('扫描失败: ' + error.message, 'error');
    } finally {
        isScanning = false;
        if (scanBtn) {
            scanBtn.textContent = originalText;
            scanBtn.disabled = false;
        }
    }
}

// 选择音乐文件夹
async function selectMusicFolder() {
    try {
        // 使用HTML5 File API选择文件夹
        if ('showDirectoryPicker' in window) {
            const directoryHandle = await window.showDirectoryPicker();

            console.log('选择的文件夹:', directoryHandle.name);
            showMessage('正在扫描文件夹: ' + directoryHandle.name, 'info');

            // 读取文件夹内容
            const audioFiles = await readDirectoryHandle(directoryHandle);

            if (audioFiles.length > 0) {
                await processLocalAudioFiles(audioFiles, directoryHandle.name);
            } else {
                showMessage('文件夹中没有找到支持的音频文件', 'warning');
            }

        } else {
            // 降级方案：使用传统的文件输入
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.multiple = true;
            input.accept = 'audio/*';

            input.onchange = async (e) => {
                const files = Array.from(e.target.files).filter(file =>
                    isSupportedAudioFile(file.name)
                );

                if (files.length > 0) {
                    await processLocalAudioFiles(files, '选择的音乐');
                } else {
                    showMessage('未找到支持的音频文件', 'warning');
                }
            };

            input.click();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('用户取消了文件夹选择');
        } else {
            console.error('选择文件夹失败:', error);
            showMessage('选择文件夹失败，请重试', 'error');
        }
    }
}

// 读取目录句柄中的文件
async function readDirectoryHandle(directoryHandle) {
    const audioFiles = [];

    try {
        for await (const [name, handle] of directoryHandle.entries()) {
            if (handle.kind === 'file') {
                const file = await handle.getFile();
                if (isSupportedAudioFile(file.name)) {
                    // 添加相对路径信息
                    file.relativePath = name;
                    audioFiles.push(file);
                }
            } else if (handle.kind === 'directory') {
                // 递归读取子目录
                const subFiles = await readDirectoryHandle(handle);
                subFiles.forEach(file => {
                    file.relativePath = `${name}/${file.relativePath}`;
                });
                audioFiles.push(...subFiles);
            }
        }
    } catch (error) {
        console.warn('读取目录失败:', error);
    }

    return audioFiles;
}

// 检查是否为支持的音频文件（保留用于验证）
function isSupportedAudioFile(fileName) {
    const supportedExts = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return supportedExts.includes(ext);
}

// 扫描音乐文件夹（后端API）
async function scanMusicFolder(folderPath) {
    if (isScanning) {
        showMessage('正在扫描中，请稍候...', 'warning');
        return;
    }
    
    if (!folderPath) {
        showMessage('请先选择音乐文件夹', 'warning');
        return;
    }
    
    isScanning = true;
    showLoadingState('正在扫描音乐文件夹...');
    
    try {
        const response = await LocalMusicService.ScanMusicFolder(folderPath);
        
        if (response.success) {
            localMusicFiles = response.data || [];
            folderMusicGroups = response.folder_groups || [];

            // 如果后端没有返回分组数据，前端进行分组
            if (folderMusicGroups.length === 0 && localMusicFiles.length > 0) {
                folderMusicGroups = groupMusicFilesByFolder(localMusicFiles);
            }

            displayLocalMusicWithFolders();
            updateLocalStats(response.stats);
            showMessage(response.message, 'success');
        } else {
            showMessage(response.message || '扫描失败', 'error');
        }
        
    } catch (error) {
        console.error('扫描音乐文件夹失败:', error);
        showMessage('扫描音乐文件夹失败', 'error');
    } finally {
        isScanning = false;
        hideLoadingState();
    }
}

// 加载缓存的音乐文件
async function loadCachedMusicFiles() {
    try {
        const response = await LocalMusicService.GetCachedMusicFiles();
        
        if (response.success) {
            localMusicFiles = response.data || [];
            folderMusicGroups = response.folder_groups || [];

            // 如果后端没有返回分组数据，前端进行分组
            if (folderMusicGroups.length === 0 && localMusicFiles.length > 0) {
                folderMusicGroups = groupMusicFilesByFolder(localMusicFiles);
            }

            displayLocalMusicWithFolders();
            updateLocalStats(response.stats);
            console.log('成功加载缓存的音乐文件:', localMusicFiles.length);
        } else {
            console.log('没有缓存的音乐文件');
            showEmptyState();
        }
        
    } catch (error) {
        console.error('加载缓存音乐文件失败:', error);
        showEmptyState();
    }
}

// 按文件夹分组音乐文件（前端分组函数）
function groupMusicFilesByFolder(musicFiles) {
    const folderMap = new Map();

    // 按文件夹路径分组
    musicFiles.forEach(musicFile => {
        // 获取文件夹路径
        const filePath = musicFile.file_path || musicFile.FilePath;
        const folderPath = filePath.substring(0, filePath.lastIndexOf('/')) || filePath.substring(0, filePath.lastIndexOf('\\'));

        if (!folderMap.has(folderPath)) {
            folderMap.set(folderPath, []);
        }
        folderMap.get(folderPath).push(musicFile);
    });

    // 转换为分组数组
    const groups = [];
    folderMap.forEach((files, folderPath) => {
        const folderName = folderPath.split('/').pop() || folderPath.split('\\').pop() || folderPath;
        const stats = calculateLocalStats(files);

        groups.push({
            folder_path: folderPath,
            folder_name: folderName,
            music_files: files,
            stats: stats
        });
    });

    return groups;
}

// 显示按文件夹分组的音乐列表
function displayLocalMusicWithFolders() {
    const localContent = document.querySelector('#localPage .local-content');
    if (!localContent) return;

    // 同步更新全局变量
    window.localMusicFiles = localMusicFiles;

    // 移除加载状态和空状态
    const existingStates = localContent.querySelectorAll('.local-loading, .local-empty');
    existingStates.forEach(state => state.remove());

    if (folderMusicGroups.length === 0) {
        showEmptyState();
        return;
    }

    // 创建或更新音乐列表
    let musicList = localContent.querySelector('.local-music-list');
    if (!musicList) {
        musicList = createFolderMusicList();
        localContent.appendChild(musicList);
    } else {
        // 更新现有列表
        const musicListContent = musicList.querySelector('.local-music-content');
        if (musicListContent) {
            musicListContent.innerHTML = '';
            folderMusicGroups.forEach(group => {
                const folderSection = createFolderSection(group);
                musicListContent.appendChild(folderSection);
            });
        }
    }
}

// 更新本地音乐显示
function updateLocalMusicDisplay() {
    const localContent = document.querySelector('#localPage .local-content');
    if (!localContent) return;
    
    // 同步更新全局变量
    window.localMusicFiles = localMusicFiles;
    
    // 移除加载状态和空状态
    const existingStates = localContent.querySelectorAll('.local-loading, .local-empty');
    existingStates.forEach(state => state.remove());
    
    if (localMusicFiles.length === 0) {
        showEmptyState();
        return;
    }
    
    // 创建或更新音乐列表
    let musicList = localContent.querySelector('.local-music-list');
    if (!musicList) {
        musicList = createMusicList();
        localContent.appendChild(musicList);
    }
    
    // 更新音乐列表内容
    const musicListContent = musicList.querySelector('.local-music-content');
    if (musicListContent) {
        musicListContent.innerHTML = '';
        
        localMusicFiles.forEach((musicFile, index) => {
            const songItem = createSongItem(musicFile, index);
            musicListContent.appendChild(songItem);
        });
    }
}

// 创建文件夹分组音乐列表
function createFolderMusicList() {
    const musicList = document.createElement('div');
    musicList.className = 'local-music-list folder-grouped';
    musicList.innerHTML = `
        <div class="local-music-content"></div>
    `;

    // 添加文件夹分组内容
    const musicListContent = musicList.querySelector('.local-music-content');
    folderMusicGroups.forEach(group => {
        const folderSection = createFolderSection(group);
        musicListContent.appendChild(folderSection);
    });

    return musicList;
}

// 创建文件夹分组区域
function createFolderSection(group) {
    const folderSection = document.createElement('div');
    folderSection.className = 'folder-section';
    folderSection.dataset.folderPath = group.folder_path;

    const isExpanded = expandedFolders.has(group.folder_path);

    folderSection.innerHTML = `
        <div class="folder-header" onclick="toggleFolder('${escapeHtml(group.folder_path)}')">
            <div class="folder-toggle">
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
            </div>
            <div class="folder-icon">
                <i class="fas fa-folder${isExpanded ? '-open' : ''}"></i>
            </div>
            <div class="folder-info">
                <div class="folder-name" title="${escapeHtml(group.folder_path)}">${escapeHtml(group.folder_name)}</div>
                <div class="folder-stats">${group.music_files.length} 首歌曲</div>
            </div>
            <div class="folder-actions">
                <button class="folder-action-btn" onclick="event.stopPropagation(); playFolderMusic('${escapeHtml(group.folder_path)}')" title="播放此文件夹">
                    <i class="fas fa-play"></i>
                </button>
                <button class="folder-action-btn" onclick="event.stopPropagation(); scanSingleFolder('${escapeHtml(group.folder_path)}')" title="重新扫描">
                    <i class="fas fa-sync"></i>
                </button>
            </div>
        </div>
        <div class="folder-content ${isExpanded ? 'expanded' : 'collapsed'}">
            <div class="folder-music-header">
                <div>#</div>
                <div></div>
                <div>歌曲</div>
                <div>专辑</div>
                <div>时长</div>
                <div>操作</div>
            </div>
            <div class="folder-music-list">
                ${group.music_files.map((musicFile, index) => createFolderSongItemHTML(musicFile, index, group.folder_path)).join('')}
            </div>
        </div>
    `;

    return folderSection;
}

// 创建文件夹内歌曲项的HTML
function createFolderSongItemHTML(musicFile, index, folderPath) {
    // 计算全局索引
    const globalIndex = getGlobalSongIndex(musicFile, folderPath);
    const duration = formatDuration(musicFile.time_length || musicFile.Duration);

    return `
        <div class="local-song-item folder-song-item" data-index="${globalIndex}" data-folder="${escapeHtml(folderPath)}">
            <div class="song-index small">${index + 1}</div>
            <div class="local-song-cover">
                ${musicFile.union_cover || musicFile.UnionCover ?
                    `<img src="${musicFile.union_cover || musicFile.UnionCover}" alt="封面" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                     <div class="default-cover" style="display:none;"><i class="fas fa-music"></i></div>` :
                    `<div class="default-cover"><i class="fas fa-music"></i></div>`
                }
            </div>
            <div class="local-song-info">
                <div class="local-songname" title="${escapeHtml(musicFile.title || musicFile.Title)}">${escapeHtml(musicFile.title || musicFile.Title)}</div>
                <div class="local-author_name" title="${escapeHtml(musicFile.artist || musicFile.Artist || musicFile.author_name || '未知艺术家')}">${escapeHtml(musicFile.artist || musicFile.Artist || musicFile.author_name || '未知艺术家')}</div>
            </div>
            <div class="local-song-album" title="${escapeHtml(musicFile.album_name || musicFile.Album || '未知专辑')}">${escapeHtml(musicFile.album_name || musicFile.Album || '未知专辑')}</div>
            <div class="local-song-duration">${duration}</div>
            <div class="local-song-actions">
                <button class="local-action-btn" title="播放" onclick="playLocalSong(${globalIndex})">
                    <i class="fas fa-play"></i>
                </button>
                <button class="local-action-btn" title="歌词" onclick="showLocalSongLyrics(${globalIndex})">
                    <i class="fas fa-file-text"></i>
                </button>
            </div>
        </div>
    `;
}

// 创建音乐列表（保持兼容性）
function createMusicList() {
    const musicList = document.createElement('div');
    musicList.className = 'local-music-list';
    musicList.innerHTML = `
        <div class="local-music-header">
            <div>#</div>
            <div></div>
            <div>歌曲</div>
            <div>专辑</div>
            <div>时长</div>
            <div>操作</div>
        </div>
        <div class="local-music-content"></div>
    `;
    return musicList;
}

// 创建歌曲项
function createSongItem(musicFile, index) {
    const songItem = document.createElement('div');
    songItem.className = 'local-song-item';
    songItem.dataset.index = index;
    
    // 格式化时长
    const duration = formatDuration(musicFile.time_length);
    
    songItem.innerHTML = `
        <div class="song-index small">${index + 1}</div>
        <div class="local-song-cover">
            ${musicFile.union_cover ?
                `<img src="${musicFile.union_cover}" alt="封面" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <div class="default-cover" style="display:none;"><i class="fas fa-music"></i></div>` :
                `<div class="default-cover"><i class="fas fa-music"></i></div>`
            }
        </div>
        <div class="local-song-info">
            <div class="local-songname" title="${musicFile.title}">${musicFile.title}</div>
            <div class="local-author_name" title="${musicFile.artist || musicFile.author_name || '未知艺术家'}">${musicFile.artist || musicFile.author_name || '未知艺术家'}</div>
        </div>
        <div class="local-song-album" title="${musicFile.album_name || musicFile.album || '未知专辑'}">${musicFile.album_name || musicFile.album || '未知专辑'}</div>
        <div class="local-song-duration">${duration}</div>
        <div class="local-song-actions">
            <button class="local-action-btn" title="播放" onclick="playLocalSong(${index})">
                <i class="fas fa-play"></i>
            </button>
            <button class="local-action-btn" title="歌词" onclick="showLocalSongLyrics(${index})">
                <i class="fas fa-file-text"></i>
            </button>
            <button class="local-action-btn" title="收藏">
                <i class="fas fa-heart"></i>
            </button>
            <button class="local-action-btn" title="更多">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
    `;

    // 绑定点击事件
    songItem.addEventListener('click', (e) => {
        if (!e.target.closest('.local-song-actions')) {
            playLocalSong(index);
        }
    });

    return songItem;
}

// 播放本地歌曲
window.playLocalSong = async function(index) {
    if (index < 0 || index >= localMusicFiles.length) {
        console.error('无效的歌曲索引:', index);
        return;
    }

    const musicFile = localMusicFiles[index];
    console.log('播放本地歌曲:', musicFile);

    try {
        // 更新当前播放歌曲
        currentLocalSong = musicFile;

        // 更新播放状态显示
        updatePlayingState(index);

        // 创建音频URL
        let audioUrl = '';
        if (musicFile._fileObject) {
            // 如果有文件对象，使用 createObjectURL
            audioUrl = URL.createObjectURL(musicFile._fileObject);
        } else {
            // 通过后端API获取本地音频缓存URL
            try {
                const response = await LocalMusicService.GetLocalAudioURL(musicFile.file_path);
                if (response.success && response.data) {
                    audioUrl = response.data;
                    console.log('获取本地音频缓存URL成功:', audioUrl);
                } else {
                    throw new Error(response.message || '获取本地音频URL失败');
                }
            } catch (error) {
                console.error('获取本地音频URL失败:', error);
                showMessage('获取本地音频URL失败: ' + error.message, 'error');
                return;
            }
        }

        // 使用文件的真实 hash 作为本地音乐的标识
        const localHash = 'local-' + musicFile.hash;
        const localSong = {
            hash: localHash,
            songname: musicFile.title,
            author_name: musicFile.artist,
            album_name: musicFile.album_name,
            time_length: musicFile.time_length,
            union_cover: musicFile.union_cover || ''
        };

        console.log('🎵 准备播放本地歌曲:', localSong);
        console.log('🎵 使用文件hash:', musicFile.hash);
        console.log('🎵 音频URL:', audioUrl);

        // 注意：本地音乐映射现在在扫描时自动生成，无需在播放时注册
        console.log('🎵 使用预生成的本地音乐映射:', localHash);

        // 使用 PlayerController 统一播放管理（包括播放列表管理）
        if (window.PlayerController) {
            try {
                const success = await window.PlayerController.playSong(localSong);
                if (success) {
                    console.log('✅ 本地音乐播放成功');
                } else {
                    console.error('❌ 本地音乐播放失败');
                    showMessage('播放失败', 'error');
                    return;
                }
            } catch (error) {
                console.error('❌ 本地音乐播放失败:', error);
                showMessage('播放失败: ' + error.message, 'error');
                return;
            }
        } else {
            console.error('❌ PlayerController不可用');
            showMessage('PlayerController不可用', 'error');
            return;
        }

        showMessage(`正在播放: ${musicFile.title}`, 'success');

    } catch (error) {
        console.error('播放本地歌曲失败:', error);
        showMessage('播放失败', 'error');
    }
};

// 更新播放状态显示
function updatePlayingState(playingIndex) {
    const songItems = document.querySelectorAll('.local-song-item');
    songItems.forEach((item, index) => {
        if (index === playingIndex) {
            item.classList.add('playing');
        } else {
            item.classList.remove('playing');
        }
    });
}

// 更新统计信息
function updateLocalStats(stats) {
    if (!stats) {
        // 如果没有提供统计信息，自己计算
        stats = calculateLocalStats(localMusicFiles);
    }
    
    // 更新统计卡片
    const statCards = document.querySelectorAll('#localPage .local-stat-card');
    if (statCards.length >= 3) {
        statCards[0].querySelector('.local-stat-number').textContent = stats.total_songs || 0;
        statCards[1].querySelector('.local-stat-number').textContent = stats.total_author_names || 0;
        statCards[2].querySelector('.local-stat-number').textContent = stats.total_albums || 0;
    }
}

// 显示加载状态
function showLoadingState(message = '正在加载...') {
    const localContent = document.querySelector('#localPage .local-content');
    if (!localContent) return;
    
    // 移除现有状态
    const existingStates = localContent.querySelectorAll('.local-loading, .local-empty, .local-music-list');
    existingStates.forEach(state => state.remove());
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'local-loading';
    loadingDiv.innerHTML = `
        <div class="local-loading-spinner"></div>
        <div class="local-loading-text">${message}</div>
        <div class="local-loading-hint">请稍候...</div>
    `;
    
    localContent.appendChild(loadingDiv);
}

// 隐藏加载状态
function hideLoadingState() {
    const loadingStates = document.querySelectorAll('.local-loading');
    loadingStates.forEach(state => state.remove());
}

// 显示空状态
function showEmptyState() {
    const localContent = document.querySelector('#localPage .local-content');
    if (!localContent) return;
    
    // 移除现有状态
    const existingStates = localContent.querySelectorAll('.local-loading, .local-empty, .local-music-list');
    existingStates.forEach(state => state.remove());
    
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'local-empty';
    emptyDiv.innerHTML = `
        <div class="local-empty-icon">
            <i class="fas fa-music"></i>
        </div>
        <div class="local-empty-title">暂无本地音乐</div>
        <div class="local-empty-text">
            点击上方"选择文件夹"按钮或拖拽音乐文件夹到这里<br>
            开始享受您的本地音乐收藏
        </div>
    `;
    
    localContent.appendChild(emptyDiv);
}

// 格式化时长
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '--:--';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 显示消息
function showMessage(message, type = 'info') {
    // 这里可以集成到全局的消息系统
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // 简单的消息显示（可以后续改进）
    if (window.showToast) {
        window.showToast(message, type);
    }
}

// 播放全部本地音乐
async function playAllLocalMusic() {
    console.log('🎵 播放全部本地音乐');
    
    if (!localMusicFiles || localMusicFiles.length === 0) {
        showMessage('暂无本地音乐文件，请先添加音乐文件夹', 'warning');
        return;
    }
    
    try {
        // 转换本地音乐文件格式为播放器期望的格式
        const playlistSongs = localMusicFiles.map(musicFile => {
            // 使用文件的真实 hash 作为本地音乐的标识
            const localHash = 'local-' + (musicFile.hash || musicFile.file_path || musicFile.filename);
            
            return {
                hash: localHash,
                songname: musicFile.title || musicFile.songname || musicFile.filename,
                filename: musicFile.filename || '',
                author_name: musicFile.artist || musicFile.author_name || '未知艺术家',
                album_name: musicFile.album_name || musicFile.album || '未知专辑',
                album_id: musicFile.album_id || '',
                time_length: parseInt(musicFile.time_length || musicFile.duration || 0),
                union_cover: musicFile.union_cover || ''
            };
        });
        
        console.log('🎵 转换后的播放列表:', playlistSongs);
        console.log('🎵 第一首歌曲示例:', playlistSongs[0]);
        
        // 使用播放控制器播放整个本地音乐列表
        if (window.PlayerController && window.PlayerController.playPlaylist) {
            console.log('🎵 开始播放本地音乐列表，共', playlistSongs.length, '首');
            const success = await window.PlayerController.playPlaylist(
                playlistSongs, 
                0, 
                '本地音乐', 
                'repeat_all'
            );
            
            if (success) {
                showMessage(`开始播放本地音乐，共 ${playlistSongs.length} 首`, 'success');
            } else {
                showMessage('播放失败，请重试', 'error');
            }
        } else {
            console.error('❌ PlayerController 不可用');
            showMessage('播放器未初始化，请刷新页面重试', 'error');
        }
    } catch (error) {
        console.error('❌ 播放全部本地音乐失败:', error);
        showMessage('播放失败：' + error.message, 'error');
    }
}

// 显示本地歌曲歌词
window.showLocalSongLyrics = async function(index) {
    if (index < 0 || index >= localMusicFiles.length) {
        console.error('无效的歌曲索引:', index);
        return;
    }

    const musicFile = localMusicFiles[index];
    console.log('显示歌词:', musicFile);

    try {
        // 如果音乐文件对象中已经有歌词，直接显示
        if (musicFile.lyrics && musicFile.lyrics.trim() !== '') {
            showLyricsModal(musicFile.title, musicFile.artist, musicFile.lyrics);
            return;
        }

        // 否则从后端API获取歌词
        showMessage('正在获取歌词...', 'info');
        
        const response = await LocalMusicService.GetLocalMusicLyrics(musicFile.file_path);
        
        if (response.success && response.data) {
            // 缓存歌词到本地对象
            musicFile.lyrics = response.data;
            showLyricsModal(musicFile.title, musicFile.artist, response.data);
        } else {
            showMessage(response.message || '该歌曲没有歌词信息', 'warning');
        }
        
    } catch (error) {
        console.error('获取歌词失败:', error);
        showMessage('获取歌词失败: ' + error.message, 'error');
    }
};

// 显示歌词弹窗
function showLyricsModal(title, artist, lyrics) {
    // 创建歌词弹窗
    const modal = document.createElement('div');
    modal.className = 'lyrics-modal-overlay';
    modal.innerHTML = `
        <div class="lyrics-modal">
            <div class="lyrics-modal-header">
                <div class="lyrics-song-info">
                    <h3 class="lyrics-song-title">${title}</h3>
                    <p class="lyrics-song-artist">${artist}</p>
                </div>
                <button class="lyrics-modal-close" onclick="closeLyricsModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="lyrics-modal-content">
                <div class="lyrics-text">${formatLyricsForDisplay(lyrics)}</div>
            </div>
        </div>
    `;

    // 添加到页面
    document.body.appendChild(modal);
    
    // 添加点击外部关闭功能
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeLyricsModal();
        }
    });

    // 添加ESC键关闭功能
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeLyricsModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// 关闭歌词弹窗
window.closeLyricsModal = function() {
    const modal = document.querySelector('.lyrics-modal-overlay');
    if (modal) {
        modal.remove();
    }
};

// 格式化歌词显示
function formatLyricsForDisplay(lyrics) {
    if (!lyrics) return '<p class="no-lyrics">聆听音乐</p>';
    
    // 将换行符转换为HTML换行
    const formattedLyrics = lyrics
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '') // 移除空行
        .map(line => `<p class="lyrics-line">${escapeHtml(line)}</p>`)
        .join('');
    
    return formattedLyrics || '<p class="no-lyrics">聆听音乐</p>';
}

// 获取歌曲的全局索引
function getGlobalSongIndex(musicFile, folderPath) {
    return localMusicFiles.findIndex(file => {
        const filePath1 = file.file_path || file.FilePath;
        const filePath2 = musicFile.file_path || musicFile.FilePath;
        return filePath1 === filePath2;
    });
}

// 切换文件夹展开/收缩状态
window.toggleFolder = function(folderPath) {
    const folderSection = document.querySelector(`[data-folder-path="${CSS.escape(folderPath)}"]`);
    if (!folderSection) return;

    const folderContent = folderSection.querySelector('.folder-content');
    const toggleIcon = folderSection.querySelector('.folder-toggle i');
    const folderIcon = folderSection.querySelector('.folder-icon i');

    if (expandedFolders.has(folderPath)) {
        // 收缩文件夹
        expandedFolders.delete(folderPath);
        folderContent.classList.remove('expanded');
        folderContent.classList.add('collapsed');
        toggleIcon.className = 'fas fa-chevron-right';
        folderIcon.className = 'fas fa-folder';
    } else {
        // 展开文件夹
        expandedFolders.add(folderPath);
        folderContent.classList.remove('collapsed');
        folderContent.classList.add('expanded');
        toggleIcon.className = 'fas fa-chevron-down';
        folderIcon.className = 'fas fa-folder-open';
    }
};

// 播放文件夹内的所有音乐
window.playFolderMusic = async function(folderPath) {
    const group = folderMusicGroups.find(g => g.folder_path === folderPath);
    if (!group || group.music_files.length === 0) {
        showMessage('该文件夹没有音乐文件', 'warning');
        return;
    }

    console.log(`🎵 准备播放文件夹: ${group.folder_name}，包含 ${group.music_files.length} 首歌曲`);

    try {
        // 将文件夹中的所有音乐文件转换为播放列表格式
        const playlistSongs = group.music_files.map(musicFile => {
            const localHash = 'local-' + musicFile.hash;
            return {
                hash: localHash,
                songname: musicFile.title || musicFile.Title,
                author_name: musicFile.artist || musicFile.Artist || musicFile.author_name || '未知艺术家',
                album_name: musicFile.album_name || musicFile.Album || '未知专辑',
                time_length: musicFile.time_length || musicFile.Duration || 0,
                union_cover: musicFile.union_cover || musicFile.UnionCover || ''
            };
        });

        console.log(`🎵 转换后的播放列表:`, playlistSongs);

        // 使用 PlayerController 播放整个文件夹的歌单
        if (window.PlayerController && window.PlayerController.playPlaylist) {
            const success = await window.PlayerController.playPlaylist(
                playlistSongs,
                0, // 从第一首开始播放
                `文件夹: ${group.folder_name}`, // 播放列表名称
                'repeat_all' // 列表循环播放
            );

            if (success) {
                showMessage(`开始播放文件夹: ${group.folder_name} (${group.music_files.length} 首歌曲)`, 'success');
                console.log(`✅ 成功播放文件夹: ${group.folder_name}`);
            } else {
                showMessage('播放文件夹失败', 'error');
                console.error(`❌ 播放文件夹失败: ${group.folder_name}`);
            }
        } else {
            console.error('❌ PlayerController不可用或缺少playPlaylist方法');
            showMessage('播放器不可用', 'error');
        }
    } catch (error) {
        console.error('❌ 播放文件夹音乐失败:', error);
        showMessage('播放文件夹失败: ' + error.message, 'error');
    }
};

// 切换文件夹路径管理器展开/收起状态
window.togglePathManager = function() {
    const pathManager = document.querySelector('.folder-path-manager');
    if (!pathManager) return;

    const pathList = pathManager.querySelector('.path-list');
    const toggleIcon = pathManager.querySelector('.path-manager-toggle i');
    const managerIcon = pathManager.querySelector('.path-manager-icon i');

    if (isPathListExpanded) {
        // 收起路径列表
        isPathListExpanded = false;
        pathList.classList.remove('expanded');
        pathList.classList.add('collapsed');
        toggleIcon.className = 'fas fa-chevron-right';
        managerIcon.className = 'fas fa-folder';
    } else {
        // 展开路径列表
        isPathListExpanded = true;
        pathList.classList.remove('collapsed');
        pathList.classList.add('expanded');
        toggleIcon.className = 'fas fa-chevron-down';
        managerIcon.className = 'fas fa-folder-open';
    }

    // 保存展开状态
    try {
        localStorage.setItem('isPathListExpanded', JSON.stringify(isPathListExpanded));
    } catch (error) {
        console.warn('保存路径列表展开状态失败:', error);
    }
};



// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 暴露播放全部函数到全局作用域，供HTML调用
window.playAllLocalMusic = playAllLocalMusic;

// 暴露本地音乐文件列表到全局作用域，供歌词获取使用
window.localMusicFiles = localMusicFiles;

// 刷新本地音乐页面
window.refreshLocalPage = async () => {
    console.log('🔄 刷新本地音乐页面');
    await loadCachedMusicFiles();
};

// 导出功能函数
export {
    initLocalMusic,
    selectMusicFolder,
    scanMusicFolder,
    loadCachedMusicFiles,
    playAllLocalMusic
};
