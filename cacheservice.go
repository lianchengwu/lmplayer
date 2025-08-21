package main

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CacheService 音频缓存服务（包含OSD歌词功能）
type CacheService struct {
	server        *http.Server
	cacheDir      string
	mp3Dir        string
	serverPort    string
	localMusicMap map[string]string // 本地音乐hash到文件路径的映射
	localMapFile  string            // 本地音乐映射文件路径
	// OSD歌词相关字段
	osdClients sync.Map // 使用 sync.Map 管理客户端: *http.Request -> chan LyricsMessage
	// OSD歌词进程管理
	osdProcess      *exec.Cmd
	osdProcessMutex sync.RWMutex
}

// CacheResponse 缓存服务响应
type CacheResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    string `json:"data,omitempty"`
}

// OSDLyricsResponse OSD歌词响应结构
type OSDLyricsResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// LyricsMessage SSE消息结构
type LyricsMessage struct {
	Type     string `json:"type"`
	Text     string `json:"text"` // 原始文本或KRC JSON数据
	SongName string `json:"songName"`
	Artist   string `json:"artist"`
	Format   string `json:"format,omitempty"` // 歌词格式：lrc, krc
}

// NewCacheService 创建新的缓存服务实例
func NewCacheService() *CacheService {
	homeDir, _ := os.UserHomeDir()
	cacheDir := filepath.Join(homeDir, ".cache", "gomusic")
	mp3Dir := filepath.Join(cacheDir, "cache", "mp3")
	localMapFile := filepath.Join(cacheDir, "cache", "local_music_map.json")

	service := &CacheService{
		cacheDir:      cacheDir,
		mp3Dir:        mp3Dir,
		serverPort:    "18911", // 本地HTTP服务端口
		localMusicMap: make(map[string]string),
		localMapFile:  localMapFile,
		// osdClients 使用 sync.Map，无需初始化
	}

	// 启动时加载已有的本地音乐映射
	service.loadLocalMusicMap()

	return service
}

// StartHTTPServer 启动本地HTTP文件服务器
func (c *CacheService) StartHTTPServer() error {
	return c.StartHTTPServerWithOSDLyrics()
}

// StartHTTPServerWithO0SDLyrics 启动本地HTTP文件服务器并支持OSD歌词SSE
func (c *CacheService) StartHTTPServerWithOSDLyrics() error {
	// 确保缓存目录存在
	if err := c.ensureCacheDir(); err != nil {
		return fmt.Errorf("创建缓存目录失败: %v", err)
	}

	// 如果服务器已经在运行，先停止它
	if c.server != nil {
		c.StopHTTPServer()
	}

	// 创建自定义的文件服务器处理器，添加调试信息
	fileServer := http.FileServer(http.Dir(c.cacheDir))

	// 包装文件服务器，添加日志和错误处理
	wrappedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("🎵 HTTP请求: %s %s\n", r.Method, r.URL.Path)

		// 检查文件是否存在
		filePath := filepath.Join(c.cacheDir, r.URL.Path)
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			fmt.Printf("❌ 文件不存在: %s\n", filePath)
			http.NotFound(w, r)
			return
		}

		// 设置CORS头
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Range")

		// 处理OPTIONS请求
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		fmt.Printf("✅ 提供文件: %s\n", filePath)
		fileServer.ServeHTTP(w, r)
	})

	// 设置路由
	mux := http.NewServeMux()
	mux.Handle("/", wrappedHandler)

	// 如果提供了OSD歌词服务，添加SSE端点
	mux.HandleFunc("/api/osd-lyrics/sse", func(w http.ResponseWriter, r *http.Request) {
		c.handleOSDLyricsSSE(w, r)
	})
	fmt.Printf("✅ OSD歌词SSE端点已注册: /api/osd-lyrics/sse\n")

	// 创建HTTP服务器
	c.server = &http.Server{
		Addr:    ":" + c.serverPort,
		Handler: mux,
	}

	// 在goroutine中启动服务器
	go func() {
		fmt.Printf("🎵 本地HTTP缓存服务器启动在端口 %s\n", c.serverPort)
		fmt.Printf("🎵 缓存根目录: %s\n", c.cacheDir)
		if err := c.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("❌ HTTP服务器启动失败: %v\n", err)
		}
	}()

	// 等待一下确保服务器启动
	time.Sleep(100 * time.Millisecond)
	return nil
}

