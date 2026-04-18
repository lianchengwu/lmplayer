package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// LoginService 处理登录相关的服务
type LoginService struct{}

// ApiResponse 通用API响应结构体
type ApiResponse[T any] struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	ErrorCode int    `json:"error_code,omitempty"`
	Status    int    `json:"status,omitempty"`
	Data      T      `json:"data,omitempty"`
}

// LoginData 登录成功时的数据结构
type LoginData struct {
	Token    string `json:"token,omitempty"`
	UserID   int64  `json:"userid,omitempty"`
	UserInfo any    `json:"user_info,omitempty"`
}

// CaptchaData 验证码响应的数据结构
type CaptchaData struct {
	Count int `json:"count,omitempty"`
}

// QRKeyData 二维码Key响应的数据结构
type QRKeyData struct {
	QRCode    string `json:"qrcode"`
	QRCodeImg string `json:"qrcode_img"`
}

// QRCodeData 二维码生成响应的数据结构
type QRCodeData struct {
	URL    string `json:"url"`
	Base64 string `json:"base64"`
}

// QRStatusData 二维码状态检测响应的数据结构
type QRStatusData struct {
	Nickname string `json:"nickname,omitempty"`
	Pic      string `json:"pic,omitempty"`
	Token    string `json:"token,omitempty"`
	UserID   int64  `json:"userid,omitempty"`
	Status   int    `json:"status"`
}

// LoginResponse 登录响应结构 (保持向后兼容)
type LoginResponse = ApiResponse[LoginData]

// CaptchaResponse 验证码响应结构 (保持向后兼容)
type CaptchaResponse = ApiResponse[CaptchaData]

// QRKeyResponse 二维码Key响应结构
type QRKeyResponse = ApiResponse[QRKeyData]

// QRCodeResponse 二维码生成响应结构
type QRCodeResponse = ApiResponse[QRCodeData]

// QRStatusResponse 二维码状态检测响应结构
type QRStatusResponse = ApiResponse[QRStatusData]

// saveCookieToFile 保存cookie到指定文件（使用全局Cookie管理器）
func saveCookieToFile(token string, userid int64) error {
	return GlobalCookieManager.SaveCookieToFile(token, userid)
}

// saveLoginMethodToFile 保存登录方式到指定文件
func saveLoginMethodToFile(loginMethod string) error {
	// 获取用户主目录
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("获取用户主目录失败: %v", err)
	}

	// 创建配置目录路径
	configDir := filepath.Join(homeDir, ".config", "gomusic")

	// 确保目录存在
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("创建配置目录失败: %v", err)
	}

	// 创建登录方式文件路径
	loginMethodFile := filepath.Join(configDir, "login_method.txt")

	// 写入文件
	if err := os.WriteFile(loginMethodFile, []byte(loginMethod), 0644); err != nil {
		return fmt.Errorf("写入登录方式文件失败: %v", err)
	}

	return nil
}

// readLoginMethodFromFile 从文件读取登录方式
func readLoginMethodFromFile() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户主目录失败: %v", err)
	}

	loginMethodFile := filepath.Join(homeDir, ".config", "gomusic", "login_method.txt")

	// 检查文件是否存在
	if _, err := os.Stat(loginMethodFile); os.IsNotExist(err) {
		return "unknown", nil // 如果文件不存在，返回unknown而不是错误
	}

	// 读取文件内容
	content, err := os.ReadFile(loginMethodFile)
	if err != nil {
		return "", fmt.Errorf("读取登录方式文件失败: %v", err)
	}

	loginMethod := strings.TrimSpace(string(content))
	if loginMethod == "" {
		return "unknown", nil
	}

	return loginMethod, nil
}

