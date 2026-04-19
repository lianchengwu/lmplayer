package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HomepageService 处理首页相关的服务
type HomepageService struct {
	cacheService *CacheService
}

// NewHomepageService 创建新的首页服务实例
func NewHomepageService(cacheService *CacheService) *HomepageService {
	return &HomepageService{
		cacheService: cacheService,
	}
}

// FmSongData 私人FM歌曲数据结构
type FmSongData struct {
	Hash       string   `json:"hash"`
	SongName   string   `json:"songname"`
	FileName   string   `json:"filename"`
	TimeLength int      `json:"time_length"`
	AlbumName  string   `json:"album_name"`
	AlbumID    string   `json:"album_id"`
	AuthorName string   `json:"author_name"`
	UnionCover string   `json:"union_cover"`
	SongUrl    []string `json:"song_url"`
}

// FmRequestParams 私人FM请求参数
type FmRequestParams struct {
	Hash          string `json:"hash,omitempty"`           // 音乐 hash
	SongID        string `json:"songid,omitempty"`         // 音乐 songid
	PlayTime      int    `json:"playtime,omitempty"`       // 已播放时间
	Mode          string `json:"mode,omitempty"`           // 获取模式：normal, small, peak
	Action        string `json:"action,omitempty"`         // 操作：play, garbage
	SongPoolID    int    `json:"song_pool_id,omitempty"`   // AI模式：0=Alpha, 1=Beta, 2=Gamma
	IsOverplay    bool   `json:"is_overplay,omitempty"`    // 是否已播放完成
	RemainSongCnt int    `json:"remain_songcnt,omitempty"` // 剩余未播放歌曲数
}

// FmResponse 私人FM响应结构
type FmResponse = ApiResponse[[]FmSongData]

// SongUrlData 歌曲播放地址数据结构
type SongUrlData struct {
	URLs   []string `json:"urls"`
	Lyrics string   `json:"lyrics"` // 歌词内容
}

// LyricsSearchData 歌词搜索数据结构
type LyricsSearchData struct {
	ID        string `json:"id"`
	AccessKey string `json:"accesskey"`
	Score     int    `json:"score"`
}

// LyricsSearchResponse 歌词搜索响应结构
type LyricsSearchResponse = ApiResponse[map[string]interface{}]

// LyricsResponse 歌词响应结构
type LyricsResponse = ApiResponse[map[string]interface{}]

// SongUrlResponse 歌曲播放地址响应结构
type SongUrlResponse = ApiResponse[SongUrlData]

// DailyRecommendData 每日推荐歌曲数据结构
type DailyRecommendData struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	FileName   string `json:"filename"`
	TimeLength int    `json:"time_length"`
	AlbumName  string `json:"album_name"`
	AlbumID    string `json:"album_id"`
	AuthorName string `json:"author_name"`
	UnionCover string `json:"union_cover"`
}

// AIRecommendData AI推荐歌曲数据结构
type AIRecommendData struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	FileName   string `json:"filename"`
	TimeLength int    `json:"time_length"`
	AlbumName  string `json:"album_name"`
	AlbumID    string `json:"album_id"`
	AuthorName string `json:"author_name"`
	UnionCover string `json:"union_cover"`
}

// DailyRecommendResponse 每日推荐响应结构
type DailyRecommendResponse = ApiResponse[[]DailyRecommendData]

// AIRecommendResponse AI推荐歌曲响应结构
type AIRecommendResponse = ApiResponse[[]AIRecommendData]

// readCookieFromFile 从全局Cookie管理器读取cookie
func (h *HomepageService) readCookieFromFile() (string, error) {
	cookie := GlobalCookieManager.GetCookie()
	// HomepageService 允许没有cookie的情况，返回空字符串而不是错误
	return cookie, nil
}

