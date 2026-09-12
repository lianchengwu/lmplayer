use base64::Engine;
use num_bigint::BigUint;
use rand::rngs::OsRng;
use rsa::pkcs8::DecodePublicKey;
use rsa::traits::PublicKeyParts;
use rsa::{Oaep, Pkcs1v15Encrypt, RsaPublicKey};
use serde_json::Value;
use sha2::Sha256;

use super::aes::json_bytes;
use crate::Error;

pub(crate) const PUBLIC_RSA_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----";

pub(crate) const PUBLIC_LITE_RSA_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB\n-----END PUBLIC KEY-----";

pub(crate) const SIMULATE_RSA_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoW2+Ylo8ALePSQTP0xBFlFmEOHvBD9tS+s7DBlfKEu3RzzvZTaX1JtYbX4+AVUqj6ARz8IM+CKByqGFvbHN/W64XxNI+q7z36ajCL3VTJ2W5G9MCJitc6oGbire4NQfhaEq0nC+hxBWQvCbIFflA2ItrLUbSU7z1bHA/a+jlQm4OWvY+IKnTryOJTPuT1yNOVjbJ8wBLKy2DgQr9pPqWPmEQtGpR5IM9V8Kao6PaSdKYOWGbX3i2+RzIKhvZUxxtJwdVbqPlDPlW9h4/xIBc56Lgvr4aIl8nFtwbj4UJVUTFuGrs0tY9H/tXvZ22dUCKuGxW/gW7ZF+gXz6vHtYarQIDAQAB\n-----END PUBLIC KEY-----";

fn wrap_pem(pem: &str) -> String {
    let mut lines = Vec::new();
    let mut body = String::new();
    for line in pem.lines() {
        let t = line.trim();
        if t.starts_with("-----") {
            if !body.is_empty() {
                for chunk in body.as_bytes().chunks(64) {
                    lines.push(std::str::from_utf8(chunk).unwrap_or("").to_string());
                }
                body.clear();
            }
            lines.push(t.to_string());
        } else {
            body.push_str(t);
        }
    }
    if !body.is_empty() {
        for chunk in body.as_bytes().chunks(64) {
            lines.push(std::str::from_utf8(chunk).unwrap_or("").to_string());
        }
    }
    lines.join("\n")
}

fn parse_public_key(pem: &str) -> Result<RsaPublicKey, Error> {
    RsaPublicKey::from_public_key_pem(&wrap_pem(pem)).map_err(|e| Error::crypto(format!("rsa: {e}")))
}

/// Raw RSA (no padding): zero-pad on the right, then m^e mod n as hex.
pub(crate) fn rsa_raw_encrypt(data: &[u8], public_pem: &str) -> Result<String, Error> {
    let key = parse_public_key(public_pem)?;
    let n = BigUint::from_bytes_be(&key.n().to_bytes_be());
    let e = BigUint::from_bytes_be(&key.e().to_bytes_be());
    let key_len = (n.bits() as usize).div_ceil(8);
    if data.len() > key_len {
        return Err(Error::crypto("Data length exceeds key size"));
    }
    let mut padded = vec![0u8; key_len];
    padded[..data.len()].copy_from_slice(data);
    let m = BigUint::from_bytes_be(&padded);
    let c = m.modpow(&e, &n);
    let hex_s = c.to_str_radix(16);
    Ok(format!("{:0>width$}", hex_s, width = key_len * 2))
}

pub(crate) fn rsa_raw_encrypt_value(data: &Value, public_pem: &str) -> Result<String, Error> {
    rsa_raw_encrypt(&json_bytes(data), public_pem)
}

#[allow(dead_code)]
pub(crate) fn rsa_pkcs1_encrypt(data: &[u8], public_pem: &str) -> Result<String, Error> {
    let key = parse_public_key(public_pem)?;
    let enc = key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, data)
        .map_err(|e| Error::crypto(format!("rsa: {e}")))?;
    Ok(hex::encode(enc))
}

pub(crate) fn rsa_oaep_sha256_b64(data: &[u8], public_pem: &str) -> Result<String, Error> {
    let key = parse_public_key(public_pem)?;
    let padding = Oaep::new::<Sha256>();
    let enc = key
        .encrypt(&mut OsRng, padding, data)
        .map_err(|e| Error::crypto(format!("rsa: {e}")))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(enc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rsa_raw_matches_node() {
        let hex = rsa_raw_encrypt_value(
            &json!({ "clienttime_ms": 1700000000u64, "key": "abcdefghijklmnop" }),
            PUBLIC_RSA_KEY,
        )
        .unwrap();
        assert_eq!(
            hex,
            "644da1a8f6da96bd08a7f07ee0f3f69372129689d7a2c12211b6e737941cabeb39fd55a903b4324b578cb0cfcbda7832182ee4a4af8b80aff58701a6d200bdb8b26a06b9fe4fb736e77fb1954e10fa601bad4839c7a745ef077f2d917b36591bad321974746192b9829b5c288c9d31d69debd9bb4983a67a5aeee76fae016d53"
        );
    }

    #[test]
    fn rsa_pkcs1_length() {
        let hex = rsa_pkcs1_encrypt(
            &json_bytes(&json!({ "aes": "abc123", "uid": 0, "token": "" })),
            PUBLIC_RSA_KEY,
        )
        .unwrap();
        assert_eq!(hex.len(), 256);
    }
}
