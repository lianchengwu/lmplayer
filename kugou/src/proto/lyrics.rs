use base64::Engine;
use flate2::read::ZlibDecoder;
use std::io::Read;

const KRC_KEY: [u8; 16] = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

pub fn decode_krc(val: &[u8]) -> String {
    if val.len() <= 4 {
        return String::new();
    }
    let mut krc: Vec<u8> = val[4..].to_vec();
    for (i, b) in krc.iter_mut().enumerate() {
        *b ^= KRC_KEY[i % KRC_KEY.len()];
    }
    let mut decoder = ZlibDecoder::new(&krc[..]);
    let mut out = Vec::new();
    match decoder.read_to_end(&mut out) {
        Ok(_) => String::from_utf8_lossy(&out).into_owned(),
        Err(_) => String::new(),
    }
}

pub fn decode_krc_base64(s: &str) -> String {
    match base64::engine::general_purpose::STANDARD.decode(s) {
        Ok(b) => decode_krc(&b),
        Err(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn lyrics_roundtrip() {
        let plain = b"[00:00.00]hello lyrics";
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(plain).unwrap();
        let comp = enc.finish().unwrap();
        let mut body = Vec::new();
        for (i, b) in comp.iter().enumerate() {
            body.push(b ^ KRC_KEY[i % 16]);
        }
        let mut raw = b"krc1".to_vec();
        raw.extend_from_slice(&body);
        assert_eq!(decode_krc(&raw), String::from_utf8_lossy(plain));
    }

    #[test]
    fn lyrics_decodes_node_sample() {
        assert_eq!(
            decode_krc_base64("a3JjMTjb6kFugkZ3gQUBpQOao6CJEKnecvg4aVc2dx7J2Q=="),
            "[00:00.00]hello lyrics"
        );
    }
}
