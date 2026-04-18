package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// DownloadService 下载服务
type DownloadService struct{}

// NewDownloadService 创建下载服务实例
func NewDownloadService() *DownloadService {
	return &DownloadService{}
}

// DownloadRecord 下载记录
type DownloadRecord struct {
	ID           string    `json:"id"`            // 记录ID（使用歌曲hash）
	Hash         string    `json:"hash"`          // 歌曲hash
	SongName     string    `json:"songname"`      // 歌曲名称
	ArtistName   string    `json:"artist_name"`   // 艺术家名称
	Filename     string    `json:"filename"`      // 文件名
	DownloadTime time.Time `json:"download_time"` // 下载时间
	FilePath     string    `json:"file_path"`     // 文件路径
	FileSize     int64     `json:"file_size"`     // 文件大小（字节）
}

// DownloadRecordsData 下载记录数据结构
type DownloadRecordsData struct {
	Records    []DownloadRecord `json:"records"`     // 下载记录列表
	TotalCount int              `json:"total_count"` // 总记录数
	UpdateTime time.Time        `json:"update_time"` // 更新时间
}

// DownloadRecordsResponse 下载记录响应结构
type DownloadRecordsResponse = ApiResponse[DownloadRecordsData]

// AddDownloadRecordRequest 添加下载记录请求
type AddDownloadRecordRequest struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	ArtistName string `json:"artist_name"`
	Filename   string `json:"filename"`
	FilePath   string `json:"file_path"`
	FileSize   int64  `json:"file_size"`
}

// GetDownloadRecordsRequest 获取下载记录请求
type GetDownloadRecordsRequest struct {
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Filter   string `json:"filter"`
}

// DeleteDownloadRecordRequest 删除下载记录请求
type DeleteDownloadRecordRequest struct {
	Hash string `json:"hash"`
}

// getDownloadRecordsFilePath 获取下载记录文件路径
func (d *DownloadService) getDownloadRecordsFilePath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	appDir := filepath.Join(homeDir, ".wg-music")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "", err
	}

	return filepath.Join(appDir, "download_records.json"), nil
}

// loadDownloadRecords 加载下载记录
func (d *DownloadService) loadDownloadRecords() (*DownloadRecordsData, error) {
	filePath, err := d.getDownloadRecordsFilePath()
	if err != nil {
		return nil, err
	}

	// 如果文件不存在，返回空数据
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return &DownloadRecordsData{
			Records:    []DownloadRecord{},
			TotalCount: 0,
			UpdateTime: time.Now(),
		}, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var records DownloadRecordsData
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}

	return &records, nil
}

// saveDownloadRecords 保存下载记录
func (d *DownloadService) saveDownloadRecords(data *DownloadRecordsData) error {
	filePath, err := d.getDownloadRecordsFilePath()
	if err != nil {
		return err
	}

	data.UpdateTime = time.Now()
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, jsonData, 0644)
}

// AddDownloadRecord 添加下载记录
func (d *DownloadService) AddDownloadRecord(request AddDownloadRecordRequest) DownloadRecordsResponse {
	if request.Hash == "" {
		return DownloadRecordsResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	// 加载现有记录
	data, err := d.loadDownloadRecords()
	if err != nil {
		return DownloadRecordsResponse{
			Success: false,
			Message: fmt.Sprintf("加载下载记录失败: %v", err),
		}
	}

	// 检查是否已存在
	for i, record := range data.Records {
		if record.Hash == request.Hash {
			// 更新现有记录
			data.Records[i].SongName = request.SongName
			data.Records[i].ArtistName = request.ArtistName
			data.Records[i].Filename = request.Filename
			data.Records[i].FilePath = request.FilePath
			data.Records[i].FileSize = request.FileSize
			data.Records[i].DownloadTime = time.Now()

			if err := d.saveDownloadRecords(data); err != nil {
				return DownloadRecordsResponse{
					Success: false,
					Message: fmt.Sprintf("保存下载记录失败: %v", err),
				}
			}

			log.Printf("✅ 更新下载记录: %s\n", request.SongName)
			return DownloadRecordsResponse{
				Success: true,
				Message: "下载记录更新成功",
				Data:    *data,
			}
		}
	}

	// 创建新记录
	newRecord := DownloadRecord{
		ID:           request.Hash,
		Hash:         request.Hash,
		SongName:     request.SongName,
		ArtistName:   request.ArtistName,
		Filename:     request.Filename,
		DownloadTime: time.Now(),
		FilePath:     request.FilePath,
		FileSize:     request.FileSize,
	}

	// 添加到记录列表开头（最新的在前面）
	data.Records = append([]DownloadRecord{newRecord}, data.Records...)
	data.TotalCount = len(data.Records)

	if err := d.saveDownloadRecords(data); err != nil {
		return DownloadRecordsResponse{
			Success: false,
			Message: fmt.Sprintf("保存下载记录失败: %v", err),
		}
	}

	log.Printf("✅ 添加下载记录: %s\n", request.SongName)
	return DownloadRecordsResponse{
		Success: true,
		Message: "下载记录添加成功",
		Data:    *data,
	}
}

// GetDownloadRecords 获取下载记录
func (d *DownloadService) GetDownloadRecords(request GetDownloadRecordsRequest) DownloadRecordsResponse {
	data, err := d.loadDownloadRecords()
	if err != nil {
		return DownloadRecordsResponse{
			Success: false,
			Message: fmt.Sprintf("加载下载记录失败: %v", err),
		}
	}

	// 分页处理
	page := request.Page
	pageSize := request.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}

	totalCount := len(data.Records)
	startIndex := (page - 1) * pageSize
	endIndex := startIndex + pageSize

	if startIndex >= totalCount {
		data.Records = []DownloadRecord{}
	} else {
		if endIndex > totalCount {
			endIndex = totalCount
		}
		data.Records = data.Records[startIndex:endIndex]
	}

	data.TotalCount = totalCount

	return DownloadRecordsResponse{
		Success: true,
		Message: "获取下载记录成功",
		Data:    *data,
	}
}