// SendCaptcha 发送验证码
func (l *LoginService) SendCaptcha(mobile string) CaptchaResponse {
	if mobile == "" {
		return CaptchaResponse{
			Success: false,
			Message: "手机号不能为空",
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/captcha/sent?mobile=%s", baseApi, url.QueryEscape(mobile))

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return CaptchaResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return CaptchaResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return CaptchaResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return CaptchaResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功 - 根据error_code判断
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		// 提取count数据
		var captchaData CaptchaData
		if data, ok := apiResponse["data"].(map[string]any); ok {
			if count, ok := data["count"].(float64); ok {
				captchaData.Count = int(count)
			}
		}

		return CaptchaResponse{
			Success:   true,
			Message:   "验证码发送成功",
			ErrorCode: int(errorCode),
			Data:      captchaData,
		}
	} else {
		message := "验证码发送失败"
		errorCodeInt := -1
		statusInt := 0

		// 尝试从响应中获取错误信息
		if msg, ok := apiResponse["message"].(string); ok && msg != "" {
			message = msg
		} else if status, ok := apiResponse["status"].(float64); ok {
			message = fmt.Sprintf("验证码发送失败，状态码: %.0f", status)
			statusInt = int(status)
		}

		if errorCode, ok := apiResponse["error_code"].(float64); ok {
			errorCodeInt = int(errorCode)
		}

		return CaptchaResponse{
			Success:   false,
			Message:   message,
			ErrorCode: errorCodeInt,
			Status:    statusInt,
			Data:      CaptchaData{},
		}
	}
}

// LoginWithPhone 手机号登录
func (l *LoginService) LoginWithPhone(mobile, code string) LoginResponse {
	if mobile == "" {
		return LoginResponse{
			Success: false,
			Message: "手机号不能为空",
		}
	}

	if code == "" {
		return LoginResponse{
			Success: false,
			Message: "验证码不能为空",
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/login/cellphone?mobile=%s&code=%s",
		baseApi, url.QueryEscape(mobile), url.QueryEscape(code))

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功 - 根据error_code判断
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		// 提取登录数据
		var loginData LoginData
		if data, ok := apiResponse["data"].(map[string]any); ok {
			if tokenValue, ok := data["token"].(string); ok {
				loginData.Token = tokenValue
			}
			if useridValue, ok := data["userid"].(float64); ok {
				loginData.UserID = int64(useridValue)
			}
			// 保存其他用户信息
			loginData.UserInfo = data
		}

		// 保存cookie到文件
		if loginData.Token != "" && loginData.UserID != 0 {
			if err := saveCookieToFile(loginData.Token, loginData.UserID); err != nil {
				// 记录错误但不影响登录成功
				log.Printf("保存cookie失败: %v\n", err)
			}

			// 保存登录方式
			if err := saveLoginMethodToFile("phone"); err != nil {
				// 记录错误但不影响登录成功
				log.Printf("保存登录方式失败: %v\n", err)
			}
		}

		return LoginResponse{
			Success:   true,
			Message:   "登录成功",
			ErrorCode: int(errorCode),
			Data:      loginData,
		}
	} else {
		message := "登录失败"
		errorCodeInt := -1
		statusInt := 0

		// 尝试从响应中获取错误信息
		if msg, ok := apiResponse["message"].(string); ok && msg != "" {
			message = msg
		} else if status, ok := apiResponse["status"].(float64); ok {
			message = fmt.Sprintf("登录失败，状态码: %.0f", status)
			statusInt = int(status)
		}

		if errorCode, ok := apiResponse["error_code"].(float64); ok {
			errorCodeInt = int(errorCode)
		}

		return LoginResponse{
			Success:   false,
			Message:   message,
			ErrorCode: errorCodeInt,
			Status:    statusInt,
			Data:      LoginData{},
		}
	}
}

// readCookieFromFile 从全局Cookie管理器读取cookie
func (l *LoginService) readCookieFromFile() (string, error) {
	cookie := GlobalCookieManager.GetCookie()
	return cookie, nil
}

// UserDetailData 用户详情数据结构
type UserDetailData struct {
	UserID    int64  `json:"userid"`
	LoginTime int64  `json:"login_time"`
	Nickname  string `json:"nickname"`
	Pic       string `json:"pic"`
	VipType   int    `json:"vip_type"`
	VipLevel  int    `json:"vip_level"`
	IsVip     bool   `json:"is_vip"`
}

// UserDetailResponse 用户详情响应结构
type UserDetailResponse = ApiResponse[UserDetailData]

// VipDetailData VIP详情数据结构
type VipDetailData struct {
	IsVip       int    `json:"is_vip"`       // 1是VIP，0不是VIP
	VipEndTime  string `json:"vip_end_time"` // VIP结束时间字符串
	ProductType string `json:"product_type"` // VIP类型
}

// VipDetailResponse VIP详情响应结构
type VipDetailResponse = ApiResponse[VipDetailData]

// GetUserDetail 获取用户详情
func (l *LoginService) GetUserDetail() UserDetailResponse {
	// 读取cookie
	cookie, err := l.readCookieFromFile()
	if err != nil {
		return UserDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	if cookie == "" {
		return UserDetailResponse{
			Success: false,
			Message: "未找到有效的登录信息",
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/user/detail?cookie=%s&timestamp=%d",
		baseApi, url.QueryEscape(cookie), time.Now().UnixMilli())

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return UserDetailResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return UserDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return UserDetailResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return UserDetailResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		if status, ok := apiResponse["status"].(float64); ok && status == 1 {
			// 提取用户详情数据
			var userDetailData UserDetailData
			if data, ok := apiResponse["data"].(map[string]any); ok {
				if len(strings.Split(cookie, ";")) == 2 {
					// userid 从cookie中获取
					if userid, err := strconv.Atoi(strings.Split(strings.Split(cookie, ";")[1], "=")[1]); err == nil {
						userDetailData.UserID = int64(userid)
					}
				}

				if nickname, ok := data["nickname"].(string); ok {
					userDetailData.Nickname = nickname
				}
				if pic, ok := data["pic"].(string); ok {
					userDetailData.Pic = pic
				}
				if loginTime, ok := data["logintime"].(float64); ok {
					userDetailData.LoginTime = int64(loginTime)
				}
				if vipType, ok := data["vip_type"].(float64); ok {
					userDetailData.VipType = int(vipType)
				}
				if vipLevel, ok := data["vip_level"].(float64); ok {
					userDetailData.VipLevel = int(vipLevel)
				}
				// 判断是否为VIP
				userDetailData.IsVip = userDetailData.VipType > 0 || userDetailData.VipLevel > 0
			}

			return UserDetailResponse{
				Success:   true,
				Message:   "获取用户详情成功",
				ErrorCode: int(errorCode),
				Status:    int(status),
				Data:      userDetailData,
			}
		}
	}

	// 处理错误情况
	message := "获取用户详情失败"
	errorCodeInt := -1
	statusInt := 0

	if msg, ok := apiResponse["message"].(string); ok && msg != "" {
		message = msg
	} else if status, ok := apiResponse["status"].(float64); ok {
		message = fmt.Sprintf("获取用户详情失败，状态码: %.0f", status)
		statusInt = int(status)
	}

	if errorCode, ok := apiResponse["error_code"].(float64); ok {
		errorCodeInt = int(errorCode)
	}

	return UserDetailResponse{
		Success:   false,
		Message:   message,
		ErrorCode: errorCodeInt,
		Status:    statusInt,
		Data:      UserDetailData{},
	}
}

// GetVipDetail 获取VIP详情
func (l *LoginService) GetVipDetail() VipDetailResponse {
	// 读取cookie
	cookie, err := l.readCookieFromFile()
	if err != nil {
		return VipDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取cookie失败: %v", err),
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/user/vip/detail?cookie=%s", baseApi, url.QueryEscape(cookie))

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return VipDetailResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return VipDetailResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return VipDetailResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d", resp.StatusCode),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return VipDetailResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); ok && status == 1 {
		// 获取data字段
		if dataInterface, ok := apiResponse["data"]; ok {
			if dataMap, ok := dataInterface.(map[string]interface{}); ok {
				// 获取busi_vip数组
				if busiVipInterface, ok := dataMap["busi_vip"]; ok {
					if busiVipArray, ok := busiVipInterface.([]interface{}); ok && len(busiVipArray) > 0 {
						// 获取第一个VIP信息
						if vipInfo, ok := busiVipArray[0].(map[string]interface{}); ok {
							vipDetailData := VipDetailData{}

							// 获取是否VIP (1是VIP，0不是VIP)
							if isVipFloat, ok := vipInfo["is_vip"].(float64); ok {
								vipDetailData.IsVip = int(isVipFloat)
							} else if isVipBool, ok := vipInfo["is_vip"].(bool); ok {
								if isVipBool {
									vipDetailData.IsVip = 1
								} else {
									vipDetailData.IsVip = 0
								}
							}

							// 获取VIP结束时间 (字符串格式)
							if vipEndTime, ok := vipInfo["vip_end_time"].(string); ok {
								vipDetailData.VipEndTime = vipEndTime
							}

							// 获取VIP类型
							if productType, ok := vipInfo["product_type"].(string); ok {
								vipDetailData.ProductType = productType
							}

							return VipDetailResponse{
								Success: true,
								Message: "获取VIP详情成功",
								Data:    vipDetailData,
							}
						}
					}
				}
			}
		}
	}

	// 处理错误情况
	message := "获取VIP详情失败"
	if msg, ok := apiResponse["message"].(string); ok && msg != "" {
		message = msg
	}

	return VipDetailResponse{
		Success: false,
		Message: message,
		Data:    VipDetailData{},
	}
}

// CheckLoginStatus 检查登录状态
func (l *LoginService) CheckLoginStatus() LoginResponse {
	// 尝试获取用户详情来验证登录状态
	userDetailResponse := l.GetUserDetail()

	if userDetailResponse.Success {
		// 读取登录方式
		loginMethod, err := readLoginMethodFromFile()
		if err != nil {
			// 如果读取失败，使用默认值
			loginMethod = "unknown"
		}

		// 获取VIP详情
		vipDetailResponse := l.GetVipDetail()

		// 构建用户信息，包含VIP详情
		userInfo := map[string]any{
			"userid":       userDetailResponse.Data.UserID,
			"nickname":     userDetailResponse.Data.Nickname,
			"pic":          userDetailResponse.Data.Pic,
			"vip_type":     userDetailResponse.Data.VipType,
			"vip_level":    userDetailResponse.Data.VipLevel,
			"is_vip":       userDetailResponse.Data.IsVip,
			"login_time":   userDetailResponse.Data.LoginTime,
			"login_method": loginMethod,
		}

		// 如果VIP详情获取成功，添加VIP信息
		if vipDetailResponse.Success {
			userInfo["vip_detail"] = map[string]any{
				"is_vip":       vipDetailResponse.Data.IsVip,       // 1是VIP，0不是VIP
				"vip_end_time": vipDetailResponse.Data.VipEndTime,  // VIP结束时间字符串
				"product_type": vipDetailResponse.Data.ProductType, // VIP类型
			}
			// 更新is_vip字段为VIP详情接口的结果（更准确）
			// 转换为布尔值以保持与原有逻辑的兼容性
			userInfo["is_vip"] = vipDetailResponse.Data.IsVip == 1
		}

		// 用户详情获取成功，说明登录有效
		return LoginResponse{
			Success: true,
			Message: "登录状态有效",
			Data: LoginData{
				UserID:   userDetailResponse.Data.UserID,
				UserInfo: userInfo,
			},
		}
	} else {
		// 用户详情获取失败，说明登录无效或已过期
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("登录状态无效: %s", userDetailResponse.Message),
			Data:    LoginData{},
		}
	}
}

// ClaimDailyVip 领取每日VIP
func (l *LoginService) ClaimDailyVip() LoginResponse {
	// 读取cookie文件
	cookie, err := l.readCookieFromFile()
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: "未找到登录信息，请先登录",
		}
	}

	// 构建请求URL
	requestURL := fmt.Sprintf("%s/youth/day/vip?cookie=%s", baseApi, url.QueryEscape(cookie))

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: "请求失败: " + err.Error(),
		}
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: "读取响应失败: " + err.Error(),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return LoginResponse{
			Success: false,
			Message: "解析响应失败: " + err.Error(),
		}
	}

	// 检查API响应状态
	if status, ok := apiResponse["status"].(float64); ok && status == 1 {
		// 成功
		message := "领取成功"
		if msg, ok := apiResponse["msg"].(string); ok && msg != "" {
			message = msg
		}

		return LoginResponse{
			Success: true,
			Message: message,
		}
	} else {
		// 失败
		message := "领取失败"
		if msg, ok := apiResponse["msg"].(string); ok && msg != "" {
			message = msg
		}

		return LoginResponse{
			Success: false,
			Message: message,
		}
	}
}