// GetPersonalFM 获取私人FM歌曲
func (h *HomepageService) GetPersonalFM(params FmRequestParams) FmResponse {
	// 设置默认参数
	if params.Mode == "" {
		params.Mode = "normal"
	}
	if params.Action == "" {
		params.Action = "play"
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/personal/fm", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	if params.Hash != "" {
		queryParams.Add("hash", params.Hash)
	}
	if params.SongID != "" {
		queryParams.Add("songid", params.SongID)
	}
	if params.PlayTime > 0 {
		queryParams.Add("playtime", fmt.Sprintf("%d", params.PlayTime))
	}
	queryParams.Add("mode", params.Mode)
	queryParams.Add("action", params.Action)
	if params.SongPoolID > 0 {
		queryParams.Add("song_pool_id", fmt.Sprintf("%d", params.SongPoolID))
	}
	if params.IsOverplay {
		queryParams.Add("is_overplay", "true")
	}
	if params.RemainSongCnt > 0 {
		queryParams.Add("remain_songcnt", fmt.Sprintf("%d", params.RemainSongCnt))
	}

	// 添加查询参数到URL
	if len(queryParams) > 0 {
		requestURL += "?" + queryParams.Encode()
	}

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return FmResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return FmResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return FmResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return FmResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		// 解析歌曲数据
		var songs []FmSongData
		if data, ok := apiResponse["data"].(map[string]any); ok {
			if songList, ok := data["song_list"].([]any); ok {
				for _, songItem := range songList {
					if song, ok := songItem.(map[string]any); ok {
						songData := FmSongData{}

						// 提取基本信息
						if hash, ok := song["hash"].(string); ok {
							songData.Hash = hash
						}
						if songname, ok := song["songname"].(string); ok {
							songData.SongName = songname
						}
						if filename, ok := song["filename"].(string); ok {
							songData.FileName = filename
						}
						if timelength, ok := song["timelength_320"].(float64); ok {
							songData.TimeLength = int(timelength)
						}
						if authorName, ok := song["author_name"].(string); ok {
							songData.AuthorName = authorName
						}

						// 提取专辑信息
						if relateGoods, ok := song["relate_goods"].([]any); ok && len(relateGoods) > 0 {
							if album, ok := relateGoods[0].(map[string]any); ok {
								if albumname, ok := album["albumname"].(string); ok {
									songData.AlbumName = albumname
								}
							}
							if len(relateGoods) > 1 {
								if album, ok := relateGoods[1].(map[string]any); ok {
									if albumID, ok := album["album_id"].(string); ok {
										songData.AlbumID = albumID
									}
								}
							}
						}

						// 提取封面信息
						if transParam, ok := song["trans_param"].(map[string]any); ok {
							if unionCover, ok := transParam["union_cover"].(string); ok {
								songData.UnionCover = unionCover
							}
						}

						songs = append(songs, songData)
					}
				}
			}
		}

		return FmResponse{
			Success:   true,
			Message:   "获取私人FM成功",
			ErrorCode: int(errorCode),
			Data:      songs,
		}
	} else {
		message := "获取私人FM失败"
		errorCodeInt := -1
		statusInt := 0

		// 尝试从响应中获取错误信息
		if msg, ok := apiResponse["message"].(string); ok && msg != "" {
			message = msg
		} else if status, ok := apiResponse["status"].(float64); ok {
			message = fmt.Sprintf("获取私人FM失败，状态码: %.0f", status)
			statusInt = int(status)
		}

		if errorCode, ok := apiResponse["error_code"].(float64); ok {
			errorCodeInt = int(errorCode)
		}

		return FmResponse{
			Success:   false,
			Message:   message,
			ErrorCode: errorCodeInt,
			Status:    statusInt,
			Data:      []FmSongData{},
		}
	}
}

// GetPersonalFMSimple 获取私人FM歌曲（简化版本）
func (h *HomepageService) GetPersonalFMSimple(mode string) FmResponse {
	params := FmRequestParams{
		Mode:   mode,
		Action: "play",
	}
	return h.GetPersonalFM(params)
}

// GetPersonalFMWithParams 获取私人FM歌曲（带完整参数）
func (h *HomepageService) GetPersonalFMWithParams(mode string, songPoolID int) FmResponse {
	params := FmRequestParams{
		Mode:       mode,
		Action:     "play",
		SongPoolID: songPoolID,
	}
	return h.GetPersonalFM(params)
}

