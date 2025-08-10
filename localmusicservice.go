package main

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dhowden/tag"
	"github.com/hajimehoshi/go-mp3"
)

// LocalMusicService 本地音乐服务结构体
type LocalMusicService struct{}

// ScanResult 扫描结果
type ScanResult struct {
	MusicFile *LocalMusicFile
	Error     error
}

// LocalMusicFile 本地音乐文件信息
type LocalMusicFile struct {
	FilePath     string `json:"file_path"`     // 文件路径
	Filename     string `json:"filename"`      // 文件名
	Title        string `json:"title"`         // 歌曲标题
	Artist       string `json:"artist"`        // 艺术家
	Album        string `json:"album_name"`    // 专辑
	Year         int    `json:"year"`          // 年份
	Genre        string `json:"genre"`         // 流派
	Duration     int    `json:"time_length"`   // 时长(秒)
	Bitrate      int    `json:"bitrate"`       // 比特率
	FileSize     int64  `json:"file_size"`     // 文件大小
	Format       string `json:"format"`        // 文件格式
	Hash         string `json:"hash"`          // 文件哈希值
	LastModified int64  `json:"last_modified"` // 最后修改时间
	UnionCover   string `json:"union_cover"`   // 封面图片URL
	Lyrics       string `json:"lyrics"`        // 歌词内容
}

// FolderMusicGroup 文件夹音乐分组
type FolderMusicGroup struct {
	FolderPath string           `json:"folder_path"` // 文件夹路径
	FolderName string           `json:"folder_name"` // 文件夹名称
	MusicFiles []LocalMusicFile `json:"music_files"` // 该文件夹下的音乐文件
	Stats      LocalMusicStats  `json:"stats"`       // 该文件夹的统计信息
}

// LocalMusicResponse 本地音乐响应结构
type LocalMusicResponse struct {
	Success      bool               `json:"success"`
	Message      string             `json:"message"`
	Data         []LocalMusicFile   `json:"data"`          // 保持兼容性，所有音乐文件的平铺列表
	FolderGroups []FolderMusicGroup `json:"folder_groups"` // 按文件夹分组的音乐文件
	Stats        LocalMusicStats    `json:"stats"`         // 总体统计信息
}

// LocalMusicStats 本地音乐统计信息
type LocalMusicStats struct {
	TotalSongs   int `json:"total_songs"`
	TotalArtists int `json:"total_author_names"` // 与前端字段名保持一致
	TotalAlbums  int `json:"total_albums"`
}

// FolderSelectResponse 文件夹选择响应
type FolderSelectResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Path    string `json:"path"`
}

// AudioFileResponse 音频文件响应结构
type AudioFileResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Data     []byte `json:"data,omitempty"`     // 音频文件二进制数据
	MimeType string `json:"mimeType,omitempty"` // MIME类型
	FileName string `json:"fileName,omitempty"` // 文件名
}

// getCacheDir 获取缓存目录
func (l *LocalMusicService) getCacheDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户主目录失败: %v", err)
	}

	cacheDir := filepath.Join(homeDir, ".cache", "gomusic")

	// 确保缓存目录存在
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", fmt.Errorf("创建缓存目录失败: %v", err)
	}

	return cacheDir, nil
}

// SelectMusicFolder 选择音乐文件夹
func (l *LocalMusicService) SelectMusicFolder() FolderSelectResponse {
	// 注意：在实际实现中，这里应该调用系统的文件夹选择对话框
	// 由于Wails3的限制，这里先返回一个示例路径
	// 在前端可以通过HTML5的文件API来实现文件夹选择

	return FolderSelectResponse{
		Success: true,
		Message: "请在前端使用文件夹选择功能",
		Path:    "",
	}
}

