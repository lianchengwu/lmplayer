#![cfg(target_os = "windows")]

use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::{Duration, Instant};

use windows::core::{w, Interface};
use windows_numerics::Vector2;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct2D::Common::*;
use windows::Win32::Graphics::Direct2D::*;
use windows::Win32::Graphics::DirectWrite::*;
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    ReleaseCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::osd::{set_osd_enabled, set_osd_locked, LyricPayload, OsdCommand};
use crate::osd_window::{load_config, parse_krc_line, save_config, KrcLine, OsdConfig};

const WM_OSD_CMD: u32 = WM_USER + 101;
const WM_MOUSELEAVE: u32 = 0x02A3;
const TIMER_KRC_ID: usize = 1;
#[derive(Clone)]
pub struct OsdWindow {
    tx: Sender<OsdCommand>,
    hwnd: HWND,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MiniButton {
    Lock,
    FontDec,
    FontInc,
    Close,
}

fn get_button_rect(btn: MiniButton, width: i32) -> D2D_RECT_F {
    let top = 4.0;
    let bottom = 24.0;
    let w = width as f32;
    match btn {
        MiniButton::Lock => D2D_RECT_F {
            left: w - 124.0,
            top,
            right: w - 98.0,
            bottom,
        },
        MiniButton::FontDec => D2D_RECT_F {
            left: w - 94.0,
            top,
            right: w - 68.0,
            bottom,
        },
        MiniButton::FontInc => D2D_RECT_F {
            left: w - 64.0,
            top,
            right: w - 38.0,
            bottom,
        },
        MiniButton::Close => D2D_RECT_F {
            left: w - 34.0,
            top,
            right: w - 10.0,
            bottom,
        },
    }
}

fn parse_hex_color(hex: &str, alpha: f32) -> D2D1_COLOR_F {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() == 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(56) as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(189) as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(248) as f32 / 255.0;
        D2D1_COLOR_F { r, g, b, a: alpha }
    } else {
        D2D1_COLOR_F {
            r: 0.22,
            g: 0.74,
            b: 0.97,
            a: alpha,
        }
    }
}

struct WinOsdState {
    hwnd: HWND,
    config: OsdConfig,
    d2d_factory: ID2D1Factory,
    dwrite_factory: IDWriteFactory,
    current_krc: Option<KrcLine>,
    current_lrc: String,
    hovered_btn: Option<MiniButton>,
    mouse_tracked: bool,
    rx: Receiver<OsdCommand>,
}

impl WinOsdState {
    fn render_frame(&mut self) {
        if self.hwnd.0.is_null() {
            return;
        }

        unsafe {
            let hdc_screen = GetDC(None);
            if hdc_screen.0.is_null() {
                return;
            }
            let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
            if hdc_mem.0.is_null() {
                let _ = ReleaseDC(None, hdc_screen);
                return;
            }

            let width = self.config.width.max(300);
            let height = self.config.height.max(50);

            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // Top-down DIB
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bits: *mut core::ffi::c_void = core::ptr::null_mut();
            let hbmp = match CreateDIBSection(Some(hdc_mem), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)
            {
                Ok(b) => b,
                Err(_) => {
                    let _ = DeleteDC(hdc_mem);
                    let _ = ReleaseDC(None, hdc_screen);
                    return;
                }
            };
            let old_bmp = SelectObject(hdc_mem, hbmp.into());

            let rt_props = D2D1_RENDER_TARGET_PROPERTIES {
                r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
                pixelFormat: D2D1_PIXEL_FORMAT {
                    format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
                },
                dpiX: 96.0,
                dpiY: 96.0,
                usage: D2D1_RENDER_TARGET_USAGE_NONE,
                minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
            };

            let dc_target = match self.d2d_factory.CreateDCRenderTarget(&rt_props) {
                Ok(rt) => rt,
                Err(_) => {
                    SelectObject(hdc_mem, old_bmp);
                    let _ = DeleteObject(hbmp.into());
                    let _ = DeleteDC(hdc_mem);
                    let _ = ReleaseDC(None, hdc_screen);
                    return;
                }
            };

            let bind_rect = RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            };
            if dc_target.BindDC(hdc_mem, &bind_rect).is_err() {
                SelectObject(hdc_mem, old_bmp);
                let _ = DeleteObject(hbmp.into());
                let _ = DeleteDC(hdc_mem);
                let _ = ReleaseDC(None, hdc_screen);
                return;
            }

            dc_target.BeginDraw();
            dc_target.Clear(Some(&D2D1_COLOR_F {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
            }));

            // 1. Draw rounded background
            let bg_round = D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F {
                    left: 2.0,
                    top: 2.0,
                    right: (width - 2) as f32,
                    bottom: (height - 2) as f32,
                },
                radiusX: 14.0,
                radiusY: 14.0,
            };

