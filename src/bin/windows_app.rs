//! Windows shell: GUI subsystem window + WebView2. No console, no system browser.
use std::net::SocketAddr;

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

use super::{WinOp, JS_FAV, JS_NEXT, JS_PREV, JS_TOGGLE};

static WIN_TX: std::sync::OnceLock<EventLoopProxy<WinOp>> = std::sync::OnceLock::new();

pub(super) fn send_win(op: WinOp) {
    match WIN_TX.get() {
        Some(tx) => {
            if tx.send_event(op).is_err() {
                eprintln!("window op dropped: {op:?}");
            }
        }
        None => eprintln!("window op before window ready: {op:?}"),
    }
}

pub(super) fn start(
    rt: tokio::runtime::Runtime,
    listener: tokio::net::TcpListener,
    router: axum::Router,
    addr: SocketAddr,
) -> ! {
    std::panic::set_hook(Box::new(|info| {
        windows_message(&format!("lmPlayer 异常退出:\n{info}"));
    }));
    if !claim_single_instance(addr) {
        std::process::exit(0);
    }

    let mut builder = EventLoopBuilder::<WinOp>::with_user_event();
    let event_loop = builder.build();
    let proxy = event_loop.create_proxy();
    let _ = WIN_TX.set(proxy.clone());

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

    let tray = create_tray(proxy);
    let has_tray = tray.is_some();
    let start_hidden = has_tray && super::start_minimized_enabled();
    let mut window = WindowBuilder::new()
        .with_title("lmPlayer")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(960.0, 640.0))
        .with_decorations(false)
        .with_visible(!start_hidden)
        .with_focused(!start_hidden);
    if let Some(icon) = window_icon() {
        window = window.with_window_icon(Some(icon));
    }
    let window = match window.build(&event_loop) {
        Ok(window) => window,
        Err(e) => {
            windows_message(&format!("无法创建应用窗口: {e}"));
            std::process::exit(1);
        }
    };

    let uri = format!("http://{addr}/");
    let webview = WebViewBuilder::new()
        .with_url(&uri)
        .with_autoplay(true)
        .with_clipboard(true)
        .with_devtools(cfg!(debug_assertions))
        .with_background_throttling(wry::BackgroundThrottlingPolicy::Disabled)
        .with_new_window_req_handler(|url, _features| {
            wmplayer::open_with_system(&url);
            wry::NewWindowResponse::Deny
        })
        .build(&window);
    let webview = match webview {
        Ok(webview) => webview,
        Err(e) => {
            windows_message(&format!(
                "无法创建应用窗口。请安装 Microsoft Edge WebView2 运行时后重试。\n{e}"
            ));
            std::process::exit(1);
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _hold_tray = &tray;
        match event {
            Event::UserEvent(op) => apply_op(&window, &webview, op, has_tray),
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if has_tray && !super::QUIT.load(std::sync::atomic::Ordering::Relaxed) {
                    window.set_visible(false);
                } else {
                    std::process::exit(0);
                }
            }
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            } => {
                super::MAXIMIZED.store(
                    window.is_maximized(),
                    std::sync::atomic::Ordering::Relaxed,
                );
            }
            _ => {}
        }
    });
}

fn apply_op(window: &tao::window::Window, webview: &wry::WebView, op: WinOp, has_tray: bool) {
    match op {
        WinOp::Minimize => window.set_minimized(true),
        WinOp::Maximize => {
            let next = !window.is_maximized();
            window.set_maximized(next);
            super::MAXIMIZED.store(next, std::sync::atomic::Ordering::Relaxed);
        }
        WinOp::Unmaximize => {
            window.set_maximized(false);
            super::MAXIMIZED.store(false, std::sync::atomic::Ordering::Relaxed);
        }
        WinOp::Hide => {
            if has_tray {
                window.set_visible(false);
            } else {
                window.set_minimized(true);
            }
        }
        WinOp::Show => {
            window.set_minimized(false);
            window.set_visible(true);
            window.set_focus();
        }
        WinOp::Close => std::process::exit(0),
        WinOp::Drag { .. } => {
            let _ = window.drag_window();
        }
        WinOp::Js(code) => {
            let _ = webview.evaluate_script(code);
        }
        WinOp::HwAccel(_) => {}
    }
}

