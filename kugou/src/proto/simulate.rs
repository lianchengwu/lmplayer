use rand::Rng;

use super::aes::aes128_cbc_pkcs7_b64;
use super::hash::md5_str;
use super::id::{generate_webgl_hash, now_ms, random_string};
use super::rsa::{rsa_oaep_sha256_b64, SIMULATE_RSA_KEY};
use crate::Result;

const IV: &[u8] = b"kugousecurity123";

fn ri(min: i32, max: i32) -> i32 {
    rand::thread_rng().gen_range(min..=max)
}

fn f3(t: i32, i: i32, x: i32, y: i32) -> String {
    format!("3,{t},{i},{x},{y}")
}
fn f5(t: i32, i: i32) -> String {
    format!("5,{t},{i}")
}
fn f6(t: i32, i: i32, x: i32, y: i32) -> String {
    format!("6,{t},{i},{x},{y}")
}
fn fs3(sentinel: u32, i: i32, x: i32, y: i32) -> String {
    format!("3,{sentinel},{i},{x},{y}")
}
fn fs5(sentinel: u32, i: i32) -> String {
    format!("5,{sentinel},{i}")
}
fn fs6(sentinel: u32, i: i32, x: i32, y: i32) -> String {
    format!("6,{sentinel},{i},{x},{y}")
}

fn bezier_path(sx: f64, sy: f64, ex: f64, ey: f64, n: i32) -> Vec<(f64, f64)> {
    let c1x = sx + (ex - sx) * 0.3 + ri(-80, 80) as f64;
    let c1y = sy + (ey - sy) * 0.2 + ri(-60, 60) as f64;
    let c2x = sx + (ex - sx) * 0.7 + ri(-60, 60) as f64;
    let c2y = sy + (ey - sy) * 0.8 + ri(-40, 40) as f64;
    let mut pts = Vec::new();
    let mut rng = rand::thread_rng();
    for i in 0..=n {
        let t = i as f64 / n as f64;
        let u = 1.0 - t;
        let x = u * u * u * sx + 3.0 * u * u * t * c1x + 3.0 * u * t * t * c2x + t * t * t * ex;
        let y = u * u * u * sy + 3.0 * u * u * t * c1y + 3.0 * u * t * t * c2y + t * t * t * ey;
        let jitter = (3.0 - t * 2.5).max(0.5);
        pts.push((
            x + (rng.gen::<f64>() - 0.5) * jitter,
            y + (rng.gen::<f64>() - 0.5) * jitter,
        ));
    }
    pts
}

fn generate_edt_data(
    start_x: i32,
    start_y: i32,
    end_x: i32,
    end_y: i32,
    mouse_points: i32,
    sentinel: u32,
) -> String {
    let mut entries = Vec::new();
    let mut ts = 0i32;
    let mut ei = 0i32;

    entries.push(f5(0, 0));
    entries.push(fs5(sentinel, 0));
    entries.push(f5(0, 0));
    entries.push(fs5(sentinel, 0));

    ts += ri(5, 20);
    entries.push(f6(ts, ei, 750, 500));
    entries.push(fs6(sentinel, ei, 750, 500));
    ei += 1;

    for _ in 0..3 {
        ts += ri(80, 600);
        entries.push(f5(ts, ei));
        entries.push(fs5(sentinel, ei));
        ei += 1;
    }

    let path = bezier_path(
        start_x as f64,
        start_y as f64,
        end_x as f64,
        end_y as f64,
        mouse_points,
    );
    let mut si = 0i32;
    for (i, (x, y)) in path.iter().enumerate() {
        ts += ri(8, 50);
        let rx = x.round() as i32;
        let ry = y.round() as i32;
        entries.push(f3(ts, si, rx, ry));
        entries.push(fs3(sentinel, si, rx, ry));
        if i > 0 && i % 12 == 0 {
            ts += ri(20, 60);
            entries.push(f5(ts, ei));
            entries.push(fs5(sentinel, ei));
            ei += 1;
        }
        si = (si + 1) % 2;
    }

    ts += ri(5, 30);
    entries.push(f3(ts, 1, end_x + ri(-5, 5), end_y + ri(-5, 5)));
    entries.push(fs3(sentinel, 1, end_x, end_y));
    entries.join(":")
}

#[derive(Clone, Debug)]
pub(crate) struct Simulate {
    pub edt: String,
    pub sid: String,
}

pub(crate) fn generate_simulate(
    mid: &str,
    userid: &str,
    dfid: &str,
    webgl_hash: Option<&str>,
) -> Result<Simulate> {
    let sentinel: u32 = 0xffff_ffff - rand::thread_rng().gen_range(0..20);
    let key = md5_str(&random_string(16));
    let key: String = key.chars().take(16).collect();

    let points = ri(30, 60);
    let start_x = ri(200, 600);
    let start_y = ri(200, 500);
    let end_x = ri(500, 700);
    let end_y = ri(80, 150);

    let mid = if mid.is_empty() { "0" } else { mid };
    let userid = if userid.is_empty() { "0" } else { userid };
    let dfid = if dfid.is_empty() { "0" } else { dfid };
    let webgl = webgl_hash
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(generate_webgl_hash);
    let ts = now_ms();
    let data = generate_edt_data(start_x, start_y, end_x, end_y, points, sentinel);
    let plaintext =
        format!("mid={mid};userid={userid};dfid={dfid};webgl={webgl};webdriver=0;ts={ts};data={data}");

    let edt = aes128_cbc_pkcs7_b64(key.as_bytes(), IV, plaintext.as_bytes())?;
    let sid = rsa_oaep_sha256_b64(key.as_bytes(), SIMULATE_RSA_KEY)?;
    Ok(Simulate { edt, sid })
}