            let bg_alpha = (self.config.bg_opacity * 0.78) as f32;
            if let Ok(bg_brush) = dc_target.CreateSolidColorBrush(
                &D2D1_COLOR_F {
                    r: 0.08,
                    g: 0.09,
                    b: 0.12,
                    a: bg_alpha,
                },
                None,
            ) {
                dc_target.FillRoundedRectangle(&bg_round, &bg_brush);
            }

            if !self.config.locked {
                if let Ok(border_brush) = dc_target.CreateSolidColorBrush(
                    &D2D1_COLOR_F {
                        r: 0.40,
                        g: 0.50,
                        b: 0.65,
                        a: 0.35,
                    },
                    None,
                ) {
                    dc_target.DrawRoundedRectangle(&bg_round, &border_brush, 1.2, None);
                }

                // 2. Draw hover toolbar buttons
                let btn_font_fmt = self.dwrite_factory.CreateTextFormat(
                    w!("Segoe UI"),
                    None,
                    DWRITE_FONT_WEIGHT_NORMAL,
                    DWRITE_FONT_STYLE_NORMAL,
                    DWRITE_FONT_STRETCH_NORMAL,
                    12.0,
                    w!("zh-cn"),
                );

                if let Ok(btn_fmt) = btn_font_fmt {
                    let _ = btn_fmt.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER);
                    let _ = btn_fmt.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);

                    let buttons = [
                        (
                            MiniButton::Lock,
                            if self.config.locked {
                                "🔒"
                            } else {
                                "🔓"
                            },
                        ),
                        (MiniButton::FontDec, "A-"),
                        (MiniButton::FontInc, "A+"),
                        (MiniButton::Close, "✕"),
                    ];

