package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// AlbumService 专辑服务
type AlbumService struct{}

// AlbumDetailData 专辑详情数据结构
type AlbumDetailData struct {
	ID             string `json:"id"`
	AlbumName      string `json:"album_name"`
	AuthorName     string `json:"author_name"`
	PublishDate    string `json:"publish_date"`
	SongCount      int    `json:"song_count"`
	UnionCover     string `json:"union_cover"`
	Description    string `json:"description"`
	PublishCompany string `json:"publish_company"`
	Language       string `json:"language"`
	Category       string `json:"category"`
}

// AlbumSongData 专辑歌曲数据结构
type AlbumSongData struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	FileName   string `json:"filename"`
	TimeLength int    `json:"time_length"`
	AlbumName  string `json:"album_name"`
	AlbumID    string `json:"album_id"`
	AuthorName string `json:"author_name"`
	UnionCover string `json:"union_cover"`
}

// AlbumDetailResponse 专辑详情响应
type AlbumDetailResponse struct {
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	ErrorCode int             `json:"error_code"`
	Status    int             `json:"status"`
	Data      AlbumDetailData `json:"data"`
}

// AlbumSongsResponse 专辑歌曲列表响应
type AlbumSongsResponse struct {
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	ErrorCode int             `json:"error_code"`
	Status    int             `json:"status"`
	Data      []AlbumSongData `json:"data"`
}

// PlaylistDetailData 歌单详情数据结构
type PlaylistDetailData struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Intro          string `json:"intro"`
	Pic            string `json:"pic"`
	Count          int    `json:"count"`
	CreateUsername string `json:"create_username"`
	CreateUserPic  string `json:"create_user_pic"`
	PublishDate    string `json:"publish_date"`
	Tags           string `json:"tags"`
	CollectTotal   int    `json:"collect_total"`
}

// PlaylistDetailResponse 歌单详情响应
type PlaylistDetailResponse struct {
	Success   bool               `json:"success"`
	Message   string             `json:"message"`
	ErrorCode int                `json:"error_code"`
	Status    int                `json:"status"`
	Data      PlaylistDetailData `json:"data"`
}

// PlaylistSongsResponse 歌单歌曲列表响应
type PlaylistSongsResponse struct {
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	ErrorCode int             `json:"error_code"`
	Status    int             `json:"status"`
	Data      []AlbumSongData `json:"data"`
}

// readCookieFromFile 从全局Cookie管理器读取cookie
func (a *AlbumService) readCookieFromFile() (string, error) {
	cookie := GlobalCookieManager.GetCookie()
	return cookie, nil
}

// GetAlbumDetail 获取专辑详情
func (a *AlbumService) GetAlbumDetail(albumID string) AlbumDetailResponse {
	log.Printf("开始获取专辑详情，专辑ID: %s", albumID)

	if albumID == "" {
		return AlbumDetailResponse{
			Success: false,
			Message: "专辑ID不能为空",
		}
	}

	// 读取cookie
	cookie, err := a.readCookieFromFile()
	if err != nil {
		return AlbumDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/album/detail", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("id", albumID)
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用专辑详情API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		log.Printf("专辑详情API请求失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取专辑详情响应失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "读取响应失败",
		}
	}

	log.Printf("专辑详情API响应状态码: %d", resp.StatusCode)

	// 检查响应状态码
	if resp.StatusCode != 200 {
		log.Printf("专辑详情API返回非200状态码: %d", resp.StatusCode)
		return AlbumDetailResponse{
			Success: false,
			Message: fmt.Sprintf("API返回状态码: %d", resp.StatusCode),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		log.Printf("解析专辑详情JSON失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "解析响应失败",
		}
	}

	// 打印完整的API响应用于调试
	log.Printf("专辑详情API完整响应: %+v", apiResponse)

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "API请求失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AlbumDetailResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data数组
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	log.Printf("专辑详情data字段类型: %T, 内容: %+v", dataInterface, dataInterface)

	dataArray, ok := dataInterface.([]interface{})
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "data字段格式错误，期望数组",
		}
	}

	if len(dataArray) == 0 {
		return AlbumDetailResponse{
			Success: false,
			Message: "专辑详情数据为空",
		}
	}

	// 获取第一个专辑详情对象
	dataMap, ok := dataArray[0].(map[string]interface{})
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "专辑详情数据格式错误",
		}
	}

	// 解析专辑详情数据
	albumDetail := AlbumDetailData{}

	if id, ok := dataMap["album_id"].(string); ok {
		albumDetail.ID = id
	} else if idFloat, ok := dataMap["album_id"].(float64); ok {
		albumDetail.ID = fmt.Sprintf("%.0f", idFloat)
	}

	if albumName, ok := dataMap["album_name"].(string); ok {
		albumDetail.AlbumName = albumName
	}

	if authorName, ok := dataMap["author_name"].(string); ok {
		albumDetail.AuthorName = authorName
	}

	if publishDate, ok := dataMap["publish_date"].(string); ok {
		albumDetail.PublishDate = publishDate
	}

	// 注意：API响应中没有song_count字段，我们暂时设为0
	albumDetail.SongCount = 0

	if description, ok := dataMap["intro"].(string); ok {
		albumDetail.Description = description
	}

	if publishCompany, ok := dataMap["publish_company"].(string); ok {
		albumDetail.PublishCompany = publishCompany
	}

	if language, ok := dataMap["language"].(string); ok {
		albumDetail.Language = language
	}

	if category, ok := dataMap["category"].(string); ok {
		albumDetail.Category = category
	}

	// 处理封面图片URL
	if sizableCover, ok := dataMap["sizable_cover"].(string); ok {
		albumDetail.UnionCover = sizableCover
	}

	log.Printf("成功获取专辑详情: %s", albumDetail.AlbumName)

	return AlbumDetailResponse{
		Success:   true,
		Message:   "获取专辑详情成功",
		ErrorCode: 0,
		Status:    0,
		Data:      albumDetail,
	}
}

