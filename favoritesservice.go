package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// FavoritesService 处理我喜欢的页面相关的服务
type FavoritesService struct{}

// processSongName 处理歌曲名称：去掉艺术家名称、扩展名和"- "分隔符
func (f *FavoritesService) processSongName(originalName string) string {
	if originalName == "" {
		return ""
	}

	songName := originalName

	// 去掉文件扩展名
	if lastDot := strings.LastIndex(songName, "."); lastDot != -1 {
		songName = songName[:lastDot]
	}

	// 查找 " - " 分隔符，取后面的部分作为歌曲名
	if dashIndex := strings.Index(songName, " - "); dashIndex != -1 {
		songName = songName[dashIndex+3:] // +3 是为了跳过 " - "
	}

	// 去掉首尾空格
	songName = strings.TrimSpace(songName)

	return songName
}

// 删除专门的我喜欢的数据结构，使用通用的歌单数据结构

// AddFavoriteRequest 添加收藏请求结构
type AddFavoriteRequest struct {
	SongName string `json:"songname"`
	Hash     string `json:"hash"`
}

// AddFavoriteResponse 添加收藏响应结构
type AddFavoriteResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	ErrorCode int    `json:"error_code"`
	Status    int    `json:"status"`
	Data      string `json:"data"`
}

// readCookieFromFile 从全局Cookie管理器读取cookie
func (f *FavoritesService) readCookieFromFile() (string, error) {
	cookie := GlobalCookieManager.GetCookie()
	return cookie, nil
}

// getUserIDFromCookie 从cookie中提取用户ID
func (f *FavoritesService) getUserIDFromCookie(cookie string) (int64, error) {
	if cookie == "" {
		return 0, fmt.Errorf("cookie为空")
	}

	// cookie格式通常为: "token=xxx;userid=123"
	parts := strings.Split(cookie, ";")
	if len(parts) < 2 {
		return 0, fmt.Errorf("cookie格式不正确")
	}

	// 查找userid部分
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "userid=") {
			useridStr := strings.TrimPrefix(part, "userid=")
			userid, err := strconv.ParseInt(useridStr, 10, 64)
			if err != nil {
				return 0, fmt.Errorf("解析用户ID失败: %v", err)
			}
			return userid, nil
		}
	}

	return 0, fmt.Errorf("在cookie中未找到用户ID")
}

// 删除专门的GetFavoritesSongs方法，使用通用的歌单逻辑

