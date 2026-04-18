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

// SearchService 搜索服务结构体
type SearchService struct{}

// NewSearchService 创建搜索服务实例
func NewSearchService() *SearchService {
	return &SearchService{}
}

// SearchSongData 搜索歌曲数据结构
type SearchSongData struct {
	Hash       string `json:"hash"`
	SongName   string `json:"songname"`
	FileName   string `json:"filename"`
	TimeLength int    `json:"time_length"`
	AlbumName  string `json:"album_name"`
	AlbumID    string `json:"album_id"`
	AuthorName string `json:"author_name"`
	UnionCover string `json:"union_cover"`
}

// SearchArtistData 搜索艺人数据结构
type SearchArtistData struct {
	AuthorID   string `json:"author_id"`
	AuthorName string `json:"author_name"`
	Avatar     string `json:"avatar"`
	SongCount  int    `json:"song_count"`
}

// SearchPlaylistData 搜索歌单数据结构
type SearchPlaylistData struct {
	SpecialID   string `json:"special_id"`
	SpecialName string `json:"special_name"`
	ImgURL      string `json:"img_url"`
	PlayCount   int    `json:"play_count"`
	SongCount   int    `json:"song_count"`
	AuthorName  string `json:"author_name"`
}

// SearchAlbumData 搜索专辑数据结构
type SearchAlbumData struct {
	AlbumID    string `json:"album_id"`
	AlbumName  string `json:"album_name"`
	ImgURL     string `json:"img_url"`
	AuthorName string `json:"author_name"`
	SongCount  int    `json:"song_count"`
}

// SearchMVData 搜索MV数据结构
type SearchMVData struct {
	Hash       string `json:"hash"`
	MVName     string `json:"mv_name"`
	ImgURL     string `json:"img_url"`
	AuthorName string `json:"author_name"`
	Duration   int    `json:"time_length"`
}

// SearchResults 搜索结果数据结构
type SearchResults struct {
	Songs     ResSong     `json:"songs"`
	Artists   ResArtist   `json:"artists"`
	Playlists ResPlaylist `json:"playlists"`
	Albums    ResAlbum    `json:"albums"`
	MVs       ResMV       `json:"mvs"` // 总数量
}

type ResSong struct {
	List  []SearchSongData `json:"list"`
	Total int              `json:"total"`
}
type ResArtist struct {
	List  []SearchArtistData `json:"list"`
	Total int                `json:"total"`
}
type ResPlaylist struct {
	List  []SearchPlaylistData `json:"list"`
	Total int                  `json:"total"`
}
type ResAlbum struct {
	List  []SearchAlbumData `json:"list"`
	Total int               `json:"total"`
}
type ResMV struct {
	List  []SearchMVData `json:"list"`
	Total int            `json:"total"`
}

// SearchResponse 搜索响应结构
type SearchResponse = ApiResponse[SearchResults]

// HotSearchKeyword 热搜关键词数据结构
type HotSearchKeyword struct {
	Reason      string `json:"reason"`
	JsonURL     string `json:"json_url"`
	JumpURL     string `json:"jumpurl"`
	Keyword     string `json:"keyword"`
	IsCoverWord int    `json:"is_cover_word"`
	Type        int    `json:"type"`
	Icon        int    `json:"icon"`
}

// HotSearchCategory 热搜分类数据结构
type HotSearchCategory struct {
	Name     string             `json:"name"`
	Keywords []HotSearchKeyword `json:"keywords"`
}

// HotSearchData 热搜数据结构
type HotSearchData struct {
	Timestamp int64               `json:"timestamp"`
	List      []HotSearchCategory `json:"list"`
}

// HotSearchResponse 热搜响应结构
type HotSearchResponse = ApiResponse[HotSearchData]

// SearchSuggestData 搜索建议数据结构
type SearchSuggestData struct {
	Keyword string `json:"keyword"`
	Type    string `json:"type"`
}

// SearchSuggestResponse 搜索建议响应结构
type SearchSuggestResponse = ApiResponse[[]SearchSuggestData]

