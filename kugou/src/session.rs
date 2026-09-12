use serde_json::Value;
use std::collections::BTreeMap;

use crate::proto::{aes_decrypt, parse_cookie_header, parse_set_cookie, value_query};

/// Login/session cookies. Device ids live on [`crate::Device`], not here.
#[derive(Clone, Debug, Default)]
pub struct Session {
    inner: BTreeMap<String, String>,
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn token(&self) -> Option<&str> {
        self.nonempty("token")
    }

    pub fn user_id(&self) -> Option<&str> {
        self.nonempty("userid").filter(|s| *s != "0")
    }

    pub fn dfid(&self) -> Option<&str> {
        self.nonempty("dfid").filter(|s| *s != "-")
    }

    pub fn vip_token(&self) -> Option<&str> {
        self.nonempty("vip_token")
    }

    pub fn vip_type(&self) -> Option<&str> {
        self.nonempty("vip_type")
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.inner.get(key).map(|s| s.as_str())
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.inner.insert(key.into(), value.into());
    }

    pub fn set_token(&mut self, token: impl Into<String>, user_id: impl Into<String>) {
        self.inner.insert("token".into(), token.into());
        self.inner.insert("userid".into(), user_id.into());
    }

    pub fn absorb_set_cookie(&mut self, header: &str) {
        if let Some((k, v)) = parse_set_cookie(header) {
            if !v.is_empty() {
                self.inner.insert(k, v);
            }
        }
    }

    pub fn absorb_pairs(&mut self, pairs: impl IntoIterator<Item = (String, String)>) {
        for (k, v) in pairs {
            if !k.is_empty() && !v.is_empty() {
                self.inner.insert(k, v);
            }
        }
    }

    pub fn parse_cookie_str(&mut self, cookie: &str) {
        for (k, v) in parse_cookie_header(cookie) {
            if !k.is_empty() {
                self.inner.insert(k, v);
            }
        }
    }

    /// Decrypt `data.secu_params` after a successful login and fold tokens in.
    pub(crate) fn apply_login(&mut self, body: &mut Value, encrypt_key: &str) {
        if body.get("status").and_then(|s| s.as_i64()) != Some(1) {
            return;
        }
        if let Some(secu) = body
            .pointer("/data/secu_params")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        {
            if let Ok(token) = aes_decrypt(&secu, encrypt_key, None) {
                match token {
                    Value::Object(map) => {
                        if let Some(Value::Object(data)) = body.get_mut("data") {
                            for (k, v) in &map {
                                data.insert(k.clone(), v.clone());
                                self.set(k, value_query(v));
                            }
                        }
                    }
                    other => {
                        let s = value_query(&other);
                        if let Some(Value::Object(data)) = body.get_mut("data") {
                            data.insert("token".into(), Value::String(s.clone()));
                        }
                        self.set("token", s);
                    }
                }
            }
        }
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        if let Some(v) = nonempty_field(&data, "t1") {
            self.set("t1", v);
        }
        if let Some(v) = nonempty_field(&data, "token") {
            self.set("token", v);
        }
        if let Some(v) = nonempty_field(&data, "userid") {
            self.set("userid", v);
        }
        if let Some(v) = nonempty_field(&data, "vip_type") {
            self.set("vip_type", v);
        }
        if let Some(v) = nonempty_field(&data, "vip_token") {
            self.set("vip_token", v);
        }
    }

    pub fn snapshot(&self) -> BTreeMap<String, String> {
        self.inner.clone()
    }

    fn nonempty(&self, key: &str) -> Option<&str> {
        self.inner
            .get(key)
            .map(|s| s.as_str())
            .filter(|s| !s.is_empty())
    }
}

fn nonempty_field(data: &Value, key: &str) -> Option<String> {
    let v = data.get(key)?;
    let s = value_query(v);
    if s.is_empty() || s == "null" {
        None
    } else {
        Some(s)
    }
}