                    for (btn, label) in buttons {
                        let r = get_button_rect(btn, width);
                        let is_hover = self.hovered_btn == Some(btn);

                        let btn_round = D2D1_ROUNDED_RECT {
                            rect: r,
                            radiusX: 5.0,
                            radiusY: 5.0,
                        };

                        if is_hover {
                            if let Ok(h_brush) = dc_target.CreateSolidColorBrush(
                                &D2D1_COLOR_F {
                                    r: 1.0,
                                    g: 1.0,
                                    b: 1.0,
                                    a: 0.22,
                                },
                                None,
                            ) {
                                dc_target.FillRoundedRectangle(&btn_round, &h_brush);
                            }
                        }

                        let text_color = if btn == MiniButton::Close && is_hover {
                            D2D1_COLOR_F {
                                r: 0.95,
                                g: 0.35,
                                b: 0.35,
                                a: 0.95,
                            }
                        } else {
                            D2D1_COLOR_F {
                                r: 0.88,
                                g: 0.92,
                                b: 0.96,
                                a: 0.85,
                            }
                        };

                        if let Ok(tb_brush) = dc_target.CreateSolidColorBrush(&text_color, None) {
                            let label_utf16: Vec<u16> = label.encode_utf16().collect();
                            dc_target.DrawText(
                                &label_utf16,
                                &btn_fmt,
                                &r,
                                &tb_brush,
                                D2D1_DRAW_TEXT_OPTIONS_NONE,
                                DWRITE_MEASURING_MODE_NATURAL,
                            );
                        }
                    }
                }
            }

            // 3. Draw Lyrics
            let font_size = self.config.font_size.clamp(14, 56) as f32;
            let lyric_fmt = self.dwrite_factory.CreateTextFormat(
                w!("Microsoft YaHei"),
                None,
                DWRITE_FONT_WEIGHT_BOLD,
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                font_size,
                w!("zh-cn"),
            );

            if let Ok(fmt) = lyric_fmt {
                let _ = fmt.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER);
                let _ = fmt.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);

                let text_top = if !self.config.locked { 18.0 } else { 6.0 };
                let text_rect = D2D_RECT_F {
                    left: 16.0,
                    top: text_top,
                    right: (width - 16) as f32,
                    bottom: (height - 6) as f32,
                };
                let max_w = (text_rect.right - text_rect.left).max(10.0);
                let max_h = (text_rect.bottom - text_rect.top).max(10.0);

                let shadow_color = D2D1_COLOR_F {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 0.85,
                };
                let shadow_brush = dc_target.CreateSolidColorBrush(&shadow_color, None).ok();

                if let Some(krc) = &self.current_krc {
                    let full_text: String = krc.tokens.iter().map(|t| t.text.as_str()).collect();
                    let display_text = if full_text.trim().is_empty() {
                        "wmPlayer 桌面歌词已启动".to_string()
                    } else {
                        full_text
                    };

                    let utf16: Vec<u16> = display_text.encode_utf16().collect();
                    if let Ok(layout) =
                        self.dwrite_factory.CreateTextLayout(&utf16, &fmt, max_w, max_h)
                    {
                        let elapsed = krc.start_time.elapsed().as_millis() as u64;

                        // Calculate sung character count (in UTF-16 code units)
                        let mut sung_chars = 0usize;
                        for tok in &krc.tokens {
                            let tok_len = tok.text.encode_utf16().count();
                            if elapsed >= tok.start_offset_ms {
                                sung_chars += tok_len;
                            } else {
                                break;
                            }
                        }

                        let sung_color = parse_hex_color(&self.config.color, 1.0);
                        let unsung_color = D2D1_COLOR_F {
                            r: 1.0,
                            g: 1.0,
                            b: 1.0,
                            a: 0.50,
                        };

                        let sung_brush =
                            dc_target.CreateSolidColorBrush(&sung_color, None).ok();
                        let unsung_brush =
                            dc_target.CreateSolidColorBrush(&unsung_color, None).ok();

                        if let Some(sb) = &sung_brush {
                            if sung_chars > 0 {
                                let range = DWRITE_TEXT_RANGE {
                                    startPosition: 0,
                                    length: (sung_chars as u32).min(utf16.len() as u32),
                                };
                                if let Ok(unk) = sb.cast::<windows::core::IUnknown>() {
                                    let _ = layout.SetDrawingEffect(&unk, range);
                                }
                            }
                        }

                        if let Some(sb) = &shadow_brush {
                            dc_target.DrawTextLayout(
                                Vector2 {
                                    X: text_rect.left + 1.5,
                                    Y: text_rect.top + 1.5,
                                },
                                &layout,
                                sb,
                                D2D1_DRAW_TEXT_OPTIONS_NONE,
                            );
                        }

                        if let Some(ub) = &unsung_brush {
                            dc_target.DrawTextLayout(
                                Vector2 {
                                    X: text_rect.left,
                                    Y: text_rect.top,
                                },
                                &layout,
                                ub,
                                D2D1_DRAW_TEXT_OPTIONS_NONE,
                            );
                        }
                    }
                } else {
                    let display_text = if self.current_lrc.trim().is_empty() {
                        "wmPlayer 桌面歌词已启动".to_string()
                    } else {
                        self.current_lrc.clone()
                    };

                    let utf16: Vec<u16> = display_text.encode_utf16().collect();
                    if let Ok(layout) =
                        self.dwrite_factory.CreateTextLayout(&utf16, &fmt, max_w, max_h)
                    {
                        let active_color = parse_hex_color(&self.config.color, 1.0);
                        let active_brush =
                            dc_target.CreateSolidColorBrush(&active_color, None).ok();

                        if let Some(sb) = &shadow_brush {
                            dc_target.DrawTextLayout(
                                Vector2 {
                                    X: text_rect.left + 1.5,
                                    Y: text_rect.top + 1.5,
                                },
                                &layout,
                                sb,
                                D2D1_DRAW_TEXT_OPTIONS_NONE,
                            );
                        }

                        if let Some(ab) = &active_brush {
                            dc_target.DrawTextLayout(
                                Vector2 {
                                    X: text_rect.left,
                                    Y: text_rect.top,
                                },
                                &layout,
                                ab,
                                D2D1_DRAW_TEXT_OPTIONS_NONE,
                            );
                        }
                    }
                }
            }

            let _ = dc_target.EndDraw(None, None);

            // 4. UpdateLayeredWindow
            let mut pt_dst = POINT { x: 0, y: 0 };
            let mut win_rect = RECT::default();
            if GetWindowRect(self.hwnd, &mut win_rect).is_ok() {
                pt_dst.x = win_rect.left;
                pt_dst.y = win_rect.top;
            }

            let pt_src = POINT { x: 0, y: 0 };
            let sz = SIZE {
                cx: width,
                cy: height,
            };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: (self.config.opacity.clamp(0.1, 1.0) * 255.0) as u8,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };

            let _ = UpdateLayeredWindow(
                self.hwnd,
                Some(hdc_screen),
                Some(&pt_dst),
                Some(&sz),
                Some(hdc_mem),
                Some(&pt_src),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            );

            SelectObject(hdc_mem, old_bmp);
            let _ = DeleteObject(hbmp.into());
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
        }
    }

    fn handle_mouse_move(&mut self, x: i32, y: i32) {
        if self.config.locked {
            return;
        }

        unsafe {
            if !self.mouse_tracked {
                let mut tme = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: self.hwnd,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&mut tme);
                self.mouse_tracked = true;
            }

            let prev = self.hovered_btn;
            let fx = x as f32;
            let fy = y as f32;

            let mut hit = None;
            for btn in [
                MiniButton::Lock,
                MiniButton::FontDec,
                MiniButton::FontInc,
                MiniButton::Close,
            ] {
                let r = get_button_rect(btn, self.config.width);
                if fx >= r.left && fx <= r.right && fy >= r.top && fy <= r.bottom {
                    hit = Some(btn);
                    break;
                }
            }

            self.hovered_btn = hit;
            if hit.is_some() {
                SetCursor(Some(LoadCursorW(None, IDC_HAND).unwrap_or_default()));
            } else {
                SetCursor(Some(LoadCursorW(None, IDC_SIZEALL).unwrap_or_default()));
            }

            if prev != self.hovered_btn {
                self.render_frame();
            }
        }
    }

    fn handle_mouse_leave(&mut self) {
        self.mouse_tracked = false;
        if self.hovered_btn.is_some() {
            self.hovered_btn = None;
            self.render_frame();
        }
    }

    fn handle_lbutton_down(&mut self) {
        if self.config.locked {
            return;
        }

        match self.hovered_btn {
            Some(MiniButton::Lock) => {
                self.toggle_lock();
            }
            Some(MiniButton::FontDec) => {
                if self.config.font_size > 14 {
                    self.config.font_size -= 2;
                    save_config(&self.config);
                    self.render_frame();
                }
            }
            Some(MiniButton::FontInc) => {
                if self.config.font_size < 56 {
                    self.config.font_size += 2;
                    save_config(&self.config);
                    self.render_frame();
                }
            }
            Some(MiniButton::Close) => {
                set_osd_enabled(false);
                unsafe {
                    let _ = ShowWindow(self.hwnd, SW_HIDE);
                }
            }
            None => unsafe {
                // Drag window moving
                let _ = ReleaseCapture();
                let _ = SendMessageW(
                    self.hwnd,
                    WM_NCLBUTTONDOWN,
                    Some(WPARAM(HTCAPTION as usize)),
                    Some(LPARAM(0)),
                );
            },
        }
    }

    fn toggle_lock(&mut self) {
        let new_locked = !self.config.locked;
        self.set_locked(new_locked);
    }

    fn set_locked(&mut self, locked: bool) {
        self.config.locked = locked;
        set_osd_locked(locked);
        save_config(&self.config);

        unsafe {
            let ex = GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE);
            if locked {
                SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, ex | (WS_EX_TRANSPARENT.0 as isize));
            } else {
                SetWindowLongPtrW(
                    self.hwnd,
                    GWL_EXSTYLE,
                    ex & !(WS_EX_TRANSPARENT.0 as isize),
                );
            }
        }
        self.hovered_btn = None;
        self.render_frame();
    }

    fn drain_commands(&mut self) {
        while let Ok(cmd) = self.rx.try_recv() {
            match cmd {
                OsdCommand::UpdateLyrics(payload) => {
                    let raw = payload.lyric.trim();
                    if raw.is_empty() {
                        self.current_krc = None;
                        self.current_lrc = "wmPlayer - 暂无播放".to_string();
                        unsafe {
                            let _ = KillTimer(Some(self.hwnd), TIMER_KRC_ID);
                        }
                    } else if payload.format == "krc" || raw.contains("]<") || (raw.contains('<') && raw.contains('>')) {
                        let (tokens, dur, start_ms) = parse_krc_line(raw);
                        if tokens.is_empty() {
                            self.current_krc = None;
                            self.current_lrc = raw.to_string();
                            unsafe {
                                let _ = KillTimer(Some(self.hwnd), TIMER_KRC_ID);
                            }
                        } else {
                            let current_ms = (payload.current_time * 1000.0).round() as u64;
                            let initial_offset = if current_ms >= start_ms {
                                (current_ms - start_ms).min(dur)
                            } else {
                                0
                            };

                            self.current_krc = Some(KrcLine {
                                tokens,
                                start_time: Instant::now()
                                    - Duration::from_millis(initial_offset),
                                total_duration_ms: dur,
                            });
                            unsafe {
                                let _ = SetTimer(Some(self.hwnd), TIMER_KRC_ID, 30, None);
                            }
                        }
                    } else {
                        self.current_krc = None;
                        self.current_lrc = raw.to_string();
                        unsafe {
                            let _ = KillTimer(Some(self.hwnd), TIMER_KRC_ID);
                        }
                    }
                    self.render_frame();
                }
                OsdCommand::SetVisible(visible) => {
                    unsafe {
                        if visible {
                            let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                            let _ = SetWindowPos(
                                self.hwnd,
                                Some(HWND_TOPMOST),
                                0,
                                0,
                                0,
                                0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                            );
                            self.render_frame();
                        } else {
                            let _ = ShowWindow(self.hwnd, SW_HIDE);
                            let _ = KillTimer(Some(self.hwnd), TIMER_KRC_ID);
                        }
                    }
                }
                OsdCommand::SetLocked(locked) => {
                    self.set_locked(locked);
                }
                OsdCommand::ToggleLock => {
                    self.toggle_lock();
                }
                OsdCommand::SetColor(color) => {
                    self.config.color = color;
                    save_config(&self.config);
                    self.render_frame();
                }
                OsdCommand::SavePosition(x, y) => {
                    self.config.x = Some(x);
                    self.config.y = Some(y);
                    save_config(&self.config);
                    unsafe {
                        let _ = SetWindowPos(
                            self.hwnd,
                            Some(HWND_TOPMOST),
                            x,
                            y,
                            self.config.width,
                            self.config.height,
                            SWP_NOACTIVATE,
                        );
                    }
                    self.render_frame();
                }
            }
        }
    }
}