// StopHTTPServer 停止HTTP服务器
func (c *CacheService) StopHTTPServer() error {
	if c.server != nil {
		// 先关闭所有OSD客户端连接，避免SSE长连接阻塞
		c.closeAllOSDClients()

		// 减少超时时间到2秒，因为我们已经主动关闭了长连接
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		log.Printf("🔴 正在停止HTTP服务器...")
		err := c.server.Shutdown(ctx)
		if err != nil {
			log.Printf("⚠️ HTTP服务器优雅关闭超时，强制关闭")
			// 如果优雅关闭失败，强制关闭
			c.server.Close()
		}
		c.server = nil
		return err
	}
	return nil
}

// ensureCacheDir 确保缓存目录存在
func (c *CacheService) ensureCacheDir() error {
	// 创建主缓存目录
	if err := os.MkdirAll(c.cacheDir, 0755); err != nil {
		return err
	}

	// 创建MP3缓存目录
	if err := os.MkdirAll(c.mp3Dir, 0755); err != nil {
		return err
	}

	fmt.Printf("✅ 缓存目录已创建: %s\n", c.cacheDir)
	fmt.Printf("✅ MP3缓存目录已创建: %s\n", c.mp3Dir)
	return nil
}

// generateFileHash 生成文件hash名称
func (c *CacheService) generateFileHash(songHash string) string {
	h := md5.New()
	h.Write([]byte(songHash))
	return fmt.Sprintf("%x", h.Sum(nil))
}

// getCachedFilePath 获取缓存文件路径
func (c *CacheService) getCachedFilePath(songHash string) string {
	fileHash := c.generateFileHash(songHash)
	return filepath.Join(c.mp3Dir, fileHash+".mp3")
}

// isCached 检查文件是否已缓存
func (c *CacheService) isCached(songHash string) bool {
	// 需要判断一下
	filePath := c.getCachedFilePath(songHash)
	_, err := os.Stat(filePath)
	return err == nil
}

// getLocalURL 获取本地缓存文件的URL
func (c *CacheService) getLocalURL(songHash string) string {
	fileHash := c.generateFileHash(songHash)
	return fmt.Sprintf("http://127.0.0.1:%s/cache/mp3/%s.mp3", c.serverPort, fileHash)
}

// downloadAndCache 下载并缓存音频文件
func (c *CacheService) downloadAndCache(songHash string, urls []string) (string, error) {
	// 检查是否已缓存
	if c.isCached(songHash) {
		fmt.Printf("✅ 文件已缓存: %s\n", songHash)
		return c.getLocalURL(songHash), nil
	}

	// 确保缓存目录存在
	if err := c.ensureCacheDir(); err != nil {
		return "", err
	}

	filePath := c.getCachedFilePath(songHash)

	// 尝试从多个URL下载
	for i, url := range urls {
		if url == "" {
			continue
		}

		fmt.Printf("🎵 尝试下载音频文件 (%d/%d): %s\n", i+1, len(urls), url)

		if err := c.downloadFile(url, filePath); err != nil {
			fmt.Printf("⚠️ 下载失败 (%d/%d): %v\n", i+1, len(urls), err)
			continue
		}

		// 下载成功
		fmt.Printf("✅ 音频文件下载成功: %s\n", filePath)
		return c.getLocalURL(songHash), nil
	}

	return "", fmt.Errorf("所有URL下载失败")
}

