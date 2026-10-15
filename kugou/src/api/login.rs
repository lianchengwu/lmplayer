use std::io::Write;

use base64::Engine;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use qrcode::{Color, QrCode};
use serde_json::json;

use crate::http::{Call, Response, SignKind};
use crate::platform::SRCAPPID;
use crate::proto::{
    aes_encrypt_value, now_ms, random_string, rsa_raw_encrypt_value, sign_params_key, value_query,
};
use crate::{Client, Platform, Result};

const LITE_T2_KEY: &str = "fd14b35e3f81af3817a20ae7adae7020";
const LITE_T2_IV: &str = "17a20ae7adae7020";
const LITE_T1_KEY: &str = "5e4ef500e9597fe004bd09a46d8add98";
const LITE_T1_IV: &str = "04bd09a46d8add98";
const TOKEN_KEY: &str = "90b8382a1bb4ccdcf063102053fd75b8";
const TOKEN_IV: &str = "f063102053fd75b8";
const TOKEN_LITE_KEY: &str = "c24f74ca2820225badc01946dba4fdf7";
const TOKEN_LITE_IV: &str = "adc01946dba4fdf7";
const LOGIN_T1: &str = "562a6f12a6e803453647d16a08f5f0c2ff7eee692cba2ab74cc4c8ab47fc467561a7c6b586ce7dc46a63613b246737c03a1dc8f8d162d8ce1d2c71893d19f1d4b797685a4c6d3d81341cbde65e488c4829a9b4d42ef2df470eb102979fa5adcdd9b4eecfea8b909ff7599abeb49867640f10c3c70fc444effca9d15db44a9a6c907731e2bb0f22cd9b3536380169995693e5f0e2424e3378097d3813186e3fe96bbe7023808a0981b4e2b6135a76faac";
const LOGIN_T2: &str = "31c4daf4cf480169ccea1cb7d4a209295865a9d2b788510301694db229b87807469ea0d41b4d4b9173c2151da7294aeebfc9738df154bbdf11a4e117bb5dff6a3af8ce5ce333e681c1f29a44038f27567d58992eb81283e080778ac77db1400fdf49b7cf7e26be2e5af4da7830cc3be4";

