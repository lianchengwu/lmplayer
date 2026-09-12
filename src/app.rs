use std::fs;
use std::path::PathBuf;

use kugou::Client;

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
        let kg = Client::builder().lite().cookie_str(cookie).build()?;
        Ok(Self { kg })
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
        let uid = s.user_id().unwrap_or("0");
        let path = Self::default_cookie_path();
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, format!("token={token};userid={uid}"))?;
        Ok(())
    }
}