// ScanMusicFolders 扫描多个音乐文件夹
func (l *LocalMusicService) ScanMusicFolders(folderPaths []string) LocalMusicResponse {
	if len(folderPaths) == 0 {
		return LocalMusicResponse{
			Success: false,
			Message: "文件夹路径列表不能为空",
		}
	}

	var allMusicFiles []LocalMusicFile
	var folderGroups []FolderMusicGroup
	var failedPaths []string

	// 收集所有文件夹中的音乐文件路径
	var allFilePaths []string
	var folderFileMap = make(map[string][]string) // 记录每个文件夹的文件路径

	supportedFormats := map[string]bool{
		".mp3":  true,
		".flac": true,
		".wav":  true,
		".m4a":  true,
		".aac":  true,
		".ogg":  true,
		".wma":  true,
	}

	for _, folderPath := range folderPaths {
		if folderPath == "" {
			continue
		}

		// 检查文件夹是否存在
		if _, err := os.Stat(folderPath); os.IsNotExist(err) {
			failedPaths = append(failedPaths, folderPath)
			fmt.Printf("文件夹不存在: %s\n", folderPath)
			continue
		}

		var folderFiles []string
		err := filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // 跳过错误文件
			}

			if info.IsDir() {
				return nil // 跳过目录
			}

			// 检查文件扩展名
			ext := strings.ToLower(filepath.Ext(path))
			if !supportedFormats[ext] {
				return nil // 跳过不支持的格式
			}

			folderFiles = append(folderFiles, path)
			allFilePaths = append(allFilePaths, path)
			return nil
		})

		if err != nil {
			failedPaths = append(failedPaths, folderPath)
			fmt.Printf("扫描文件夹失败 %s: %v\n", folderPath, err)
			continue
		}

		folderFileMap[folderPath] = folderFiles
		fmt.Printf("收集文件夹 %s: %d 个音乐文件\n", folderPath, len(folderFiles))
	}

	if len(allFilePaths) == 0 {
		message := "没有找到音乐文件"
		if len(failedPaths) > 0 {
			message += fmt.Sprintf("，%d 个文件夹扫描失败", len(failedPaths))
		}
		return LocalMusicResponse{
			Success: true,
			Message: message,
			Data:    []LocalMusicFile{},
			Stats:   LocalMusicStats{},
		}
	}

	// 使用协程并发扫描所有音乐文件
	fmt.Printf("🚀 开始并发扫描 %d 个音乐文件\n", len(allFilePaths))
	allMusicFiles = l.scanMusicFilesConcurrently(allFilePaths)

	// 按文件夹分组音乐文件
	for folderPath, folderFiles := range folderFileMap {
		var folderMusicFiles []LocalMusicFile

		// 找到属于这个文件夹的音乐文件
		for _, musicFile := range allMusicFiles {
			for _, filePath := range folderFiles {
				if musicFile.FilePath == filePath {
					folderMusicFiles = append(folderMusicFiles, musicFile)
					break
				}
			}
		}

		if len(folderMusicFiles) > 0 {
			folderName := filepath.Base(folderPath)
			folderStats := l.calculateStats(folderMusicFiles)
			folderGroup := FolderMusicGroup{
				FolderPath: folderPath,
				FolderName: folderName,
				MusicFiles: folderMusicFiles,
				Stats:      folderStats,
			}
			folderGroups = append(folderGroups, folderGroup)
			fmt.Printf("✅ 文件夹 %s: %d 首音乐\n", folderPath, len(folderMusicFiles))
		}
	}

	// 去重处理（基于文件hash）
	uniqueFiles := l.deduplicateMusicFiles(allMusicFiles)

	// 计算总体统计信息
	stats := l.calculateStats(uniqueFiles)

	// 缓存扫描结果
	if err := l.cacheMusicFiles(uniqueFiles); err != nil {
		fmt.Printf("缓存音乐文件失败: %v\n", err)
	}

	// 生成本地音乐映射
	if err := l.generateLocalMusicMappings(uniqueFiles); err != nil {
		fmt.Printf("生成本地音乐映射失败: %v\n", err)
	}

	message := fmt.Sprintf("成功扫描到 %d 首音乐", len(uniqueFiles))
	if len(failedPaths) > 0 {
		message += fmt.Sprintf("，%d 个文件夹扫描失败", len(failedPaths))
	}

	return LocalMusicResponse{
		Success:      true,
		Message:      message,
		Data:         uniqueFiles,
		FolderGroups: folderGroups,
		Stats:        stats,
	}
}

// ScanMusicFolder 扫描音乐文件夹（使用协程并发扫描）
func (l *LocalMusicService) ScanMusicFolder(folderPath string) LocalMusicResponse {
	if folderPath == "" {
		return LocalMusicResponse{
			Success: false,
			Message: "文件夹路径不能为空",
		}
	}

	// 检查文件夹是否存在
	if _, err := os.Stat(folderPath); os.IsNotExist(err) {
		return LocalMusicResponse{
			Success: false,
			Message: "指定的文件夹不存在",
		}
	}

	// 收集所有音乐文件路径
	var filePaths []string
	supportedFormats := map[string]bool{
		".mp3":  true,
		".flac": true,
		".wav":  true,
		".m4a":  true,
		".aac":  true,
		".ogg":  true,
		".wma":  true,
	}

	err := filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 跳过错误文件
		}

		if info.IsDir() {
			return nil // 跳过目录
		}

		// 检查文件扩展名
		ext := strings.ToLower(filepath.Ext(path))
		if !supportedFormats[ext] {
			return nil // 跳过不支持的格式
		}

		filePaths = append(filePaths, path)
		return nil
	})

	if err != nil {
		return LocalMusicResponse{
			Success: false,
			Message: fmt.Sprintf("扫描文件夹失败: %v", err),
		}
	}

	if len(filePaths) == 0 {
		return LocalMusicResponse{
			Success: true,
			Message: "文件夹中没有找到支持的音乐文件",
			Data:    []LocalMusicFile{},
			Stats:   LocalMusicStats{},
		}
	}

	// 使用协程并发扫描音乐文件
	musicFiles := l.scanMusicFilesConcurrently(filePaths)

	// 计算统计信息
	stats := l.calculateStats(musicFiles)

	// 缓存扫描结果
	if err := l.cacheMusicFiles(musicFiles); err != nil {
		fmt.Printf("缓存音乐文件失败: %v\n", err)
	}

	// 生成本地音乐映射
	if err := l.generateLocalMusicMappings(musicFiles); err != nil {
		fmt.Printf("生成本地音乐映射失败: %v\n", err)
	}

	// 创建文件夹分组
	folderName := filepath.Base(folderPath)
	folderGroup := FolderMusicGroup{
		FolderPath: folderPath,
		FolderName: folderName,
		MusicFiles: musicFiles,
		Stats:      stats,
	}

	return LocalMusicResponse{
		Success:      true,
		Message:      fmt.Sprintf("成功扫描到 %d 首音乐", len(musicFiles)),
		Data:         musicFiles,
		FolderGroups: []FolderMusicGroup{folderGroup},
		Stats:        stats,
	}
}

