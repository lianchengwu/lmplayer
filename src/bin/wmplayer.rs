use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use gtk4::gdk::prelude::*;
use gtk4::glib;
use gtk4::prelude::*;
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;
#[cfg(debug_assertions)]
use tower_http::services::ServeDir;
use webkit6::prelude::*;
use webkit6::HardwareAccelerationPolicy;
use wmplayer::{dispatch, Player};

#[derive(Clone)]
struct App {
    player: Arc<Player>,
}

#[derive(Clone, Copy, Debug)]
enum WinOp {
    Minimize,
    Maximize,
    Unmaximize,
    Hide,
    Show,
    Close,
    Drag { x: f64, y: f64 },
    Js(&'static str),
    HwAccel(bool),
}

static WIN_TX: OnceLock<Sender<WinOp>> = OnceLock::new();
static MAXIMIZED: AtomicBool = AtomicBool::new(false);
static QUIT: AtomicBool = AtomicBool::new(false);

const JS_TOGGLE: &str = "window.Events&&window.Events.Emit('systray:toggle-play-pause')";
const JS_PREV: &str = "window.Events&&window.Events.Emit('systray:previous-song')";
const JS_NEXT: &str = "window.Events&&window.Events.Emit('systray:next-song')";
const JS_FAV: &str = "window.Events&&window.Events.Emit('systray:favorite-song')";
const JS_OSD: &str = "window.Events&&window.Events.Emit('systray:toggle-osd-lyrics')";

fn send_win(op: WinOp) {
    match WIN_TX.get() {
        Some(tx) => {
            if tx.send(op).is_err() {
                eprintln!("window op dropped: {op:?}");
            }
        }
        None => eprintln!("window op before gtk ready: {op:?}"),
    }
}

fn apply_win_op(app: &gtk4::Application, win: &gtk4::ApplicationWindow, webview: &webkit6::WebView, op: WinOp) {
    match op {
        WinOp::Minimize => win.minimize(),
        WinOp::Maximize => {
            if win.is_maximized() {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
        WinOp::Unmaximize => win.unmaximize(),
        WinOp::Hide => win.set_visible(false),
        WinOp::Show => {
            win.set_visible(true);
            win.present();
        }
        WinOp::Close => {
            QUIT.store(true, Ordering::Relaxed);
            win.close();
            app.quit();
            std::process::exit(0);
        }
        WinOp::Drag { x, y } => begin_window_move(win, x, y),
        WinOp::Js(code) => {
            webview.evaluate_javascript(
                code,
                None,
                None,
                None::<&gtk4::gio::Cancellable>,
                |_| {},
            );
        }
        WinOp::HwAccel(on) => apply_hw_accel(webview, on),
    }
}

fn hardware_accel_enabled() -> bool {
    let path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wmplayer")
        .join("settings.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.pointer("/behavior/hardwareAcceleration").cloned())
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn apply_hw_accel(webview: &webkit6::WebView, on: bool) {
    if let Some(settings) = webkit6::prelude::WebViewExt::settings(webview) {
        settings.set_hardware_acceleration_policy(if on {
            HardwareAccelerationPolicy::Always
        } else {
            HardwareAccelerationPolicy::Never
        });
    }
}


fn begin_window_move(win: &gtk4::ApplicationWindow, x: f64, y: f64) {
    let Some(native) = win.native() else {
        return;
    };
    let Some(surface) = native.surface() else {
        return;
    };
    let Ok(toplevel) = surface.downcast::<gtk4::gdk::Toplevel>() else {
        return;
    };
    let Some(display) = gtk4::gdk::Display::default() else {
        return;
    };
    let Some(seat) = display.default_seat() else {
        return;
    };
    let Some(pointer) = seat.pointer() else {
        return;
    };
    toplevel.begin_move(&pointer, 1, x, y, 0);
}

async fn ipc(State(app): State<App>, Json(body): Json<Value>) -> Json<Value> {
    let cmd = body.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let args = body.get("args").cloned().unwrap_or_else(|| json!({}));
    Json(dispatch(app.player.as_ref(), cmd, args).await)
}

async fn window_op(Json(body): Json<Value>) -> Json<Value> {
    let op = body.get("op").and_then(|v| v.as_str()).unwrap_or("");
    match op {
        "minimize" => send_win(WinOp::Minimize),
        "maximize" => send_win(WinOp::Maximize),
        "unmaximize" => send_win(WinOp::Unmaximize),
        "hide" => send_win(WinOp::Hide),
        "show" => send_win(WinOp::Show),
        "close" => send_win(WinOp::Close),
        "hwaccel" => {
            let on = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            send_win(WinOp::HwAccel(on));
        }
        "drag" => {
            let x = body.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = body.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            send_win(WinOp::Drag { x, y });
        }
        _ => {}
    }
    Json(json!({ "ok": true, "op": op }))
}

async fn window_q() -> Json<Value> {
    Json(json!({ "maximized": MAXIMIZED.load(Ordering::Relaxed) }))
}

async fn open_url(Json(body): Json<Value>) -> Json<Value> {
    if let Some(url) = body.get("url").and_then(|v| v.as_str()) {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
    Json(json!({ "ok": true }))
}

async fn serve_cache(Path(hash): Path<String>, req: axum::extract::Request) -> Response {
    if hash.starts_with("local-") {
        return wmplayer::local_music::serve_audio(axum::extract::Path(hash), req).await;
    }
    let Some(path) = wmplayer::audio_cache::file_path(&hash) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !path.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    use tower_http::services::ServeFile;
    use tower_service::Service;
    let mime = wmplayer::audio_cache::detect_audio_mime(&path);
    let mut svc = ServeFile::new_with_mime(path, &mime);
    match svc.call(req).await {
        Ok(res) => res.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}


#[cfg(debug_assertions)]
fn frontend_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("frontend/dist");
    if manifest.exists() {
        manifest
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("frontend")
    }
}

#[cfg(not(debug_assertions))]
#[derive(rust_embed::Embed)]
#[folder = "frontend/dist"]
struct Dist;

#[cfg(not(debug_assertions))]
async fn embedded_frontend(uri: axum::http::Uri) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;

    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Dist::get(path) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], f.data).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn load_player() -> Player {
    if let Ok(p) = Player::load_saved() {
        if p.kg.session().token().is_some() {
            return p;
        }
    }
    let session = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("kugou/.session");
    if let Ok(raw) = std::fs::read_to_string(session) {
        if let Ok(p) = Player::with_cookie(&raw.replace('\n', ";")) {
            let _ = p.save_cookie();
            return p;
        }
    }
    Player::lite().expect("kugou client")
}

fn main() {
    // NVIDIA + WebKitGTK: DMA-BUF often freezes input.
    // Do not disable compositing / GSK cairo — that paints the whole UI on CPU.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let app = gtk4::Application::builder()
        .application_id("com.wmplayer.app")
        .flags(gtk4::gio::ApplicationFlags::empty())
        .build();

    if let Err(e) = app.register(gtk4::gio::Cancellable::NONE) {
        eprintln!("Failed to register application: {e}");
    }
    if app.is_remote() {
        eprintln!("wmplayer is already running, activating existing instance...");
        app.activate();
        let _ = app.run_with_args::<&str>(&[]);
        return;
    }
    let player = load_player();
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio");
    let listener = rt
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let state = App {
        player: Arc::new(player),
    };
    let api = Router::new()
        .route("/__ipc", post(ipc))
        .route("/__window", post(window_op).get(window_q))
        .route("/__open", post(open_url))
        .route("/__cache/{hash}", get(serve_cache))
        .route("/__local/{hash}", get(wmplayer::local_music::serve_audio))
        .route("/__local_cover/{hash}", get(wmplayer::local_music::serve_cover))
        .layer(CorsLayer::permissive())
        .with_state(state);

    #[cfg(debug_assertions)]
    let (router, origin) = {
        let dist = frontend_dir();
        let origin = format!("dist={}", dist.display());
        (api.fallback_service(ServeDir::new(dist)), origin)
    };
    #[cfg(not(debug_assertions))]
    let (router, origin) = (api.fallback(embedded_frontend), "dist=embedded".to_string());

    eprintln!("wmplayer http://{addr}  {origin}");
    rt.spawn(async {
        if let Err(e) = wmplayer::osd::start_dbus_service().await {
            eprintln!("D-Bus lyric service: {e}");
        }
    });
    std::thread::Builder::new()
        .name("wmplayer-http".into())
        .spawn(move || {
            rt.block_on(async move {
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("http server: {e}");
                }
            });
        })
        .expect("http thread");
    start_webview(app, addr);
}

fn start_webview(app: gtk4::Application, addr: SocketAddr) {
    let uri = format!("http://{addr}/");
    app.connect_activate(move |app| {
        for window in app.windows() {
            if window.title().as_deref() == Some("lmPlayer") {
                window.set_visible(true);
                window.present();
                return;
            }
        }
        let win = gtk4::ApplicationWindow::builder()
            .application(app)
            .title("lmPlayer")
            .default_width(1200)
            .default_height(800)
            .decorated(false)
            .build();
        win.set_decorated(false);
        win.connect_maximized_notify(|w| {
            MAXIMIZED.store(w.is_maximized(), Ordering::Relaxed);
        });
        win.connect_close_request(|win| {
            if QUIT.load(Ordering::Relaxed) {
                if let Some(app) = win.application() {
                    app.quit();
                }
                std::process::exit(0);
            } else {
                win.set_visible(false);
                gtk4::glib::Propagation::Stop
            }
        });

        let webview = webkit6::WebView::new();
        webview.set_hexpand(true);
        webview.set_vexpand(true);
        webview.set_halign(gtk4::Align::Fill);
        webview.set_valign(gtk4::Align::Fill);
        if let Some(settings) = webkit6::prelude::WebViewExt::settings(&webview) {
            settings.set_enable_javascript(true);
            settings.set_enable_developer_extras(true);
        }
        apply_hw_accel(&webview, hardware_accel_enabled());
        webview.load_uri(&uri);
        win.set_child(Some(&webview));

        let (tx, rx) = mpsc::channel::<WinOp>();
        let tray_tx = tx.clone();
        let act_win_tx = tx.clone();
        let _ = WIN_TX.set(tx);
        let win_ops = win.clone();
        let web_ops = webview.clone();
        let app_ops = app.clone();
        glib::timeout_add_local(Duration::from_millis(16), move || {
            if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                while let Ok(op) = rx.try_recv() {
                    apply_win_op(&app_ops, &win_ops, &web_ops, op);
                }
            })) {
                eprintln!("[apply_win_op] PANICKED in timeout_add_local: {e:?}");
            }
            glib::ControlFlow::Continue
        });

        // Setup internal GTK4 OSD floating lyrics window
        let osd_win = std::rc::Rc::new(wmplayer::osd_window::OsdWindow::new());
        let (osd_tx, osd_rx) = std::sync::mpsc::channel();
        wmplayer::osd::register_osd_cmd_sender(osd_tx);
        wmplayer::osd_window::setup_osd_receiver(osd_win.clone(), osd_rx);

        // Setup D-Bus remote playback actions handler
        let (act_tx, act_rx) = std::sync::mpsc::channel::<wmplayer::osd::PlayerAction>();
        wmplayer::osd::register_action_sender(act_tx);
        glib::timeout_add_local(Duration::from_millis(50), move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                while let Ok(act) = act_rx.try_recv() {
                    match act {
                        wmplayer::osd::PlayerAction::TogglePlayPause => {
                            let _ = act_win_tx.send(WinOp::Js(JS_TOGGLE));
                        }
                        wmplayer::osd::PlayerAction::Next => {
                            let _ = act_win_tx.send(WinOp::Js(JS_NEXT));
                        }
                        wmplayer::osd::PlayerAction::Previous => {
                            let _ = act_win_tx.send(WinOp::Js(JS_PREV));
                        }
                    }
                }
            }));
            glib::ControlFlow::Continue
        });

        start_tray(tray_tx);

        win.present();
    });
    app.run();
}