// GetPersonalFMAdvanced 获取私人FM歌曲（高级参数版本）
func (h *HomepageService) GetPersonalFMAdvanced(hash, songID string, playTime int, mode string, songPoolID int, isOverplay bool, remainSongCnt int) FmResponse {
	params := FmRequestParams{
		Hash:          hash,
		SongID:        songID,
		PlayTime:      playTime,
		Mode:          mode,
		Action:        "play",
		SongPoolID:    songPoolID,
		IsOverplay:    isOverplay,
		RemainSongCnt: remainSongCnt,
	}
	return h.GetPersonalFM(params)
}

// ReportFMAction 报告私人FM操作（喜欢/不喜欢）
func (h *HomepageService) ReportFMAction(hash, songID string, action string, playTime int) FmResponse {
	params := FmRequestParams{
		Hash:     hash,
		SongID:   songID,
		Action:   action,
		PlayTime: playTime,
	}
	return h.GetPersonalFM(params)
}

// GetSongUrl 获取歌曲播放地址
func (h *HomepageService) GetSongUrl(hash string) SongUrlResponse {
	if hash == "" {
		return SongUrlResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	// 🎵 首先检查是否已缓存
	if h.cacheService != nil {
		if cachedResponse := h.cacheService.GetCachedURL(hash); cachedResponse.Success {
			log.Printf("✅ 使用缓存的播放地址: %s\n", hash)

			// 获取歌词内容
			lyricsContent := ""
			if cookie, err := h.readCookieFromFile(); err == nil {
				if lyricsData, err := h.searchLyrics(hash, cookie); err == nil {
					if lyrics, err := h.getLyrics(lyricsData.ID, lyricsData.AccessKey, cookie); err == nil {
						lyricsContent = lyrics
					}
				}
			}

			return SongUrlResponse{
				Success:   true,
				Message:   "获取缓存播放地址成功",
				ErrorCode: 0,
				Data: SongUrlData{
					URLs:      []string{cachedResponse.Data},
					Lyrics:    lyricsContent,
				},
			}
		}
	}

	// 🎵 如果没有缓存，从API获取播放地址
	log.Printf("🎵 从API获取播放地址: %s\n", hash)

	// 读取cookie
	cookie, err := h.readCookieFromFile()
	if err != nil {
		return SongUrlResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/song/url", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("hash", hash)
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return SongUrlResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SongUrlResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return SongUrlResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SongUrlResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 简化日志记录
	log.Printf("🎵 GetSongUrl API调用成功\n")

	// 收集所有播放地址用于缓存和返回
	var remoteUrls []string
	seenUrls := make(map[string]struct{})
	appendUniqueURL := func(raw string) {
		urlStr := strings.TrimSpace(raw)
		if urlStr == "" {
			return
		}
		if _, exists := seenUrls[urlStr]; exists {
			return
		}
		seenUrls[urlStr] = struct{}{}
		remoteUrls = append(remoteUrls, urlStr)
	}

	// 从$.url数组获取主播放地址
	if urlArray, ok := apiResponse["url"].([]any); ok && len(urlArray) > 0 {
		for _, urlItem := range urlArray {
			if urlStr, ok := urlItem.(string); ok {
				appendUniqueURL(urlStr)
			}
		}
	}

	// 从$.backupUrl数组获取备用播放地址
	if backupUrlArray, ok := apiResponse["backupUrl"].([]any); ok && len(backupUrlArray) > 0 {
		for _, backupUrlItem := range backupUrlArray {
			if backupUrlStr, ok := backupUrlItem.(string); ok {
				appendUniqueURL(backupUrlStr)
			}
		}
	}

	// 获取歌词内容
	lyricsContent := ""
	if lyricsData, err := h.searchLyrics(hash, cookie); err == nil {
		if lyrics, err := h.getLyrics(lyricsData.ID, lyricsData.AccessKey, cookie); err == nil {
			lyricsContent = lyrics
		}
	}

	// 如果获取到播放地址，尝试缓存并返回本地地址
	if len(remoteUrls) > 0 {

		log.Printf("✅ 获取到 %d 个播放地址\n", len(remoteUrls))

		// 🎵 后台异步缓存音频文件，但不改变当前这次播放地址
		go func() {
			if h.cacheService != nil {
				log.Printf("🎵 开始异步缓存音频文件: %s\n", hash)
				cacheResponse := h.cacheService.CacheAudioFile(hash, remoteUrls)
				if cacheResponse.Success {
					log.Printf("✅ 音频文件缓存成功: %s -> %s\n", hash, cacheResponse.Data)
				} else {
					log.Printf("❌ 音频文件缓存失败: %s, 错误: %s\n", hash, cacheResponse.Message)
				}
			}
		}()

		return SongUrlResponse{
			Success:   true,
			Message:   "获取播放地址成功",
			ErrorCode: 0,
			Data: SongUrlData{
				URLs:   remoteUrls,
				Lyrics: lyricsContent,
			},
		}
	}

	// 如果没有获取到播放地址，返回失败
	{
		message := "获取播放地址失败"
		errorCodeInt := -1
		statusInt := 0

		// 尝试从响应中获取错误信息
		if msg, ok := apiResponse["message"].(string); ok && msg != "" {
			message = msg
		} else if status, ok := apiResponse["status"].(float64); ok {
			message = fmt.Sprintf("获取播放地址失败，状态码: %.0f", status)
			statusInt = int(status)
		}

		if errorCode, ok := apiResponse["error_code"].(float64); ok {
			errorCodeInt = int(errorCode)
		}

		return SongUrlResponse{
			Success:   false,
			Message:   message,
			ErrorCode: errorCodeInt,
			Status:    statusInt,
			Data:      SongUrlData{},
		}
	}
}

// searchLyrics 搜索歌词
func (h *HomepageService) searchLyrics(hash string, cookie string) (*LyricsSearchData, error) {
	if hash == "" {
		return nil, fmt.Errorf("歌曲hash不能为空")
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search/lyric", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("hash", hash)
	queryParams.Add("cookie", cookie)
	queryParams.Add("man", "no") // 只返回一个歌词

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, fmt.Errorf("解析响应失败: %v", err)
	}

	// 检查是否有candidates数组
	if candidates, ok := apiResponse["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if candidate, ok := candidates[0].(map[string]interface{}); ok {
			lyricsData := &LyricsSearchData{}

			if id, ok := candidate["id"].(string); ok {
				lyricsData.ID = id
			}

			if accesskey, ok := candidate["accesskey"].(string); ok {
				lyricsData.AccessKey = accesskey
			}

			if score, ok := candidate["score"].(float64); ok {
				lyricsData.Score = int(score)
			}

			return lyricsData, nil
		}
	}

	return nil, fmt.Errorf("未找到歌词信息")
}

// getLyrics 获取歌词内容，优先尝试KRC格式，失败时降级到LRC格式
func (h *HomepageService) getLyrics(id string, accesskey string, cookie string) (string, error) {
	if id == "" || accesskey == "" {
		return "", fmt.Errorf("歌词ID或AccessKey不能为空")
	}

	// 首先尝试获取KRC格式歌词（包含逐字时间戳）
	krcLyrics, err := h.getLyricsWithFormat(id, accesskey, cookie, "krc")
	if err == nil && krcLyrics != "" {
		log.Printf("✅ 获取到KRC格式歌词，长度: %d\n", len(krcLyrics))
		return krcLyrics, nil
	}

	log.Printf("⚠️ KRC格式歌词获取失败，降级到LRC格式: %v\n", err)

	// 降级到LRC格式
	lrcLyrics, err := h.getLyricsWithFormat(id, accesskey, cookie, "lrc")
	if err == nil && lrcLyrics != "" {
		log.Printf("✅ 获取到LRC格式歌词，长度: %d\n", len(lrcLyrics))
		return lrcLyrics, nil
	}

	return "", fmt.Errorf("获取歌词失败: %v", err)
}

// getLyricsWithFormat 获取指定格式的歌词内容
func (h *HomepageService) getLyricsWithFormat(id string, accesskey string, cookie string, format string) (string, error) {
	// 构建请求URL
	requestURL := fmt.Sprintf("%s/lyric", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("id", id)
	queryParams.Add("accesskey", accesskey)
	queryParams.Add("decode", "true")
	queryParams.Add("fmt", format)
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %v", err)
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return "", fmt.Errorf("解析响应失败: %v", err)
	}

	// 获取解码后的歌词内容
	if decodeContent, ok := apiResponse["decodeContent"].(string); ok {
		return decodeContent, nil
	}

	return "", fmt.Errorf("未找到歌词内容")
}

// GetDailyRecommend 获取每日推荐歌曲
func (h *HomepageService) GetDailyRecommend(platform string) DailyRecommendResponse {
	// 设置默认平台
	if platform == "" {
		platform = "ios"
	}

	// 读取cookie
	cookie, err := h.readCookieFromFile()
	if err != nil {
		return DailyRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/everyday/recommend", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("cookie", cookie)
	queryParams.Add("platform", platform)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return DailyRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return DailyRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return DailyRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var objResponse map[string]any
	if err := json.Unmarshal(body, &objResponse); err != nil {
		return DailyRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查是否有data字段
	dataField, ok := objResponse["data"]
	if !ok {
		return DailyRecommendResponse{
			Success: false,
			Message: "响应中没有data字段",
		}
	}

	// 获取data对象
	dataObj, ok := dataField.(map[string]any)
	if !ok {
		return DailyRecommendResponse{
			Success: false,
			Message: "data字段格式不正确",
		}
	}

	// 获取song_list数组
	songListField, ok := dataObj["song_list"]
	if !ok {
		return DailyRecommendResponse{
			Success: false,
			Message: "data中没有song_list字段",
		}
	}

	songList, ok := songListField.([]any)
	if !ok {
		return DailyRecommendResponse{
			Success: false,
			Message: "song_list字段格式不正确",
		}
	}

	var apiResponse []map[string]any
	for _, item := range songList {
		if itemMap, ok := item.(map[string]any); ok {
			apiResponse = append(apiResponse, itemMap)
		}
	}

	// 转换为前端需要的格式
	var dailyRecommendList []DailyRecommendData
	for _, item := range apiResponse {
		song := DailyRecommendData{}

		// 安全地提取字段
		if hash, ok := item["hash"].(string); ok {
			song.Hash = hash
		}
		if songname, ok := item["songname"].(string); ok {
			song.SongName = songname
		}
		if authorName, ok := item["author_name"].(string); ok {
			song.AuthorName = authorName
		}
		if albumName, ok := item["album_name"].(string); ok {
			song.AlbumName = albumName
		}
		if albumID, ok := item["album_id"].(string); ok {
			song.AlbumID = albumID
		}
		if filename, ok := item["filename"].(string); ok {
			song.FileName = filename
		} else {
			// 如果没有filename字段，使用默认格式
			song.FileName = fmt.Sprintf("%s - %s", song.AuthorName, song.SongName)
		}
		// 处理时长字段，优先使用time_length字段
		if timeLength, ok := item["time_length"].(float64); ok {
			song.TimeLength = int(timeLength)
		} else if timeLengthInt, ok := item["time_length"].(int); ok {
			song.TimeLength = timeLengthInt
		} else if timeLengthStr, ok := item["time_length"].(string); ok {
			if len(timeLengthStr) > 0 {
				var timeInt int
				fmt.Sscanf(timeLengthStr, "%d", &timeInt)
				song.TimeLength = timeInt
			}
		} else if timelength320, ok := item["timelength_320"].(float64); ok {
			song.TimeLength = int(timelength320)
		} else if timelength320Int, ok := item["timelength_320"].(int); ok {
			song.TimeLength = timelength320Int
		} else if timelength320Str, ok := item["timelength_320"].(string); ok {
			if len(timelength320Str) > 0 {
				var timeInt int
				fmt.Sscanf(timelength320Str, "%d", &timeInt)
				song.TimeLength = timeInt
			}
		} else if timelength, ok := item["timelength"].(float64); ok {
			song.TimeLength = int(timelength)
		} else if timelengthInt, ok := item["timelength"].(int); ok {
			song.TimeLength = timelengthInt
		}
		if unionCover, ok := item["sizable_cover"].(string); ok {
			song.UnionCover = unionCover
		}

		// 从relate_goods数组中提取专辑信息
		if relateGoods, ok := item["relate_goods"].([]any); ok && len(relateGoods) > 0 {
			if firstGoods, ok := relateGoods[0].(map[string]any); ok {
				if albumname, ok := firstGoods["album_name"].(string); ok {
					song.AlbumName = albumname
				}
			}
			if len(relateGoods) > 1 {
				if secondGoods, ok := relateGoods[1].(map[string]any); ok {
					if albumId, ok := secondGoods["album_id"].(string); ok {
						song.AlbumID = albumId
					}
				}
			}
		}

		dailyRecommendList = append(dailyRecommendList, song)
	}

	return DailyRecommendResponse{
		Success: true,
		Message: "获取每日推荐成功",
		Data:    dailyRecommendList,
	}
}

// GetAIRecommend 获取AI推荐歌曲
func (h *HomepageService) GetAIRecommend() AIRecommendResponse {
	log.Println("🤖 开始获取AI推荐歌曲...")

	// 读取cookie
	cookie, err := h.readCookieFromFile()
	if err != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 首先获取我喜欢的歌曲列表，提取hash用于AI推荐
	// 使用通用的歌单API获取"我喜欢的"歌曲
	favoritesService := &FavoritesService{}

	// 读取cookie获取用户ID
	cookie, err2 := favoritesService.readCookieFromFile()
	if err2 != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err2),
		}
	}

	userid, err3 := favoritesService.getUserIDFromCookie(cookie)
	if err3 != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("获取用户ID失败: %v", err3),
		}
	}

	// 构建我喜欢的歌单ID
	favoritesPlaylistId := fmt.Sprintf("collection_3_%d_2_0", userid)

	// 使用专门的AI推荐方法获取更多我喜欢的歌曲
	favoritesResponse := favoritesService.GetFavoriteSongsForAI(favoritesPlaylistId)

	if !favoritesResponse.Success {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("获取我喜欢的歌曲失败: %s", favoritesResponse.Message),
		}
	}

	// 提取歌曲hash，最多50个，用逗号拼接（提高AI推荐准确性）
	var allValidSongs []AlbumSongData
	for _, song := range favoritesResponse.Data {
		if song.Hash != "" {
			allValidSongs = append(allValidSongs, song)
		}
	}

	if len(allValidSongs) == 0 {
		return AIRecommendResponse{
			Success: false,
			Message: "我喜欢的歌曲中没有找到有效的歌曲hash",
		}
	}

	// 智能选择歌曲策略：
	// 1. 如果歌曲数量 <= 30，全部使用
	// 2. 如果歌曲数量 > 30，随机选择30首以增加推荐多样性
	maxSongs := 30
	var selectedSongs []AlbumSongData

	if len(allValidSongs) <= maxSongs {
		selectedSongs = allValidSongs
		log.Printf("使用全部%d首我喜欢的歌曲用于AI推荐", len(selectedSongs))
	} else {
		// 随机选择30首歌曲
		selectedSongs = make([]AlbumSongData, maxSongs)

		// 使用简单的随机选择算法
		rand.Seed(time.Now().UnixNano())

		// 创建索引数组
		indices := make([]int, len(allValidSongs))
		for i := range indices {
			indices[i] = i
		}

		// 随机打乱索引
		for i := len(indices) - 1; i > 0; i-- {
			j := rand.Intn(i + 1)
			indices[i], indices[j] = indices[j], indices[i]
		}

		// 选择前30首
		for i := 0; i < maxSongs; i++ {
			selectedSongs[i] = allValidSongs[indices[i]]
		}

		log.Printf("从%d首我喜欢的歌曲中随机选择%d首用于AI推荐", len(allValidSongs), maxSongs)
	}

	// 提取选中歌曲的hash
	var songHashes []string
	for _, song := range selectedSongs {
		songHashes = append(songHashes, song.Hash)
	}

	albumAudioIds := strings.Join(songHashes, ",")
	log.Printf("AI推荐使用的歌曲数量: %d", len(songHashes))
	log.Printf("AI推荐使用的歌曲hash前10个: %s", func() string {
		if len(songHashes) > 10 {
			return strings.Join(songHashes[:10], ",") + "..."
		}
		return albumAudioIds
	}())

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/ai/recommend", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("album_audio_id", albumAudioIds)
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用AI推荐API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	log.Printf("AI推荐API响应状态码: %d", resp.StatusCode)

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var objResponse map[string]any
	if err := json.Unmarshal(body, &objResponse); err != nil {
		return AIRecommendResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应状态
	if status, ok := objResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "AI推荐API请求失败"
		if msg, ok := objResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AIRecommendResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 检查是否有data字段
	dataField, ok := objResponse["data"]
	if !ok {
		return AIRecommendResponse{
			Success: false,
			Message: "响应中没有data字段",
		}
	}

	// 获取data对象
	dataObj, ok := dataField.(map[string]any)
	if !ok {
		return AIRecommendResponse{
			Success: false,
			Message: "data字段格式不正确",
		}
	}

	// 获取song_list数组
	songListField, ok := dataObj["song_list"]
	if !ok {
		return AIRecommendResponse{
			Success: false,
			Message: "data中没有song_list字段",
		}
	}

	songList, ok := songListField.([]any)
	if !ok {
		return AIRecommendResponse{
			Success: false,
			Message: "song_list字段格式不正确",
		}
	}

	var aiRecommendList []AIRecommendData
	for _, item := range songList {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}

		song := AIRecommendData{}

		// 按照用户提供的数据对应关系进行映射
		// hash: $.data.song_list[0].hash
		if hash, ok := itemMap["hash"].(string); ok {
			song.Hash = hash
		}

		// songname: $.data.song_list[0].songname
		if songname, ok := itemMap["songname"].(string); ok {
			song.SongName = songname
		}

		// filename: $.data.song_list[0].filename
		if filename, ok := itemMap["filename"].(string); ok {
			song.FileName = filename
		}

		// timelength: $.data.song_list[0].time_length
		if timeLength, ok := itemMap["time_length"].(float64); ok {
			song.TimeLength = int(timeLength)
		} else if timeLengthInt, ok := itemMap["time_length"].(int); ok {
			song.TimeLength = timeLengthInt
		}

		// albumname: $.data.song_list[0].relate_goods[0].albumname
		if relateGoods, ok := itemMap["relate_goods"].([]any); ok && len(relateGoods) > 0 {
			if firstGoods, ok := relateGoods[0].(map[string]any); ok {
				if albumname, ok := firstGoods["albumname"].(string); ok {
					song.AlbumName = albumname
				}
			}
		}

		// album_id: $.data.song_list[0].album_id
		if albumID, ok := itemMap["album_id"].(string); ok {
			song.AlbumID = albumID
		} else if albumIDFloat, ok := itemMap["album_id"].(float64); ok {
			song.AlbumID = fmt.Sprintf("%.0f", albumIDFloat)
		}

		// author_name: $.data.song_list[0].author_name
		if authorName, ok := itemMap["author_name"].(string); ok {
			song.AuthorName = authorName
		}

		// union_cover: $.data.song_list[0].trans_param.union_cover
		if transParam, ok := itemMap["trans_param"].(map[string]any); ok {
			if unionCover, ok := transParam["union_cover"].(string); ok {
				song.UnionCover = unionCover
			}
		}

		aiRecommendList = append(aiRecommendList, song)
	}

	log.Printf("成功获取AI推荐歌曲，共%d首", len(aiRecommendList))

	return AIRecommendResponse{
		Success: true,
		Message: "获取AI推荐成功",
		Data:    aiRecommendList,
	}
}
