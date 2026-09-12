use md5::{Digest, Md5};
use sha1::Sha1;

pub(crate) fn md5_bytes(data: &[u8]) -> String {
    let mut h = Md5::new();
    h.update(data);
    hex::encode(h.finalize())
}

pub(crate) fn md5_str(data: &str) -> String {
    md5_bytes(data.as_bytes())
}

#[allow(dead_code)]
pub(crate) fn sha1_str(data: &str) -> String {
    let mut h = Sha1::new();
    h.update(data.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_hello() {
        assert_eq!(md5_str("hello"), "5d41402abc4b2a76b9719d911017c592");
    }

    #[test]
    fn sha1_hello() {
        assert_eq!(sha1_str("hello"), "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    }
}