// GenerateQRKey 生成二维码登录Key
func (l *LoginService) GenerateQRKey() QRKeyResponse {
	// 构建请求URL，添加时间戳防止缓存
	requestURL := fmt.Sprintf("%s/login/qr/key?timestamp=%d", baseApi, time.Now().UnixMilli())

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return QRKeyResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return QRKeyResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return QRKeyResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return QRKeyResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功 - 根据error_code和status判断
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		if status, ok := apiResponse["status"].(float64); ok && status == 1 {
			// 提取二维码Key数据
			var qrKeyData QRKeyData
			if data, ok := apiResponse["data"].(map[string]any); ok {
				if qrcode, ok := data["qrcode"].(string); ok {
					qrKeyData.QRCode = qrcode
				}
				if qrcodeImg, ok := data["qrcode_img"].(string); ok {
					qrKeyData.QRCodeImg = qrcodeImg
				}
			}

			return QRKeyResponse{
				Success:   true,
				Message:   "二维码Key生成成功",
				ErrorCode: int(errorCode),
				Status:    int(status),
				Data:      qrKeyData,
			}
		}
	}

	// 处理错误情况
	message := "二维码Key生成失败"
	errorCodeInt := -1
	statusInt := 0

	// 尝试从响应中获取错误信息
	if msg, ok := apiResponse["message"].(string); ok && msg != "" {
		message = msg
	} else if status, ok := apiResponse["status"].(float64); ok {
		message = fmt.Sprintf("二维码Key生成失败，状态码: %.0f", status)
		statusInt = int(status)
	}

	if errorCode, ok := apiResponse["error_code"].(float64); ok {
		errorCodeInt = int(errorCode)
	}

	return QRKeyResponse{
		Success:   false,
		Message:   message,
		ErrorCode: errorCodeInt,
		Status:    statusInt,
		Data:      QRKeyData{},
	}
}