// readCookieFromFile 从全局Cookie管理器读取cookie
func (s *SearchService) readCookieFromFile() (string, error) {
	cookie := GlobalCookieManager.GetCookie()
	return cookie, nil
}

// Search 综合搜索
func (s *SearchService) Search(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search/complex", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 解析歌曲数据
			if songList, ok := data["song"].(map[string]interface{}); ok {
				if songs, ok := songList["list"].([]interface{}); ok {
					for _, songItem := range songs {
						if song, ok := songItem.(map[string]interface{}); ok {
							songData := SearchSongData{}
							if hash, ok := song["hash"].(string); ok {
								songData.Hash = hash
							}
							if songname, ok := song["songname"].(string); ok {
								songData.SongName = songname
							}
							if filename, ok := song["filename"].(string); ok {
								songData.FileName = filename
							}
							if timelength, ok := song["timelength"].(float64); ok {
								songData.TimeLength = int(timelength)
							}
							if albumname, ok := song["album_name"].(string); ok {
								songData.AlbumName = albumname
							}
							if albumID, ok := song["album_id"].(string); ok {
								songData.AlbumID = albumID
							}
							if authorName, ok := song["author_name"].(string); ok {
								songData.AuthorName = authorName
							}
							if unionCover, ok := song["union_cover"].(string); ok {
								songData.UnionCover = unionCover
							}
							results.Songs.List = append(results.Songs.List, songData)
						}
					}
				}
			}

			// 解析艺人数据
			if authorList, ok := data["author"].(map[string]interface{}); ok {
				if authors, ok := authorList["list"].([]interface{}); ok {
					for _, authorItem := range authors {
						if author, ok := authorItem.(map[string]interface{}); ok {
							artistData := SearchArtistData{}
							if authorID, ok := author["author_id"].(string); ok {
								artistData.AuthorID = authorID
							}
							if authorName, ok := author["author_name"].(string); ok {
								artistData.AuthorName = authorName
							}
							if avatar, ok := author["avatar"].(string); ok {
								artistData.Avatar = avatar
							}
							if songCount, ok := author["song_count"].(float64); ok {
								artistData.SongCount = int(songCount)
							}
							results.Artists.List = append(results.Artists.List, artistData)
						}
					}
				}
			}

			// 解析歌单数据
			if specialList, ok := data["special"].(map[string]interface{}); ok {
				if specials, ok := specialList["list"].([]interface{}); ok {
					for _, specialItem := range specials {
						if special, ok := specialItem.(map[string]interface{}); ok {
							playlistData := SearchPlaylistData{}
							if specialID, ok := special["gid"].(string); ok {
								playlistData.SpecialID = specialID
							}
							if specialName, ok := special["special_name"].(string); ok {
								playlistData.SpecialName = specialName
							}
							if imgURL, ok := special["img_url"].(string); ok {
								playlistData.ImgURL = imgURL
							}
							if playCount, ok := special["play_count"].(float64); ok {
								playlistData.PlayCount = int(playCount)
							}
							if songCount, ok := special["song_count"].(float64); ok {
								playlistData.SongCount = int(songCount)
							}
							if authorName, ok := special["author_name"].(string); ok {
								playlistData.AuthorName = authorName
							}
							results.Playlists.List = append(results.Playlists.List, playlistData)
						}
					}
				}
			}

			// 解析专辑数据
			if albumList, ok := data["album"].(map[string]interface{}); ok {
				if albums, ok := albumList["list"].([]interface{}); ok {
					for _, albumItem := range albums {
						if album, ok := albumItem.(map[string]interface{}); ok {
							albumData := SearchAlbumData{}
							if albumID, ok := album["album_id"].(float64); ok {
								albumData.AlbumID = fmt.Sprintf("%.0f", albumID)
							} else if albumIDStr, ok := album["album_id"].(string); ok {
								albumData.AlbumID = albumIDStr
							}
							if albumName, ok := album["album_name"].(string); ok {
								albumData.AlbumName = albumName
							}
							if imgURL, ok := album["img_url"].(string); ok {
								albumData.ImgURL = imgURL
							}
							if authorName, ok := album["author_name"].(string); ok {
								albumData.AuthorName = authorName
							}
							if songCount, ok := album["song_count"].(float64); ok {
								albumData.SongCount = int(songCount)
							}
							results.Albums.List = append(results.Albums.List, albumData)
						}
					}
				}
			}

			// 解析MV数据
			if mvList, ok := data["mv"].(map[string]interface{}); ok {
				if mvs, ok := mvList["list"].([]interface{}); ok {
					for _, mvItem := range mvs {
						if mv, ok := mvItem.(map[string]interface{}); ok {
							mvData := SearchMVData{}
							if hash, ok := mv["hash"].(string); ok {
								mvData.Hash = hash
							}
							if mvName, ok := mv["mv_name"].(string); ok {
								mvData.MVName = mvName
							}
							if imgURL, ok := mv["img_url"].(string); ok {
								mvData.ImgURL = imgURL
							}
							if authorName, ok := mv["author_name"].(string); ok {
								mvData.AuthorName = authorName
							}
							if duration, ok := mv["duration"].(float64); ok {
								mvData.Duration = int(duration)
							}
							results.MVs.List = append(results.MVs.List, mvData)
						}
					}
				}
			}
		}

		return SearchResponse{
			Success: true,
			Message: "搜索成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// GetHotSearch 获取热搜列表
func (s *SearchService) GetHotSearch() HotSearchResponse {
	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return HotSearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search/hot", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
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
		return HotSearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return HotSearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return HotSearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if status, ok := apiResponse["status"].(float64); ok && status == 1 {
		hotSearchData := HotSearchData{}

		// 解析热搜数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 解析时间戳
			if timestamp, ok := data["timestamp"].(float64); ok {
				hotSearchData.Timestamp = int64(timestamp)
			}

			// 解析分类列表
			if list, ok := data["list"].([]interface{}); ok {
				for _, categoryItem := range list {
					if categoryMap, ok := categoryItem.(map[string]interface{}); ok {
						category := HotSearchCategory{}

						// 解析分类名称
						if name, ok := categoryMap["name"].(string); ok {
							category.Name = name
						}

						// 解析关键词列表
						if keywords, ok := categoryMap["keywords"].([]interface{}); ok {
							for _, keywordItem := range keywords {
								if keywordMap, ok := keywordItem.(map[string]interface{}); ok {
									keyword := HotSearchKeyword{}

									if reason, ok := keywordMap["reason"].(string); ok {
										keyword.Reason = reason
									}
									if jsonURL, ok := keywordMap["json_url"].(string); ok {
										keyword.JsonURL = jsonURL
									}
									if jumpURL, ok := keywordMap["jumpurl"].(string); ok {
										keyword.JumpURL = jumpURL
									}
									if keywordText, ok := keywordMap["keyword"].(string); ok {
										keyword.Keyword = keywordText
									}
									if isCoverWord, ok := keywordMap["is_cover_word"].(float64); ok {
										keyword.IsCoverWord = int(isCoverWord)
									}
									if keywordType, ok := keywordMap["type"].(float64); ok {
										keyword.Type = int(keywordType)
									}
									if icon, ok := keywordMap["icon"].(float64); ok {
										keyword.Icon = int(icon)
									}

									category.Keywords = append(category.Keywords, keyword)
								}
							}
						}

						hotSearchData.List = append(hotSearchData.List, category)
					}
				}
			}
		}

		return HotSearchResponse{
			Success: true,
			Message: "获取热搜成功",
			Data:    hotSearchData,
		}
	}

	// 处理API错误
	errorMsg := "获取热搜失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return HotSearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// GetSearchSuggest 获取搜索建议
func (s *SearchService) GetSearchSuggest(keyword string) SearchSuggestResponse {
	if keyword == "" {
		return SearchSuggestResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchSuggestResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search/suggest", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
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
		return SearchSuggestResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchSuggestResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchSuggestResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		var suggestList []SearchSuggestData

		// 解析建议数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 解析音乐建议
			if musicTips, ok := data["music_tip"].([]interface{}); ok {
				for _, tip := range musicTips {
					if tipStr, ok := tip.(string); ok {
						suggestList = append(suggestList, SearchSuggestData{
							Keyword: tipStr,
							Type:    "song",
						})
					}
				}
			}

			// 解析专辑建议
			if albumTips, ok := data["album_tip"].([]interface{}); ok {
				for _, tip := range albumTips {
					if tipStr, ok := tip.(string); ok {
						suggestList = append(suggestList, SearchSuggestData{
							Keyword: tipStr,
							Type:    "album",
						})
					}
				}
			}

			// 解析MV建议
			if mvTips, ok := data["mv_tip"].([]interface{}); ok {
				for _, tip := range mvTips {
					if tipStr, ok := tip.(string); ok {
						suggestList = append(suggestList, SearchSuggestData{
							Keyword: tipStr,
							Type:    "mv",
						})
					}
				}
			}
		}

		return SearchSuggestResponse{
			Success: true,
			Message: "获取搜索建议成功",
			Data:    suggestList,
		}
	}

	// 处理API错误
	errorMsg := "获取搜索建议失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchSuggestResponse{
		Success: false,
		Message: errorMsg,
	}
}

