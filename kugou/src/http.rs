use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, SET_COOKIE, USER_AGENT};
use reqwest::Method;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

use crate::platform::{DEFAULT_BASE_URL, KG_RF, KG_THASH, USER_AGENT as UA};
use crate::proto::{
    generate_simulate, now_s, parse_set_cookie, sign_key, signature_android_params,
    signature_register_params, signature_web_params, value_query,
};
use crate::{Client, Error, Result};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SignKind {
    #[default]
    Android,
    Web,
    Register,
}

#[derive(Clone, Debug, Default)]
pub enum Body {
    #[default]
    Empty,
    Raw {
        content_type: Option<String>,
        bytes: Bytes,
    },
}

impl Body {
    pub fn json(v: impl serde::Serialize) -> Result<Self> {
        let bytes = serde_json::to_vec(&v)?;
        Ok(Self::Raw {
            content_type: Some("application/json".into()),
            bytes: Bytes::from(bytes),
        })
    }

    pub fn bytes(data: impl Into<Bytes>) -> Self {
        Self::Raw {
            content_type: None,
            bytes: data.into(),
        }
    }

    pub fn as_slice(&self) -> &[u8] {
        match self {
            Body::Empty => b"",
            Body::Raw { bytes, .. } => bytes,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

/// Low-level signed request. Domain APIs build this; callers can too.
#[derive(Clone, Debug)]
pub struct Call {
    pub method: Method,
    pub path: String,
    pub base_url: Option<String>,
    pub query: Map<String, Value>,
    pub body: Body,
    pub headers: Vec<(String, String)>,
    pub sign: SignKind,
    pub tracker_key: bool,
    pub skip_defaults: bool,
    pub unsigned: bool,
    pub raw_bytes: bool,
    pub ip: Option<String>,
}

impl Default for Call {
    fn default() -> Self {
        Self {
            method: Method::GET,
            path: String::new(),
            base_url: None,
            query: Map::new(),
            body: Body::Empty,
            headers: Vec::new(),
            sign: SignKind::Android,
            tracker_key: false,
            skip_defaults: false,
            unsigned: false,
            raw_bytes: false,
            ip: None,
        }
    }
}

impl Call {
    pub fn get(path: impl Into<String>) -> Self {
        Self {
            method: Method::GET,
            path: path.into(),
            ..Self::default()
        }
    }

    pub fn post(path: impl Into<String>) -> Self {
        Self {
            method: Method::POST,
            path: path.into(),
            ..Self::default()
        }
    }

    pub fn base(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    pub fn router(mut self, host: impl Into<String>) -> Self {
        self.headers.push(("x-router".into(), host.into()));
        self
    }

    pub fn header(mut self, k: impl Into<String>, v: impl Into<String>) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }

    pub fn query(mut self, k: impl Into<String>, v: impl Into<Value>) -> Self {
        self.query.insert(k.into(), v.into());
        self
    }

    pub fn queries(mut self, map: Map<String, Value>) -> Self {
        for (k, v) in map {
            self.query.insert(k, v);
        }
        self
    }

    pub fn json(mut self, v: impl serde::Serialize) -> Result<Self> {
        self.body = Body::json(v)?;
        Ok(self)
    }

    pub fn body(mut self, body: Body) -> Self {
        self.body = body;
        self
    }

    pub fn sign(mut self, kind: SignKind) -> Self {
        self.sign = kind;
        self
    }

    pub fn tracker_key(mut self) -> Self {
        self.tracker_key = true;
        self
    }

    pub fn skip_defaults(mut self) -> Self {
        self.skip_defaults = true;
        self
    }

    pub fn unsigned(mut self) -> Self {
        self.unsigned = true;
        self
    }

    pub fn raw_bytes(mut self) -> Self {
        self.raw_bytes = true;
        self
    }
}

#[derive(Clone, Debug)]
pub struct Response {
    pub http_status: u16,
    pub body: Value,
    pub cookies: Vec<(String, String)>,
    pub headers: HashMap<String, String>,
    pub raw: Option<Bytes>,
}

impl Response {
    pub fn kugou_ok(&self) -> bool {
        match &self.body {
            Value::Object(m) => {
                m.get("status").and_then(|s| s.as_i64()) != Some(0)
                    && m.get("error_code")
                        .and_then(|c| c.as_i64())
                        .map(|c| c == 0)
                        .unwrap_or(true)
            }
            _ => (200..300).contains(&self.http_status),
        }
    }

    pub fn data(&self) -> &Value {
        self.body.get("data").unwrap_or(&self.body)
    }

    pub fn pointer(&self, path: &str) -> Option<&Value> {
        self.body.pointer(path)
    }
}

pub(crate) fn obj(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

impl Client {
    pub async fn execute(&self, call: Call) -> Result<Response> {
        let (dfid, token, userid) = {
            let session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            (
                session.dfid().map(|s| s.to_string()).unwrap_or_else(|| "-".into()),
                session.token().unwrap_or("").to_string(),
                session.user_id().map(|s| s.to_string()).unwrap_or_else(|| "0".into()),
            )
        };

        let mid = self.device.mid.clone();
        let clienttime = now_s();

        let mut default_params = Map::new();
        default_params.insert("dfid".into(), json!(dfid));
        default_params.insert("mid".into(), json!(mid));
        default_params.insert("uuid".into(), json!("-"));
        default_params.insert("appid".into(), json!(self.appid()));
        default_params.insert("clientver".into(), json!(self.clientver()));
        default_params.insert("clienttime".into(), json!(clienttime));
        if !token.is_empty() {
            default_params.insert("token".into(), json!(token));
        }
        if !userid.is_empty() && userid != "0" {
            default_params.insert("userid".into(), json!(userid));
        }

        let mut params = if call.skip_defaults {
            call.query.clone()
        } else {
            let mut m = default_params;
            for (k, v) in call.query.iter() {
                m.insert(k.clone(), v.clone());
            }
            m
        };

        if call.tracker_key {
            let hash = params.get("hash").map(value_query).unwrap_or_default();
            let mid_p = params
                .get("mid")
                .map(value_query)
                .unwrap_or_else(|| mid.clone());
            let uid_p = params
                .get("userid")
                .map(value_query)
                .unwrap_or_else(|| userid.clone());
            let appid_p = params
                .get("appid")
                .map(value_query)
                .unwrap_or_else(|| self.appid().to_string());
            params.insert(
                "key".into(),
                json!(sign_key(&hash, &mid_p, &uid_p, &appid_p, self.platform)),
            );
        }

        let data_bytes = call.body.as_slice();
        if params.get("signature").is_none() && !call.unsigned {
            let sig = match call.sign {
                SignKind::Register => signature_register_params(&params),
                SignKind::Web => signature_web_params(&params),
                SignKind::Android => signature_android_params(&params, data_bytes, self.platform),
            };
            params.insert("signature".into(), json!(sig));
        }

        let ct = params
            .get("clienttime")
            .map(value_query)
            .unwrap_or_else(|| clienttime.to_string());

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        for (k, v) in &call.headers {
            if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                headers.insert(name, val);
            }
        }
        insert_h(&mut headers, "dfid", &dfid);
        insert_h(&mut headers, "clienttime", &ct);
        insert_h(&mut headers, "mid", &mid);
        insert_h(&mut headers, "kg-rc", "1");
        insert_h(&mut headers, "kg-thash", KG_THASH);
        insert_h(&mut headers, "kg-rec", "1");
        insert_h(&mut headers, "kg-rf", KG_RF);

        if let Some(ip) = call.ip.as_deref().filter(|s| !s.is_empty()) {
            insert_h(&mut headers, "X-Real-IP", ip);
            insert_h(&mut headers, "X-Forwarded-For", ip);
        }

        let base = call
            .base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let mut url = if call.path.starts_with("http://") || call.path.starts_with("https://") {
            call.path.clone()
        } else {
            format!(
                "{}{}",
                base.trim_end_matches('/'),
                if call.path.starts_with('/') {
                    call.path.clone()
                } else {
                    format!("/{}", call.path)
                }
            )
        };

        if base.contains("openapicdn") {
            let qs = params
                .iter()
                .map(|(k, v)| format!("{}={}", k, value_query(v)))
                .collect::<Vec<_>>()
                .join("&");
            url = format!("{url}?{qs}");
            params.clear();
        }

        let mut rb = self.http.request(call.method.clone(), &url).headers(headers);
        if !params.is_empty() {
            let q: Vec<(String, String)> = params
                .iter()
                .map(|(k, v)| (k.clone(), value_query(v)))
                .collect();
            rb = rb.query(&q);
        }

        match &call.body {
            Body::Empty => {}
            Body::Raw { content_type, bytes } => {
                if let Some(ct) = content_type {
                    rb = rb.header("Content-Type", ct);
                }
                rb = rb.body(bytes.clone());
            }
        }

        let response = rb.send().await.map_err(Error::from_reqwest)?;
        let http_status = response.status().as_u16();

        let mut hdrs = HashMap::new();
        let mut ssa_code = String::new();
        for (k, v) in response.headers().iter() {
            if let Ok(s) = v.to_str() {
                if k.as_str().eq_ignore_ascii_case("ssa-code") {
                    ssa_code = s.to_string();
                }
                hdrs.insert(k.as_str().to_string(), s.to_string());
            }
        }

        let cookies: Vec<(String, String)> = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(parse_set_cookie)
            .collect();

        let bytes = response.bytes().await.map_err(Error::from_reqwest)?;
        let raw = if call.raw_bytes {
            Some(bytes.clone())
        } else {
            None
        };
        let mut body_val = match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) => v,
            Err(_) => {
                if call.raw_bytes {
                    Value::Null
                } else {
                    Value::String(String::from_utf8_lossy(&bytes).into_owned())
                }
            }
        };

        if !ssa_code.is_empty() {
            if let Ok(sim) = generate_simulate(&mid, &userid, &dfid, Some(&self.device.webgl)) {
                if let Value::Object(m) = &mut body_val {
                    m.insert("edt".into(), json!(sim.edt));
                    m.insert("sid".into(), json!(sim.sid));
                    m.insert("ssaCode".into(), json!(ssa_code));
                }
            }
        }

        {
            let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            session.absorb_pairs(cookies.iter().cloned());
        }

        let api_fail = match &body_val {
            Value::Object(m) => {
                m.get("status").and_then(|s| s.as_i64()) == Some(0)
                    || m.get("error_code")
                        .and_then(|c| c.as_i64())
                        .map(|c| c != 0)
                        .unwrap_or(false)
            }
            _ => !(200..300).contains(&http_status),
        };

        if api_fail {
            return Err(Error::api_fail(http_status, body_val));
        }

        Ok(Response {
            http_status,
            body: body_val,
            cookies,
            headers: hdrs,
            raw,
        })
    }
}

fn insert_h(map: &mut HeaderMap, k: &str, v: &str) {
    if let (Ok(n), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
        map.insert(n, val);
    }
}