// CreateQRCode 根据Key生成二维码
func (l *LoginService) CreateQRCode(key string) QRCodeResponse {
	if key == "" {
		return QRCodeResponse{
			Success: false,
			Message: "二维码Key不能为空",
		}
	}

	// 构建请求URL，添加时间戳防止缓存
	requestURL := fmt.Sprintf("%s/login/qr/create?key=%s&qrimg=true&timestamp=%d",
		baseApi, url.QueryEscape(key), time.Now().UnixMilli())

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return QRCodeResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return QRCodeResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return QRCodeResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return QRCodeResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功 - 根据code判断（这个接口返回的是code而不是error_code）
	if code, ok := apiResponse["code"].(float64); ok && code == 200 {
		// 提取二维码数据
		var qrCodeData QRCodeData
		if data, ok := apiResponse["data"].(map[string]any); ok {
			if url, ok := data["url"].(string); ok {
				qrCodeData.URL = url
			}
			if base64, ok := data["base64"].(string); ok {
				qrCodeData.Base64 = base64
			}
		}

		return QRCodeResponse{
			Success: true,
			Message: "二维码生成成功",
			Status:  int(code),
			Data:    qrCodeData,
		}
	}

	// 处理错误情况
	message := "二维码生成失败"
	statusInt := 0

	// 尝试从响应中获取错误信息
	if msg, ok := apiResponse["message"].(string); ok && msg != "" {
		message = msg
	} else if code, ok := apiResponse["code"].(float64); ok {
		message = fmt.Sprintf("二维码生成失败，状态码: %.0f", code)
		statusInt = int(code)
	}

	return QRCodeResponse{
		Success: false,
		Message: message,
		Status:  statusInt,
		Data:    QRCodeData{},
	}
}