// SearchSongs 搜索歌曲
func (s *SearchService) SearchSongs(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("type", "song")
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析歌曲数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 提取总数
			if total, ok := data["total"].(float64); ok {
				results.Songs.Total = int(total)
			}

			if lists, ok := data["lists"].([]interface{}); ok {
				for _, listItem := range lists {
					if song, ok := listItem.(map[string]interface{}); ok {
						songData := SearchSongData{}
						if hash, ok := song["FileHash"].(string); ok {
							songData.Hash = hash
						}
						if songname, ok := song["OriSongName"].(string); ok {
							songData.SongName = songname
						}
						if filename, ok := song["FileName"].(string); ok {
							if extName, ok := song["ExtName"].(string); ok {
								songData.FileName = filename + extName
							}
						}
						if timelength, ok := song["Duration"].(float64); ok {
							songData.TimeLength = int(timelength)
						}
						if albumname, ok := song["AlbumName"].(string); ok {
							songData.AlbumName = albumname
						}
						if albumID, ok := song["AlbumID"].(string); ok {
							songData.AlbumID = albumID
						}
						if authorName, ok := song["SingerName"].(string); ok {
							songData.AuthorName = authorName
						}
						if unionCover, ok := song["Image"].(string); ok {
							songData.UnionCover = unionCover
						}
						results.Songs.List = append(results.Songs.List, songData)
					}
				}
			}
		}
		log.Println("曲：", results.Songs)
		return SearchResponse{
			Success: true,
			Message: "搜索歌曲成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索歌曲失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// SearchArtists 搜索艺人
func (s *SearchService) SearchArtists(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("type", "author")
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析艺人数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 提取总数
			if total, ok := data["total"].(float64); ok {
				results.Artists.Total = int(total)
			}

			if lists, ok := data["lists"].([]interface{}); ok {
				for _, listItem := range lists {
					if artist, ok := listItem.(map[string]interface{}); ok {
						artistData := SearchArtistData{}
						if authorID, ok := artist["SingerID"].(string); ok {
							artistData.AuthorID = authorID
						}
						if authorName, ok := artist["AuthorName"].(string); ok {
							artistData.AuthorName = authorName
						}
						if avatar, ok := artist["Avatar"].(string); ok {
							artistData.Avatar = avatar
						}
						if songCount, ok := artist["AudioCount"].(float64); ok {
							artistData.SongCount = int(songCount)
						}
						results.Artists.List = append(results.Artists.List, artistData)
					}
				}
			}
		}

		return SearchResponse{
			Success: true,
			Message: "搜索艺人成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索艺人失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// SearchPlaylists 搜索歌单
func (s *SearchService) SearchPlaylists(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("type", "special")
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析歌单数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 提取总数
			if total, ok := data["total"].(float64); ok {
				results.Playlists.Total = int(total)
			}

			if lists, ok := data["lists"].([]interface{}); ok {
				for _, listItem := range lists {
					if playlist, ok := listItem.(map[string]interface{}); ok {
						playlistData := SearchPlaylistData{}
						if specialID, ok := playlist["gid"].(string); ok {
							playlistData.SpecialID = specialID
						}
						if specialName, ok := playlist["specialname"].(string); ok {
							playlistData.SpecialName = specialName
						}
						if imgURL, ok := playlist["img"].(string); ok {
							playlistData.ImgURL = imgURL
						}
						if playCount, ok := playlist["play_count"].(float64); ok {
							playlistData.PlayCount = int(playCount)
						}
						if songCount, ok := playlist["song_count"].(float64); ok {
							playlistData.SongCount = int(songCount)
						}
						if authorName, ok := playlist["nickname"].(string); ok {
							playlistData.AuthorName = authorName
						}
						results.Playlists.List = append(results.Playlists.List, playlistData)
					}
				}
			}
		}

		return SearchResponse{
			Success: true,
			Message: "搜索歌单成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索歌单失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// SearchAlbums 搜索专辑
func (s *SearchService) SearchAlbums(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("type", "album")
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析专辑数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 提取总数
			if total, ok := data["total"].(float64); ok {
				results.Albums.Total = int(total)
			}

			if lists, ok := data["lists"].([]interface{}); ok {
				for _, listItem := range lists {
					if album, ok := listItem.(map[string]interface{}); ok {
						albumData := SearchAlbumData{}
						if albumID, ok := album["albumid"].(float64); ok {
							albumData.AlbumID = fmt.Sprintf("%.0f", albumID)
						} else if albumIDStr, ok := album["albumid"].(string); ok {
							albumData.AlbumID = albumIDStr
						}
						if albumName, ok := album["albumname"].(string); ok {
							albumData.AlbumName = albumName
						}
						if imgURL, ok := album["img"].(string); ok {
							albumData.ImgURL = imgURL
						}
						if authorName, ok := album["singer"].(string); ok {
							albumData.AuthorName = authorName
						}
						if songCount, ok := album["songcount"].(float64); ok {
							albumData.SongCount = int(songCount)
						}
						results.Albums.List = append(results.Albums.List, albumData)
					}
				}
			}
		}

		return SearchResponse{
			Success: true,
			Message: "搜索专辑成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索专辑失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}

// SearchMVs 搜索MV
func (s *SearchService) SearchMVs(keyword string, page int, pageSize int) SearchResponse {
	if keyword == "" {
		return SearchResponse{
			Success: false,
			Message: "搜索关键词不能为空",
		}
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	// 读取cookie
	cookie, err := s.readCookieFromFile()
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/search", baseApi)

	// 构建查询参数
	queryParams := url.Values{}
	queryParams.Add("keywords", keyword)
	queryParams.Add("type", "mv")
	queryParams.Add("page", fmt.Sprintf("%d", page))
	queryParams.Add("pagesize", fmt.Sprintf("%d", pageSize))
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
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return SearchResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		results := SearchResults{}

		// 解析MV数据
		if data, ok := apiResponse["data"].(map[string]interface{}); ok {
			// 提取总数
			if total, ok := data["total"].(float64); ok {
				results.MVs.Total = int(total)
			}

			if lists, ok := data["lists"].([]interface{}); ok {
				for _, listItem := range lists {
					if mv, ok := listItem.(map[string]interface{}); ok {
						mvData := SearchMVData{}
						if hash, ok := mv["MvHash"].(string); ok {
							mvData.Hash = hash
						}
						if mvName, ok := mv["MvName"].(string); ok {
							mvData.MVName = mvName
						}
						if imgURL, ok := mv["ThumbGif"].(string); ok {
							mvData.ImgURL = imgURL
						}
						if authorName, ok := mv["SingerName"].(string); ok {
							mvData.AuthorName = authorName
						}
						if duration, ok := mv["Duration"].(float64); ok {
							mvData.Duration = int(duration)
						}
						results.MVs.List = append(results.MVs.List, mvData)
					}
				}
			}
		}

		return SearchResponse{
			Success: true,
			Message: "搜索MV成功",
			Data:    results,
		}
	}

	// 处理API错误
	errorMsg := "搜索MV失败"
	if msg, ok := apiResponse["error_msg"].(string); ok {
		errorMsg = msg
	}

	return SearchResponse{
		Success: false,
		Message: errorMsg,
	}
}