// scanMusicFilesConcurrently 并发扫描音乐文件（简化版本）
func (l *LocalMusicService) scanMusicFilesConcurrently(filePaths []string) []LocalMusicFile {
	if len(filePaths) == 0 {
		return []LocalMusicFile{}
	}

	fmt.Printf("🚀 开始并发扫描 %d 个音乐文件\n", len(filePaths))

	// 创建结果通道
	resultChan := make(chan ScanResult, len(filePaths))
	var wg sync.WaitGroup

	// 为每个文件启动一个协程
	for _, filePath := range filePaths {
		wg.Add(1)
		go func(path string) {
			defer wg.Done()

			musicFile, err := l.parseMusicFile(path)
			result := ScanResult{
				MusicFile: musicFile,
				Error:     err,
			}
			resultChan <- result
		}(filePath)
	}

	// 等待所有协程完成
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// 收集结果
	var musicFiles []LocalMusicFile
	successCount := 0
	failedCount := 0

	for result := range resultChan {
		if result.Error != nil {
			fmt.Printf("❌ 扫描失败: %v\n", result.Error)
			failedCount++
		} else {
			musicFiles = append(musicFiles, *result.MusicFile)
			successCount++
		}
	}

	fmt.Printf("✅ 并发扫描完成: 成功 %d 个，失败 %d 个\n", successCount, failedCount)
	return musicFiles
}

// parseMusicFile 解析音乐文件
func (l *LocalMusicService) parseMusicFile(filePath string) (*LocalMusicFile, error) {
	// 打开文件
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %v", err)
	}
	defer file.Close()

	// 获取文件信息
	fileInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 解析音频标签
	metadata, err := tag.ReadFrom(file)
	if err != nil {
		// 如果无法解析标签，使用文件名作为标题
		filename := filepath.Base(filePath)
		nameWithoutExt := strings.TrimSuffix(filename, filepath.Ext(filename))

		return &LocalMusicFile{
			FilePath:     filePath,
			Filename:     filename,
			Title:        nameWithoutExt,
			Artist:       "未知艺术家",
			Album:        "未知专辑",
			Format:       strings.TrimPrefix(filepath.Ext(filePath), "."),
			FileSize:     fileInfo.Size(),
			Hash:         l.calculateFileHash(filePath),
			LastModified: fileInfo.ModTime().Unix(),
		}, nil
	}

	// 创建音乐文件对象
	musicFile := &LocalMusicFile{
		FilePath:     filePath,
		Filename:     filepath.Base(filePath),
		Title:        metadata.Title(),
		Artist:       metadata.Artist(),
		Album:        metadata.Album(),
		Genre:        metadata.Genre(),
		Format:       strings.TrimPrefix(filepath.Ext(filePath), "."),
		FileSize:     fileInfo.Size(),
		Hash:         l.calculateFileHash(filePath),
		LastModified: fileInfo.ModTime().Unix(),
	}

	// 处理年份
	if year := metadata.Year(); year != 0 {
		musicFile.Year = year
	}

	// 处理标题为空的情况
	if musicFile.Title == "" {
		nameWithoutExt := strings.TrimSuffix(musicFile.Filename, filepath.Ext(musicFile.Filename))
		musicFile.Title = nameWithoutExt
	}

	// 处理艺术家为空的情况
	if musicFile.Artist == "" {
		musicFile.Artist = "未知艺术家"
	}

	// 处理专辑为空的情况
	if musicFile.Album == "" {
		musicFile.Album = "未知专辑"
	}

	// 解析音频时长
	duration, err := l.parseAudioDuration(filePath)
	if err == nil {
		musicFile.Duration = duration
	}

	// 处理封面图片
	if picture := metadata.Picture(); picture != nil {
		coverURL, err := l.saveCoverToCache(musicFile.Hash, picture.Data, picture.MIMEType)
		if err == nil {
			musicFile.UnionCover = coverURL
		}
	}

	// 解析歌词
	lyrics := l.extractLyricsFromMetadata(metadata)
	if lyrics != "" {
		musicFile.Lyrics = lyrics
		fmt.Printf("✅ 成功提取歌词 %s: %d 字符\n", filepath.Base(filePath), len(lyrics))
	} else {
		fmt.Printf("📝 未找到歌词信息: %s\n", filepath.Base(filePath))
	}

	return musicFile, nil
}

