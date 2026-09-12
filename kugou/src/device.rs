use crate::platform::DEFAULT_MAC;
use crate::proto::{
    calculate_mid, generate_webgl_hash, get_guid, is_uuid_v4, md5_guid_like, md5_str, random_string,
};

/// Stable device fingerprint used in signed requests.
#[derive(Clone, Debug)]
pub struct Device {
    pub guid: String,
    pub mid: String,
    pub dev: String,
    pub mac: String,
    pub webgl: String,
}

impl Device {
    pub fn generate() -> Self {
        Self::from_guid(md5_str(&get_guid()))
    }

    pub fn from_guid(guid: impl Into<String>) -> Self {
        let raw = guid.into();
        let guid = if is_uuid_v4(&raw) {
            md5_guid_like(&raw)
        } else {
            raw
        };
        let mid = calculate_mid(&guid);
        Self {
            guid,
            mid,
            dev: random_string(10).to_uppercase(),
            mac: DEFAULT_MAC.to_string(),
            webgl: generate_webgl_hash(),
        }
    }

    pub fn from_env() -> Self {
        let guid = match std::env::var("KUGOU_API_GUID")
            .ok()
            .filter(|s| !s.is_empty())
        {
            Some(g) if is_uuid_v4(&g) => md5_guid_like(&g),
            Some(g) => g,
            None => md5_str(&get_guid()),
        };
        let mut d = Self::from_guid(guid);
        if let Some(dev) = std::env::var("KUGOU_API_DEV").ok().filter(|s| !s.is_empty()) {
            d.dev = dev.to_uppercase();
        }
        if let Some(mac) = std::env::var("KUGOU_API_MAC").ok().filter(|s| !s.is_empty()) {
            d.mac = mac.to_uppercase();
        }
        if let Some(webgl) = std::env::var("KUGOU_API_WEBGL").ok().filter(|s| !s.is_empty()) {
            d.webgl = webgl;
        }
        d
    }

    pub fn with_dev(mut self, dev: impl Into<String>) -> Self {
        self.dev = dev.into().to_uppercase();
        self
    }

    pub fn with_mac(mut self, mac: impl Into<String>) -> Self {
        self.mac = mac.into().to_uppercase();
        self
    }

    pub fn with_webgl(mut self, webgl: impl Into<String>) -> Self {
        self.webgl = webgl.into();
        self
    }
}

impl Default for Device {
    fn default() -> Self {
        Self::generate()
    }
}