// downloadFile 下载单个文件
func (c *CacheService) downloadFile(url, filePath string) error {
	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 创建请求
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	// 设置请求头
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "audio/mpeg,audio/*,*/*")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")

	// 发送请求
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP状态码: %d", resp.StatusCode)
	}

	// 创建临时文件
	tempFile := filePath + ".tmp"
	out, err := os.Create(tempFile)
	if err != nil {
		return err
	}
	defer out.Close()

	// 复制数据
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		os.Remove(tempFile)
		return err
	}

	// 重命名临时文件为最终文件
	return os.Rename(tempFile, filePath)
}

// CacheAudioFile 缓存音频文件（供前端调用）
func (c *CacheService) CacheAudioFile(songHash string, urls []string) CacheResponse {
	if songHash == "" {
		return CacheResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	if len(urls) == 0 {
		return CacheResponse{
			Success: false,
			Message: "播放地址列表不能为空",
		}
	}

	// 过滤空URL
	validUrls := make([]string, 0, len(urls))
	for _, url := range urls {
		if strings.TrimSpace(url) != "" {
			validUrls = append(validUrls, strings.TrimSpace(url))
		}
	}

	if len(validUrls) == 0 {
		return CacheResponse{
			Success: false,
			Message: "没有有效的播放地址",
		}
	}

	// 下载并缓存
	localURL, err := c.downloadAndCache(songHash, validUrls)
	if err != nil {
		return CacheResponse{
			Success: false,
			Message: fmt.Sprintf("缓存失败: %v", err),
		}
	}

	return CacheResponse{
		Success: true,
		Message: "缓存成功",
		Data:    localURL,
	}
}

// GetCachedURL 获取缓存的本地URL
func (c *CacheService) GetCachedURL(songHash string) CacheResponse {
	if songHash == "" {
		return CacheResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	// 检查是否是本地音乐hash（以"local-"开头）
	if strings.HasPrefix(songHash, "local-") {
		return c.getLocalMusicURL(songHash)
	}

	// 在线音乐的缓存检查
	if c.isCached(songHash) {
		return CacheResponse{
			Success: true,
			Message: "文件已缓存",
			Data:    c.getLocalURL(songHash),
		}
	}

	return CacheResponse{
		Success: false,
		Message: "文件未缓存",
	}
}

// RegisterLocalMusic 注册本地音乐hash到文件路径的映射（供前端调用）
func (c *CacheService) RegisterLocalMusic(localHash, filePath string) CacheResponse {
	if localHash == "" || filePath == "" {
		return CacheResponse{
			Success: false,
			Message: "参数不能为空",
		}
	}

	if c.localMusicMap == nil {
		c.localMusicMap = make(map[string]string)
	}

	c.localMusicMap[localHash] = filePath
	fmt.Printf("🎵 注册本地音乐映射: %s -> %s\n", localHash, filePath)

	// 保存映射到文件
	if err := c.saveLocalMusicMap(); err != nil {
		fmt.Printf("⚠️ 保存本地音乐映射失败: %v\n", err)
	}

	return CacheResponse{
		Success: true,
		Message: "本地音乐映射注册成功",
	}
}

// getLocalMusicURL 获取本地音乐的缓存URL
func (c *CacheService) getLocalMusicURL(localHash string) CacheResponse {
	// 从映射中查找文件路径
	filePath, exists := c.localMusicMap[localHash]
	if !exists {
		return CacheResponse{
			Success: false,
			Message: "本地音乐映射不存在",
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return CacheResponse{
			Success: false,
			Message: "本地音乐文件不存在",
		}
	}

	// 计算文件hash作为缓存key
	fileHash := c.generateLocalFileHash(filePath)
	if fileHash == "" {
		return CacheResponse{
			Success: false,
			Message: "计算文件hash失败",
		}
	}

	// 获取文件扩展名
	ext := strings.ToLower(filepath.Ext(filePath))

	// 创建缓存文件路径
	cachedFileName := fileHash + ext
	cachedFilePath := filepath.Join(c.mp3Dir, cachedFileName)

	// 检查是否已经缓存
	if _, err := os.Stat(cachedFilePath); os.IsNotExist(err) {
		// 文件未缓存，复制到缓存目录
		if err := c.copyLocalFileToCache(filePath, cachedFilePath); err != nil {
			return CacheResponse{
				Success: false,
				Message: fmt.Sprintf("复制本地文件到缓存失败: %v", err),
			}
		}
		fmt.Printf("✅ 本地音乐文件已缓存: %s -> %s\n", filePath, cachedFilePath)
	}

	// 生成本地HTTP URL
	localURL := fmt.Sprintf("http://127.0.0.1:%s/cache/mp3/%s", c.serverPort, cachedFileName)

	return CacheResponse{
		Success: true,
		Message: "获取本地音乐URL成功",
		Data:    localURL,
	}
}

// generateLocalFileHash 生成本地文件hash
func (c *CacheService) generateLocalFileHash(filePath string) string {
	file, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer file.Close()

	hash := md5.New()
	if _, err := io.Copy(hash, file); err != nil {
		return ""
	}

	return fmt.Sprintf("%x", hash.Sum(nil))
}

// copyLocalFileToCache 复制本地文件到缓存目录
func (c *CacheService) copyLocalFileToCache(srcPath, dstPath string) error {
	// 确保缓存目录存在
	if err := c.ensureCacheDir(); err != nil {
		return err
	}

	// 打开源文件
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("打开源文件失败: %v", err)
	}
	defer srcFile.Close()

	// 创建目标文件
	dstFile, err := os.Create(dstPath)
	if err != nil {
		return fmt.Errorf("创建目标文件失败: %v", err)
	}
	defer dstFile.Close()

	// 复制文件内容
	_, err = io.Copy(dstFile, srcFile)
	if err != nil {
		return fmt.Errorf("复制文件内容失败: %v", err)
	}

	return nil
}

// loadLocalMusicMap 从文件加载本地音乐映射
func (c *CacheService) loadLocalMusicMap() {
	if _, err := os.Stat(c.localMapFile); os.IsNotExist(err) {
		fmt.Printf("🎵 本地音乐映射文件不存在，创建新的映射: %s\n", c.localMapFile)
		return
	}

	data, err := os.ReadFile(c.localMapFile)
	if err != nil {
		fmt.Printf("⚠️ 读取本地音乐映射文件失败: %v\n", err)
		return
	}

	if len(data) == 0 {
		fmt.Printf("🎵 本地音乐映射文件为空\n")
		return
	}

	var loadedMap map[string]string
	if err := json.Unmarshal(data, &loadedMap); err != nil {
		fmt.Printf("⚠️ 解析本地音乐映射文件失败: %v\n", err)
		return
	}

	if c.localMusicMap == nil {
		c.localMusicMap = make(map[string]string)
	}

	// 验证文件是否仍然存在，清理无效映射
	validCount := 0
	for hash, filePath := range loadedMap {
		if _, err := os.Stat(filePath); err == nil {
			c.localMusicMap[hash] = filePath
			validCount++
		} else {
			fmt.Printf("🗑️ 清理无效的本地音乐映射: %s -> %s (文件不存在)\n", hash, filePath)
		}
	}

	fmt.Printf("✅ 加载本地音乐映射成功: %d 个有效映射\n", validCount)

	// 如果有无效映射被清理，保存更新后的映射
	if validCount != len(loadedMap) {
		if err := c.saveLocalMusicMap(); err != nil {
			fmt.Printf("⚠️ 保存清理后的本地音乐映射失败: %v\n", err)
		}
	}
}

// saveLocalMusicMap 保存本地音乐映射到文件
func (c *CacheService) saveLocalMusicMap() error {
	// 确保缓存目录存在
	if err := c.ensureCacheDir(); err != nil {
		return fmt.Errorf("创建缓存目录失败: %v", err)
	}

	data, err := json.MarshalIndent(c.localMusicMap, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化本地音乐映射失败: %v", err)
	}

	if err := os.WriteFile(c.localMapFile, data, 0644); err != nil {
		return fmt.Errorf("写入本地音乐映射文件失败: %v", err)
	}

	fmt.Printf("💾 本地音乐映射已保存: %s (%d 个映射)\n", c.localMapFile, len(c.localMusicMap))
	return nil
}

// handleOSDLyricsSSE 处理OSD歌词SSE连接
func (c *CacheService) handleOSDLyricsSSE(w http.ResponseWriter, r *http.Request) {
	fmt.Printf("🔗 [OSD歌词] 新的SSE连接来自: %s\n", r.RemoteAddr)

	// 设置SSE头部
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 创建消息通道
	msgChan := make(chan LyricsMessage, 10)

	// 添加客户端到管理列表（以 HTTP 请求为 key，通道为 value）
	c.addOSDClient(r, msgChan)

	// 发送连接确认
	fmt.Fprintf(w, "data: %s\n\n", `{"type":"connected","message":"OSD歌词SSE连接成功"}`)
	w.(http.Flusher).Flush()

	// 监听客户端断开连接
	ctx := r.Context()
	defer func() {
		fmt.Printf("🔌 [OSD歌词] 客户端断开连接: %s\n", r.RemoteAddr)
		c.removeOSDClient(r)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case message := <-msgChan:
			data, _ := json.Marshal(message)
			// fmt.Printf("📤 [OSD歌词] 发送消息到客户端: %s\n", string(data))
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.(http.Flusher).Flush()
		case <-time.After(30 * time.Second):
			// 发送心跳，如果发送失败说明连接已断开
			fmt.Fprintf(w, "data: %s\n\n", `{"type":"heartbeat"}`)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			} else {
				// 无法刷新，连接可能已断开
				fmt.Printf("⚠️ [OSD歌词] 无法刷新响应，连接可能已断开: %s\n", r.RemoteAddr)
				return
			}
		}
	}
}