// calculateFileHash 计算文件哈希值
func (l *LocalMusicService) calculateFileHash(filePath string) string {
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

// deduplicateMusicFiles 去重音乐文件（基于文件hash）
func (l *LocalMusicService) deduplicateMusicFiles(musicFiles []LocalMusicFile) []LocalMusicFile {
	seen := make(map[string]bool)
	var uniqueFiles []LocalMusicFile

	for _, file := range musicFiles {
		if file.Hash != "" && !seen[file.Hash] {
			seen[file.Hash] = true
			uniqueFiles = append(uniqueFiles, file)
		} else if file.Hash == "" {
			// 如果没有hash，基于文件路径去重
			if !seen[file.FilePath] {
				seen[file.FilePath] = true
				uniqueFiles = append(uniqueFiles, file)
			}
		}
	}

	fmt.Printf("去重处理: %d -> %d 首音乐\n", len(musicFiles), len(uniqueFiles))
	return uniqueFiles
}

// calculateStats 计算统计信息
func (l *LocalMusicService) calculateStats(musicFiles []LocalMusicFile) LocalMusicStats {
	artistSet := make(map[string]bool)
	albumSet := make(map[string]bool)

	for _, file := range musicFiles {
		if file.Artist != "" && file.Artist != "未知艺术家" {
			artistSet[file.Artist] = true
		}
		if file.Album != "" && file.Album != "未知专辑" {
			albumSet[file.Album] = true
		}
	}

	return LocalMusicStats{
		TotalSongs:   len(musicFiles),
		TotalArtists: len(artistSet),
		TotalAlbums:  len(albumSet),
	}
}

// cacheMusicFiles 缓存音乐文件信息
func (l *LocalMusicService) cacheMusicFiles(musicFiles []LocalMusicFile) error {
	cacheDir, err := l.getCacheDir()
	if err != nil {
		return err
	}

	cacheFile := filepath.Join(cacheDir, "music_cache.json")

	// 创建缓存数据
	cacheData := map[string]interface{}{
		"timestamp":   time.Now().Unix(),
		"music_files": musicFiles,
	}

	// 序列化为JSON
	jsonData, err := json.MarshalIndent(cacheData, "", "  ")
	if err != nil {
		return err
	}

	// 写入缓存文件
	return os.WriteFile(cacheFile, jsonData, 0644)
}

// GetCachedMusicFiles 获取缓存的音乐文件
func (l *LocalMusicService) GetCachedMusicFiles() LocalMusicResponse {
	cacheDir, err := l.getCacheDir()
	if err != nil {
		return LocalMusicResponse{
			Success: false,
			Message: fmt.Sprintf("获取缓存目录失败: %v", err),
		}
	}

	cacheFile := filepath.Join(cacheDir, "music_cache.json")

	// 检查缓存文件是否存在
	if _, err := os.Stat(cacheFile); os.IsNotExist(err) {
		return LocalMusicResponse{
			Success: false,
			Message: "没有找到缓存的音乐文件",
		}
	}

	// 读取缓存文件
	jsonData, err := os.ReadFile(cacheFile)
	if err != nil {
		return LocalMusicResponse{
			Success: false,
			Message: fmt.Sprintf("读取缓存文件失败: %v", err),
		}
	}

	// 解析JSON数据
	var cacheData map[string]interface{}
	if err := json.Unmarshal(jsonData, &cacheData); err != nil {
		return LocalMusicResponse{
			Success: false,
			Message: fmt.Sprintf("解析缓存数据失败: %v", err),
		}
	}

	// 提取音乐文件数据
	musicFilesData, ok := cacheData["music_files"].([]interface{})
	if !ok {
		return LocalMusicResponse{
			Success: false,
			Message: "缓存数据格式错误",
		}
	}

	var musicFiles []LocalMusicFile
	for _, item := range musicFilesData {
		itemBytes, _ := json.Marshal(item)
		var musicFile LocalMusicFile
		if err := json.Unmarshal(itemBytes, &musicFile); err == nil {
			musicFiles = append(musicFiles, musicFile)
		}
	}

	// 计算统计信息
	stats := l.calculateStats(musicFiles)

	// 按文件夹路径分组音乐文件
	folderGroups := l.groupMusicFilesByFolder(musicFiles)

	return LocalMusicResponse{
		Success:      true,
		Message:      fmt.Sprintf("成功加载 %d 首缓存音乐", len(musicFiles)),
		Data:         musicFiles,
		FolderGroups: folderGroups,
		Stats:        stats,
	}
}

// groupMusicFilesByFolder 按文件夹路径分组音乐文件
func (l *LocalMusicService) groupMusicFilesByFolder(musicFiles []LocalMusicFile) []FolderMusicGroup {
	folderMap := make(map[string][]LocalMusicFile)

	// 按文件夹路径分组
	for _, musicFile := range musicFiles {
		folderPath := filepath.Dir(musicFile.FilePath)
		folderMap[folderPath] = append(folderMap[folderPath], musicFile)
	}

	// 转换为FolderMusicGroup切片
	var folderGroups []FolderMusicGroup
	for folderPath, files := range folderMap {
		folderName := filepath.Base(folderPath)
		stats := l.calculateStats(files)

		folderGroup := FolderMusicGroup{
			FolderPath: folderPath,
			FolderName: folderName,
			MusicFiles: files,
			Stats:      stats,
		}
		folderGroups = append(folderGroups, folderGroup)
	}

	return folderGroups
}

// parseAudioDuration 解析音频文件时长
func (l *LocalMusicService) parseAudioDuration(filePath string) (int, error) {
	// 首先尝试从标签中获取时长
	if duration := l.getDurationFromTags(filePath); duration > 0 {
		return duration, nil
	}

	// 如果标签中没有时长信息，使用格式特定的解析方法
	ext := strings.ToLower(filepath.Ext(filePath))

	switch ext {
	case ".mp3":
		return l.parseMp3Duration(filePath)
	case ".flac":
		return l.parseFlacDuration(filePath)
	case ".wav":
		return l.parseWavDuration(filePath)
	case ".m4a", ".aac", ".ogg", ".wma":
		// 对于这些格式，目前使用估算方法
		// 可以在未来添加更精确的解析器
		fmt.Printf("📊 使用估算方法解析 %s 格式: %s\n", ext, filepath.Base(filePath))
		return l.estimateAudioDuration(filePath)
	default:
		return 0, fmt.Errorf("不支持的音频格式: %s", ext)
	}
}

// parseMp3Duration 解析MP3文件时长
func (l *LocalMusicService) parseMp3Duration(filePath string) (int, error) {
	// 方法1：尝试使用 go-mp3 库快速解析
	duration, err := l.parseMp3DurationFast(filePath)
	if err == nil && duration > 0 {
		fmt.Printf("✅ MP3时长解析成功 %s: %d秒\n", filepath.Base(filePath), duration)
		return duration, nil
	}

	// 方法2：如果快速解析失败，尝试通过帧分析
	duration, err = l.parseMp3DurationByFrames(filePath)
	if err == nil && duration > 0 {
		fmt.Printf("✅ MP3帧分析时长成功 %s: %d秒\n", filepath.Base(filePath), duration)
		return duration, nil
	}

	// 方法3：最后使用估算方法
	fmt.Printf("⚠️ MP3精确解析失败，使用估算方法: %s\n", filepath.Base(filePath))
	return l.estimateAudioDuration(filePath)
}

// parseMp3DurationFast 使用 go-mp3 库快速解析MP3时长
func (l *LocalMusicService) parseMp3DurationFast(filePath string) (int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	decoder, err := mp3.NewDecoder(file)
	if err != nil {
		return 0, fmt.Errorf("创建MP3解码器失败: %v", err)
	}

	// 获取采样率
	sampleRate := decoder.SampleRate()
	if sampleRate == 0 {
		return 0, fmt.Errorf("无法获取采样率")
	}

	// 计算总样本数 - 使用更高效的方法
	var totalSamples int64
	buf := make([]byte, 8192) // 增大缓冲区提高效率

	for {
		n, err := decoder.Read(buf)
		if err != nil {
			if err == io.EOF {
				break
			}
			return 0, fmt.Errorf("读取音频数据失败: %v", err)
		}
		// 每个样本2字节，立体声2通道
		totalSamples += int64(n) / 4
	}

	if totalSamples == 0 {
		return 0, fmt.Errorf("无法计算样本数")
	}

	// 计算时长（秒）
	duration := float64(totalSamples) / float64(sampleRate)
	return int(duration + 0.5), nil // 四舍五入
}

// parseMp3DurationByFrames 通过分析MP3帧头获取时长
func (l *LocalMusicService) parseMp3DurationByFrames(filePath string) (int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	// 获取文件大小
	fileInfo, err := file.Stat()
	if err != nil {
		return 0, err
	}
	fileSize := fileInfo.Size()

	// 读取文件开头寻找第一个MP3帧
	buf := make([]byte, 4096)
	n, err := file.Read(buf)
	if err != nil {
		return 0, err
	}

	// 寻找MP3帧同步字节 (0xFF)
	var frameStart int = -1
	for i := 0; i < n-4; i++ {
		if buf[i] == 0xFF && (buf[i+1]&0xE0) == 0xE0 {
			frameStart = i
			break
		}
	}

	if frameStart == -1 {
		return 0, fmt.Errorf("未找到MP3帧头")
	}

	// 解析第一个帧头获取比特率
	header := buf[frameStart : frameStart+4]
	bitrate, _, err := l.parseMp3FrameHeader(header)
	if err != nil {
		return 0, err
	}

	// 估算时长：文件大小 / (比特率/8)
	if bitrate > 0 {
		duration := float64(fileSize*8) / float64(bitrate)
		return int(duration + 0.5), nil
	}

	return 0, fmt.Errorf("无法确定比特率")
}

// parseMp3FrameHeader 解析MP3帧头获取比特率和采样率
func (l *LocalMusicService) parseMp3FrameHeader(header []byte) (bitrate, sampleRate int, err error) {
	if len(header) < 4 {
		return 0, 0, fmt.Errorf("帧头长度不足")
	}

	// MP3帧头格式分析
	// 比特率表 (kbps)
	bitrateTable := [][]int{
		// MPEG-1 Layer III
		{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},
		// MPEG-2 Layer III
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
	}

	// 采样率表 (Hz)
	sampleRateTable := [][]int{
		// MPEG-1
		{44100, 48000, 32000, 0},
		// MPEG-2
		{22050, 24000, 16000, 0},
	}

	// 解析版本和层
	version := (header[1] >> 3) & 0x03
	_ = (header[1] >> 1) & 0x03 // layer，暂时不使用

	// 解析比特率索引
	bitrateIndex := int((header[2] >> 4) & 0x0F)

	// 解析采样率索引
	sampleRateIndex := int((header[2] >> 2) & 0x03)

	// 确定使用哪个表
	var tableIndex int
	if version == 3 { // MPEG-1
		tableIndex = 0
	} else { // MPEG-2/2.5
		tableIndex = 1
	}

	// 获取比特率
	if bitrateIndex < len(bitrateTable[tableIndex]) {
		bitrate = bitrateTable[tableIndex][bitrateIndex] * 1000 // 转换为 bps
	}

	// 获取采样率
	if sampleRateIndex < len(sampleRateTable[tableIndex]) {
		sampleRate = sampleRateTable[tableIndex][sampleRateIndex]
	}

	if bitrate == 0 || sampleRate == 0 {
		return 0, 0, fmt.Errorf("无效的比特率或采样率")
	}

	return bitrate, sampleRate, nil
}

// estimateAudioDuration 通过文件大小估算音频时长
func (l *LocalMusicService) estimateAudioDuration(filePath string) (int, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return 0, err
	}

	// 根据文件格式使用不同的估算比特率
	ext := strings.ToLower(filepath.Ext(filePath))
	var avgBitrate int // 字节/秒

	switch ext {
	case ".mp3":
		avgBitrate = 128 * 1000 / 8 // 128kbps
	case ".flac":
		avgBitrate = 1000 * 1000 / 8 // 1000kbps (无损)
	case ".wav":
		avgBitrate = 1411 * 1000 / 8 // 1411kbps (CD质量)
	case ".m4a", ".aac":
		avgBitrate = 128 * 1000 / 8 // 128kbps
	case ".ogg":
		avgBitrate = 160 * 1000 / 8 // 160kbps
	case ".wma":
		avgBitrate = 128 * 1000 / 8 // 128kbps
	default:
		avgBitrate = 128 * 1000 / 8 // 默认128kbps
	}

	estimatedDuration := int(fileInfo.Size()) / avgBitrate
	fmt.Printf("📊 估算音频时长 %s: %d秒 (基于文件大小 %d 字节)\n",
		filepath.Base(filePath), estimatedDuration, fileInfo.Size())

	return estimatedDuration, nil
}

