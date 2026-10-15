use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("http{status}: {source}", status = status.map(|s| format!(" {s}")).unwrap_or_default())]
    Http {
        #[source]
        source: reqwest::Error,
        status: Option<u16>,
    },

    #[error("kugou http={http_status} status={status:?} error_code={error_code:?}: {message}")]
    Api {
        http_status: u16,
        status: Option<i64>,
        error_code: Option<i64>,
        message: String,
        body: Value,
    },

    #[error("crypto: {0}")]
    Crypto(String),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Message(String),
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Self {
        Self::Message(m.into())
    }

    pub(crate) fn crypto(m: impl Into<String>) -> Self {
        Self::Crypto(m.into())
    }

    pub(crate) fn from_reqwest(e: reqwest::Error) -> Self {
        let status = e.status().map(|s| s.as_u16());
        Self::Http { source: e, status }
    }

    pub(crate) fn api_fail(http_status: u16, body: Value) -> Self {
        let status = body.get("status").and_then(|v| v.as_i64());
        let error_code = body.get("error_code").and_then(|v| v.as_i64());
        let message = api_text(&body).unwrap_or_else(|| "api error".into());
        Self::Api {
            http_status,
            status,
            error_code,
            message,
            body,
        }
    }

    /// Short text safe to show in the login UI.
    pub fn user_message(&self) -> String {
        match self {
            Self::Api { message, .. } if message != "api error" => message.clone(),
            Self::Api {
                error_code: Some(code),
                ..
            } => format!("请求失败（{code}）"),
            Self::Api { .. } => "请求失败".into(),
            other => other.to_string(),
        }
    }
}

fn api_text(body: &Value) -> Option<String> {
    const KEYS: [&str; 5] = ["error", "msg", "errmsg", "error_msg", "message"];
    let from = |v: &Value| {
        KEYS.iter().find_map(|k| {
            v.get(*k)
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
    };
    from(body).or_else(|| match body.get("data") {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(v) => from(v),
        None => None,
    })
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