// ============ OSD歌词相关方法 ============

// UpdateCurrentLyrics 更新当前显示的歌词行
func (c *CacheService) UpdateCurrentLyrics(lyricsText string, songName string, artist string) OSDLyricsResponse {
	// 检测原始歌词格式
	format := "lrc" // 默认格式
	if strings.HasPrefix(lyricsText, "[") && strings.Contains(lyricsText, ",") && strings.Contains(lyricsText, "]<") {
		// KRC格式特征：[数字,数字]<数字,数字,数字>
		format = "krc"
		fmt.Printf("🎵 [OSD歌词] 收到原始KRC歌词: %s - %s\n", songName, artist)
	} else if strings.HasPrefix(lyricsText, "[") && strings.Contains(lyricsText, ":") && strings.Contains(lyricsText, "]") {
		// LRC格式特征：[mm:ss.xx]
		format = "lrc"
		fmt.Printf("🎵 [OSD歌词] 收到原始LRC歌词: %s - %s\n", songName, artist)
	} else {
		fmt.Printf("🎵 [OSD歌词] 收到纯文本歌词: %s - %s: %s\n", songName, artist, lyricsText)
	}

	// 广播原始歌词消息
	message := LyricsMessage{
		Type:     "lyrics_update",
		Text:     lyricsText, // 直接发送原始歌词文本
		SongName: songName,
		Artist:   artist,
		Format:   format,
	}

	c.broadcastLyricsMessage(message)
	return OSDLyricsResponse{Success: true, Message: "OSD歌词更新成功"}
}

