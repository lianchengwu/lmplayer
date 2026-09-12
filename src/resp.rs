use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(message: impl Into<String>, data: T) -> Self {
        Self {
            success: true,
            message: message.into(),
            error_code: Some(0),
            status: Some(1),
            data: Some(data),
        }
    }

    pub fn fail(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            error_code: None,
            status: None,
            data: None,
        }
    }

    pub fn from_kugou(message: impl Into<String>, res: &kugou::Response, data: T) -> Self {
        let status = res.body.get("status").and_then(|v| v.as_i64());
        let error_code = res.body.get("error_code").and_then(|v| v.as_i64());
        Self {
            success: res.kugou_ok(),
            message: message.into(),
            error_code,
            status,
            data: Some(data),
        }
    }
}

pub fn s(v: Option<&serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

pub fn i(v: Option<&serde_json::Value>) -> i64 {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}
