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
        let message = body
            .get("error")
            .and_then(|v| v.as_str())
            .or_else(|| body.get("msg").and_then(|v| v.as_str()))
            .or_else(|| body.get("errmsg").and_then(|v| v.as_str()))
            .unwrap_or("api error")
            .to_string();
        Self::Api {
            http_status,
            status,
            error_code,
            message,
            body,
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