// SetEnabled 设置OSD歌词开关状态
func (cs *CacheService) SetEnabled(enabled bool) CacheResponse {
	log.Printf("🎵 设置OSD歌词状态: %v", enabled)

	if enabled {
		// 检查是否已经启用
		if cs.IsEnabled() {
			log.Printf("✅ OSD歌词程序已在运行，无需重复启动")
			return CacheResponse{
				Success: true,
				Message: "桌面歌词已在运行",
			}
		}

		// 启动OSD歌词程序
		if err := cs.startOSDLyricsProcess(); err != nil {
			log.Printf("❌ 启动OSD歌词程序失败: %v", err)
			return CacheResponse{
				Success: false,
				Message: fmt.Sprintf("启动桌面歌词失败: %v", err),
			}
		}
	} else {
		// 停止OSD歌词程序
		cs.stopOSDLyricsProcess()
	}

	return CacheResponse{
		Success: true,
		Message: fmt.Sprintf("桌面歌词已%s", map[bool]string{true: "开启", false: "关闭"}[enabled]),
	}
}

// startOSDLyricsProcess 启动OSD歌词程序
func (cs *CacheService) startOSDLyricsProcess() error {
	cs.osdProcessMutex.Lock()
	defer cs.osdProcessMutex.Unlock()

	// 检查进程是否已经在运行且健康
	if cs.osdProcess != nil {
		// 检查进程状态
		processState := cs.osdProcess.ProcessState
		if processState == nil {
			// 进程还在运行（ProcessState为nil表示进程未退出）
			log.Printf("✅ OSD歌词程序已在运行，PID: %d", cs.osdProcess.Process.Pid)
			return nil // 进程健康运行，无需重启
		} else {
			// 进程已退出，清理引用
			log.Printf("🔍 检测到OSD歌词进程已退出（退出码: %d），准备重新启动", processState.ExitCode())
			cs.osdProcess = nil
		}
	}
	// 获取当前程序所在的目录
	ex, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取当前程序路径失败: %v", err)
	}
	exPath := filepath.Dir(ex)

	// 查找OSD歌词程序
	osdPath := fmt.Sprintf("%s/osdlyric/osd_lyrics", exPath) // 相对路径 "./osdlyric/osd_lyrics"
	fmt.Println("OSD歌词程序路径:", osdPath)
	if _, err := os.Stat(osdPath); os.IsNotExist(err) {
		// 尝试在系统路径中查找
		if path, err := exec.LookPath("osd_lyrics"); err == nil {
			osdPath = path
		} else {
			return fmt.Errorf("找不到OSD歌词程序")
		}
	}

	// 启动OSD歌词程序（使用默认SSE URL）
	cs.osdProcess = exec.Command(osdPath)

	// 继承当前进程的环境变量（包括DISPLAY等）
	env := os.Environ()

	// 确保关键的显示环境变量存在
	displayFound := false
	for _, e := range env {
		if strings.HasPrefix(e, "DISPLAY=") {
			displayFound = true
			break
		}
	}

	// 如果没有DISPLAY环境变量，设置默认值
	if !displayFound {
		env = append(env, "DISPLAY=:0")
		log.Printf("🖥️ 设置默认DISPLAY环境变量: :0")
	}

	// 强制使用X11后端，确保窗口管理器功能正常
	env = append(env, "GDK_BACKEND=x11")

	cs.osdProcess.Env = env

	log.Printf("🎵 启动OSD歌词程序: %s (将自动连接到默认SSE端点)", osdPath)

	if err := cs.osdProcess.Start(); err != nil {
		cs.osdProcess = nil
		return fmt.Errorf("启动OSD歌词程序失败: %v", err)
	}

	log.Printf("✅ OSD歌词程序已启动，PID: %d", cs.osdProcess.Process.Pid)

	// 在后台监控进程状态
	go func() {
		cs.osdProcess.Wait()
		cs.osdProcessMutex.Lock()
		cs.osdProcess = nil
		cs.osdProcessMutex.Unlock()
		log.Printf("🔴 OSD歌词程序已退出")
	}()

	return nil
}