// parseFlacDuration 解析FLAC文件时长
func (l *LocalMusicService) parseFlacDuration(filePath string) (int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	// 读取FLAC文件头
	header := make([]byte, 4)
	if _, err := file.Read(header); err != nil {
		return 0, err
	}

	// 检查FLAC标识
	if string(header) != "fLaC" {
		return 0, fmt.Errorf("不是有效的FLAC文件")
	}

	// 读取元数据块
	for {
		blockHeader := make([]byte, 4)
		if _, err := file.Read(blockHeader); err != nil {
			break
		}

		isLast := (blockHeader[0] & 0x80) != 0
		blockType := blockHeader[0] & 0x7F
		blockSize := int(blockHeader[1])<<16 | int(blockHeader[2])<<8 | int(blockHeader[3])

		if blockType == 0 { // STREAMINFO块
			streamInfo := make([]byte, blockSize)
			if _, err := file.Read(streamInfo); err != nil {
				break
			}

			// 解析采样率和总样本数
			if len(streamInfo) >= 18 {
				sampleRate := int(streamInfo[10])<<12 | int(streamInfo[11])<<4 | int(streamInfo[12]>>4)
				totalSamples := int64(streamInfo[13]&0x0F)<<32 | int64(streamInfo[14])<<24 |
					int64(streamInfo[15])<<16 | int64(streamInfo[16])<<8 | int64(streamInfo[17])

				if sampleRate > 0 && totalSamples > 0 {
					duration := float64(totalSamples) / float64(sampleRate)
					fmt.Printf("✅ FLAC时长解析成功 %s: %.2f秒\n", filepath.Base(filePath), duration)
					return int(duration + 0.5), nil
				}
			}
		} else {
			// 跳过其他块
			if _, err := file.Seek(int64(blockSize), io.SeekCurrent); err != nil {
				break
			}
		}

		if isLast {
			break
		}
	}

	// 如果解析失败，使用估算方法
	return l.estimateAudioDuration(filePath)
}