unsafe extern "system" fn osd_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WinOsdState;

    match msg {
        WM_OSD_CMD => {
            if !ptr.is_null() {
                (*ptr).drain_commands();
            }
            LRESULT(0)
        }
        WM_TIMER => {
            if wparam.0 == TIMER_KRC_ID && !ptr.is_null() {
                let state = &mut *ptr;
                if let Some(krc) = &state.current_krc {
                    let elapsed = krc.start_time.elapsed().as_millis() as u64;
                    if elapsed > krc.total_duration_ms + 600 {
                        let _ = KillTimer(Some(hwnd), TIMER_KRC_ID);
                    }
                }
                state.render_frame();
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            if !ptr.is_null() {
                let x = (lparam.0 & 0xffff) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
                (*ptr).handle_mouse_move(x, y);
            }
            LRESULT(0)
        }
        WM_MOUSELEAVE => {
            if !ptr.is_null() {
                (*ptr).handle_mouse_leave();
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            if !ptr.is_null() {
                (*ptr).handle_lbutton_down();
            }
            LRESULT(0)
        }
        WM_MOVE => {
            if !ptr.is_null() {
                let x = (lparam.0 & 0xffff) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
                let state = &mut *ptr;
                state.config.x = Some(x);
                state.config.y = Some(y);
                save_config(&state.config);
            }
            LRESULT(0)
        }
        WM_MOUSEWHEEL => {
            if !ptr.is_null() {
                let delta = (wparam.0 >> 16) as i16;
                let state = &mut *ptr;
                if !state.config.locked {
                    if delta > 0 {
                        state.config.opacity = (state.config.opacity + 0.05).min(1.0);
                    } else {
                        state.config.opacity = (state.config.opacity - 0.05).max(0.2);
                    }
                    save_config(&state.config);
                    state.render_frame();
                }
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn run_osd_thread(init_tx: Sender<(isize, Sender<OsdCommand>)>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let d2d_factory: ID2D1Factory = match D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[OSD Win32] Failed to create D2D1Factory: {e:?}");
                return;
            }
        };

        let dwrite_factory: IDWriteFactory = match DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[OSD Win32] Failed to create DWriteFactory: {e:?}");
                return;
            }
        };

        let hinstance = GetModuleHandleW(None).unwrap_or_default();
        let class_name = w!("wmplayer_osd_lyrics_class");

        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(osd_wndproc),
            hInstance: hinstance.into(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassExW(&wc);

        let config = load_config();
        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);

        let x = config.x.unwrap_or_else(|| (screen_w - config.width) / 2);
        let y = config.y.unwrap_or_else(|| (screen_h - config.height - 110).max(50));

        let mut ex_style = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
        if config.locked {
            ex_style |= WS_EX_TRANSPARENT;
        }

        let hwnd = match CreateWindowExW(
            ex_style,
            class_name,
            w!("wmPlayer OSD Lyrics"),
            WS_POPUP,
            x,
            y,
            config.width,
            config.height,
            None,
            None,
            Some(hinstance.into()),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[OSD Win32] CreateWindowExW failed: {e:?}");
                return;
            }
        };

        let (cmd_tx, cmd_rx) = channel();

        let state = Box::new(WinOsdState {
            hwnd,
            config,
            d2d_factory,
            dwrite_factory,
            current_krc: None,
            current_lrc: "wmPlayer 桌面歌词已启动".to_string(),
            hovered_btn: None,
            mouse_tracked: false,
            rx: cmd_rx,
        });

        let state_ptr = Box::into_raw(state);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, state_ptr as isize);

        let _ = init_tx.send((hwnd.0 as isize, cmd_tx));

        // Initial render
        (*state_ptr).render_frame();

        // Message pump
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = Box::from_raw(state_ptr);
        CoUninitialize();
    }
}

