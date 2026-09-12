use md5::{Digest, Md5};
use num_bigint::BigUint;
use num_traits::Num;
use rand::Rng;

const RAND_CHARS: &[u8] = b"1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// JS `Math.ceil((len-1)*Math.random())` over the charset.
pub(crate) fn random_string(len: usize) -> String {
    let mut rng = rand::thread_rng();
    let n = RAND_CHARS.len();
    (0..len)
        .map(|_| {
            let r: f64 = rng.gen();
            let idx = ((n - 1) as f64 * r).ceil() as usize;
            RAND_CHARS[idx.min(n - 1)] as char
        })
        .collect()
}

pub(crate) fn calculate_mid(s: &str) -> String {
    let mut h = Md5::new();
    h.update(s.as_bytes());
    let digest = hex::encode(h.finalize());
    BigUint::from_str_radix(&digest, 16)
        .map(|n| n.to_string())
        .unwrap_or_else(|_| "0".into())
}

pub(crate) fn get_guid() -> String {
    let mut rng = rand::thread_rng();
    let mut e = || {
        let n: u32 = (65536.0 * (1.0 + rng.gen::<f64>())) as u32;
        format!("{n:x}")[1..].to_string()
    };
    format!(
        "{}{}-{}-{}-{}-{}{}{}",
        e(),
        e(),
        e(),
        e(),
        e(),
        e(),
        e(),
        e()
    )
}

pub(crate) fn generate_webgl_hash() -> String {
    let mut rng = rand::thread_rng();
    let hi: u64 = rng.gen::<u32>() as u64;
    let lo: u64 = rng.gen::<u32>() as u64;
    (hi.wrapping_mul(0x1_0000_0000) + lo).to_string()
}

pub(crate) fn is_uuid_v4(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    let hex = |c: u8| c.is_ascii_hexdigit();
    for (i, c) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *c != b'-' {
                    return false;
                }
            }
            14 => {
                if *c != b'4' {
                    return false;
                }
            }
            19 => {
                let ch = (*c as char).to_ascii_lowercase();
                if !matches!(ch, '8' | '9' | 'a' | 'b') {
                    return false;
                }
            }
            _ => {
                if !hex(*c) {
                    return false;
                }
            }
        }
    }
    true
}

pub(crate) fn md5_guid_like(guid: &str) -> String {
    let mut h = Md5::new();
    h.update(guid.as_bytes());
    hex::encode(h.finalize())
}

pub(crate) fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn now_s() -> u64 {
    now_ms() / 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mid_known() {
        assert_eq!(
            calculate_mid("550e8400-e29b-41d4-a716-446655440000"),
            "308741372901437977228425563242293240765"
        );
    }

    #[test]
    fn uuid_v4() {
        assert!(is_uuid_v4("550e8400-e29b-41d4-a716-446655440000"));
        assert!(!is_uuid_v4("550e8400-e29b-31d4-a716-446655440000"));
    }
}
