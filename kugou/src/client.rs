use reqwest::Client as HttpClient;
use reqwest::Proxy;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::device::Device;
use crate::platform::Platform;
use crate::session::Session;
use crate::{Error, Result};

#[derive(Clone)]
pub struct Client {
    pub(crate) http: HttpClient,
    pub(crate) platform: Platform,
    pub(crate) device: Device,
    pub(crate) session: Arc<Mutex<Session>>,
}

impl Client {
    pub fn new() -> Result<Self> {
        Builder::new().build()
    }

    pub fn lite() -> Result<Self> {
        Builder::new().platform(Platform::Lite).build()
    }

    pub fn builder() -> Builder {
        Builder::new()
    }

    pub fn platform(&self) -> Platform {
        self.platform
    }

    pub fn appid(&self) -> i64 {
        self.platform.appid()
    }

    pub fn clientver(&self) -> i64 {
        self.platform.clientver()
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    pub fn session(&self) -> Session {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_token(&self, token: impl Into<String>, user_id: impl Into<String>) {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_token(token, user_id);
    }

    pub fn set_cookie_str(&self, cookie: &str) {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .parse_cookie_str(cookie);
    }

    pub(crate) fn rsa_pem(&self) -> &'static str {
        self.platform.rsa_pem()
    }

    pub(crate) fn session_token(&self) -> String {
        self.session().token().unwrap_or("").to_string()
    }

    pub(crate) fn session_userid_json(&self) -> serde_json::Value {
        match self.session().user_id().and_then(|s| s.parse::<i64>().ok()) {
            Some(n) => serde_json::json!(n),
            None => serde_json::json!(0),
        }
    }
}

pub struct Builder {
    platform: Platform,
    device: Device,
    session: Session,
    proxy: Option<String>,
    timeout: Duration,
}

impl Builder {
    pub fn new() -> Self {
        let mut session = Session::new();
        if let Ok(cookie) = std::env::var("KUGOU_API_COOKIE") {
            session.parse_cookie_str(&cookie);
        }
        Self {
            platform: Platform::Standard,
            device: Device::from_env(),
            session,
            proxy: std::env::var("KUGOU_API_PROXY")
                .ok()
                .filter(|s| !s.is_empty()),
            timeout: Duration::from_secs(30),
        }
    }

    pub fn platform(mut self, p: Platform) -> Self {
        self.platform = p;
        self
    }

    pub fn lite(mut self) -> Self {
        self.platform = Platform::Lite;
        self
    }

    pub fn device(mut self, d: Device) -> Self {
        self.device = d;
        self
    }

    pub fn guid(mut self, g: impl Into<String>) -> Self {
        let mut d = Device::from_guid(g);
        d.dev = self.device.dev.clone();
        d.mac = self.device.mac.clone();
        d.webgl = self.device.webgl.clone();
        self.device = d;
        self
    }

    pub fn proxy(mut self, p: impl Into<String>) -> Self {
        self.proxy = Some(p.into());
        self
    }

    pub fn timeout(mut self, d: Duration) -> Self {
        self.timeout = d;
        self
    }

    pub fn token(mut self, token: impl Into<String>, user_id: impl Into<String>) -> Self {
        self.session.set_token(token, user_id);
        self
    }

    pub fn dfid(mut self, dfid: impl Into<String>) -> Self {
        self.session.set("dfid", dfid);
        self
    }

    pub fn cookie_str(mut self, s: &str) -> Self {
        self.session.parse_cookie_str(s);
        self
    }

    pub fn session(mut self, s: Session) -> Self {
        self.session = s;
        self
    }

    pub fn build(self) -> Result<Client> {
        let mut b = HttpClient::builder()
            .timeout(self.timeout)
            .user_agent(crate::platform::USER_AGENT)
            .gzip(true)
            .redirect(reqwest::redirect::Policy::limited(10));
        if let Some(p) = &self.proxy {
            b = b.proxy(Proxy::all(p).map_err(|e| Error::msg(e.to_string()))?);
        }
        Ok(Client {
            http: b.build().map_err(Error::from_reqwest)?,
            platform: self.platform,
            device: self.device,
            session: Arc::new(Mutex::new(self.session)),
        })
    }
}

impl Default for Builder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds() {
        let c = Client::new().unwrap();
        assert_eq!(c.appid(), 1005);
        assert_eq!(c.clientver(), 20489);
        let lite = Client::lite().unwrap();
        assert_eq!(lite.appid(), 3116);
        assert_eq!(lite.clientver(), 11440);
    }

    #[test]
    fn token_roundtrip() {
        let c = Client::new().unwrap();
        c.set_token("test_token_123", "999999");
        let s = c.session();
        assert_eq!(s.token(), Some("test_token_123"));
        assert_eq!(s.user_id(), Some("999999"));
    }
}