// parseWavDuration 解析WAV文件时长
func (l *LocalMusicService) parseWavDuration(filePath string) (int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	// 读取WAV文件头
	header := make([]byte, 44) // WAV标准头部大小
	if _, err := file.Read(header); err != nil {
		return 0, err
	}

	// 检查WAV标识
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return 0, fmt.Errorf("不是有效的WAV文件")
	}

	// 解析格式信息
	if string(header[12:16]) == "fmt " {
		// 获取字节率（用于计算时长）
		byteRate := int(header[28]) | int(header[29])<<8 | int(header[30])<<16 | int(header[31])<<24

		// 获取文件大小
		fileInfo, err := file.Stat()
		if err != nil {
			return 0, err
		}

		if byteRate > 0 {
			// 减去头部大小
			audioDataSize := fileInfo.Size() - 44
			duration := float64(audioDataSize) / float64(byteRate)
			fmt.Printf("✅ WAV时长解析成功 %s: %.2f秒\n", filepath.Base(filePath), duration)
			return int(duration + 0.5), nil
		}
	}

	// 如果解析失败，使用估算方法
	return l.estimateAudioDuration(filePath)
}

// generateLocalMusicMappings 生成本地音乐映射关系
func (l *LocalMusicService) generateLocalMusicMappings(musicFiles []LocalMusicFile) error {
	if len(musicFiles) == 0 {
		fmt.Printf("📋 没有音乐文件需要生成映射\n")
		return nil
	}

	// 获取缓存服务实例
	cacheService := GetCacheService()
	if cacheService == nil {
		return fmt.Errorf("缓存服务不可用")
	}

	successCount := 0
	for _, musicFile := range musicFiles {
		// 生成本地音乐hash（格式：local-{fileHash}）
		localHash := "local-" + musicFile.Hash

		// 注册映射关系
		response := cacheService.RegisterLocalMusic(localHash, musicFile.FilePath)
		if response.Success {
			successCount++
		} else {
			fmt.Printf("⚠️ 注册本地音乐映射失败 %s: %s\n", musicFile.Filename, response.Message)
		}
	}

	fmt.Printf("✅ 本地音乐映射生成完成: %d/%d 成功\n", successCount, len(musicFiles))
	return nil
}