impl Client {
    pub async fn login_password(
        &self,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<Response> {
        self.login_password_code(username, password, "").await
    }

    pub async fn login_password_code(
        &self,
        username: impl Into<String>,
        password: impl Into<String>,
        code: impl Into<String>,
    ) -> Result<Response> {
        let date_now = now_ms();
        let encrypt = aes_encrypt_value(
            &json!({
                "pwd": password.into(),
                "code": code.into(),
                "clienttime_ms": date_now,
            }),
            None,
            None,
        )?;
        let pk = rsa_raw_encrypt_value(
            &json!({ "clienttime_ms": date_now, "key": encrypt.key }),
            self.rsa_pem(),
        )?
        .to_uppercase();
        let mut res = self
            .execute(
                Call::post("/v9/login_by_pwd")
                    .json(json!({
                        "plat": 1,
                        "support_multi": 1,
                        "clienttime_ms": date_now,
                        "t1": LOGIN_T1,
                        "t2": LOGIN_T2,
                        "t3": "MCwwLDAsMCwwLDAsMCwwLDA=",
                        "username": username.into(),
                        "params": encrypt.str,
                        "pk": pk,
                    }))?
                    .router("login.user.kugou.com"),
            )
            .await?;
        self.finish_login(&mut res, &encrypt.key);
        Ok(res)
    }

    pub async fn login_cellphone(&self, mobile: impl Into<String>, code: impl Into<String>) -> Result<Response> {
        let date_time = now_ms();
        let mobile_raw = mobile.into();
        let encrypt = aes_encrypt_value(
            &json!({
                "mobile": mobile_raw,
                "code": code.into(),
            }),
            None,
            None,
        )?;
        let mobile = if mobile_raw.len() >= 11 {
            format!("{}*****{}", &mobile_raw[..2], &mobile_raw[10..11])
        } else {
            mobile_raw.clone()
        };
        let session = self.session();
        let dfid = session
            .dfid()
            .map(|s| s.to_string())
            .unwrap_or_else(|| random_string(24));
        let guid = self.device.guid.clone();
        let mac = self.device.mac.clone();
        let dev = self.device.dev.clone();
        let t2 = aes_encrypt_value(
            &json!(format!("{guid}|0f607264fc6318a92b9e13c65db7cd3c|{mac}|{dev}|{date_time}")),
            Some(LITE_T2_KEY),
            Some(LITE_T2_IV),
        )?;
        let t1 = aes_encrypt_value(
            &json!(format!("|{date_time}")),
            Some(LITE_T1_KEY),
            Some(LITE_T1_IV),
        )?;
        let pk = rsa_raw_encrypt_value(
            &json!({ "clienttime_ms": date_time, "key": encrypt.key }),
            self.rsa_pem(),
        )?
        .to_uppercase();
        let key = sign_params_key(
            &date_time.to_string(),
            self.appid(),
            self.clientver(),
            self.platform,
        );
        let lite = self.platform == Platform::Lite;
        let mut data = json!({
            "plat": 1,
            "support_multi": 1,
            "t1": if lite { json!(t1.str) } else { json!(0) },
            "t2": if lite { json!(t2.str) } else { json!(0) },
            "clienttime_ms": date_time,
            "mobile": mobile,
            "key": key,
            "pk": pk,
            "params": encrypt.str,
        });
        if lite {
            data["dfid"] = json!(dfid);
            data["dev"] = json!(dev);
            data["gitversion"] = json!("5f0b7c4");
        } else {
            data["t3"] = json!("MCwwLDAsMCwwLDAsMCwwLDA=");
        }
        let mut res = self
            .execute(
                Call::post("/v7/login_by_verifycode")
                    .base("https://loginserviceretry.kugou.com")
                    .json(data)?
                    .header("support-calm", "1")
                    .header("User-Agent", "Android16-1070-11440-130-0-LOGIN-wifi"),
            )
            .await?;
        self.finish_login(&mut res, &encrypt.key);
        Ok(res)
    }

    pub async fn login_token(&self) -> Result<Response> {
        let date_now = now_ms();
        let session = self.session();
        let token = session.token().unwrap_or("").to_string();
        let userid = session.user_id().unwrap_or("0").to_string();
        let lite = self.platform == Platform::Lite;
        let (k, iv) = if lite {
            (TOKEN_LITE_KEY, TOKEN_LITE_IV)
        } else {
            (TOKEN_KEY, TOKEN_IV)
        };
        let encrypt = aes_encrypt_value(
            &json!({ "clienttime": date_now / 1000, "token": token }),
            Some(k),
            Some(iv),
        )?;
        let encrypt_params = aes_encrypt_value(&json!({}), None, None)?;
        let pk = rsa_raw_encrypt_value(
            &json!({ "clienttime_ms": date_now, "key": encrypt_params.key }),
            self.rsa_pem(),
        )?;
        let guid = self.device.guid.clone();
        let mac = self.device.mac.clone();
        let dev = self.device.dev.clone();
        let t2 = aes_encrypt_value(
            &json!(format!("{guid}|0f607264fc6318a92b9e13c65db7cd3c|{mac}|{dev}|{date_now}")),
            Some(LITE_T2_KEY),
            Some(LITE_T2_IV),
        )?;
        let t1_src = session.get("t1").unwrap_or("").to_string();
        let t1_plain = if t1_src.is_empty() {
            format!("|{date_now}")
        } else {
            format!("{t1_src}|{date_now}")
        };
        let t1 = aes_encrypt_value(&json!(t1_plain), Some(LITE_T1_KEY), Some(LITE_T1_IV))?;
        let mut data = json!({
            "dfid": session.dfid().unwrap_or("-"),
            "p3": encrypt.str,
            "plat": 1,
            "t1": if lite { json!(t1.str) } else { json!(0) },
            "t2": if lite { json!(t2.str) } else { json!(0) },
            "t3": "MCwwLDAsMCwwLDAsMCwwLDA=",
            "pk": pk,
            "params": encrypt_params.str,
            "userid": userid,
            "clienttime_ms": date_now,
        });
        if lite {
            data["dev"] = json!(dev);
        }
        let mut res = self
            .execute(
                Call::post("/v5/login_by_token")
                    .base("http://login.user.kugou.com")
                    .json(data)?,
            )
            .await?;
        self.finish_login(&mut res, &encrypt_params.key);
        Ok(res)
    }

    pub async fn captcha_sent(&self, mobile: impl Into<String>) -> Result<Response> {
        self.execute(
            Call::post("/v7/send_mobile_code")
                .base("http://login.user.kugou.com")
                .json(json!({
                    "businessid": 5,
                    "mobile": mobile.into(),
                    "plat": 3,
                }))?,
        )
        .await
    }

    pub async fn login_qr_key(&self) -> Result<Response> {
        self.login_qr_key_app(false).await
    }

    pub async fn login_qr_key_app(&self, web: bool) -> Result<Response> {
        let appid = if web { 1014 } else { 1001 };
        let qr = format!(
            "https://h5.kugou.com/apps/loginQRCode/html/index.html?appid={}&",
            self.appid()
        );
        self.execute(
            Call::get("/v2/qrcode")
                .base("https://login-user.kugou.com")
                .query("appid", appid)
                .query("type", 1)
                .query("plat", 4)
                .query("qrcode_txt", qr)
                .query("srcappid", SRCAPPID)
                .sign(SignKind::Web),
        )
        .await
    }

    pub fn login_qr_url(key: &str) -> String {
        format!("https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode={key}")
    }

    pub fn login_qr_create(&self, key: &str) -> Response {
        let url = Self::login_qr_url(key);
        Response {
            http_status: 200,
            body: json!({
                "code": 200,
                "data": { "url": url, "base64": qr_png_data_url(&url) }
            }),
            cookies: Vec::new(),
            headers: Default::default(),
            raw: None,
        }
    }

    pub async fn login_qr_check(&self, key: impl Into<String>) -> Result<Response> {
        let dev = self.device.dev.clone();
        let res = self
            .execute(
                Call::get("/v2/get_userinfo_qrcode")
                    .base("https://login-user.kugou.com")
                    .query("plat", 4)
                    .query("appid", self.appid())
                    .query("srcappid", SRCAPPID)
                    .query("qrcode", key.into())
                    .query("dev", dev)
                    .sign(SignKind::Web),
            )
            .await?;
        if res.body.pointer("/data/status").and_then(|s| s.as_i64()) == Some(4) {
            let data = res.body.get("data").cloned().unwrap_or(json!({}));
            let token = data.get("token").map(value_query).unwrap_or_default();
            let userid = data.get("userid").map(value_query).unwrap_or_default();
            if !token.is_empty() {
                let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
                session.set_token(token, userid);
                for key in ["vip_type", "vip_token", "t1"] {
                    if let Some(v) = data
                        .get(key)
                        .map(value_query)
                        .filter(|s| !s.is_empty() && s != "null")
                    {
                        session.set(key, v);
                    }
                }
            }
        }
        Ok(res)
    }

    pub async fn login_devices(&self) -> Result<Response> {
        let clienttime_ms = now_ms();
        let token = self.session().token().unwrap_or("").to_string();
        let encrypt = aes_encrypt_value(&json!({ "token": token }), None, None)?;
        let pk = rsa_raw_encrypt_value(
            &json!({ "clienttime_ms": clienttime_ms, "key": encrypt.key }),
            self.rsa_pem(),
        )?
        .to_uppercase();
        let userid = self.session().user_id().unwrap_or("0").to_string();
        self.execute(
            Call::post("/v2/get_dev")
                .base("https://userinfoservice.kugou.com")
                .json(json!({
                    "plat": 1,
                    "userid": userid,
                    "clienttime_ms": clienttime_ms,
                    "pk": pk,
                    "params": encrypt.str,
                }))?,
        )
        .await
    }

    fn finish_login(&self, res: &mut Response, encrypt_key: &str) {
        let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
        session.apply_login(&mut res.body, encrypt_key);
    }
}

fn qr_png_data_url(text: &str) -> String {
    let Ok(code) = QrCode::new(text.as_bytes()) else {
        return String::new();
    };
    let quiet = 4usize;
    let scale = 8usize;
    let n = code.width();
    let side = n + quiet * 2;
    let px = side * scale;
    let colors = code.to_colors();
    let mut pixels = vec![255u8; px * px];
    for y in 0..n {
        for x in 0..n {
            if colors[y * n + x] != Color::Dark {
                continue;
            }
            let x0 = (x + quiet) * scale;
            let y0 = (y + quiet) * scale;
            for dy in 0..scale {
                let row = (y0 + dy) * px + x0;
                pixels[row..row + scale].fill(0);
            }
        }
    }
    let png = encode_png_gray(px as u32, px as u32, &pixels);
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

fn encode_png_gray(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity((width as usize + 1) * height as usize);
    for y in 0..height as usize {
        raw.push(0);
        let start = y * width as usize;
        raw.extend_from_slice(&pixels[start..start + width as usize]);
    }
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::fast());
    enc.write_all(&raw).ok();
    let idat = enc.finish().unwrap_or_default();

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 0, 0, 0, 0]);

    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    out.extend(png_chunk(b"IHDR", &ihdr));
    out.extend(png_chunk(b"IDAT", &idat));
    out.extend(png_chunk(b"IEND", &[]));
    out
}

fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[4..]);
    out.extend_from_slice(&crc.to_be_bytes());
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn qr_create_returns_png() {
        let client = Client::new().unwrap();
        let res = client.login_qr_create("abc");
        let url = res.body.pointer("/data/url").and_then(|v| v.as_str()).unwrap();
        assert_eq!(
            url,
            "https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=abc"
        );
        let data_url = res
            .body
            .pointer("/data/base64")
            .and_then(|v| v.as_str())
            .unwrap();
        let b64 = data_url.strip_prefix("data:image/png;base64,").unwrap();
        let png = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(png.windows(4).any(|w| w == b"IEND"));
    }
}