struct PlayerTray {
    tx: Sender<WinOp>,
}

impl ksni::Tray for PlayerTray {
    fn id(&self) -> String {
        "com.wmplayer.app".into()
    }

    fn title(&self) -> String {
        "lmPlayer".into()
    }

    fn icon_name(&self) -> String {
        String::new()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        tray_logo()
    }

    fn category(&self) -> ksni::Category {
        ksni::Category::ApplicationStatus
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        let _ = self.tx.send(WinOp::Show);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        vec![
            StandardItem {
                label: "显示主窗口".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Show);
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "播放/暂停".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Js(JS_TOGGLE));
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "上一首".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Js(JS_PREV));
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "下一首".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Js(JS_NEXT));
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "喜欢当前歌曲".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Js(JS_FAV));
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "桌面歌词".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Js(JS_OSD));
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "退出".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = t.tx.send(WinOp::Close);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

fn start_tray(tx: Sender<WinOp>) {
    use ksni::blocking::TrayMethods;
    match (PlayerTray { tx }).spawn() {
        Ok(handle) => std::mem::forget(handle),
        Err(e) => eprintln!("system tray: {e}"),
    }
}

fn tray_logo() -> Vec<ksni::Icon> {
    static ICONS: std::sync::OnceLock<Vec<ksni::Icon>> = std::sync::OnceLock::new();
    ICONS
        .get_or_init(|| {
            const ICO: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icon.ico"));
            let Ok(dyn_img) =
                image::load_from_memory_with_format(ICO, image::ImageFormat::Ico)
            else {
                return Vec::new();
            };
            let mut rgba = dyn_img.into_rgba8();
            if rgba.width() > 64 || rgba.height() > 64 {
                rgba = image::imageops::resize(&rgba, 64, 64, image::imageops::FilterType::Triangle);
            }
            let mut data = Vec::with_capacity(rgba.len());
            for px in rgba.pixels() {
                data.extend_from_slice(&[px[3], px[0], px[1], px[2]]);
            }
            vec![ksni::Icon {
                width: rgba.width() as i32,
                height: rgba.height() as i32,
                data,
            }]
        })
        .clone()
}
