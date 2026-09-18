use gtk4::glib;
use gtk4::prelude::*;
use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;

use crate::osd::{set_osd_enabled, LyricPayload, OsdCommand};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OsdConfig {
    pub font_size: i32,
    pub width: i32,
    pub height: i32,
    pub locked: bool,
    pub color: String,
}

impl Default for OsdConfig {
    fn default() -> Self {
        Self {
            font_size: 22,
            width: 780,
            height: 72,
            locked: false,
            color: "#38bdf8".to_string(),
        }
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wmplayer")
        .join("osd_lyrics.json")
}

fn load_config() -> OsdConfig {
    let path = config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<OsdConfig>(&content) {
            return cfg;
        }
    }
    OsdConfig::default()
}

fn save_config(cfg: &OsdConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, content);
    }
}

// Token for KRC karaoke animation
#[derive(Debug, Clone)]
struct KrcToken {
    start_offset_ms: u64,
    _duration_ms: u64,
    text: String,
}

struct KrcLine {
    tokens: Vec<KrcToken>,
    start_time: Instant,
    total_duration_ms: u64,
}

pub struct OsdWindow {
    window: gtk4::Window,
    label: gtk4::Label,
    config: Rc<RefCell<OsdConfig>>,
    current_krc: Rc<RefCell<Option<KrcLine>>>,
    krc_source_id: Rc<RefCell<Option<glib::SourceId>>>,
}

