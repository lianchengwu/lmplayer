package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

// FavoritesSongData 我喜欢的歌曲数据结构
type FavoritesSongData struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	FileName   string `json:"filename"`
	TimeLength int    `json:"time_length"`
	AlbumName  string `json:"album_name"`
	AlbumID    string `json:"album_id"`
	AuthorName string `json:"author_name"`
	UnionCover string `json:"union_cover"`
	Mixsongid  int    `json:"mixsongid"`
}

// FavoritesSongResponse 我喜欢的歌曲响应结构
type FavoritesSongResponse = ApiResponse[[]FavoritesSongData]

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

// GetFavoritesSongs 获取我喜欢的歌曲
func (f *FavoritesService) GetFavoritesSongs(page int, pageSize int) FavoritesSongResponse {
	log.Printf("开始获取我喜欢的歌曲，页码: %d, 页大小: %d", page, pageSize)

	// 设置默认值
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := f.readCookieFromFile()
	if err != nil {
		return FavoritesSongResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/playlist/track/all/new", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("listid", "2") // 我喜欢的歌单ID固定为2
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
	queryParams.Add("cookie", cookie)

	// 添加查询参数到URL
	requestURL += "?" + queryParams.Encode()

	log.Printf("调用我喜欢的歌曲API: %s", requestURL)

	// 创建HTTP客户端，设置超时（增加超时时间，因为可能需要多次请求）
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return FavoritesSongResponse{
			Success: false,
			Message: fmt.Sprintf("请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return FavoritesSongResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	log.Printf("我喜欢的歌曲API响应状态码: %d", resp.StatusCode)

	// 打印响应内容用于调试
	bodyStr := string(body)
	if len(bodyStr) > 1000 {
		log.Printf("我喜欢的歌曲API响应前1000字符: %s", bodyStr[:1000])
	} else {
		log.Printf("我喜欢的歌曲API响应: %s", bodyStr)
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return FavoritesSongResponse{
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
		return FavoritesSongResponse{
			Success: false,
			Message: errorMsg,
		}
	}

	// 获取data对象
	dataInterface, ok := apiResponse["data"]
	if !ok {
		return FavoritesSongResponse{
			Success: false,
			Message: "响应中缺少data字段",
		}
	}

	dataMap, ok := dataInterface.(map[string]interface{})
	if !ok {
		return FavoritesSongResponse{
			Success: false,
			Message: "data字段格式错误",
		}
	}

	// 获取info数组和song_list数组
	infoInterface, infoExists := dataMap["info"]
	songListInterface, songListExists := dataMap["song_list"]

	if !infoExists {
		return FavoritesSongResponse{
			Success: false,
			Message: "响应中缺少info字段",
		}
	}

	infoArray, ok := infoInterface.([]interface{})
	if !ok {
		return FavoritesSongResponse{
			Success: false,
			Message: "info字段格式错误",
		}
	}

	// song_list字段可能不存在，如果不存在就使用空数组
	var songListArray []interface{}
	if songListExists {
		songListArray, ok = songListInterface.([]interface{})
		if !ok {
			log.Printf("song_list字段格式错误，将使用空数组")
			songListArray = []interface{}{}
		}
	}

	// 转换为前端需要的格式
	var favoritesSongsList []FavoritesSongData

	// 根据用户提供的数据对应关系进行映射
	// hash: $.data.info[0].hash
	// songname: $.data.info[0].name
	// filename: $.data.song_list[0].filename
	// timelength: $.data.info[0].timelen/1000
	// albumname: $.data.info[0].albuminfo.name
	// album_id: $.data.info[0].album_id
	// author_name: $.data.info[0].singerinfo[0].name
	// union_cover: $.data.info[0].cover

	// 遍历info数组，每个元素代表一首歌曲
	for i, infoItem := range infoArray {
		infoMap, ok := infoItem.(map[string]interface{})
		if !ok {
			log.Printf("跳过无效的info[%d]项", i)
			continue
		}

		song := FavoritesSongData{}

		// hash: $.data.info[i].hash
		if hash, ok := infoMap["hash"].(string); ok {
			song.Hash = hash
		}

		// songname: $.data.info[i].name (修正后的映射)
		// 需要处理：去掉艺术家名称、扩展名和"- "分隔符
		if name, ok := infoMap["name"].(string); ok {
			song.SongName = f.processSongName(name)
		}

		// filename: $.data.song_list[i].filename
		if i < len(songListArray) {
			if songItem, ok := songListArray[i].(map[string]interface{}); ok {
				if filename, ok := songItem["filename"].(string); ok {
					song.FileName = filename
				}
			}
		}

		// timelength: $.data.info[i].timelen/1000
		if timelen, ok := infoMap["timelen"].(float64); ok {
			song.TimeLength = int(timelen / 1000)
		} else if timelenInt, ok := infoMap["timelen"].(int); ok {
			song.TimeLength = timelenInt / 1000
		}

		// albumname: $.data.info[i].albuminfo.name
		if albumInfo, ok := infoMap["albuminfo"].(map[string]interface{}); ok {
			if albumName, ok := albumInfo["name"].(string); ok {
				song.AlbumName = albumName
			}
		}

		// album_id: $.data.info[i].album_id
		if albumID, ok := infoMap["album_id"].(string); ok {
			song.AlbumID = albumID
		} else if albumIDFloat, ok := infoMap["album_id"].(float64); ok {
			song.AlbumID = fmt.Sprintf("%.0f", albumIDFloat)
		}

		// author_name: $.data.info[i].singerinfo[0].name
		if singerInfo, ok := infoMap["singerinfo"].([]interface{}); ok && len(singerInfo) > 0 {
			if singer, ok := singerInfo[0].(map[string]interface{}); ok {
				if singerName, ok := singer["name"].(string); ok {
					song.AuthorName = singerName
				}
			}
		}

		// union_cover: $.data.info[i].cover
		if cover, ok := infoMap["cover"].(string); ok {
			song.UnionCover = cover
		}

		// mixsongid: $.data.info[i].mixsongid
		if mixsongid, ok := infoMap["mixsongid"].(float64); ok {
			song.Mixsongid = int(mixsongid)
		}

		favoritesSongsList = append(favoritesSongsList, song)
	}

	log.Printf("成功获取我喜欢的歌曲，共%d首", len(favoritesSongsList))

	return FavoritesSongResponse{
		Success:   true,
		Message:   "获取我喜欢的歌曲成功",
		ErrorCode: 0,
		Status:    0,
		Data:      favoritesSongsList,
	}
}

// GetAllFavoritesSongs 获取所有我喜欢的歌曲（自动分页获取全部并倒序）
func (f *FavoritesService) GetAllFavoritesSongs() FavoritesSongResponse {
	log.Printf("🎵 开始获取所有我喜欢的歌曲...")

	// 首先获取用户歌单信息，拿到"我喜欢"歌单的总数
	log.Printf("📊 获取用户歌单信息以确定总歌曲数...")
	playlistsResponse := f.GetUserPlaylists()
	if !playlistsResponse.Success {
		return FavoritesSongResponse{
			Success: false,
			Message: "获取用户歌单失败: " + playlistsResponse.Message,
		}
	}

	// 找到"我喜欢"歌单（listid为2）
	var totalSongs int
	for _, playlist := range playlistsResponse.Data {
		if playlist.ListID == 2 {
			totalSongs = playlist.Count
			break
		}
	}

	if totalSongs == 0 {
		log.Printf("📊 我喜欢歌单为空")
		return FavoritesSongResponse{
			Success: true,
			Message: "我喜欢歌单为空",
			Data:    []FavoritesSongData{},
		}
	}

	log.Printf("📊 我喜欢歌单总数: %d", totalSongs)

	var allSongs []FavoritesSongData
	page := 1
	pageSize := 200                                         // 使用较大的页面大小提高效率
	expectedPages := (totalSongs + pageSize - 1) / pageSize // 向上取整
	log.Printf("📊 预期需要获取 %d 页", expectedPages)

	for {
		log.Printf("📄 获取第%d页，每页%d首", page, pageSize)

		// 调用现有的分页方法
		response := f.GetFavoritesSongs(page, pageSize)

		if !response.Success {
			log.Printf("❌ 获取第%d页失败: %s", page, response.Message)
			return FavoritesSongResponse{
				Success: false,
				Message: fmt.Sprintf("获取第%d页失败: %s", page, response.Message),
			}
		}

		if response.Data == nil || len(response.Data) == 0 {
			log.Printf("📄 第%d页没有数据，停止获取", page)
			break
		}

		// 追加当前页的歌曲
		allSongs = append(allSongs, response.Data...)
		log.Printf("✅ 第%d页获取成功，本页%d首，累计%d首", page, len(response.Data), len(allSongs))

		// 如果当前页的歌曲数量小于页面大小，说明已经是最后一页
		if len(response.Data) < pageSize {
			log.Printf("📄 第%d页歌曲数量(%d)小于页面大小(%d)，已获取全部", page, len(response.Data), pageSize)
			break
		}

		// 如果已达到预期总数，停止获取
		if len(allSongs) >= totalSongs {
			log.Printf("📄 已获取预期数量(%d)的歌曲，停止获取", totalSongs)
			break
		}

		// 如果已达到预期页数，停止获取
		if page >= expectedPages {
			log.Printf("📄 已获取预期页数(%d)，停止获取", expectedPages)
			break
		}

		page++

		// 添加短暂延迟，避免请求过于频繁
		time.Sleep(100 * time.Millisecond)
	}

	// 倒序排列（最新的在前面）
	for i, j := 0, len(allSongs)-1; i < j; i, j = i+1, j-1 {
		allSongs[i], allSongs[j] = allSongs[j], allSongs[i]
	}

	log.Printf("🎉 成功获取所有我喜欢的歌曲，共%d首，已倒序排列", len(allSongs))

	return FavoritesSongResponse{
		Success:   true,
		Message:   fmt.Sprintf("获取所有我喜欢的歌曲成功，共%d首，已倒序排列", len(allSongs)),
		ErrorCode: 0,
		Status:    0,
		Data:      allSongs,
	}
}

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
func (f *FavoritesService) GetPlaylistSongs(globalCollectionID string) FavoritesSongResponse {
	log.Printf("开始获取歌单歌曲列表，globalCollectionID: %s", globalCollectionID)

	if globalCollectionID == "" {
		return FavoritesSongResponse{
			Success: false,
			Message: "歌单ID不能为空",
		}
	}

	// 读取cookie
	cookie, err := f.readCookieFromFile()
	if err != nil {
		return FavoritesSongResponse{
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
		return FavoritesSongResponse{
			Success: false,
			Message: "API请求失败",
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return FavoritesSongResponse{
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
		return FavoritesSongResponse{
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
		return FavoritesSongResponse{
			Success: false,
			Message: message,
		}
	}

	// 提取data字段
	data, ok := apiResponse["data"].(map[string]interface{})
	if !ok {
		return FavoritesSongResponse{
			Success: false,
			Message: "响应数据格式错误",
		}
	}

	// 提取info字段（歌曲列表）
	info, ok := data["info"].([]interface{})
	if !ok {
		return FavoritesSongResponse{
			Success: false,
			Message: "歌曲列表数据格式错误",
		}
	}

	// 解析歌曲数据 - 使用与GetFavoritesSongs相同的逻辑
	var songs []FavoritesSongData
	for i, songItem := range info {
		songMap, ok := songItem.(map[string]interface{})
		if !ok {
			log.Printf("跳过无效的歌曲项[%d]", i)
			continue
		}

		song := FavoritesSongData{}

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

		// mixsongid
		if mixsongid, ok := songMap["mixsongid"].(float64); ok {
			song.Mixsongid = int(mixsongid)
		}

		// 只添加有效的歌曲（至少有hash）
		if song.Hash != "" {
			songs = append(songs, song)
		}
	}

	log.Printf("成功获取歌单歌曲列表，共%d首歌曲", len(songs))

	return FavoritesSongResponse{
		Success:   true,
		Message:   "获取歌单歌曲成功",
		ErrorCode: 0,
		Status:    0,
		Data:      songs,
	}
}
