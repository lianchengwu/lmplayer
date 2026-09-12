use std::collections::BTreeMap;

/// First `name=value` of a Set-Cookie line; attributes dropped.
pub(crate) fn parse_set_cookie(header: &str) -> Option<(String, String)> {
    let first = header.split(';').next()?.trim();
    if first.is_empty() {
        return None;
    }
    let (k, v) = match first.split_once('=') {
        Some((k, v)) => (k.trim(), v.trim()),
        None => return None,
    };
    if k.is_empty() {
        return None;
    }
    Some((k.to_string(), v.to_string()))
}

pub(crate) fn parse_cookie_header(cookie: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for part in cookie.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        match part.split_once('=') {
            Some((k, v)) => {
                let k = k.trim();
                if !k.is_empty() {
                    out.insert(k.to_string(), v.trim().to_string());
                }
            }
            None => {
                out.insert(part.to_string(), String::new());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_cookie_strips_attrs() {
        let (k, v) = parse_set_cookie("token=abc; Path=/; HttpOnly; Domain=.kugou.com").unwrap();
        assert_eq!(k, "token");
        assert_eq!(v, "abc");
    }

    #[test]
    fn cookie_header_no_leading_space_keys() {
        let c = parse_cookie_header("token=abc; userid=123");
        assert_eq!(c.get("token").unwrap(), "abc");
        assert_eq!(c.get("userid").unwrap(), "123");
    }
}
