use aes::{Aes128, Aes192, Aes256};
use base64::Engine;
use cbc::{Decryptor, Encryptor};
use cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use serde_json::Value;

use super::hash::md5_str;
use super::id::random_string;
use crate::Error;

#[derive(Clone, Debug)]
pub(crate) struct AesEncrypt {
    pub str: String,
    pub key: String,
}

fn aes_encrypt_raw(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, Error> {
    if iv.len() != 16 {
        return Err(Error::crypto(format!("iv len {} != 16", iv.len())));
    }
    match key.len() {
        16 => Ok(Encryptor::<Aes128>::new(key.into(), iv.into()).encrypt_padded_vec_mut::<Pkcs7>(data)),
        24 => Ok(Encryptor::<Aes192>::new(key.into(), iv.into()).encrypt_padded_vec_mut::<Pkcs7>(data)),
        32 => Ok(Encryptor::<Aes256>::new(key.into(), iv.into()).encrypt_padded_vec_mut::<Pkcs7>(data)),
        n => Err(Error::crypto(format!("unsupported aes key len {n}"))),
    }
}

fn aes_decrypt_raw(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, Error> {
    if iv.len() != 16 {
        return Err(Error::crypto(format!("iv len {} != 16", iv.len())));
    }
    let out = match key.len() {
        16 => Decryptor::<Aes128>::new(key.into(), iv.into())
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map_err(|e| Error::crypto(e.to_string()))?,
        24 => Decryptor::<Aes192>::new(key.into(), iv.into())
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map_err(|e| Error::crypto(e.to_string()))?,
        32 => Decryptor::<Aes256>::new(key.into(), iv.into())
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map_err(|e| Error::crypto(e.to_string()))?,
        n => return Err(Error::crypto(format!("unsupported aes key len {n}"))),
    };
    Ok(out)
}

pub(crate) fn json_bytes(data: &Value) -> Vec<u8> {
    match data {
        Value::String(s) => s.as_bytes().to_vec(),
        other => other.to_string().into_bytes(),
    }
}

/// AES-CBC PKCS7. Explicit key+iv → hex. Otherwise `{str, key}` with key/iv from md5(temp).
pub(crate) fn aes_encrypt(data: &[u8], key: Option<&str>, iv: Option<&str>) -> Result<AesEncrypt, Error> {
    if let (Some(k), Some(v)) = (key, iv) {
        let ct = aes_encrypt_raw(k.as_bytes(), v.as_bytes(), data)?;
        return Ok(AesEncrypt {
            str: hex::encode(ct),
            key: k.to_string(),
        });
    }
    let temp_key = key
        .map(|s| s.to_string())
        .unwrap_or_else(|| random_string(16).to_lowercase());
    let derived: String = md5_str(&temp_key).chars().take(32).collect();
    let iv_s = derived[derived.len().saturating_sub(16)..].to_string();
    let ct = aes_encrypt_raw(derived.as_bytes(), iv_s.as_bytes(), data)?;
    Ok(AesEncrypt {
        str: hex::encode(ct),
        key: temp_key,
    })
}

pub(crate) fn aes_encrypt_value(data: &Value, key: Option<&str>, iv: Option<&str>) -> Result<AesEncrypt, Error> {
    aes_encrypt(&json_bytes(data), key, iv)
}

pub(crate) fn aes_decrypt(data_hex: &str, key: &str, iv: Option<&str>) -> Result<Value, Error> {
    let mut key_s = key.to_string();
    if iv.is_none() {
        key_s = md5_str(&key_s).chars().take(32).collect();
    }
    let iv_s = iv
        .map(|s| s.to_string())
        .unwrap_or_else(|| key_s[key_s.len().saturating_sub(16)..].to_string());
    let ct = hex::decode(data_hex).map_err(|e| Error::crypto(e.to_string()))?;
    let pt = aes_decrypt_raw(key_s.as_bytes(), iv_s.as_bytes(), &ct)?;
    let text = String::from_utf8_lossy(&pt).to_string();
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

#[allow(dead_code)]
pub(crate) fn playlist_aes_encrypt(data: &Value) -> Result<AesEncrypt, Error> {
    let use_data = match data {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let key = random_string(6).to_lowercase();
    let digest = md5_str(&key);
    let encrypt_key = digest[..16].to_string();
    let iv = digest[16..32].to_string();
    let ct = aes_encrypt_raw(encrypt_key.as_bytes(), iv.as_bytes(), use_data.as_bytes())?;
    Ok(AesEncrypt {
        key,
        str: base64::engine::general_purpose::STANDARD.encode(ct),
    })
}

#[allow(dead_code)]
pub(crate) fn playlist_aes_decrypt(str_b64: &str, key: &str) -> Result<Value, Error> {
    let digest = md5_str(key);
    let encrypt_key = digest[..16].to_string();
    let iv = digest[16..32].to_string();
    let ct = base64::engine::general_purpose::STANDARD
        .decode(str_b64)
        .map_err(|e| Error::crypto(e.to_string()))?;
    let pt = aes_decrypt_raw(encrypt_key.as_bytes(), iv.as_bytes(), &ct)?;
    let text = String::from_utf8_lossy(&pt).to_string();
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

pub(crate) fn aes128_cbc_pkcs7_b64(key: &[u8], iv: &[u8], data: &[u8]) -> Result<String, Error> {
    let ct = aes_encrypt_raw(key, iv, data)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(ct))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aes_explicit_matches_node() {
        let enc = aes_encrypt(b"hello", Some("0123456789abcdef"), Some("fedcba9876543210")).unwrap();
        assert_eq!(enc.str, "7bedceb0655f38941069789f36462091");
        let dec = aes_decrypt(&enc.str, "0123456789abcdef", Some("fedcba9876543210")).unwrap();
        assert_eq!(dec, Value::String("hello".into()));
    }

    #[test]
    fn playlist_decrypts_node_ciphertext() {
        let dec = playlist_aes_decrypt("DQN/GTTZCXb7fm7eB/upDw==", "wwhk8j").unwrap();
        assert_eq!(dec, json!({"foo": "bar"}));
    }

    #[test]
    fn playlist_roundtrip() {
        let src = json!({"foo": "bar"});
        let enc = playlist_aes_encrypt(&src).unwrap();
        let dec = playlist_aes_decrypt(&enc.str, &enc.key).unwrap();
        assert_eq!(dec, src);
    }
}