// DeleteDownloadRecord 删除下载记录
func (d *DownloadService) DeleteDownloadRecord(request DeleteDownloadRecordRequest) DownloadRecordsResponse {
	if request.Hash == "" {
		return DownloadRecordsResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	data, err := d.loadDownloadRecords()
	if err != nil {
		return DownloadRecordsResponse{
			Success: false,
			Message: fmt.Sprintf("加载下载记录失败: %v", err),
		}
	}

	// 查找并删除记录
	for i, record := range data.Records {
		if record.Hash == request.Hash {
			data.Records = append(data.Records[:i], data.Records[i+1:]...)
			data.TotalCount = len(data.Records)

			if err := d.saveDownloadRecords(data); err != nil {
				return DownloadRecordsResponse{
					Success: false,
					Message: fmt.Sprintf("保存下载记录失败: %v", err),
				}
			}

			log.Printf("✅ 删除下载记录: %s\n", record.SongName)
			return DownloadRecordsResponse{
				Success: true,
				Message: "下载记录删除成功",
				Data:    *data,
			}
		}
	}

	return DownloadRecordsResponse{
		Success: false,
		Message: "未找到指定的下载记录",
	}
}

// ClearDownloadRecords 清空下载记录
func (d *DownloadService) ClearDownloadRecords() DownloadRecordsResponse {
	data := &DownloadRecordsData{
		Records:    []DownloadRecord{},
		TotalCount: 0,
		UpdateTime: time.Now(),
	}

	if err := d.saveDownloadRecords(data); err != nil {
		return DownloadRecordsResponse{
			Success: false,
			Message: fmt.Sprintf("清空下载记录失败: %v", err),
		}
	}

	log.Println("✅ 清空下载记录成功")
	return DownloadRecordsResponse{
		Success: true,
		Message: "下载记录清空成功",
		Data:    *data,
	}
}

// OpenFileFolder 打开文件所在文件夹
func (d *DownloadService) OpenFileFolder(filePath string) ApiResponse[string] {
	if filePath == "" {
		return ApiResponse[string]{
			Success: false,
			Message: "文件路径不能为空",
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return ApiResponse[string]{
			Success: false,
			Message: "文件不存在",
		}
	}

	// 获取文件所在目录
	dir := filepath.Dir(filePath)

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Windows: 使用 explorer 并选中文件
		cmd = exec.Command("explorer", "/select,", filePath)
	case "darwin":
		// macOS: 使用 open 并选中文件
		cmd = exec.Command("open", "-R", filePath)
	case "linux":
		// Linux: 打开文件所在目录
		cmd = exec.Command("xdg-open", dir)
	default:
		return ApiResponse[string]{
			Success: false,
			Message: "不支持的操作系统",
		}
	}

	if err := cmd.Start(); err != nil {
		return ApiResponse[string]{
			Success: false,
			Message: fmt.Sprintf("打开文件夹失败: %v", err),
		}
	}

	log.Printf("✅ 打开文件夹: %s\n", dir)
	return ApiResponse[string]{
		Success: true,
		Message: "文件夹打开成功",
		Data:    dir,
	}
}