// CheckQRStatus 检测二维码扫码状态
func (l *LoginService) CheckQRStatus(key string) QRStatusResponse {
	if key == "" {
		return QRStatusResponse{
			Success: false,
			Message: "二维码Key不能为空",
		}
	}

	// 构建请求URL，添加时间戳防止缓存
	requestURL := fmt.Sprintf("%s/login/qr/check?key=%s&timestamp=%d",
		baseApi, url.QueryEscape(key), time.Now().UnixMilli())

	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求
	resp, err := client.Get(requestURL)
	if err != nil {
		return QRStatusResponse{
			Success: false,
			Message: fmt.Sprintf("网络请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return QRStatusResponse{
			Success: false,
			Message: fmt.Sprintf("读取响应失败: %v", err),
		}
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return QRStatusResponse{
			Success: false,
			Message: fmt.Sprintf("服务器返回错误状态: %d, 响应: %s", resp.StatusCode, string(body)),
		}
	}

	// 解析JSON响应
	var apiResponse map[string]any
	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return QRStatusResponse{
			Success: false,
			Message: fmt.Sprintf("解析响应失败: %v", err),
		}
	}

	// 检查API响应是否成功 - 根据error_code和status判断
	if errorCode, ok := apiResponse["error_code"].(float64); ok && errorCode == 0 {
		if status, ok := apiResponse["status"].(float64); ok && status == 1 {
			// 提取二维码状态数据
			var qrStatusData QRStatusData
			if data, ok := apiResponse["data"].(map[string]any); ok {
				if nickname, ok := data["nickname"].(string); ok {
					qrStatusData.Nickname = nickname
				}
				if pic, ok := data["pic"].(string); ok {
					qrStatusData.Pic = pic
				}
				if token, ok := data["token"].(string); ok {
					qrStatusData.Token = token
				}
				if userid, ok := data["userid"].(float64); ok {
					qrStatusData.UserID = int64(userid)
				}
				if qrStatus, ok := data["status"].(float64); ok {
					qrStatusData.Status = int(qrStatus)
				}
			}

			// 如果登录成功（status=4），保存cookie到文件
			if qrStatusData.Status == 4 && qrStatusData.Token != "" && qrStatusData.UserID != 0 {
				if err := saveCookieToFile(qrStatusData.Token, qrStatusData.UserID); err != nil {
					// 记录错误但不影响登录成功
					log.Printf("保存cookie失败: %v\n", err)
				}

				// 保存登录方式
				if err := saveLoginMethodToFile("qrcode"); err != nil {
					// 记录错误但不影响登录成功
					log.Printf("保存登录方式失败: %v\n", err)
				}
			}

			return QRStatusResponse{
				Success:   true,
				Message:   getQRStatusMessage(qrStatusData.Status),
				ErrorCode: int(errorCode),
				Status:    int(status),
				Data:      qrStatusData,
			}
		}
	}

	// 处理错误情况
	message := "二维码状态检测失败"
	errorCodeInt := -1
	statusInt := 0

	// 尝试从响应中获取错误信息
	if msg, ok := apiResponse["message"].(string); ok && msg != "" {
		message = msg
	} else if status, ok := apiResponse["status"].(float64); ok {
		message = fmt.Sprintf("二维码状态检测失败，状态码: %.0f", status)
		statusInt = int(status)
	}

	if errorCode, ok := apiResponse["error_code"].(float64); ok {
		errorCodeInt = int(errorCode)
	}

	return QRStatusResponse{
		Success:   false,
		Message:   message,
		ErrorCode: errorCodeInt,
		Status:    statusInt,
		Data:      QRStatusData{},
	}
}

// getQRStatusMessage 根据二维码状态返回对应的消息
func getQRStatusMessage(status int) string {
	switch status {
	case 0:
		return "二维码已过期"
	case 1:
		return "等待扫码"
	case 2:
		return "已扫描，待确认"
	case 4:
		return "登录成功"
	default:
		return fmt.Sprintf("未知状态: %d", status)
	}
}

// Logout 登出功能，清除Cookie
func (l *LoginService) Logout() LoginResponse {
	err := GlobalCookieManager.ClearCookie()
	if err != nil {
		return LoginResponse{
			Success: false,
			Message: fmt.Sprintf("登出失败: %v", err),
		}
	}

	return LoginResponse{
		Success: true,
		Message: "登出成功",
	}
}

// NewLoginService 创建LoginService实例
func NewLoginService() LoginService {
	return LoginService{}
}