impl OsdWindow {
    pub fn new() -> Self {
        let config = Rc::new(RefCell::new(load_config()));
        let cfg = config.borrow().clone();

        let window = gtk4::Window::builder()
            .title("wmPlayer OSD Lyrics")
            .default_width(cfg.width)
            .default_height(cfg.height)
            .decorated(false)
            .resizable(true)
            .build();

        window.add_css_class("osd-window");

        // Main layout container
        let root_box = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
        root_box.set_hexpand(true);
        root_box.set_vexpand(true);
        root_box.add_css_class("osd-root-box");

        // Top subtle control toolbar (shown on hover)
        let toolbar = gtk4::Box::new(gtk4::Orientation::Horizontal, 6);
        toolbar.set_halign(gtk4::Align::End);
        toolbar.set_valign(gtk4::Align::Start);
        toolbar.set_margin_top(4);
        toolbar.set_margin_end(8);
        toolbar.add_css_class("osd-toolbar");
        toolbar.set_opacity(0.15); // subtle by default

        // Add hover effect to toolbar
        let motion_ctrl = gtk4::EventControllerMotion::new();
        let tb_hover = toolbar.clone();
        motion_ctrl.connect_enter(move |_, _, _| {
            tb_hover.set_opacity(1.0);
        });
        let tb_leave = toolbar.clone();
        motion_ctrl.connect_leave(move |_| {
            tb_leave.set_opacity(0.15);
        });
        window.add_controller(motion_ctrl);

        // Control buttons
        let btn_font_dec = gtk4::Button::with_label("A-");
        btn_font_dec.add_css_class("osd-mini-btn");
        btn_font_dec.set_tooltip_text(Some("缩小字号"));

        let btn_font_inc = gtk4::Button::with_label("A+");
        btn_font_inc.add_css_class("osd-mini-btn");
        btn_font_inc.set_tooltip_text(Some("放大字号"));

        let btn_lock = gtk4::Button::with_label(if cfg.locked { "🔒" } else { "🔓" });
        btn_lock.add_css_class("osd-mini-btn");
        btn_lock.set_tooltip_text(Some(if cfg.locked { "解锁拖拽" } else { "锁定位置" }));

        let btn_close = gtk4::Button::with_label("✕");
        btn_close.add_css_class("osd-mini-btn");
        btn_close.add_css_class("osd-close-btn");
        btn_close.set_tooltip_text(Some("关闭桌面歌词"));

        toolbar.append(&btn_font_dec);
        toolbar.append(&btn_font_inc);
        toolbar.append(&btn_lock);
        toolbar.append(&btn_close);

        // Center Lyric Label
        let label = gtk4::Label::new(None);
        label.set_hexpand(true);
        label.set_vexpand(true);
        label.set_halign(gtk4::Align::Center);
        label.set_valign(gtk4::Align::Center);
        label.set_use_markup(true);
        label.set_wrap(false);
        label.set_ellipsize(gtk4::pango::EllipsizeMode::End);
        label.add_css_class("osd-lyric-label");
        label.set_markup(&format!(
            "<span font_desc=\"Sans Bold {}\" foreground=\"{}\">wmPlayer 桌面歌词已启动</span>",
            cfg.font_size, cfg.color
        ));

        root_box.append(&toolbar);
        root_box.append(&label);
        window.set_child(Some(&root_box));

        // Drag gesture to move window
        let gesture_drag = gtk4::GestureDrag::new();
        let cfg_for_drag = config.clone();
        gesture_drag.connect_drag_begin(move |gesture, x, y| {
            if cfg_for_drag.borrow().locked {
                return;
            }
            if let Some(widget) = gesture.widget() {
                if let Some(native) = widget.native() {
                    if let Some(surface) = native.surface() {
                        if let Ok(toplevel) = surface.downcast::<gtk4::gdk::Toplevel>() {
                            if let Some(display) = gtk4::gdk::Display::default() {
                                if let Some(seat) = display.default_seat() {
                                    if let Some(pointer) = seat.pointer() {
                                        toplevel.begin_move(&pointer, 1, x, y, 0);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        window.add_controller(gesture_drag);

        // Button actions
        let cfg_fdec = config.clone();
        let lbl_fdec = label.clone();
        btn_font_dec.connect_clicked(move |_| {
            let mut c = cfg_fdec.borrow_mut();
            if c.font_size > 14 {
                c.font_size -= 2;
                save_config(&c);
                lbl_fdec.queue_draw();
            }
        });

        let cfg_finc = config.clone();
        let lbl_finc = label.clone();
        btn_font_inc.connect_clicked(move |_| {
            let mut c = cfg_finc.borrow_mut();
            if c.font_size < 48 {
                c.font_size += 2;
                save_config(&c);
                lbl_finc.queue_draw();
            }
        });

        let cfg_lock = config.clone();
        let btn_lock_clone = btn_lock.clone();
        btn_lock.connect_clicked(move |_| {
            let mut c = cfg_lock.borrow_mut();
            c.locked = !c.locked;
            btn_lock_clone.set_label(if c.locked { "🔒" } else { "🔓" });
            btn_lock_clone.set_tooltip_text(Some(if c.locked { "解锁拖拽" } else { "锁定位置" }));
            save_config(&c);
        });

        btn_close.connect_clicked(move |_| {
            set_osd_enabled(false);
        });

        // Window close handler (intercept close to hide instead)
        let win_close = window.clone();
        window.connect_close_request(move |_| {
            win_close.set_visible(false);
            set_osd_enabled(false);
            glib::Propagation::Stop
        });

        // Install CSS
        Self::apply_css();

        Self {
            window,
            label,
            config,
            current_krc: Rc::new(RefCell::new(None)),
            krc_source_id: Rc::new(RefCell::new(None)),
        }
    }

    fn apply_css() {
        let css_provider = gtk4::CssProvider::new();
        css_provider.load_from_data(
            "
            window.osd-window {
                background-color: rgba(15, 23, 42, 0.78);
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            .osd-root-box {
                padding: 4px 12px 10px 12px;
            }
            .osd-mini-btn {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                padding: 1px 6px;
                font-size: 11px;
                font-weight: bold;
                min-height: 20px;
                min-width: 24px;
            }
            .osd-mini-btn:hover {
                background: rgba(255, 255, 255, 0.25);
                color: #ffffff;
            }
            .osd-close-btn:hover {
                background: rgba(239, 68, 68, 0.85);
                color: #ffffff;
            }
            .osd-lyric-label {
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
            }
            ",
        );

        if let Some(display) = gtk4::gdk::Display::default() {
            gtk4::style_context_add_provider_for_display(
                &display,
                &css_provider,
                gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }
    }

    pub fn set_visible(&self, visible: bool) {
        if visible {
            self.window.set_visible(true);
            self.window.present();
        } else {
            self.window.set_visible(false);
            self.stop_krc_timer();
        }
    }

    fn stop_krc_timer(&self) {
        if let Some(src_id) = self.krc_source_id.borrow_mut().take() {
            unsafe {
                gtk4::glib::ffi::g_source_remove(src_id.as_raw());
            }
        }
        *self.current_krc.borrow_mut() = None;
    }

    pub fn update_lyrics(&self, payload: LyricPayload) {
        self.stop_krc_timer();

        let raw = payload.lyric.trim();
        if raw.is_empty() {
            let cfg = self.config.borrow();
            self.label.set_markup(&format!(
                "<span font_desc=\"Sans Bold {}\" foreground=\"#94a3b8\">wmPlayer - 暂无播放</span>",
                cfg.font_size
            ));
            return;
        }

        if payload.format == "krc" || (raw.contains("]<") && raw.contains('>')) {
            self.start_krc_display(raw);
        } else {
            self.display_lrc_line(raw);
        }
    }

    fn display_lrc_line(&self, line: &str) {
        // Strip [02:34.56] if present
        let clean = if let Some(idx) = line.find(']') {
            &line[idx + 1..]
        } else {
            line
        }
        .trim();

        let escaped = glib::markup_escape_text(clean);
        let cfg = self.config.borrow();
        self.label.set_markup(&format!(
            "<span font_desc=\"Sans Bold {}\" foreground=\"{}\">{}</span>",
            cfg.font_size, cfg.color, escaped
        ));
    }

    fn start_krc_display(&self, krc_raw: &str) {
        let (tokens, duration) = parse_krc_line(krc_raw);
        if tokens.is_empty() {
            self.display_lrc_line(krc_raw);
            return;
        }

        let krc_line = KrcLine {
            tokens,
            start_time: Instant::now(),
            total_duration_ms: duration,
        };

        *self.current_krc.borrow_mut() = Some(krc_line);

        // Initial render
        self.render_krc_frame();

        // Start 40ms timer for smooth karaoke progressive animation
        let current_krc = self.current_krc.clone();
        let label = self.label.clone();
        let config = self.config.clone();
        let krc_source_id = self.krc_source_id.clone();
        let source_id = glib::timeout_add_local(std::time::Duration::from_millis(40), move || {
            let krc_opt = current_krc.borrow();
            let Some(krc) = krc_opt.as_ref() else {
                *krc_source_id.borrow_mut() = None;
                return glib::ControlFlow::Break;
            };

            let elapsed = krc.start_time.elapsed().as_millis() as u64;
            let cfg = config.borrow();

            let mut markup = format!("<span font_desc=\"Sans Bold {}\">", cfg.font_size);
            for tok in &krc.tokens {
                let escaped = glib::markup_escape_text(&tok.text);
                if elapsed >= tok.start_offset_ms {
                    // Played: active highlight color
                    markup.push_str(&format!(
                        "<span foreground=\"{}\">{}</span>",
                        cfg.color, escaped
                    ));
                } else {
                    // Pending: dimmed grey color
                    markup.push_str(&format!(
                        "<span foreground=\"#ffffff\" alpha=\"45%\">{}</span>",
                        escaped
                    ));
                }
            }
            markup.push_str("</span>");

            label.set_markup(&markup);

            // Continue while within duration + small grace buffer (600ms)
            if elapsed > krc.total_duration_ms + 600 {
                // Done with this line, keep full highlighted text until next line
                *krc_source_id.borrow_mut() = None;
                return glib::ControlFlow::Break;
            }

            glib::ControlFlow::Continue
        });

        *self.krc_source_id.borrow_mut() = Some(source_id);
    }

    fn render_krc_frame(&self) {
        let krc_opt = self.current_krc.borrow();
        let Some(krc) = krc_opt.as_ref() else {
            return;
        };

        let elapsed = krc.start_time.elapsed().as_millis() as u64;
        let cfg = self.config.borrow();

        let mut markup = format!("<span font_desc=\"Sans Bold {}\">", cfg.font_size);
        for tok in &krc.tokens {
            let escaped = glib::markup_escape_text(&tok.text);
            if elapsed >= tok.start_offset_ms {
                markup.push_str(&format!(
                    "<span foreground=\"{}\">{}</span>",
                    cfg.color, escaped
                ));
            } else {
                markup.push_str(&format!(
                    "<span foreground=\"#ffffff\" alpha=\"45%\">{}</span>",
                    escaped
                ));
            }
        }
        markup.push_str("</span>");
        self.label.set_markup(&markup);
    }
}

// Parses KRC format: [line_start, line_duration]<offset, duration, 0>text<offset, duration, 0>text
fn parse_krc_line(krc_raw: &str) -> (Vec<KrcToken>, u64) {
    let mut tokens = Vec::new();
    let mut total_duration = 0u64;

    // Check line timestamp: [171960,5040]
    let mut rest = krc_raw;
    if rest.starts_with('[') {
        if let Some(end_bracket) = rest.find(']') {
            let inside = &rest[1..end_bracket];
            if let Some(comma) = inside.find(',') {
                if let Ok(dur) = inside[comma + 1..].trim().parse::<u64>() {
                    total_duration = dur;
                }
            }
            rest = &rest[end_bracket + 1..];
        }
    }

    // Parse tokens: <offset, duration, 0>word
    while let Some(start_bracket) = rest.find('<') {
        let after_start = &rest[start_bracket + 1..];
        let Some(end_bracket) = after_start.find('>') else {
            break;
        };
        let tag_content = &after_start[..end_bracket];
        let after_tag = &after_start[end_bracket + 1..];

        // Next word text ends at next '<' or end of string
        let (word, next_rest) = if let Some(next_lt) = after_tag.find('<') {
            (&after_tag[..next_lt], &after_tag[next_lt..])
        } else {
            (after_tag, "")
        };

        // Parse offset and duration: "0,240,0" -> offset=0, duration=240
        let parts: Vec<&str> = tag_content.split(',').collect();
        let offset = parts.first().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
        let duration = parts.get(1).and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(150);

        if !word.is_empty() {
            tokens.push(KrcToken {
                start_offset_ms: offset,
                _duration_ms: duration,
                text: word.to_string(),
            });
        }

        if offset + duration > total_duration {
            total_duration = offset + duration;
        }

        rest = next_rest;
    }

    (tokens, total_duration)
}

// Setup OSD receiver in the GTK thread
pub fn setup_osd_receiver(osd_win: Rc<OsdWindow>, rx: std::sync::mpsc::Receiver<OsdCommand>) {
    glib::timeout_add_local(std::time::Duration::from_millis(30), move || {
        while let Ok(cmd) = rx.try_recv() {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                match cmd {
                    OsdCommand::UpdateLyrics(payload) => {
                        osd_win.update_lyrics(payload);
                    }
                    OsdCommand::SetVisible(visible) => {
                        osd_win.set_visible(visible);
                    }
                }
            }));
        }
        glib::ControlFlow::Continue
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_krc_line() {
        let line = "[171960,5040]<0,240,0>hello<240,300,0>world";
        let (tokens, duration) = parse_krc_line(line);
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].text, "hello");
        assert_eq!(tokens[1].text, "world");
        assert_eq!(duration, 5040);
    }

    #[test]
    fn test_remove_nonexistent_source_does_not_panic() {
        // Source ID 999999 does not exist in GLib context.
        // Direct call to g_source_remove safely returns GFALSE (0) without panic.
        let res = unsafe { gtk4::glib::ffi::g_source_remove(999999) };
        assert_eq!(res, gtk4::glib::ffi::GFALSE);
    }
}
