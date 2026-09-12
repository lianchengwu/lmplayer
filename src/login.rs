use serde::Serialize;
use serde_json::Value;

use crate::resp::ApiResponse;
use crate::Player;

#[derive(Clone, Debug, Default, Serialize)]
pub struct LoginData {
    pub token: String,
    pub userid: i64,
    pub user_info: Value,
}

pub struct LoginApi<'a> {
    pub player: &'a Player,
}

impl LoginApi<'_> {
    pub async fn send_captcha(&self, mobile: &str) -> ApiResponse<Value> {
        if mobile.is_empty() {
            return ApiResponse::fail("手机号不能为空");
        }
        match self.player.kg.captcha_sent(mobile).await {
            Ok(res) => ApiResponse::from_kugou("验证码发送成功", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn login_cellphone(&self, mobile: &str, code: &str) -> ApiResponse<LoginData> {
        if mobile.is_empty() {
            return ApiResponse::fail("手机号不能为空");
        }
        if code.is_empty() {
            return ApiResponse::fail("验证码不能为空");
        }
        match self.player.kg.login_cellphone(mobile, code).await {
            Ok(res) => {
                let token = self.player.kg.session().token().unwrap_or("").to_string();
                let userid = self
                    .player
                    .kg
                    .session()
                    .user_id()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let _ = self.player.save_cookie();
                ApiResponse::ok(
                    "登录成功",
                    LoginData {
                        token,
                        userid,
                        user_info: res.data().clone(),
                    },
                )
            }
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn qr_key(&self) -> ApiResponse<Value> {
        match self.player.kg.login_qr_key().await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn qr_create(&self, key: &str) -> ApiResponse<Value> {
        let res = self.player.kg.login_qr_create(key);
        ApiResponse::ok("ok", res.data().clone())
    }

    pub async fn qr_check(&self, key: &str) -> ApiResponse<Value> {
        match self.player.kg.login_qr_check(key).await {
            Ok(res) => {
                if self.player.kg.session().token().is_some() {
                    let _ = self.player.save_cookie();
                }
                ApiResponse::from_kugou("ok", &res, res.data().clone())
            }
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn check_login_status(&self) -> ApiResponse<LoginData> {
        let detail = match self.player.kg.user_detail().await {
            Ok(res) if res.kugou_ok() => res,
            Ok(_) => return ApiResponse::fail("登录状态无效"),
            Err(e) => return ApiResponse::fail(format!("登录状态无效: {e}")),
        };
        let d = detail.data();
        let userid = self
            .player
            .kg
            .session()
            .user_id()
            .and_then(|s| s.parse().ok())
            .or_else(|| d.get("userid").and_then(|v| v.as_i64()))
            .unwrap_or(0);
        let vip_type = d.get("vip_type").and_then(|v| v.as_i64()).unwrap_or(0);
        let vip_level = d.get("vip_level").and_then(|v| v.as_i64()).unwrap_or(0);
        let mut is_vip = vip_type > 0 || vip_level > 0;
        let mut user_info = serde_json::json!({
            "userid": userid,
            "nickname": d.get("nickname").and_then(|v| v.as_str()).unwrap_or(""),
            "pic": d.get("pic").and_then(|v| v.as_str()).unwrap_or(""),
            "vip_type": vip_type,
            "vip_level": vip_level,
            "is_vip": is_vip,
            "login_time": d.get("logintime").and_then(|v| v.as_i64()).unwrap_or(0),
            "login_method": "unknown",
        });
        if let Ok(vip) = self.player.kg.user_vip_detail().await {
            if vip.kugou_ok() {
                if let Some(first) = vip
                    .data()
                    .get("busi_vip")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                {
                    let vip_flag = match first.get("is_vip") {
                        Some(Value::Bool(b)) => *b,
                        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) == 1,
                        _ => false,
                    };
                    is_vip = vip_flag;
                    user_info["is_vip"] = Value::Bool(is_vip);
                    user_info["vip_detail"] = serde_json::json!({
                        "is_vip": if vip_flag { 1 } else { 0 },
                        "vip_end_time": first.get("vip_end_time").and_then(|v| v.as_str()).unwrap_or(""),
                        "product_type": first.get("product_type").and_then(|v| v.as_str()).unwrap_or(""),
                    });
                }
            }
        }
        ApiResponse::ok(
            "登录状态有效",
            LoginData {
                token: self.player.kg.session().token().unwrap_or("").to_string(),
                userid,
                user_info,
            },
        )
    }

    pub async fn user_detail(&self) -> ApiResponse<Value> {
        match self.player.kg.user_detail().await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn vip_detail(&self) -> ApiResponse<Value> {
        match self.player.kg.user_vip_detail().await {
            Ok(res) => ApiResponse::from_kugou("ok", &res, res.data().clone()),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub async fn claim_daily_vip(&self, receive_day: &str) -> ApiResponse<Value> {
        if self.player.kg.session().token().is_none() {
            return ApiResponse::fail("需要登陆");
        }
        let day = match parse_receive_day(receive_day) {
            Some(d) => d,
            None => today_ymd_cn(),
        };
        match self.player.kg.youth_day_vip(&day).await {
            Ok(res) if res.kugou_ok() => ApiResponse::from_kugou("领取成功", &res, res.data().clone()),
            Ok(res) => ApiResponse::fail(kugou_err_msg(&res, "领取失败")),
            Err(e) => ApiResponse::fail(e.to_string()),
        }
    }

    pub fn logout(&self) -> ApiResponse<Value> {
        self.player.kg.set_token("", "0");
        ApiResponse::ok("已登出", Value::Null)
    }
}

fn parse_receive_day(s: &str) -> Option<String> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() == 10 && b[4] == b'-' && b[7] == b'-' {
        Some(s.to_string())
    } else {
        None
    }
}

fn today_ymd_cn() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        + 8 * 3600;
    let z = secs.div_euclid(86400) + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn kugou_err_msg(res: &kugou::Response, fallback: &str) -> String {
    ["error_msg", "error", "msg", "errmsg", "message"]
        .into_iter()
        .find_map(|k| res.body.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or(fallback)
        .to_string()
}
