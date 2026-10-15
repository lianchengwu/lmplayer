use std::fs;
use std::path::PathBuf;

use kugou::{Client, Device};

use crate::Result;

#[derive(Clone)]
pub struct Player {
    pub kg: Client,
}

impl Player {
    pub fn lite() -> Result<Self> {
        Ok(Self {
            kg: Client::lite()?,
        })
    }

    pub fn with_cookie(cookie: &str) -> Result<Self> {
        let mut b = Client::builder().lite().cookie_str(cookie);
        if let Some(guid) = cookie_value(cookie, "guid") {
            let mut d = Device::from_guid(guid);
            if let Some(dev) = cookie_value(cookie, "dev") {
                d = d.with_dev(dev);
            }
            if let Some(mac) = cookie_value(cookie, "mac") {
                d = d.with_mac(mac);
            }
            if let Some(webgl) = cookie_value(cookie, "webgl") {
                d = d.with_webgl(webgl);
            }
            b = b.device(d);
        }
        Ok(Self { kg: b.build()? })
    }

    pub fn from_cookie_file(path: PathBuf) -> Result<Self> {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        Self::with_cookie(raw.trim())
    }

    pub fn default_cookie_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("wmplayer")
            .join("cookies.txt")
    }

    pub fn load_saved() -> Result<Self> {
        let p = Self::default_cookie_path();
        if p.exists() {
            Self::from_cookie_file(p)
        } else {
            Self::lite()
        }
    }

    pub fn save_cookie(&self) -> Result<()> {
        let s = self.kg.session();
        let Some(token) = s.token() else {
            return Ok(());
        };
        let d = self.kg.device();
        let mut parts = vec![
            format!("token={token}"),
            format!("userid={}", s.user_id().unwrap_or("0")),
            format!("guid={}", d.guid),
            format!("dev={}", d.dev),
            format!("mac={}", d.mac),
            format!("webgl={}", d.webgl),
        ];
        for key in ["dfid", "vip_token", "vip_type", "t1"] {
            if let Some(v) = s.get(key).filter(|v| !v.is_empty() && *v != "-") {
                parts.push(format!("{key}={v}"));
            }
        }
        let path = Self::default_cookie_path();
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, parts.join(";"))?;
        Ok(())
    }

    pub fn clear_cookie(&self) -> Result<()> {
        let path = Self::default_cookie_path();
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

fn cookie_value(cookie: &str, key: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        (k.trim() == key)
            .then(|| v.trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_restores_device() {
        let p = Player::with_cookie(
            "token=abc;userid=12;guid=00112233445566778899aabbccddeeff;dev=abcdefghij;mac=02:00:00:00:00:00;webgl=123",
        )
        .unwrap();
        assert_eq!(p.kg.session().token(), Some("abc"));
        assert_eq!(p.kg.session().user_id(), Some("12"));
        assert_eq!(p.kg.device().guid, "00112233445566778899aabbccddeeff");
        assert_eq!(p.kg.device().dev, "ABCDEFGHIJ");
        assert_eq!(p.kg.device().mac, "02:00:00:00:00:00");
        assert_eq!(p.kg.device().webgl, "123");
    }
}