// AddFavorite 添加歌曲到我喜欢的
func (f *FavoritesService) AddFavorite(request AddFavoriteRequest) AddFavoriteResponse {
	log.Printf("开始添加收藏歌曲: %s - %s", request.SongName, request.Hash)

	// 验证请求参数
	if request.Hash == "" {
		return AddFavoriteResponse{
			Success: false,
			Message: "歌曲hash不能为空",
		}
	}

	if request.SongName == "" {
		return AddFavoriteResponse{
			Success: false,
			Message: "歌曲名称不能为空",
		}
	}

	// 读取cookie
	cookie, err := f.readCookieFromFile()
	if err != nil {
		return AddFavoriteResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/playlist/tracks/add", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("listid", "2") // 我喜欢的歌单ID固定为2
	queryParams.Add("data", fmt.Sprintf("%s|%s", request.SongName, request.Hash))
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用添加收藏API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return AddFavoriteResponse{
			Success: false,
			Message: fmt.Sprintf("请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return AddFavoriteResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	log.Printf("添加收藏API响应状态码: %d", resp.StatusCode)

	// 打印响应内容用于调试
	bodyStr := string(body)
	if len(bodyStr) > 500 {
		log.Printf("添加收藏API响应前500字符: %s", bodyStr[:500])
	} else {
		log.Printf("添加收藏API响应: %s", bodyStr)
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return AddFavoriteResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "添加收藏失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return AddFavoriteResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	log.Printf("成功添加收藏歌曲: %s", request.SongName)

	return AddFavoriteResponse{
		Success:   true,
		Message:   "添加收藏成功",
		ErrorCode: 0,
		Status:    0,
		Data:      "",
	}
}

// PlaylistData 歌单数据结构
type PlaylistData struct {
	GlobalCollectionID string `json:"global_collection_id"`
	ListID             int    `json:"listid"`
	Name               string `json:"name"`
	Intro              string `json:"intro"`
	UnionCover         string `json:"union_cover"`
	Count              int    `json:"count"`
	Type               int    `json:"type"` // 0-我创建的，1-我收藏的
	CreateTime         int64  `json:"create_time"`
	UpdateTime         int64  `json:"update_time"`
	CreateUserPic      string `json:"create_user_pic"`
	CreateUsername     string `json:"create_username"`
}

// PlaylistResponse 歌单响应结构
type PlaylistResponse = ApiResponse[[]PlaylistData]

// GetUserPlaylists 获取用户歌单
func (f *FavoritesService) GetUserPlaylists() PlaylistResponse {
	log.Println("开始获取用户歌单...")

	// 读取cookie
	cookie, err := f.readCookieFromFile()
	if err != nil {
		return PlaylistResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/user/playlist", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("cookie", cookie)
	queryParams.Add("pagesize", "100")

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用用户歌单API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return PlaylistResponse{
			Success: false,
			Message: fmt.Sprintf("请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return PlaylistResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	log.Printf("用户歌单API响应状态码: %d", resp.StatusCode)

	// 打印响应内容用于调试
	bodyStr := string(body)
	if len(bodyStr) > 1000 {
		log.Printf("用户歌单API响应前1000字符: %s", bodyStr[:1000])
	} else {
		log.Printf("用户歌单API响应: %s", bodyStr)
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return PlaylistResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); !ok || status != 1 {
		errorMsg := "API请求失败"
		if msg, ok := apiResponse["error"].(string); ok {
			errorMsg = msg
		}
		return PlaylistResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data对象
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return PlaylistResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	dataMap, ok := dataInterface.(map[string]interface{})
	if !ok {
		return PlaylistResponse{
			Success: false,
			Message: "data字段格式错误",
		}
	}

	// 获取info数组
	infoInterface, infoExists := dataMap["info"]
	if !infoExists {
		return PlaylistResponse{
			Success: false,
			Message: "响应中缺少info字段",
		}
	}

	infoArray, ok := infoInterface.([]interface{})
	if !ok {
		return PlaylistResponse{
			Success: false,
			Message: "info字段格式错误",
		}
	}

	// 转换为前端需要的格式
	var playlistsList []PlaylistData

	// 遍历info数组，每个元素代表一个歌单
	for i, infoItem := range infoArray {
		infoMap, ok := infoItem.(map[string]interface{})
		if !ok {
			log.Printf("跳过无效的info[%d]项", i)
			continue
		}

		playlist := PlaylistData{}

		// global_collection_id
		if globalCollectionID, ok := infoMap["global_collection_id"].(string); ok {
			playlist.GlobalCollectionID = globalCollectionID
		}

		// listid
		if listID, ok := infoMap["listid"].(float64); ok {
			playlist.ListID = int(listID)
		}

		// name - 歌单名称
		if name, ok := infoMap["name"].(string); ok {
			playlist.Name = name
		}

		// intro - 歌单说明
		if intro, ok := infoMap["intro"].(string); ok {
			playlist.Intro = intro
		}

		// pic - 封面
		if pic, ok := infoMap["pic"].(string); ok {
			playlist.UnionCover = pic
		}

		// count - 歌曲总数
		if count, ok := infoMap["count"].(float64); ok {
			playlist.Count = int(count)
		}

		// type - 歌单类型，0-我创建的，1-我收藏的
		if playlistType, ok := infoMap["type"].(float64); ok {
			playlist.Type = int(playlistType)
		}

		// create_time - 创建时间
		if createTime, ok := infoMap["create_time"].(float64); ok {
			playlist.CreateTime = int64(createTime)
		}

		// update_time - 更新时间
		if updateTime, ok := infoMap["update_time"].(float64); ok {
			playlist.UpdateTime = int64(updateTime)
		}

		// create_user_pic - 创建者头像
		if createUserPic, ok := infoMap["create_user_pic"].(string); ok {
			playlist.CreateUserPic = createUserPic
		}

		// list_create_username - 创建者用户名
		if createUsername, ok := infoMap["list_create_username"].(string); ok {
			playlist.CreateUsername = createUsername
		}

		playlistsList = append(playlistsList, playlist)
	}

	log.Printf("成功获取用户歌单，共%d个", len(playlistsList))

	return PlaylistResponse{
		Success:   true,
		Message:   "获取用户歌单成功",
		ErrorCode: 0,
		Status:    0,
		Data:      playlistsList,
	}
}

// GetPlaylistSongs 获取歌单歌曲列表
func (f *FavoritesService) GetPlaylistSongs(globalCollectionID string) AlbumSongsResponse {
	log.Printf("开始获取歌单歌曲列表，globalCollectionID: %s", globalCollectionID)

	if globalCollectionID == "" {
		return AlbumSongsResponse{
			Success: false,
			Message: "歌单ID不能为空",
		}
	}

	// 读取cookie
	cookie, err := f.readCookieFromFile()
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
	queryParams.Add("id", globalCollectionID)
	queryParams.Add("pagesize", "200")
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用歌单歌曲API: %s", requestURL)

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		log.Printf("歌单歌曲API请求失败: %v", err)
		return AlbumSongsResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	log.Printf("歌单歌曲API响应状态码: %d", resp.StatusCode)

	// 打印响应内容用于调试
	// bodyStr := string(body)
	// if len(bodyStr) > 1000 {
	// 	log.Printf("歌单歌曲API响应前1000字符: %s", bodyStr[:1000])
	// } else {
	// 	log.Printf("歌单歌曲API响应: %s", bodyStr)
	// }

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return AlbumSongsResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); ok && status != 1 {
		message := "获取歌单歌曲失败"
		if msg, ok := apiResponse["error"].(string); ok {
			message = msg
		}
		return AlbumSongsResponse{
			Success: false,
			Message: message,
		}
	}

	// 提取data字段
	data, ok := apiResponse["data"].(map[string]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "响应数据格式错误",
		}
	}

	// 提取info字段（歌曲列表）
	info, ok := data["info"].([]interface{})
	if !ok {
		return AlbumSongsResponse{
			Success: false,
			Message: "歌曲列表数据格式错误",
		}
	}

	// 解析歌曲数据 - 转换为AlbumSongData格式
	var songs []AlbumSongData
	for i, songItem := range info {
		songMap, ok := songItem.(map[string]interface{})
		if !ok {
			log.Printf("跳过无效的歌曲项[%d]", i)
			continue
		}

		song := AlbumSongData{}

		// hash
		if hash, ok := songMap["hash"].(string); ok {
			song.Hash = hash
		}

		// songname - 从name字段获取，并处理格式
		if name, ok := songMap["name"].(string); ok {
			song.SongName = f.processSongName(name)
		}

		// filename - 从trans_param中获取
		if transParam, ok := songMap["trans_param"].(map[string]interface{}); ok {
			// 尝试从不同的字段获取filename
			if filename, ok := transParam["filename"].(string); ok {
				song.FileName = filename
			}
		}

		// author_name - 从singerinfo获取
		if singerInfo, ok := songMap["singerinfo"].([]interface{}); ok && len(singerInfo) > 0 {
			if singer, ok := singerInfo[0].(map[string]interface{}); ok {
				if singerName, ok := singer["name"].(string); ok {
					song.AuthorName = singerName
				}
			}
		}

		// album_name - 从albuminfo获取
		if albumInfo, ok := songMap["albuminfo"].(map[string]interface{}); ok {
			if albumName, ok := albumInfo["name"].(string); ok {
				song.AlbumName = albumName
			}
		}

		// album_id
		if albumID, ok := songMap["album_id"].(string); ok {
			song.AlbumID = albumID
		} else if albumIDFloat, ok := songMap["album_id"].(float64); ok {
			song.AlbumID = fmt.Sprintf("%.0f", albumIDFloat)
		}

		// time_length - 从timelen获取，转换为秒
		if timelen, ok := songMap["timelen"].(float64); ok {
			song.TimeLength = int(timelen / 1000)
		} else if timelenInt, ok := songMap["timelen"].(int); ok {
			song.TimeLength = timelenInt / 1000
		}

		// union_cover - 从trans_param中获取
		if transParam, ok := songMap["trans_param"].(map[string]interface{}); ok {
			if unionCover, ok := transParam["union_cover"].(string); ok {
				song.UnionCover = unionCover
			}
		}

		// mixsongid字段在AlbumSongData中不存在，跳过

		// 只添加有效的歌曲（至少有hash）
		if song.Hash != "" {
			songs = append(songs, song)
		}
	}

	log.Printf("成功获取歌单歌曲列表，共%d首歌曲", len(songs))

	return AlbumSongsResponse{
		Success:   true,
		Message:   "获取歌单歌曲成功",
		ErrorCode: 0,
		Status:    0,
		Data:      songs,
	}
}