fn create_tray(proxy: EventLoopProxy<WinOp>) -> Option<tray_icon::TrayIcon> {
    use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{MouseButton, TrayIconBuilder, TrayIconEvent};

    let (rgba, width, height) = load_rgba(32)?;
    let icon = tray_icon::Icon::from_rgba(rgba, width, height).ok()?;
    let show = MenuItem::with_id("show", "显示主窗口", true, None);
    let toggle = MenuItem::with_id("toggle", "播放/暂停", true, None);
    let prev = MenuItem::with_id("prev", "上一首", true, None);
    let next = MenuItem::with_id("next", "下一首", true, None);
    let fav = MenuItem::with_id("fav", "喜欢当前歌曲", true, None);
    let quit = MenuItem::with_id("quit", "退出", true, None);
    let sep_a = PredefinedMenuItem::separator();
    let sep_b = PredefinedMenuItem::separator();
    let menu = Menu::with_items(&[
        &show, &sep_a, &toggle, &prev, &next, &fav, &sep_b, &quit,
    ])
    .ok()?;
    let tray = TrayIconBuilder::new()
        .with_tooltip("lmPlayer")
        .with_icon(icon)
        .with_menu(Box::new(menu))
        .with_menu_on_left_click(false)
        .with_guid(0x1d4e_8a6c_9b2f_4c71_a5e3_7f0b_6d8c_2a14)
        .build()
        .ok()?;

    let click_proxy = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |event| {
        let show = match event {
            TrayIconEvent::DoubleClick { .. } => true,
            TrayIconEvent::Click { button, .. } => button == MouseButton::Left,
            _ => false,
        };
        if show {
            let _ = click_proxy.send_event(WinOp::Show);
        }
    }));
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let op = match event.id.as_ref() {
            "show" => WinOp::Show,
            "toggle" => WinOp::Js(JS_TOGGLE),
            "prev" => WinOp::Js(JS_PREV),
            "next" => WinOp::Js(JS_NEXT),
            "fav" => WinOp::Js(JS_FAV),
            "quit" => WinOp::Close,
            _ => return,
        };
        let _ = proxy.send_event(op);
    }));
    Some(tray)
}

fn window_icon() -> Option<tao::window::Icon> {
    let (rgba, width, height) = load_rgba(64)?;
    tao::window::Icon::from_rgba(rgba, width, height).ok()
}

fn claim_single_instance(addr: SocketAddr) -> bool {
    use std::os::windows::ffi::OsStrExt;
    let mut name: Vec<u16> = std::ffi::OsStr::new("Local\\lmPlayer.singleton")
        .encode_wide()
        .collect();
    name.push(0);
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            attr: *mut std::ffi::c_void,
            initial: i32,
            name: *const u16,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    let already_running = unsafe {
        let handle = CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr());
        !handle.is_null() && GetLastError() == ERROR_ALREADY_EXISTS
    };
    if already_running {
        let _ = activate_existing();
        return false;
    }
    let path = instance_port_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, addr.port().to_string());
    true
}

fn instance_port_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("wmplayer")
        .join("instance.port")
}

fn activate_existing() -> bool {
    let path = instance_port_path();
    for _ in 0..20 {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(port) = text.trim().parse::<u16>() {
                if post_show(port) {
                    return true;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    false
}

fn post_show(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    let body = r#"{"op":"show"}"#;
    let req = format!(
        "POST /__window HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    let n = stream.read(&mut buf).unwrap_or(0);
    std::str::from_utf8(&buf[..n]).unwrap_or("").contains("200")
}

fn load_rgba(size: u32) -> Option<(Vec<u8>, u32, u32)> {
    const ICO: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icon.ico"));
    let img = image::load_from_memory_with_format(ICO, image::ImageFormat::Ico).ok()?;
    let rgba = image::imageops::resize(
        &img.to_rgba8(),
        size,
        size,
        image::imageops::FilterType::Triangle,
    );
    let (width, height) = (rgba.width(), rgba.height());
    Some((rgba.into_raw(), width, height))
}

fn windows_message(text: &str) {
    use std::os::windows::ffi::OsStrExt;
    let mut body: Vec<u16> = std::ffi::OsStr::new(text).encode_wide().collect();
    body.push(0);
    let mut title: Vec<u16> = std::ffi::OsStr::new("lmPlayer").encode_wide().collect();
    title.push(0);
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            typ: u32,
        ) -> i32;
    }
    unsafe {
        MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), 0x0000_0010);
    }
}