// GetAlbumSongs 获取专辑歌曲列表
func (a *AlbumService) GetAlbumSongs(albumID string, page int, pageSize int) AlbumSongsResponse {
	log.Printf("开始获取专辑歌曲列表，专辑ID: %s, 页码: %d, 页大小: %d", albumID, page, pageSize)

	if albumID == "" {
		return AlbumSongsResponse{
			Success: false,
			Message: "专辑ID不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := a.readCookieFromFile()
	if err != nil {
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/album/songs", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("id", albumID)
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用专辑歌曲列表API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		log.Printf("专辑歌曲列表API请求失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取专辑歌曲列表响应失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "读取响应失败",
		}
	}

	log.Printf("专辑歌曲列表API响应状态码: %d", resp.StatusCode)

	// 检查响应状态码
	if resp.StatusCode != 200 {
		log.Printf("专辑歌曲列表API返回非200状态码: %d", resp.StatusCode)
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("API返回状态码: %d", resp.StatusCode),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		log.Printf("解析专辑歌曲列表JSON失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "解析响应失败",
		}
	}

	// 打印完整的API响应用于调试
	log.Printf("专辑歌曲列表API完整响应: %+v", apiResponse)

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "API请求失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AlbumSongsResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data对象
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	log.Printf("专辑歌曲列表data字段类型: %T, 内容: %+v", dataInterface, dataInterface)

	dataMap, ok := dataInterface.(map[string]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "data字段格式错误，期望对象",
		}
	}

	// 获取songs数组
	songsInterface, ok := dataMap["songs"]
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "响应中缺少songs字段",
		}
	}

	dataArray, ok := songsInterface.([]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "songs字段格式错误",
		}
	}

	// 转换为前端需要的格式
	var albumSongsList []AlbumSongData
	for _, item := range dataArray {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		song := AlbumSongData{}

		// 根据API文档提取字段
		// hash: $.data.songs[0].audio_info.hash
		if audioInfo, ok := itemMap["audio_info"].(map[string]interface{}); ok {
			if hash, ok := audioInfo["hash"].(string); ok {
				song.Hash = hash
			}
			// timelength: $.data.songs[0].audio_info.duration (毫秒转秒)
			if duration, ok := audioInfo["duration"].(float64); ok {
				song.TimeLength = int(duration / 1000) // 毫秒转秒
			} else if durationInt, ok := audioInfo["duration"].(int); ok {
				song.TimeLength = durationInt / 1000 // 毫秒转秒
			}
		}

		// songname: $.data.songs[0].base.audio_name
		// author_name: $.data.songs[0].base.author_name
		// album_id: $.data.songs[0].base.album_id
		if base, ok := itemMap["base"].(map[string]interface{}); ok {
			if audioName, ok := base["audio_name"].(string); ok {
				song.SongName = audioName
			}
			if authorName, ok := base["author_name"].(string); ok {
				song.AuthorName = authorName
			}
			if albumID, ok := base["album_id"].(string); ok {
				song.AlbumID = albumID
			} else if albumIDFloat, ok := base["album_id"].(float64); ok {
				song.AlbumID = fmt.Sprintf("%.0f", albumIDFloat)
			}

			// filename: $.data.songs[0].base.author_name + " - " + $.data.songs[0].base.audio_name
			if authorName, ok := base["author_name"].(string); ok {
				if audioName, ok := base["audio_name"].(string); ok {
					song.FileName = authorName + " - " + audioName
				}
			}
		}

		// albumname: $.data.songs[0].album_info.album_name
		// union_cover: $.data.songs[0].album_info.cover
		if albumInfo, ok := itemMap["album_info"].(map[string]interface{}); ok {
			if albumName, ok := albumInfo["album_name"].(string); ok {
				song.AlbumName = albumName
			}
			if cover, ok := albumInfo["cover"].(string); ok {
				song.UnionCover = cover
			}
		}

		albumSongsList = append(albumSongsList, song)
	}

	log.Printf("成功获取专辑歌曲列表，共%d首歌曲", len(albumSongsList))

	return AlbumSongsResponse{
		Success:   true,
		Message:   "获取专辑歌曲列表成功",
		ErrorCode: 0,
		Status:    0,
		Data:      albumSongsList,
	}
}