// stopOSDLyricsProcess 停止OSD歌词程序
func (cs *CacheService) stopOSDLyricsProcess() {
	cs.osdProcessMutex.Lock()
	defer cs.osdProcessMutex.Unlock()

	if cs.osdProcess != nil {
		log.Printf("🔴 停止OSD歌词程序，PID: %d", cs.osdProcess.Process.Pid)

		// 首先尝试温和地终止进程（SIGTERM）
		if err := cs.osdProcess.Process.Signal(os.Interrupt); err != nil {
			log.Printf("⚠️ 发送SIGTERM失败，尝试强制终止: %v", err)
			// 如果温和终止失败，使用强制终止
			if killErr := cs.osdProcess.Process.Kill(); killErr != nil {
				log.Printf("❌ 强制终止OSD歌词程序失败: %v", killErr)
			}
		}

		// 等待进程退出（最多等待3秒）
		done := make(chan error, 1)
		go func() {
			done <- cs.osdProcess.Wait()
		}()

		select {
		case <-done:
			log.Printf("✅ OSD歌词程序已正常退出")
		case <-time.After(3 * time.Second):
			log.Printf("⚠️ OSD歌词程序退出超时，强制终止")
			cs.osdProcess.Process.Kill()
			cs.osdProcess.Wait()
		}

		cs.osdProcess = nil
		log.Printf("✅ OSD歌词程序已停止")
	}
}

