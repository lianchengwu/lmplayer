use serde_json::{Map, Value};

use super::hash::{md5_bytes, md5_str};
use crate::Platform;

const WEB_SALT: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const ANDROID_SALT: &str = "OIlwieks28dk2k092lksi2UIkp";
const ANDROID_LITE_SALT: &str = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
const REGISTER_SALT: &str = "1014";
#[allow(dead_code)]
const SIGN_PARAMS_SALT: &str = "R6snCXJgbCaj9WFRJKefTMIFp0ey6Gza";
const SIGN_KEY_SALT: &str = "57ae12eb6890223e355ccfcb74edf70d";
const SIGN_KEY_LITE_SALT: &str = "185672dd44712f60bb1736df5a377e82";
#[allow(dead_code)]
const CLOUD_SALT: &str = "ebd1ac3134c880bda6a2194537843caa0162e2e7";

fn js_display(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => "[object Object]".into(),
    }
}

fn android_display(v: &Value) -> String {
    match v {
        Value::Object(_) | Value::Array(_) => v.to_string(),
        other => js_display(other),
    }
}

pub(crate) fn value_query(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => v.to_string(),
    }
}

pub(crate) fn signature_web_params(params: &Map<String, Value>) -> String {
    let mut pairs: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", js_display(v)))
        .collect();
    pairs.sort();
    let joined = pairs.concat();
    md5_str(&format!("{WEB_SALT}{joined}{WEB_SALT}"))
}

pub(crate) fn signature_android_params(
    params: &Map<String, Value>,
    data: &[u8],
    platform: Platform,
) -> String {
    let salt = match platform {
        Platform::Lite => ANDROID_LITE_SALT,
        Platform::Standard => ANDROID_SALT,
    };
    let mut keys: Vec<&String> = params.keys().collect();
    keys.sort();
    let params_string: String = keys
        .into_iter()
        .map(|k| format!("{k}={}", android_display(&params[k])))
        .collect();

    if !data.is_empty() {
        let mut buf = Vec::with_capacity(salt.len() * 2 + params_string.len() + data.len());
        buf.extend_from_slice(salt.as_bytes());
        buf.extend_from_slice(params_string.as_bytes());
        buf.extend_from_slice(data);
        buf.extend_from_slice(salt.as_bytes());
        return md5_bytes(&buf);
    }
    md5_str(&format!("{salt}{params_string}{salt}"))
}

pub(crate) fn signature_register_params(params: &Map<String, Value>) -> String {
    let mut values: Vec<String> = params.values().map(js_display).collect();
    values.sort();
    let joined = values.concat();
    md5_str(&format!("{REGISTER_SALT}{joined}{REGISTER_SALT}"))
}

#[allow(dead_code)]
pub(crate) fn sign_params(params: &Map<String, Value>, data: &str) -> String {
    let mut keys: Vec<&String> = params.keys().collect();
    keys.sort();
    let params_string: String = keys
        .into_iter()
        .map(|k| format!("{k}{}", js_display(&params[k])))
        .collect();
    md5_str(&format!("{params_string}{data}{SIGN_PARAMS_SALT}"))
}

pub(crate) fn sign_key(hash: &str, mid: &str, userid: &str, appid: &str, platform: Platform) -> String {
    let salt = match platform {
        Platform::Lite => SIGN_KEY_LITE_SALT,
        Platform::Standard => SIGN_KEY_SALT,
    };
    let userid = if userid.is_empty() { "0" } else { userid };
    md5_str(&format!("{hash}{salt}{appid}{mid}{userid}"))
}

#[allow(dead_code)]
pub(crate) fn sign_cloud_key(hash: &str, pid: &str) -> String {
    md5_str(&format!("musicclound{hash}{pid}{CLOUD_SALT}"))
}

pub(crate) fn sign_params_key(data: &str, appid: i64, clientver: i64, platform: Platform) -> String {
    let salt = match platform {
        Platform::Lite => ANDROID_LITE_SALT,
        Platform::Standard => ANDROID_SALT,
    };
    md5_str(&format!("{appid}{salt}{clientver}{data}"))
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Map<String, Value> {
        json!({
            "appid": 1005,
            "clientver": 20489,
            "clienttime": 1700000000,
            "dfid": "-",
            "mid": "123",
            "uuid": "-"
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn android_empty_body() {
        assert_eq!(
            signature_android_params(&sample(), b"", Platform::Standard),
            "7237af6540df25f68576fd7a9dd80fbf"
        );
    }

    #[test]
    fn android_json_body() {
        assert_eq!(
            signature_android_params(&sample(), br#"{"a":1}"#, Platform::Standard),
            "2621064434759bc6c83c6123f08e8916"
        );
    }

    #[test]
    fn web() {
        assert_eq!(signature_web_params(&sample()), "f415a8194da58dd092cbf443903e7b71");
    }

    #[test]
    fn register() {
        assert_eq!(
            signature_register_params(&sample()),
            "d830c671805ec9c7115ce7d65f606f2a"
        );
    }

    #[test]
    fn params_sign() {
        assert_eq!(sign_params(&sample(), ""), "7d39d48c5d5a29c8fc5890258cdfb533");
    }

    #[test]
    fn key_sign() {
        assert_eq!(
            sign_key("abc", "mid1", "0", "1005", Platform::Standard),
            "cc3cb7f4073a29d0ff6fac2d916980e4"
        );
    }

    #[test]
    fn cloud() {
        assert_eq!(sign_cloud_key("hash1", "pid1"), "34c7636aba707c7570aff8614626c36f");
    }

    #[test]
    fn params_key() {
        assert_eq!(
            sign_params_key("1700000000", 1005, 20489, Platform::Standard),
            "a1f65b6a8fe7e191521406ce8661ae02"
        );
    }
}