impl OsdWindow {
    pub fn new() -> Self {
        let (init_tx, init_rx) = channel();
        std::thread::Builder::new()
            .name("osd-win32-ui".into())
            .spawn(move || {
                run_osd_thread(init_tx);
            })
            .expect("spawn osd thread");

        let (hwnd_val, tx) = init_rx.recv().expect("osd init failed");
        Self {
            tx,
            hwnd: HWND(hwnd_val as *mut core::ffi::c_void),
        }
    }

    pub fn set_visible(&self, visible: bool) {
        let _ = self.tx.send(OsdCommand::SetVisible(visible));
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }

    pub fn update_lyrics(&self, payload: LyricPayload) {
        let _ = self.tx.send(OsdCommand::UpdateLyrics(payload));
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }

    pub fn set_locked(&self, locked: bool) {
        let _ = self.tx.send(OsdCommand::SetLocked(locked));
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }

    pub fn toggle_lock(&self) {
        let _ = self.tx.send(OsdCommand::ToggleLock);
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }

    pub fn set_color(&self, color: String) {
        let _ = self.tx.send(OsdCommand::SetColor(color));
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }

    pub fn save_position(&self, x: i32, y: i32) {
        let _ = self.tx.send(OsdCommand::SavePosition(x, y));
        unsafe {
            let _ = PostMessageW(Some(self.hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
        }
    }
}

pub fn setup_osd_receiver(osd_win: std::rc::Rc<OsdWindow>, rx: std::sync::mpsc::Receiver<OsdCommand>) {
    let tx = osd_win.tx.clone();
    let hwnd_val = osd_win.hwnd.0 as isize;
    std::thread::Builder::new()
        .name("osd-receiver-bridge".into())
        .spawn(move || {
            let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
            while let Ok(cmd) = rx.recv() {
                let _ = tx.send(cmd);
                unsafe {
                    let _ = PostMessageW(Some(hwnd), WM_OSD_CMD, WPARAM(0), LPARAM(0));
                }
            }
        })
        .expect("spawn osd receiver bridge");
}