// IsEnabled 检查OSD歌词是否启用
func (cs *CacheService) IsEnabled() bool {
	cs.osdProcessMutex.RLock()
	defer cs.osdProcessMutex.RUnlock()

	if cs.osdProcess == nil {
		return false
	}

	// 检查进程是否真的还在运行
	processState := cs.osdProcess.ProcessState
	if processState != nil {
		// 进程已退出
		log.Printf("🔍 检测到OSD歌词进程已退出，清理引用")
		// 注意：这里不能直接修改 cs.osdProcess，因为我们持有的是读锁
		// 实际清理会在下次调用 startOSDLyricsProcess 时进行
		return false
	}

	return true // 进程存在且未退出
}

// broadcastLyricsMessage 向所有连接的客户端广播歌词消息
func (c *CacheService) broadcastLyricsMessage(message LyricsMessage) {
	clientCount := 0

	// 遍历 sync.Map 中的所有客户端
	c.osdClients.Range(func(key, value interface{}) bool {
		req := key.(*http.Request)
		msgChan := value.(chan LyricsMessage)
		clientCount++

		select {
		case msgChan <- message:
			// 发送成功
		default:
			// 发送失败，客户端缓冲区满或已断开
			fmt.Printf("⚠️ [OSD歌词] 客户端 %s 缓冲区满或已断开，跳过此次发送\n", req.RemoteAddr)
		}
		return true // 继续遍历
	})

	if clientCount == 0 {
		fmt.Printf("📡 [OSD歌词] 无客户端连接，跳过广播\n")
	} else {
		fmt.Printf("📡 [OSD歌词] 广播到 %d 个客户端\n", clientCount)
	}
}

// addOSDClient 添加OSD歌词SSE客户端
func (c *CacheService) addOSDClient(req *http.Request, msgChan chan LyricsMessage) {
	c.osdClients.Store(req, msgChan)

	// 计算当前连接数
	clientCount := 0
	c.osdClients.Range(func(key, value interface{}) bool {
		clientCount++
		return true
	})

	fmt.Printf("🔗 [OSD歌词] 添加客户端: %s，当前连接数: %d\n", req.RemoteAddr, clientCount)
}

// removeOSDClient 移除OSD歌词SSE客户端
func (c *CacheService) removeOSDClient(req *http.Request) {
	if _, exists := c.osdClients.LoadAndDelete(req); exists {
		// 计算当前连接数
		clientCount := 0
		c.osdClients.Range(func(key, value interface{}) bool {
			clientCount++
			return true
		})

		fmt.Printf("🔌 [OSD歌词] 成功移除客户端: %s，当前连接数: %d\n", req.RemoteAddr, clientCount)
	} else {
		fmt.Printf("⚠️ [OSD歌词] 尝试移除不存在的客户端: %s\n", req.RemoteAddr)
	}
}

// closeAllOSDClients 关闭所有OSD客户端连接
func (c *CacheService) closeAllOSDClients() {
	// 计算当前连接数
	clientCount := 0
	c.osdClients.Range(func(key, value interface{}) bool {
		clientCount++
		return true
	})

	log.Printf("🔌 [OSD歌词] 清空所有客户端连接，当前连接数: %d", clientCount)

	// 清空所有客户端
	c.osdClients.Range(func(key, value interface{}) bool {
		c.osdClients.Delete(key)
		return true
	})

	log.Printf("✅ [OSD歌词] 所有客户端连接已清空")
}
