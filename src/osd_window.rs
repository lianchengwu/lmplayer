#[cfg(target_os = "linux")]
use gtk4::gdk::prelude::*;
#[cfg(target_os = "linux")]
use gtk4::glib;
#[cfg(target_os = "linux")]
use gtk4::prelude::*;
use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;

use crate::osd::{set_osd_enabled, set_osd_locked, LyricPayload, OsdCommand};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OsdConfig {
    pub font_size: i32,
    pub width: i32,
    pub height: i32,
    pub locked: bool,
    pub color: String,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_bg_opacity")]
    pub bg_opacity: f64,
}

fn default_opacity() -> f64 {
    0.95
}

fn default_bg_opacity() -> f64 {
    0.78
}

impl Default for OsdConfig {
    fn default() -> Self {
        Self {
            font_size: 24,
            width: 820,
            height: 76,
            locked: false,
            color: "#38bdf8".to_string(),
            opacity: 0.95,
            bg_opacity: 0.78,
        }
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wmplayer")
        .join("osd_lyrics.json")
}

pub fn load_config() -> OsdConfig {
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

/// Automatically configure KWin window rules so OSD window stays above all windows,
/// skips the taskbar, skips the pager, and skips the Alt-Tab window switcher.
#[cfg(target_os = "linux")]
fn ensure_kwin_rules() {
    let kwin_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("kwinrulesrc");

    let content = fs::read_to_string(&kwin_path).unwrap_or_default();
    // If rule section already exists with position+size remember and desktop rules, skip
    if content.contains("wmplayer-osd") && content.contains("desktopsrule=2") {
        return;
    }

    let rule_block = "
[wmplayer-osd]
Description=wmplayer OSD lyrics
above=true
aboverule=2
desktops=
desktopsrule=2
onalldesktops=true
onalldesktopsrule=2
positionrule=4
sizerule=4
skippager=true
skippagerrule=2
skipswitcher=true
skipswitcherrule=2
skiptaskbar=true
skiptaskbarrule=2
title=wmPlayer OSD Lyrics
titlematch=1
types=1
";

    // Remove old [wmplayer-osd] section if present (upgrade path)
    let content = if let Some(start) = content.find("\n[wmplayer-osd]") {
        let after = &content[start + 1..]; // skip the leading \n
        let section_end = after.find("\n[")
            .map(|i| start + 1 + i)
            .unwrap_or(content.len());
        let mut cleaned = content[..start].to_string();
        if section_end < content.len() {
            cleaned.push_str(&content[section_end..]);
        }
        cleaned
    } else if content.starts_with("[wmplayer-osd]") {
        let section_end = content.find("\n[")
            .map(|i| i)
            .unwrap_or(content.len());
        if section_end < content.len() {
            content[section_end..].to_string()
        } else {
            String::new()
        }
    } else {
        content
    };

    let new_content = if content.trim().is_empty() {
        format!("[General]\ncount=1\nrules=wmplayer-osd\n{rule_block}")
    } else if content.contains("wmplayer-osd") {
        // rules= line already lists wmplayer-osd, just append new block
        format!("{content}\n{rule_block}")
    } else if let Some(idx) = content.find("rules=") {
        let line_end = content[idx..]
            .find('\n')
            .map(|i| idx + i)
            .unwrap_or(content.len());
        let current_rules = &content[idx + 6..line_end].trim();
        let updated_line = if current_rules.is_empty() {
            "rules=wmplayer-osd".to_string()
        } else {
            format!("rules={},wmplayer-osd", current_rules)
        };
        let mut updated = content.clone();
        updated.replace_range(idx..line_end, &updated_line);
        format!("{updated}\n{rule_block}")
    } else {
        format!("{content}\n[General]\nrules=wmplayer-osd\n{rule_block}")
    };

    if let Some(parent) = kwin_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&kwin_path, new_content);

    // Ask KWin to reload rules immediately
    let ok = std::process::Command::new("busctl")
        .args(["--user", "call", "org.kde.KWin", "/KWin", "org.kde.KWin", "reconfigure"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !ok {
        let _ = std::process::Command::new("qdbus6")
            .args(["org.kde.KWin", "/KWin", "reconfigure"])
            .status()
            .or_else(|_| {
                std::process::Command::new("qdbus")
                    .args(["org.kde.KWin", "/KWin", "reconfigure"])
                    .status()
            });
    }
}

#[cfg(target_os = "linux")]
fn detect_edge(x: f64, y: f64, width: f64, height: f64, border: f64) -> Option<gtk4::gdk::SurfaceEdge> {
    let on_top = y < border;
    let on_bottom = y > height - border;
    let on_left = x < border;
    let on_right = x > width - border;

    match (on_top, on_bottom, on_left, on_right) {
        (true, false, true, false) => Some(gtk4::gdk::SurfaceEdge::NorthWest),
        (true, false, false, true) => Some(gtk4::gdk::SurfaceEdge::NorthEast),
        (false, true, true, false) => Some(gtk4::gdk::SurfaceEdge::SouthWest),
        (false, true, false, true) => Some(gtk4::gdk::SurfaceEdge::SouthEast),
        (true, false, false, false) => Some(gtk4::gdk::SurfaceEdge::North),
        (false, true, false, false) => Some(gtk4::gdk::SurfaceEdge::South),
        (false, false, true, false) => Some(gtk4::gdk::SurfaceEdge::West),
        (false, false, false, true) => Some(gtk4::gdk::SurfaceEdge::East),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn cursor_for_edge(edge: gtk4::gdk::SurfaceEdge) -> &'static str {
    match edge {
        gtk4::gdk::SurfaceEdge::North => "n-resize",
        gtk4::gdk::SurfaceEdge::South => "s-resize",
        gtk4::gdk::SurfaceEdge::East => "e-resize",
        gtk4::gdk::SurfaceEdge::West => "w-resize",
        gtk4::gdk::SurfaceEdge::NorthEast => "ne-resize",
        gtk4::gdk::SurfaceEdge::NorthWest => "nw-resize",
        gtk4::gdk::SurfaceEdge::SouthEast => "se-resize",
        gtk4::gdk::SurfaceEdge::SouthWest => "sw-resize",
        _ => "default",
    }
}

#[cfg(target_os = "linux")]
fn generate_css(bg_opacity: f64) -> String {
    let border_opacity = (bg_opacity * 0.25).clamp(0.0, 0.25);
    let shadow_opacity = (bg_opacity * 0.65).clamp(0.0, 0.65);
    let bg_str = if bg_opacity <= 0.05 {
        "transparent".to_string()
    } else {
        format!("rgba(15, 23, 42, {bg_opacity:.2})")
    };
    let border_str = if bg_opacity <= 0.05 {
        "none".to_string()
    } else {
        format!("1px solid rgba(255, 255, 255, {border_opacity:.2})")
    };
    let shadow_str = if bg_opacity <= 0.05 {
        "none".to_string()
    } else {
        format!("0 10px 30px rgba(0, 0, 0, {shadow_opacity:.2})")
    };

    format!(
        "
        window.osd-window {{
            background-color: {bg_str};
            border-radius: 16px;
            border: {border_str};
            box-shadow: {shadow_str};
        }}
        .osd-root-box {{
            padding: 4px 12px 10px 12px;
        }}
        .osd-mini-btn {{
            background: rgba(255, 255, 255, 0.16);
            color: rgba(255, 255, 255, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: bold;
            min-height: 22px;
            min-width: 24px;
        }}
        .osd-mini-btn:hover {{
            background: rgba(255, 255, 255, 0.38);
            color: #ffffff;
        }}
        .osd-close-btn:hover {{
            background: rgba(239, 68, 68, 0.85);
            color: #ffffff;
        }}
        .osd-lyric-label {{
            text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
        }}
        "
    )
}

// Token for KRC karaoke animation
#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
struct KrcToken {
    start_offset_ms: u64,
    _duration_ms: u64,
    text: String,
}

#[cfg(target_os = "linux")]
struct KrcLine {
    tokens: Vec<KrcToken>,
    start_time: Instant,
    total_duration_ms: u64,
}

#[cfg(target_os = "linux")]
pub struct OsdWindow {
    window: gtk4::Window,
    label: gtk4::Label,
    toolbar: gtk4::Box,
    btn_lock: gtk4::Button,
    #[allow(dead_code)]
    btn_opacity: gtk4::Button,
    #[allow(dead_code)]
    btn_bg: gtk4::Button,
    #[allow(dead_code)]
    css_provider: gtk4::CssProvider,
    config: Rc<RefCell<OsdConfig>>,
    current_krc: Rc<RefCell<Option<KrcLine>>>,
    krc_source_id: Rc<RefCell<Option<glib::SourceId>>>,
}

#[cfg(target_os = "linux")]
impl OsdWindow {
    pub fn new() -> Self {
        ensure_kwin_rules();

        let config = Rc::new(RefCell::new(load_config()));
        let cfg = config.borrow().clone();

        // Sync atomic lock flag with loaded config
        crate::osd::set_osd_locked(cfg.locked);

        let window = gtk4::Window::builder()
            .title("wmPlayer OSD Lyrics")
            .default_width(cfg.width)
            .default_height(cfg.height)
            .decorated(false)
            .resizable(true)
            .focusable(false)
            .build();

        window.add_css_class("osd-window");
        window.set_opacity(cfg.opacity);

        // Main layout container
        let root_box = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
        root_box.set_hexpand(true);
        root_box.set_vexpand(true);
        root_box.add_css_class("osd-root-box");

        // Top subtle control toolbar (shown on hover when unlocked)
        let toolbar = gtk4::Box::new(gtk4::Orientation::Horizontal, 6);
        toolbar.set_halign(gtk4::Align::End);
        toolbar.set_valign(gtk4::Align::Start);
        toolbar.set_margin_top(4);
        toolbar.set_margin_end(8);
        toolbar.add_css_class("osd-toolbar");
        toolbar.set_opacity(0.35); // visible enough to be seen

        if cfg.locked {
            toolbar.set_visible(false);
        }

        // Add hover effect to toolbar
        let motion_ctrl = gtk4::EventControllerMotion::new();
        let tb_hover = toolbar.clone();
        let cfg_hover = config.clone();
        motion_ctrl.connect_enter(move |_, _, _| {
            if !cfg_hover.borrow().locked {
                tb_hover.set_opacity(1.0);
            }
        });
        let tb_leave = toolbar.clone();
        let cfg_leave = config.clone();
        motion_ctrl.connect_leave(move |_| {
            if !cfg_leave.borrow().locked {
                tb_leave.set_opacity(0.35);
            }
        });
        window.add_controller(motion_ctrl);

        // Control buttons
        let btn_font_dec = gtk4::Button::with_label("A-");
        btn_font_dec.add_css_class("osd-mini-btn");
        btn_font_dec.set_tooltip_text(Some("缩小字号"));

        let btn_font_inc = gtk4::Button::with_label("A+");
        btn_font_inc.add_css_class("osd-mini-btn");
        btn_font_inc.set_tooltip_text(Some("放大字号"));

        let bg_pct = (cfg.bg_opacity * 100.0).round() as i32;
        let btn_bg = gtk4::Button::with_label(&format!("🌓 {}%", bg_pct));
        btn_bg.add_css_class("osd-mini-btn");
        btn_bg.set_tooltip_text(Some(&format!("调节底色亮度/透明度 (当前底色: {}%)", bg_pct)));

        let pct = (cfg.opacity * 100.0).round() as i32;
        let btn_opacity = gtk4::Button::with_label(&format!("🔆 {}%", pct));
        btn_opacity.add_css_class("osd-mini-btn");
        btn_opacity.set_tooltip_text(Some(&format!("调节窗口透明度: 当前 {}% (滚轮微调)", pct)));

        let btn_lock = gtk4::Button::with_label(if cfg.locked { "🔒" } else { "🔓" });
        btn_lock.add_css_class("osd-mini-btn");
        btn_lock.set_tooltip_text(Some(if cfg.locked {
            "已锁定 (鼠标穿透中，点击解锁)"
        } else {
            "锁定 (开启鼠标穿透)"
        }));

        let btn_close = gtk4::Button::with_label("✕");
        btn_close.add_css_class("osd-mini-btn");
        btn_close.add_css_class("osd-close-btn");
        btn_close.set_tooltip_text(Some("关闭桌面歌词"));

        toolbar.append(&btn_font_dec);
        toolbar.append(&btn_font_inc);
        toolbar.append(&btn_bg);
        toolbar.append(&btn_opacity);
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

        // Edge cursor motion detection
        let motion_edge = gtk4::EventControllerMotion::new();
        let win_motion = window.clone();
        let cfg_edge = config.clone();
        motion_edge.connect_motion(move |_, x, y| {
            if cfg_edge.borrow().locked {
                win_motion.set_cursor_from_name(Some("default"));
                return;
            }
            let w = win_motion.width() as f64;
            let h = win_motion.height() as f64;
            if let Some(edge) = detect_edge(x, y, w, h, 10.0) {
                win_motion.set_cursor_from_name(Some(cursor_for_edge(edge)));
            } else {
                win_motion.set_cursor_from_name(Some("default"));
            }
        });
        window.add_controller(motion_edge);

        // Window edge resize gesture: ONLY triggers when hovering over borders/corners
        let gesture_resize = gtk4::GestureDrag::new();
        let cfg_resize = config.clone();
        let win_resize = window.clone();
        gesture_resize.connect_drag_begin(move |gesture, x, y| {
            if cfg_resize.borrow().locked {
                return;
            }
            let w = win_resize.width() as f64;
            let h = win_resize.height() as f64;
            if let Some(edge) = detect_edge(x, y, w, h, 10.0) {
                if let Some(widget) = gesture.widget() {
                    if let Some(native) = widget.native() {
                        if let Some(surface) = native.surface() {
                            if let Ok(toplevel) = surface.downcast::<gtk4::gdk::Toplevel>() {
                                if let Some(display) = gtk4::gdk::Display::default() {
                                    if let Some(seat) = display.default_seat() {
                                        if let Some(pointer) = seat.pointer() {
                                            toplevel.begin_resize(edge, Some(&pointer), 1, x, y, 0);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        window.add_controller(gesture_resize);

        // Window moving gesture: attached directly to the lyric label
        // This completely prevents dragging from intercepting clicks on the toolbar buttons!
        let gesture_move = gtk4::GestureDrag::new();
        let cfg_move = config.clone();
        gesture_move.connect_drag_begin(move |gesture, x, y| {
            if cfg_move.borrow().locked {
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
        label.add_controller(gesture_move);

        // Scroll controller:
        // - Plain scroll: adjust opacity (smooth)
        // - Ctrl + scroll: zoom font size (A- / A+)
        let scroll_ctrl = gtk4::EventControllerScroll::new(
            gtk4::EventControllerScrollFlags::VERTICAL,
        );
        let cfg_scroll = config.clone();
        let win_scroll = window.clone();
        let lbl_scroll = label.clone();
        let btn_op_clone = btn_opacity.clone();
        scroll_ctrl.connect_scroll(move |controller, _, dy| {
            if cfg_scroll.borrow().locked {
                return glib::Propagation::Proceed;
            }
            let state = controller.current_event_state();
            let is_ctrl = state.contains(gtk4::gdk::ModifierType::CONTROL_MASK);

            if is_ctrl {
                let mut c = cfg_scroll.borrow_mut();
                if dy < 0.0 && c.font_size < 56 {
                    c.font_size += 2;
                } else if dy > 0.0 && c.font_size > 14 {
                    c.font_size -= 2;
                }
                save_config(&c);
                lbl_scroll.queue_draw();
            } else {
                let mut c = cfg_scroll.borrow_mut();
                let delta = if dy < 0.0 { 0.05 } else { -0.05 };
                c.opacity = (c.opacity + delta).clamp(0.20, 1.0);
                win_scroll.set_opacity(c.opacity);
                let pct = (c.opacity * 100.0).round() as i32;
                btn_op_clone.set_label(&format!("🔆 {}%", pct));
                btn_op_clone.set_tooltip_text(Some(&format!("调节窗口透明度: 当前 {}% (滚轮微调)", pct)));
                save_config(&c);
            }
            glib::Propagation::Stop
        });
        window.add_controller(scroll_ctrl);

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
            if c.font_size < 56 {
                c.font_size += 2;
                save_config(&c);
                lbl_finc.queue_draw();
            }
        });

        // Background brightness / opacity presets:
        // 0% (纯透) -> 35% (微弱) -> 65% (半透) -> 85% (标准) -> 95% (高对比) -> 0%
        let css_provider = gtk4::CssProvider::new();
        css_provider.load_from_data(&generate_css(cfg.bg_opacity));

        if let Some(display) = gtk4::gdk::Display::default() {
            gtk4::style_context_add_provider_for_display(
                &display,
                &css_provider,
                gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }

        let cfg_bg = config.clone();
        let btn_bg_clone = btn_bg.clone();
        let css_provider_clone = css_provider.clone();
        btn_bg.connect_clicked(move |_| {
            let mut c = cfg_bg.borrow_mut();
            let next_bg = if c.bg_opacity >= 0.90 {
                0.0
            } else if c.bg_opacity <= 0.05 {
                0.35
            } else if c.bg_opacity <= 0.40 {
                0.65
            } else if c.bg_opacity <= 0.70 {
                0.85
            } else {
                0.95
            };
            c.bg_opacity = next_bg;
            css_provider_clone.load_from_data(&generate_css(c.bg_opacity));
            let pct = (c.bg_opacity * 100.0).round() as i32;
            btn_bg_clone.set_label(&format!("🌓 {}%", pct));
            btn_bg_clone.set_tooltip_text(Some(&format!("调节底色亮度/透明度: 当前 {}%", pct)));
            save_config(&c);
        });

        // Window overall opacity presets: 100% -> 85% -> 70% -> 50% -> 35%
        let cfg_op = config.clone();
        let win_op = window.clone();
        let btn_op_action = btn_opacity.clone();
        btn_opacity.connect_clicked(move |_| {
            let mut c = cfg_op.borrow_mut();
            let next_op = if c.opacity >= 0.95 {
                0.85
            } else if c.opacity >= 0.80 {
                0.70
            } else if c.opacity >= 0.65 {
                0.50
            } else if c.opacity >= 0.45 {
                0.35
            } else {
                1.0
            };
            c.opacity = next_op;
            win_op.set_opacity(c.opacity);
            let pct = (c.opacity * 100.0).round() as i32;
            btn_op_action.set_label(&format!("🔆 {}%", pct));
            btn_op_action.set_tooltip_text(Some(&format!("调节窗口透明度: 当前 {}% (滚轮微调)", pct)));
            save_config(&c);
        });

        let cfg_lock = config.clone();
        let win_lock = window.clone();
        let tb_lock = toolbar.clone();
        let btn_lock_clone = btn_lock.clone();
        btn_lock.connect_clicked(move |_| {
            let is_locked = {
                let mut c = cfg_lock.borrow_mut();
                c.locked = !c.locked;
                save_config(&c);
                c.locked
            };

            set_osd_locked(is_locked);
            Self::apply_lock_state(&win_lock, &tb_lock, &btn_lock_clone, is_locked);
        });

        btn_close.connect_clicked(move |_| {
            set_osd_enabled(false);
        });

        // Intercept close request to hide instead
        let win_close = window.clone();
        window.connect_close_request(move |_| {
            win_close.set_visible(false);
            set_osd_enabled(false);
            glib::Propagation::Stop
        });

        // Save window dimensions on resize
        let cfg_sz = config.clone();
        let win_sz = window.clone();
        window.connect_default_width_notify(move |_| {
            let mut c = cfg_sz.borrow_mut();
            c.width = win_sz.width();
            c.height = win_sz.height();
            save_config(&c);
        });

        // Apply input region on realize / map
        let win_realize = window.clone();
        let cfg_realize = config.clone();
        window.connect_realize(move |_| {
            let locked = cfg_realize.borrow().locked;
            let w = win_realize.width();
            let h = win_realize.height();
            Self::set_window_input_region(&win_realize, locked, w, h);
        });

        Self {
            window,
            label,
            toolbar,
            btn_lock,
            btn_opacity,
            btn_bg,
            css_provider,
            config,
            current_krc: Rc::new(RefCell::new(None)),
            krc_source_id: Rc::new(RefCell::new(None)),
        }
    }

    fn apply_lock_state(
        window: &gtk4::Window,
        toolbar: &gtk4::Box,
        btn_lock: &gtk4::Button,
        locked: bool,
    ) {
        btn_lock.set_label(if locked { "🔒" } else { "🔓" });
        btn_lock.set_tooltip_text(Some(if locked {
            "已锁定 (鼠标穿透中，点击解锁)"
        } else {
            "锁定 (开启鼠标穿透)"
        }));

        if locked {
            toolbar.set_visible(false);
        } else {
            toolbar.set_visible(true);
            toolbar.set_opacity(0.35);
        }

        Self::set_window_input_region(window, locked, window.width(), window.height());
    }

    fn set_window_input_region(window: &gtk4::Window, locked: bool, width: i32, height: i32) {
        if let Some(surface) = gtk4::prelude::NativeExt::surface(window) {
            if locked {
                // Empty input region = 100% mouse click-through
                let empty = gtk4::cairo::Region::create();
                surface.set_input_region(&empty);
            } else {
                // Full rectangle = fully interactive
                let rect = gtk4::cairo::RectangleInt::new(0, 0, width.max(200), height.max(40));
                let full = gtk4::cairo::Region::create_rectangle(&rect);
                surface.set_input_region(&full);
            }
        }
    }

    pub fn set_locked(&self, locked: bool) {
        {
            let mut c = self.config.borrow_mut();
            c.locked = locked;
            save_config(&c);
        }
        Self::apply_lock_state(&self.window, &self.toolbar, &self.btn_lock, locked);
    }

    pub fn toggle_lock(&self) {
        let is_locked = !self.config.borrow().locked;
        self.set_locked(is_locked);
    }

    pub fn set_color(&self, color: String) {
        {
            let mut c = self.config.borrow_mut();
            c.color = color;
            save_config(&c);
        }
        self.render_krc_frame();
    }

    pub fn set_visible(&self, visible: bool) {
        if visible {
            ensure_kwin_rules();
            self.window.set_visible(true);
            self.window.present();

            let locked = self.config.borrow().locked;
            let w = self.window.width();
            let h = self.window.height();
            Self::set_window_input_region(&self.window, locked, w, h);
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
            self.start_krc_display(raw, payload.current_time);
        } else {
            self.display_lrc_line(raw);
        }
    }

    fn display_lrc_line(&self, line: &str) {
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

    fn start_krc_display(&self, krc_raw: &str, current_audio_sec: f64) {
        let (tokens, duration, line_start_ms) = parse_krc_line(krc_raw);
        if tokens.is_empty() {
            self.display_lrc_line(krc_raw);
            return;
        }

        // Timing anchor: calculate how many milliseconds into this line the playback is
        let current_audio_ms = (current_audio_sec * 1000.0).round() as u64;
        let initial_offset_ms = if current_audio_ms >= line_start_ms {
            (current_audio_ms - line_start_ms).min(duration)
        } else {
            0
        };

        let krc_line = KrcLine {
            tokens,
            start_time: Instant::now() - std::time::Duration::from_millis(initial_offset_ms),
            total_duration_ms: duration,
        };

        *self.current_krc.borrow_mut() = Some(krc_line);

        // Initial render frame
        self.render_krc_frame();

        // 30ms progressive highlight animation timer
        let current_krc = self.current_krc.clone();
        let label = self.label.clone();
        let config = self.config.clone();
        let krc_source_id = self.krc_source_id.clone();
        let source_id = glib::timeout_add_local(std::time::Duration::from_millis(30), move || {
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
                    // Pending: dimmed white text
                    markup.push_str(&format!(
                        "<span foreground=\"#ffffff\" alpha=\"45%\">{}</span>",
                        escaped
                    ));
                }
            }
            markup.push_str("</span>");

            label.set_markup(&markup);

            // Continue while within duration + grace buffer (600ms)
            if elapsed > krc.total_duration_ms + 600 {
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

// Parses KRC format: [line_start, line_duration]<offset, duration, 0>text...
// Returns (tokens, total_duration, line_start_ms)
#[cfg(target_os = "linux")]
fn parse_krc_line(krc_raw: &str) -> (Vec<KrcToken>, u64, u64) {
    let mut tokens = Vec::new();
    let mut total_duration = 0u64;
    let mut line_start_ms = 0u64;

    let mut rest = krc_raw;
    if rest.starts_with('[') {
        if let Some(end_bracket) = rest.find(']') {
            let inside = &rest[1..end_bracket];
            if let Some(comma) = inside.find(',') {
                if let Ok(start) = inside[..comma].trim().parse::<u64>() {
                    line_start_ms = start;
                }
                if let Ok(dur) = inside[comma + 1..].trim().parse::<u64>() {
                    total_duration = dur;
                }
            }
            rest = &rest[end_bracket + 1..];
        }
    }

    while let Some(start_bracket) = rest.find('<') {
        let after_start = &rest[start_bracket + 1..];
        let Some(end_bracket) = after_start.find('>') else {
            break;
        };
        let tag_content = &after_start[..end_bracket];
        let after_tag = &after_start[end_bracket + 1..];

        let (word, next_rest) = if let Some(next_lt) = after_tag.find('<') {
            (&after_tag[..next_lt], &after_tag[next_lt..])
        } else {
            (after_tag, "")
        };

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

    (tokens, total_duration, line_start_ms)
}

// Setup OSD receiver in the GTK thread
#[cfg(target_os = "linux")]
pub fn setup_osd_receiver(osd_win: Rc<OsdWindow>, rx: std::sync::mpsc::Receiver<OsdCommand>) {
    glib::timeout_add_local(std::time::Duration::from_millis(25), move || {
        while let Ok(cmd) = rx.try_recv() {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                match cmd {
                    OsdCommand::UpdateLyrics(payload) => {
                        osd_win.update_lyrics(payload);
                    }
                    OsdCommand::SetVisible(visible) => {
                        osd_win.set_visible(visible);
                    }
                    OsdCommand::SetLocked(locked) => {
                        osd_win.set_locked(locked);
                    }
                    OsdCommand::ToggleLock => {
                        osd_win.toggle_lock();
                    }
                    OsdCommand::SetColor(color) => {
                        osd_win.set_color(color);
                    }
                }
            }));
        }
        glib::ControlFlow::Continue
    });
}

#[cfg(not(target_os = "linux"))]
pub struct OsdWindow;

#[cfg(not(target_os = "linux"))]
impl OsdWindow {
    pub fn new() -> Self {
        Self
    }
    pub fn set_visible(&self, _v: bool) {}
    pub fn update_lyrics(&self, _p: LyricPayload) {}
    pub fn set_locked(&self, _l: bool) {}
    pub fn toggle_lock(&self) {}
    pub fn set_color(&self, _c: String) {}
}

#[cfg(not(target_os = "linux"))]
pub fn setup_osd_receiver(_osd_win: Rc<OsdWindow>, _rx: std::sync::mpsc::Receiver<OsdCommand>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn test_parse_krc_line() {
        let line = "[171960,5040]<0,240,0>hello<240,300,0>world";
        let (tokens, duration, start) = parse_krc_line(line);
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].text, "hello");
        assert_eq!(tokens[1].text, "world");
        assert_eq!(duration, 5040);
        assert_eq!(start, 171960);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_ensure_kwin_rules() {
        ensure_kwin_rules();
        let kwin_path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("kwinrulesrc");
        let content = fs::read_to_string(&kwin_path).unwrap_or_default();
        assert!(content.contains("wmplayer-osd"));
        assert!(content.contains("desktopsrule=2"));
        assert!(content.contains("desktops="));
        assert!(content.contains("title=wmPlayer OSD Lyrics"));

        // Calling it a second time should be idempotent and not duplicate
        ensure_kwin_rules();
        let content_after = fs::read_to_string(&kwin_path).unwrap_or_default();
        assert_eq!(content, content_after);
    }
}