// GetPlaylistDetail 获取歌单详情
func (a *AlbumService) GetPlaylistDetail(playlistID string) AlbumDetailResponse {
	log.Printf("开始获取歌单详情，歌单ID: %s", playlistID)

	if playlistID == "" {
		return AlbumDetailResponse{
			Success: false,
			Message: "歌单ID不能为空",
		}
	}

	// 读取cookie
	cookie, err := a.readCookieFromFile()
	if err != nil {
		return AlbumDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/playlist/detail", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("ids", playlistID)
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用歌单详情API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		log.Printf("歌单详情API请求失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取歌单详情响应失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "读取响应失败",
		}
	}

	log.Printf("歌单详情API响应状态码: %d", resp.StatusCode)

	// 检查响应状态码
	if resp.StatusCode != 200 {
		log.Printf("歌单详情API返回非200状态码: %d", resp.StatusCode)
		return AlbumDetailResponse{
			Success: false,
			Message: fmt.Sprintf("API返回状态码: %d", resp.StatusCode),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		log.Printf("解析歌单详情JSON失败: %v", err)
		return AlbumDetailResponse{
			Success: false,
			Message: "解析响应失败",
		}
	}

	// 打印完整的API响应用于调试
	log.Printf("歌单详情API完整响应: %+v", apiResponse)

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "API请求失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AlbumDetailResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data数组
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	log.Printf("歌单详情data字段类型: %T, 内容: %+v", dataInterface, dataInterface)

	dataArray, ok := dataInterface.([]interface{})
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "data字段格式错误，期望数组",
		}
	}

	if len(dataArray) == 0 {
		return AlbumDetailResponse{
			Success: false,
			Message: "歌单详情数据为空",
		}
	}

	// 获取第一个歌单详情对象
	dataMap, ok := dataArray[0].(map[string]interface{})
	if !ok {
		return AlbumDetailResponse{
			Success: false,
			Message: "歌单详情数据格式错误",
		}
	}

	// 解析歌单详情数据
	playlistDetail := AlbumDetailData{}

	if globalCollectionID, ok := dataMap["global_collection_id"].(string); ok {
		playlistDetail.ID = globalCollectionID
	}
	if name, ok := dataMap["name"].(string); ok {
		playlistDetail.AlbumName = name
	}
	if authorName, ok := dataMap["list_create_username"].(string); ok {
		playlistDetail.AuthorName = authorName
	}
	if intro, ok := dataMap["intro"].(string); ok {
		playlistDetail.Description = intro
	}
	if publishDate, ok := dataMap["publish_date"].(string); ok {
		playlistDetail.PublishDate = publishDate
	}
	if pic, ok := dataMap["pic"].(string); ok {
		playlistDetail.UnionCover = pic
	}
	// 提取歌曲总数
	if count, ok := dataMap["count"].(float64); ok {
		playlistDetail.SongCount = int(count)
		log.Printf("✅ 从API响应提取歌曲总数: %d", playlistDetail.SongCount)
	} else if countInt, ok := dataMap["count"].(int); ok {
		playlistDetail.SongCount = countInt
		log.Printf("✅ 从API响应提取歌曲总数(int): %d", playlistDetail.SongCount)
	} else {
		// 打印所有可用字段以便调试
		var keys []string
		for k := range dataMap {
			keys = append(keys, k)
		}
		log.Printf("⚠️ API响应中没有找到count字段，dataMap中的所有字段: %v", keys)
		playlistDetail.SongCount = 0
	}

	log.Printf("成功获取歌单详情: %s，歌曲总数: %d", playlistDetail.AlbumName, playlistDetail.SongCount)

	return AlbumDetailResponse{
		Success:   true,
		Message:   "获取歌单详情成功",
		ErrorCode: 0,
		Status:    0,
		Data:      playlistDetail,
	}
}