// GetAudioFileData 获取音频文件的二进制数据（保留兼容性）
func (l *LocalMusicService) GetAudioFileData(filePath string) AudioFileResponse {
	if filePath == "" {
		return AudioFileResponse{
			Success: false,
			Message: "文件路径不能为空",
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return AudioFileResponse{
			Success: false,
			Message: "文件不存在",
		}
	}

	// 读取文件内容
	fileData, err := os.ReadFile(filePath)
	if err != nil {
		return AudioFileResponse{
			Success: false,
			Message: fmt.Sprintf("读取文件失败: %v", err),
		}
	}

	// 确定MIME类型
	ext := strings.ToLower(filepath.Ext(filePath))
	mimeType := "application/octet-stream"
	switch ext {
	case ".mp3":
		mimeType = "audio/mpeg"
	case ".flac":
		mimeType = "audio/flac"
	case ".wav":
		mimeType = "audio/wav"
	case ".m4a":
		mimeType = "audio/mp4"
	case ".aac":
		mimeType = "audio/aac"
	case ".ogg":
		mimeType = "audio/ogg"
	case ".wma":
		mimeType = "audio/x-ms-wma"
	}

	return AudioFileResponse{
		Success:  true,
		Message:  "获取音频文件成功",
		Data:     fileData,
		MimeType: mimeType,
		FileName: filepath.Base(filePath),
	}
}

// GetLocalMusicLyrics 获取本地音乐文件的歌词
func (l *LocalMusicService) GetLocalMusicLyrics(filePath string) CacheResponse {
	if filePath == "" {
		return CacheResponse{
			Success: false,
			Message: "文件路径不能为空",
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return CacheResponse{
			Success: false,
			Message: "文件不存在",
		}
	}

	// 解析音乐文件获取歌词
	musicFile, err := l.parseMusicFile(filePath)
	if err != nil {
		return CacheResponse{
			Success: false,
			Message: fmt.Sprintf("解析音乐文件失败: %v", err),
		}
	}

	if musicFile.Lyrics == "" {
		return CacheResponse{
			Success: false,
			Message: "该音乐文件不包含歌词信息",
		}
	}

	return CacheResponse{
		Success: true,
		Message: "获取歌词成功",
		Data:    musicFile.Lyrics,
	}
}

// GetLocalAudioURL 获取本地音频文件的缓存URL
func (l *LocalMusicService) GetLocalAudioURL(filePath string) CacheResponse {
	if filePath == "" {
		return CacheResponse{
			Success: false,
			Message: "文件路径不能为空",
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return CacheResponse{
			Success: false,
			Message: "文件不存在",
		}
	}

	// 计算文件hash作为缓存key
	fileHash := l.calculateFileHash(filePath)
	if fileHash == "" {
		return CacheResponse{
			Success: false,
			Message: "计算文件hash失败",
		}
	}

	// 获取文件扩展名
	ext := strings.ToLower(filepath.Ext(filePath))

	// 获取缓存目录
	cacheDir, err := l.getCacheDir()
	if err != nil {
		return CacheResponse{
			Success: false,
			Message: fmt.Sprintf("获取缓存目录失败: %v", err),
		}
	}

	// 创建缓存文件路径
	mp3Dir := filepath.Join(cacheDir, "cache", "mp3")
	if err := os.MkdirAll(mp3Dir, 0755); err != nil {
		return CacheResponse{
			Success: false,
			Message: fmt.Sprintf("创建缓存目录失败: %v", err),
		}
	}

	// 缓存文件名：hash + 原始扩展名
	cachedFileName := fileHash + ext
	cachedFilePath := filepath.Join(mp3Dir, cachedFileName)

	// 检查是否已经缓存
	if _, err := os.Stat(cachedFilePath); os.IsNotExist(err) {
		// 文件未缓存，复制到缓存目录
		if err := l.copyFileToCache(filePath, cachedFilePath); err != nil {
			return CacheResponse{
				Success: false,
				Message: fmt.Sprintf("复制文件到缓存失败: %v", err),
			}
		}
		fmt.Printf("✅ 本地音乐文件已缓存: %s -> %s\n", filePath, cachedFilePath)
	}

	// 生成本地HTTP URL
	localURL := fmt.Sprintf("http://127.0.0.1:18911/cache/mp3/%s", cachedFileName)

	return CacheResponse{
		Success: true,
		Message: "获取本地音频URL成功",
		Data:    localURL,
	}
}

// copyFileToCache 复制文件到缓存目录
func (l *LocalMusicService) copyFileToCache(srcPath, dstPath string) error {
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

// saveCoverToCache 保存封面图片到缓存目录
func (l *LocalMusicService) saveCoverToCache(fileHash string, imageData []byte, mimeType string) (string, error) {
	if len(imageData) == 0 {
		return "", fmt.Errorf("封面数据为空")
	}

	// 获取缓存目录
	cacheDir, err := l.getCacheDir()
	if err != nil {
		return "", fmt.Errorf("获取缓存目录失败: %v", err)
	}

	// 创建封面缓存目录
	coverDir := filepath.Join(cacheDir, "cache", "covers")
	if err := os.MkdirAll(coverDir, 0755); err != nil {
		return "", fmt.Errorf("创建封面缓存目录失败: %v", err)
	}

	// 根据MIME类型确定文件扩展名
	var ext string
	switch mimeType {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	default:
		ext = ".jpg" // 默认使用jpg
	}

	// 封面文件名：文件hash + 扩展名
	coverFileName := fileHash + ext
	coverFilePath := filepath.Join(coverDir, coverFileName)

	// 检查封面是否已经缓存
	if _, err := os.Stat(coverFilePath); os.IsNotExist(err) {
		// 保存封面文件
		if err := os.WriteFile(coverFilePath, imageData, 0644); err != nil {
			return "", fmt.Errorf("保存封面文件失败: %v", err)
		}
		fmt.Printf("✅ 本地音乐封面已缓存: %s\n", coverFilePath)
	}

	// 生成本地HTTP URL
	coverURL := fmt.Sprintf("http://127.0.0.1:18911/cache/covers/%s", coverFileName)
	return coverURL, nil
}

// extractLyricsFromMetadata 从音频元数据中提取歌词
func (l *LocalMusicService) extractLyricsFromMetadata(metadata tag.Metadata) string {
	if metadata == nil {
		return ""
	}

	// 尝试从不同的标签字段获取歌词
	// 不同的音频格式和标签版本可能使用不同的字段名

	// 1. 尝试获取标准的歌词字段
	if lyrics := metadata.Lyrics(); lyrics != "" {
		return l.cleanLyrics(lyrics)
	}

	// 2. 尝试从原始标签中获取歌词（支持更多格式）
	if rawMetadata, ok := metadata.(tag.Metadata); ok {
		// 常见的歌词标签字段
		lyricsFields := []string{
			"LYRICS",         // 通用歌词字段
			"UNSYNCEDLYRICS", // 非同步歌词
			"USLT",           // ID3v2 非同步歌词
			"ULT",            // ID3v2 歌词
			"SYLT",           // ID3v2 同步歌词
			"TEXT",           // 某些格式的文本字段
			"COMMENT",        // 注释字段（有时包含歌词）
		}

		// 尝试通过反射或类型断言获取原始标签数据
		// 注意：这需要根据 dhowden/tag 库的具体实现来调整
		for _, field := range lyricsFields {
			if value := l.getTagField(rawMetadata, field); value != "" {
				return l.cleanLyrics(value)
			}
		}
	}

	return ""
}

// getTagField 尝试从元数据中获取指定字段的值
func (l *LocalMusicService) getTagField(metadata tag.Metadata, fieldName string) string {
	// 这里需要根据 dhowden/tag 库的实际API来实现
	// 由于该库可能不直接暴露原始标签字段，我们先返回空字符串
	// 在实际使用中，可能需要使用其他更底层的标签解析库

	// 尝试通过 Raw() 方法获取原始标签数据（如果存在）
	if rawTags := metadata.Raw(); rawTags != nil {
		// 检查不同格式的标签
		for key, value := range rawTags {
			keyUpper := strings.ToUpper(key)
			if keyUpper == fieldName || strings.Contains(keyUpper, fieldName) {
				if strValue, ok := value.(string); ok {
					return strValue
				}
			}
		}
	}

	return ""
}

// cleanLyrics 清理和格式化歌词文本
func (l *LocalMusicService) cleanLyrics(lyrics string) string {
	if lyrics == "" {
		return ""
	}

	// 移除BOM标记
	lyrics = strings.TrimPrefix(lyrics, "\ufeff")

	// 移除多余的空白字符
	lyrics = strings.TrimSpace(lyrics)

	// 标准化换行符
	lyrics = strings.ReplaceAll(lyrics, "\r\n", "\n")
	lyrics = strings.ReplaceAll(lyrics, "\r", "\n")

	// 移除连续的空行
	lines := strings.Split(lyrics, "\n")
	var cleanedLines []string
	var lastLineEmpty bool

	for _, line := range lines {
		line = strings.TrimSpace(line)
		isEmpty := line == ""

		// 只保留一个连续的空行
		if isEmpty && lastLineEmpty {
			continue
		}

		cleanedLines = append(cleanedLines, line)
		lastLineEmpty = isEmpty
	}

	result := strings.Join(cleanedLines, "\n")

	// 如果歌词太短，可能不是真正的歌词
	if len(result) < 10 {
		return ""
	}

	return result
}

// getDurationFromTags 从音频标签中获取时长信息
func (l *LocalMusicService) getDurationFromTags(filePath string) int {
	// 对于大多数音频格式，标签中通常不包含时长信息
	// 这个方法主要是为了保持接口一致性，实际时长获取依赖格式特定的方法
	fmt.Printf("📋 尝试从标签获取时长信息: %s\n", filepath.Base(filePath))
	return 0 // 让其他方法处理时长获取
}