// GetPlaylistSongs 获取歌单歌曲列表
func (a *AlbumService) GetPlaylistSongs(playlistID string, page int, pageSize int) AlbumSongsResponse {
	log.Printf("开始获取歌单歌曲列表，歌单ID: %s, 页码: %d, 页大小: %d", playlistID, page, pageSize)

	if playlistID == "" {
		return AlbumSongsResponse{
			Success: false,
			Message: "歌单ID不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 150 // 修改默认页面大小为150
	}

	// 读取cookie
	cookie, err := a.readCookieFromFile()
	if err != nil {
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/playlist/track/all", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("id", playlistID)
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用歌单歌曲列表API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		log.Printf("歌单歌曲列表API请求失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取歌单歌曲列表响应失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "读取响应失败",
		}
	}

	log.Printf("歌单歌曲列表API响应状态码: %d", resp.StatusCode)

	// 检查响应状态码
	if resp.StatusCode != 200 {
		log.Printf("歌单歌曲列表API返回非200状态码: %d", resp.StatusCode)
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("API返回状态码: %d", resp.StatusCode),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		log.Printf("解析歌单歌曲列表JSON失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "解析响应失败",
		}
	}

	// 打印完整的API响应用于调试
	log.Printf("歌单歌曲列表API完整响应: %+v", apiResponse)

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "API请求失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AlbumSongsResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data对象
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	log.Printf("歌单歌曲列表data字段类型: %T, 内容: %+v", dataInterface, dataInterface)

	dataMap, ok := dataInterface.(map[string]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "data字段格式错误，期望对象",
		}
	}

	// 获取songs数组
	songsInterface, ok := dataMap["songs"]
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "响应中缺少songs字段",
		}
	}

	dataArray, ok := songsInterface.([]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "songs字段格式错误，期望数组",
		}
	}

	// 转换为前端需要的格式
	var playlistSongsList []AlbumSongData
	for _, item := range dataArray {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		song := AlbumSongData{}

		// 根据API文档提取字段
		// hash: $.data.songs[0].hash
		if hash, ok := itemMap["hash"].(string); ok {
			song.Hash = hash
		}

		// songname: $.data.songs[0].base.audio_name
		if base, ok := itemMap["base"].(map[string]interface{}); ok {
			if audioName, ok := base["audio_name"].(string); ok {
				song.SongName = audioName
			}
		}

		// filename: $.data.songs[0].name
		if name, ok := itemMap["name"].(string); ok {
			song.FileName = name
		}

		// timelength: $.data.songs[0].timelen/1000
		if timelen, ok := itemMap["timelen"].(float64); ok {
			song.TimeLength = int(timelen / 1000) // 毫秒转秒
		} else if timelenInt, ok := itemMap["timelen"].(int); ok {
			song.TimeLength = timelenInt / 1000 // 毫秒转秒
		}

		// albumname: $.data.songs[0].albuminfo.name
		// album_id: $.data.songs[0].albuminfo.id
		if albuminfo, ok := itemMap["albuminfo"].(map[string]interface{}); ok {
			if albumName, ok := albuminfo["name"].(string); ok {
				song.AlbumName = albumName
			}
			if albumID, ok := albuminfo["id"].(string); ok {
				song.AlbumID = albumID
			} else if albumIDFloat, ok := albuminfo["id"].(float64); ok {
				song.AlbumID = fmt.Sprintf("%.0f", albumIDFloat)
			}
		}

		// author_name: $.data.songs[0].singerinfo[0].name
		if singerinfo, ok := itemMap["singerinfo"].([]interface{}); ok && len(singerinfo) > 0 {
			if singer, ok := singerinfo[0].(map[string]interface{}); ok {
				if singerName, ok := singer["name"].(string); ok {
					song.AuthorName = singerName
				}
			}
		}

		// union_cover: $.data.songs[0].cover
		if cover, ok := itemMap["cover"].(string); ok {
			song.UnionCover = cover
		}

		playlistSongsList = append(playlistSongsList, song)
	}

	log.Printf("成功获取歌单歌曲列表，共%d首歌曲", len(playlistSongsList))

	return AlbumSongsResponse{
		Success:   true,
		Message:   "获取歌单歌曲列表成功",
		ErrorCode: 0,
		Status:    0,
		Data:      playlistSongsList,
	}
}
