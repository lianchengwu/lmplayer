// settings.js - 设置页面功能模块

// 导入设置服务与更新服务
import * as SettingsService from './bindings/wmplayer/settingsservice.js';
import * as UpdateService from './bindings/wmplayer/updateservice.js';
import { Browser } from '@wailsio/runtime';
const DEFAULT_SETTINGS = {
    // 播放设置
    playback: {
        autoPlay: true,
        crossfade: false,
        crossfadeDuration: 3,
        gaplessPlayback: true,
        replayGain: false,
        volume: 80
    },
    // 音质设置
    quality: {
        streamingQuality: 'high',
        downloadQuality: 'lossless',
        wifiOnly: false
    },
    // 界面设置
    interface: {
        theme: 'auto',
        language: 'zh-CN',
        showLyrics: true,
        showSpectrum: false,
        miniPlayer: false,
        osdLyricsColor: '#38bdf8',
        osdLyricsAlign: 'center',
        osdLyricsFont: 'system',
        fontFamily: 'system'
    },
    // 下载设置
    download: {
        downloadPath: '',
        autoDownload: false,
        downloadLyrics: true,
        downloadCover: true
    },
    // 快捷键设置
    hotkeys: {
        playPause: 'Space',
        nextTrack: 'Ctrl+Right',
        prevTrack: 'Ctrl+Left',
        volumeUp: 'Ctrl+Up',
        volumeDown: 'Ctrl+Down',
        toggleLyrics: 'Ctrl+L'
    },
    // 隐私设置
    privacy: {
        saveHistory: true,
        shareListening: false,
        analytics: true
    },
    // 应用行为设置
    behavior: {
        closeAction: 'ask', // 'ask', 'minimize', 'exit'
        startMinimized: false,
        autoStart: false,
        hardwareAcceleration: true
    }
};

let settingsData = structuredClone(DEFAULT_SETTINGS);

function mergeSettings(base, overlay) {
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
        return structuredClone(base);
    }
    const out = structuredClone(base);
    for (const key of Object.keys(base)) {
        if (overlay[key] === undefined) {
            continue;
        }
        if (
            overlay[key] && typeof overlay[key] === 'object' && !Array.isArray(overlay[key]) &&
            base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
        ) {
            out[key] = { ...base[key], ...overlay[key] };
        } else {
            out[key] = overlay[key];
        }
    }
    return out;
}
const SYSTEM_FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';

const PREFERRED_FONTS = [
    'Noto Sans CJK SC',
    'Noto Sans SC',
    'Source Han Sans SC',
    'Source Han Sans CN',
    '思源黑体 CN',
    '思源黑体',
    'Microsoft YaHei',
    '微软雅黑',
    'PingFang SC',
    '苹方-简',
    'Sarasa Gothic SC',
    '更纱黑体 SC',
    'LXGW WenKai',
    '霞鹜文楷',
    'LXGW WenKai Screen',
    'HarmonyOS Sans SC',
    'WenQuanYi Micro Hei',
    '文泉驿微米黑',
    'Noto Serif CJK SC',
    'Source Han Serif CN',
    '思源宋体 CN',
    'Source Han Serif SC',
    'Inter',
    'Segoe UI',
];

const FONT_PRESETS = [
    ...PREFERRED_FONTS,
    'Noto Sans CJK TC',
    'Source Han Sans',
    'WenQuanYi Zen Hei',
    'Roboto',
    'Cantarell',
];

let availableFonts = null;

function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[ch]);
}

function fontFamilyCss(family) {
    const name = String(family || '').trim();
    if (!name || name === 'system') return SYSTEM_FONT_STACK;
    const safe = name.replace(/["\\\r\n]/g, '').slice(0, 80);
    if (!safe) return SYSTEM_FONT_STACK;
    return `"${safe}", ${SYSTEM_FONT_STACK}`;
}

export function applyFontFamily(family) {
    const name = String(family || '').trim();
    const root = document.documentElement;
    if (!name || name === 'system') {
        root.style.removeProperty('--app-font-family');
        try { localStorage.removeItem('lmplayer-font'); } catch (e) {}
        return;
    }
    const safe = name.replace(/["\\\r\n]/g, '').slice(0, 80);
    if (!safe) {
        root.style.removeProperty('--app-font-family');
        return;
    }
    root.style.setProperty('--app-font-family', fontFamilyCss(safe));
    try { localStorage.setItem('lmplayer-font', safe); } catch (e) {}
}

function normalizeFontEntries(list) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const family = String(item?.family || item || '').trim();
        if (!family || family.length > 120 || seen.has(family)) continue;
        seen.add(family);
        const label = String(item?.label || family).trim() || family;
        out.push({ family, label });
    }
    return out;
}

function isFontInstalled(family) {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return true;
        const sample = 'mmmmmmmmmmlli字体';
        const safe = String(family).replace(/"/g, '');
        return ['monospace', 'serif', 'sans-serif'].some((base) => {
            ctx.font = `72px ${base}`;
            const width = ctx.measureText(sample).width;
            ctx.font = `72px "${safe}", ${base}`;
            return ctx.measureText(sample).width !== width;
        });
    } catch (e) {
        return true;
    }
}

function detectPresetFonts() {
    return FONT_PRESETS.filter(isFontInstalled).map((name) => ({ family: name, label: name }));
}

async function loadAvailableFonts() {
    if (availableFonts) return availableFonts;
    try {
        const response = await SettingsService.ListSystemFonts();
        const list = response?.data ?? response?.Data;
        if (response?.success !== false && Array.isArray(list) && list.length) {
            const fonts = normalizeFontEntries(list);
            if (fonts.length) {
                availableFonts = fonts;
                return availableFonts;
            }
        }
    } catch (e) {
        console.warn('读取系统字体失败:', e);
    }
    availableFonts = detectPresetFonts();
    return availableFonts;
}

function renderFontControl(current, options = {}) {
    const selectId = options.selectId || 'fontFamilySelect';
    const customId = options.customId || 'fontFamilyCustom';
    const onChange = options.onChange || 'updateFontFamily';
    const fonts = availableFonts || [];
    const saved = String(current || 'system');
    const matched = saved === 'system'
        ? null
        : fonts.find((font) => font.family === saved || font.label === saved);
    const isCustom = saved !== 'system' && !matched;
    const preferredKeys = new Map(PREFERRED_FONTS.map((name, index) => [name.toLowerCase(), index]));
    const preferred = [];
    const rest = [];
    for (const font of fonts) {
        const rank = preferredKeys.get(font.family.toLowerCase())
            ?? preferredKeys.get(String(font.label || '').toLowerCase());
        if (rank === undefined) rest.push(font);
        else preferred.push({ font, rank });
    }
    preferred.sort((a, b) => a.rank - b.rank);
    rest.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    const option = (font, selected) => {
        const css = font.family.replace(/["'\\<>]/g, '');
        const text = font.label && font.label !== font.family ? font.label : font.family;
        return `<option value="${escapeAttr(font.family)}" ${selected ? 'selected' : ''} style="font-family:'${escapeAttr(css)}',sans-serif">${escapeAttr(text)}</option>`;
    };
    const selectedFamily = matched ? matched.family : '';
    const preferredHtml = preferred.map(({ font }) => option(font, font.family === selectedFamily)).join('');
    const restHtml = rest.map((font) => option(font, font.family === selectedFamily)).join('');
    const css = fontFamilyCss(matched ? matched.family : saved);
    return `
        <select id="${selectId}" class="settings-select settings-font-select" style="font-family:${escapeAttr(css)}" onchange="${onChange}(this.value)">
            <option value="system" ${saved === 'system' ? 'selected' : ''}>系统默认</option>
            ${preferredHtml ? `<optgroup label="推荐">${preferredHtml}</optgroup>` : ''}
            ${restHtml ? `<optgroup label="已安装">${restHtml}</optgroup>` : ''}
            <option value="__custom__" ${isCustom ? 'selected' : ''}>自定义…</option>
        </select>
        <input type="text" class="settings-input settings-font-custom" id="${customId}"
            placeholder="输入已安装的字体名称" autocomplete="off"
            value="${isCustom ? escapeAttr(saved) : ''}"
            style="display:${isCustom ? 'block' : 'none'}"
            onchange="${onChange}(this.value)">
    `;
}

function syncFontPreview(family, previewId = 'fontPreview', selectId = 'fontFamilySelect') {
    const css = fontFamilyCss(family);
    const preview = document.getElementById(previewId);
    if (preview) preview.style.fontFamily = css;
    const select = document.getElementById(selectId);
    if (select && select.value !== '__custom__') select.style.fontFamily = css;
}


window.initSettingsPage = async () => {
    console.log('初始化设置页面');
    try {
        await loadSettings();
        applyAllSettings();
    } catch (error) {
        console.error('初始化设置失败:', error);
    }
    await loadAvailableFonts();
    renderSettingsPage();
    await loadSettingsPath();
    await loadAppVersion();
};

async function loadAppVersion() {
    try {
        const { GetCurrentVersion } = await import('./bindings/wmplayer/updateservice.js');
        const ver = await GetCurrentVersion();
        const el = document.getElementById('appVersionDisplay');
        if (el && ver) {
            const verStr = typeof ver === 'string' ? ver.trim() : String(ver);
            el.textContent = verStr.startsWith('v') ? verStr : 'v' + verStr;
        }
    } catch (e) {
        console.warn('获取版本号失败:', e);
    }
}

// 加载设置文件路径
async function loadSettingsPath() {
    try {
        const response = await SettingsService.GetSettingsPath();
        if (response.Success && response.Data) {
            const pathElement = document.getElementById('settingsPath');
            if (pathElement) {
                pathElement.textContent = response.Data;
            }
        }
    } catch (error) {
        console.error('获取设置文件路径失败:', error);
        const pathElement = document.getElementById('settingsPath');
        if (pathElement) {
            pathElement.textContent = '获取路径失败';
        }
    }
}

// 加载设置数据
async function loadSettings() {
    try {
        const response = await SettingsService.LoadSettings();
        const loaded = response?.Data ?? response?.data;
        if (loaded && typeof loaded === 'object' && Object.keys(loaded).length > 0) {
            settingsData = mergeSettings(DEFAULT_SETTINGS, loaded);
            console.log('设置加载成功:', response.Message || response.message);
            if (window.closeAction !== undefined) {
                window.closeAction = settingsData.behavior.closeAction;
            }
        }
        if (settingsData.behavior.hardwareAcceleration === undefined) {
            settingsData.behavior.hardwareAcceleration = true;
        }
        try {
            const { GetOSDColor, GetOSDAlign, GetOSDFont } = await import('./bindings/wmplayer/cacheservice.js');
            const [colorRes, alignRes, fontRes] = await Promise.all([
                GetOSDColor().catch(() => null),
                GetOSDAlign().catch(() => null),
                GetOSDFont().catch(() => null),
            ]);
            if (colorRes && colorRes.success && colorRes.color) {
                settingsData.interface.osdLyricsColor = colorRes.color;
            }
            if (alignRes && alignRes.success && alignRes.align) {
                settingsData.interface.osdLyricsAlign = alignRes.align;
            }
            if (fontRes && fontRes.success && fontRes.font) {
                settingsData.interface.osdLyricsFont = fontRes.font;
            }
        } catch (e) {}
    } catch (error) {
        console.error('加载设置失败:', error);
        settingsData = structuredClone(DEFAULT_SETTINGS);
    }
}

export function applyTheme(theme) {
    let resolvedTheme = theme;
    if (!theme || theme === 'auto') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = prefersDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolvedTheme);

    const themeBtn = document.querySelector('.theme-toggle-btn i');
    if (themeBtn) {
        switch (resolvedTheme) {
            case 'light':
                themeBtn.className = 'fas fa-moon';
                break;
            case 'dark':
                themeBtn.className = 'fas fa-sun';
                break;
            case 'frosted':
                themeBtn.className = 'fas fa-snowflake';
                break;
            case 'frosted-dark':
                themeBtn.className = 'fas fa-gem';
                break;
            default:
                themeBtn.className = 'fas fa-moon';
        }
    }
    console.log('主题设置已应用:', theme, '(当前生效: ' + resolvedTheme + ')');
}

if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (settingsData.interface.theme === 'auto') {
            applyTheme('auto');
        }
    });
}

// 应用所有设置
function applyAllSettings() {
    console.log('应用所有设置...');

    // 应用主题设置
    applyTheme(settingsData.interface.theme);
    applyFontFamily(settingsData.interface.fontFamily);

    // 应用桌面歌词颜色、对齐和字体
    if (settingsData.interface.osdLyricsColor) {
        applyOsdColor(settingsData.interface.osdLyricsColor);
    }
    applyOsdAlign(settingsData.interface.osdLyricsAlign || 'center');
    applyOsdFont(settingsData.interface.osdLyricsFont || 'system');

    // 应用音量设置
    if (settingsData.playback.volume !== undefined) {
        if (typeof window.setVolume === 'function') {
            window.setVolume(settingsData.playback.volume);
            console.log('音量设置已应用:', settingsData.playback.volume);
        } else if (window.UnifiedPlayerController?.setVolume) {
            window.UnifiedPlayerController.setVolume(settingsData.playback.volume);
        }
    }

    if (settingsData.behavior?.closeAction) {
        window.closeAction = settingsData.behavior.closeAction;
        if (window.appSettings?.behavior) {
            window.appSettings.behavior.closeAction = settingsData.behavior.closeAction;
        }
        console.log('关闭行为设置已应用:', settingsData.behavior.closeAction);
    }

    applyHardwareAcceleration(settingsData.behavior?.hardwareAcceleration !== false);
    console.log('所有设置应用完成');
}

// 全局函数：加载并应用设置（供其他模块使用）
window.loadAndApplySettings = async () => {
    await loadSettings();
    applyAllSettings();
};

// 保存设置数据
async function saveSettings() {
    try {
        const response = await SettingsService.SaveSettings(settingsData);
        if (response.success) {
            console.log('设置已保存:', response.message);

            // 更新前端全局设置缓存
            if (window.appSettings) {
                window.appSettings = { ...settingsData };
                console.log('前端设置缓存已更新:', window.appSettings);
            }

            // 如果有全局重新加载函数，也调用它确保同步
            if (window.reloadAppSettings) {
                await window.reloadAppSettings();
            }
        } else {
            console.error('保存设置失败:', response.message);
        }
    } catch (error) {
        console.error('保存设置失败:', error);
    }
}

// 渲染设置页面
function renderSettingsPage() {
    const container = document.querySelector('#settingsPage .settings-content');
    if (!container) return;

    container.innerHTML = `
        <!-- 播放设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-play"></i>
                播放设置
            </h3>
            
            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">自动播放</div>
                    <div class="settings-item-description">启动时自动播放上次的音乐</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.playback.autoPlay ? 'checked' : ''} 
                               onchange="updateSetting('playback.autoPlay', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">音量</div>
                    <div class="settings-item-description">默认播放音量</div>
                </div>
                <div class="settings-item-control">
                    <input type="range" class="settings-slider" min="0" max="100" 
                           value="${settingsData.playback.volume}"
                           onchange="updateSetting('playback.volume', parseInt(this.value))">
                    <span class="settings-value">${settingsData.playback.volume}%</span>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">无缝播放</div>
                    <div class="settings-item-description">歌曲间无停顿播放</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.playback.gaplessPlayback ? 'checked' : ''} 
                               onchange="updateSetting('playback.gaplessPlayback', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- 音质设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-music"></i>
                音质设置
            </h3>
            
            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">流媒体音质</div>
                    <div class="settings-item-description">在线播放时的音质</div>
                </div>
                <div class="settings-item-control">
                    <select class="settings-select" onchange="updateSetting('quality.streamingQuality', this.value)">
                        <option value="low" ${settingsData.quality.streamingQuality === 'low' ? 'selected' : ''}>标准 (128kbps)</option>
                        <option value="medium" ${settingsData.quality.streamingQuality === 'medium' ? 'selected' : ''}>高品质 (320kbps)</option>
                        <option value="high" ${settingsData.quality.streamingQuality === 'high' ? 'selected' : ''}>超高品质 (FLAC)</option>
                    </select>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">仅WiFi高音质</div>
                    <div class="settings-item-description">移动网络时自动降低音质</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.quality.wifiOnly ? 'checked' : ''} 
                               onchange="updateSetting('quality.wifiOnly', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- 界面设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-palette"></i>
                界面设置
            </h3>
            
            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">主题</div>
                    <div class="settings-item-description">选择应用主题</div>
                </div>
                <div class="settings-item-control">
                    <select class="settings-select" onchange="updateSetting('interface.theme', this.value)">
                        <option value="auto" ${settingsData.interface.theme === 'auto' ? 'selected' : ''}>跟随系统</option>
                        <option value="light" ${settingsData.interface.theme === 'light' ? 'selected' : ''}>浅色</option>
                        <option value="dark" ${settingsData.interface.theme === 'dark' ? 'selected' : ''}>深色</option>
                        <option value="frosted" ${settingsData.interface.theme === 'frosted' ? 'selected' : ''}>磨砂</option>
                        <option value="frosted-dark" ${settingsData.interface.theme === 'frosted-dark' ? 'selected' : ''}>磨砂黑</option>
                    </select>
                </div>
            </div>

            <div class="settings-item settings-font-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">界面字体</div>
                    <div class="settings-item-description">应用于界面文字与播放歌词</div>
                    <div class="settings-font-preview" id="fontPreview" style="font-family:${escapeAttr(fontFamilyCss(settingsData.interface.fontFamily))}">春江花月夜 · Aa 字体</div>
                </div>
                <div class="settings-item-control settings-font-control">
                    ${renderFontControl(settingsData.interface.fontFamily)}
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">显示歌词</div>
                    <div class="settings-item-description">播放时自动显示歌词</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.interface.showLyrics ? 'checked' : ''} 
                               onchange="updateSetting('interface.showLyrics', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">桌面歌词颜色</div>
                    <div class="settings-item-description">自定义桌面悬浮歌词的高亮显示颜色</div>
                </div>
                <div class="settings-item-control">
                    <div class="osd-color-controls">
                        <div class="osd-color-presets">
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '#38bdf8').toLowerCase() === '#38bdf8' ? 'active' : ''}" style="--swatch:#38bdf8;" data-color="#38bdf8" title="天空蓝" onclick="updateOsdColor('#38bdf8')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#10b981' ? 'active' : ''}" style="--swatch:#10b981;" data-color="#10b981" title="翡翠绿" onclick="updateOsdColor('#10b981')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#f59e0b' ? 'active' : ''}" style="--swatch:#f59e0b;" data-color="#f59e0b" title="日落橙" onclick="updateOsdColor('#f59e0b')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#ec4899' ? 'active' : ''}" style="--swatch:#ec4899;" data-color="#ec4899" title="樱花粉" onclick="updateOsdColor('#ec4899')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#8b5cf6' ? 'active' : ''}" style="--swatch:#8b5cf6;" data-color="#8b5cf6" title="极光紫" onclick="updateOsdColor('#8b5cf6')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#ef4444' ? 'active' : ''}" style="--swatch:#ef4444;" data-color="#ef4444" title="热情红" onclick="updateOsdColor('#ef4444')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#eab308' ? 'active' : ''}" style="--swatch:#eab308;" data-color="#eab308" title="明艳黄" onclick="updateOsdColor('#eab308')"></button>
                            <button type="button" class="osd-color-swatch ${(settingsData.interface.osdLyricsColor || '').toLowerCase() === '#ffffff' ? 'active' : ''}" style="--swatch:#ffffff;" data-color="#ffffff" title="珍珠白" onclick="updateOsdColor('#ffffff')"></button>
                        </div>
                        <div class="osd-color-picker-wrap">
                            <input type="color" class="osd-color-native-input" id="osdColorNativePicker" value="${settingsData.interface.osdLyricsColor || '#38bdf8'}" onchange="updateOsdColor(this.value)">
                            <span class="osd-color-code" id="osdColorCode">${settingsData.interface.osdLyricsColor || '#38bdf8'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">桌面歌词对齐</div>
                    <div class="settings-item-description">悬浮歌词在窗口中的水平对齐方式</div>
                </div>
                <div class="settings-item-control">
                    <div class="osd-align-controls" role="group" aria-label="桌面歌词对齐">
                        <button type="button" class="osd-align-btn ${(settingsData.interface.osdLyricsAlign || 'center') === 'left' ? 'active' : ''}" data-align="left" onclick="updateOsdAlign('left')">左对齐</button>
                        <button type="button" class="osd-align-btn ${(settingsData.interface.osdLyricsAlign || 'center') === 'center' ? 'active' : ''}" data-align="center" onclick="updateOsdAlign('center')">居中</button>
                        <button type="button" class="osd-align-btn ${(settingsData.interface.osdLyricsAlign || 'center') === 'right' ? 'active' : ''}" data-align="right" onclick="updateOsdAlign('right')">右对齐</button>
                    </div>
                </div>
            </div>

            <div class="settings-item settings-font-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">桌面歌词字体</div>
                    <div class="settings-item-description">仅作用于桌面悬浮歌词，不影响界面字体</div>
                    <div class="settings-font-preview" id="osdFontPreview" style="font-family:${escapeAttr(fontFamilyCss(settingsData.interface.osdLyricsFont || 'system'))}">春江花月夜 · 桌面歌词</div>
                </div>
                <div class="settings-item-control settings-font-control">
                    ${renderFontControl(settingsData.interface.osdLyricsFont || 'system', {
                        selectId: 'osdFontFamilySelect',
                        customId: 'osdFontFamilyCustom',
                        onChange: 'updateOsdFont',
                    })}
                </div>
            </div>
        </div>

        <!-- 下载设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-download"></i>
                下载设置
            </h3>
            
            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">下载路径</div>
                    <div class="settings-item-description">音乐文件保存位置</div>
                    ${settingsData.download.downloadPath ? `<div class="settings-path">${settingsData.download.downloadPath}</div>` : ''}
                </div>
                <div class="settings-item-control">
                    <button class="settings-button" onclick="selectDownloadPath()">选择文件夹</button>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">同时下载歌词</div>
                    <div class="settings-item-description">下载音乐时一并下载歌词文件</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.download.downloadLyrics ? 'checked' : ''} 
                               onchange="updateSetting('download.downloadLyrics', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- 应用行为设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-cogs"></i>
                应用行为
            </h3>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">关闭按钮行为</div>
                    <div class="settings-item-description">点击关闭按钮时的默认行为</div>
                </div>
                <div class="settings-item-control">
                    <select class="settings-select" onchange="updateSetting('behavior.closeAction', this.value)">
                        <option value="ask" ${settingsData.behavior.closeAction === 'ask' ? 'selected' : ''}>每次询问</option>
                        <option value="minimize" ${settingsData.behavior.closeAction === 'minimize' ? 'selected' : ''}>最小化到托盘</option>
                        <option value="exit" ${settingsData.behavior.closeAction === 'exit' ? 'selected' : ''}>直接退出</option>
                    </select>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">启动时最小化</div>
                    <div class="settings-item-description">应用启动时直接最小化到托盘</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.behavior.startMinimized ? 'checked' : ''}
                               onchange="updateSetting('behavior.startMinimized', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">硬件加速</div>
                    <div class="settings-item-description">默认开启，页面更流畅；若界面卡死或无法操作可关闭</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.behavior.hardwareAcceleration !== false ? 'checked' : ''}
                               onchange="updateSetting('behavior.hardwareAcceleration', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- 关于设置 -->
        <!-- 关于与更新 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-info-circle"></i>
                关于与更新
            </h3>

            <div class="settings-item">
                    <div class="settings-item-title">当前版本</div>
                    <div class="settings-item-description">lmPlayer 桌面音乐播放器</div>
                    <div class="settings-path" id="appVersionDisplay">v0.6.0</div>
                <div class="settings-item-control">
                    <button class="settings-button" id="checkUpdateBtn" onclick="checkForAppUpdates()">检查更新</button>
                </div>
            </div>
            <div id="updateStatusInfo" style="display: none; padding: 12px 16px; margin: 8px 0 16px 0; border-radius: 8px; font-size: 13px;"></div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">开源项目地址</div>
                    <div class="settings-item-description">访问 GitHub 仓库获取最新源码与讨论</div>
                    <div class="settings-path">github.com/lianchengwu/lmplayer</div>
                </div>
                <div class="settings-item-control">
                    <button class="settings-button" onclick="openExternalLink('https://github.com/lianchengwu/lmplayer')">访问 GitHub</button>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">设置文件位置</div>
                    <div class="settings-item-description">设置数据保存的文件路径</div>
                    <div class="settings-path" id="settingsPath">加载中...</div>
                </div>
                <div class="settings-item-control">
                    <button class="settings-button" onclick="showSettingsPath()">显示文件</button>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">导出设置</div>
                    <div class="settings-item-description">将当前设置导出为JSON文件</div>
                </div>
                <div class="settings-item-control">
                    <button class="settings-button" onclick="exportSettings()">导出</button>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">重置设置</div>
                    <div class="settings-item-description">恢复所有设置为默认值</div>
                </div>
                <div class="settings-item-control">
                    <button class="settings-button" onclick="resetSettings()">重置</button>
                </div>
            </div>
        </div>

        <!-- 隐私设置 -->
        <div class="settings-group">
            <h3 class="settings-group-title">
                <i class="fas fa-shield-alt"></i>
                隐私设置
            </h3>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">保存播放历史</div>
                    <div class="settings-item-description">记录您的播放历史</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.privacy.saveHistory ? 'checked' : ''}
                               onchange="updateSetting('privacy.saveHistory', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>

            <div class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">数据分析</div>
                    <div class="settings-item-description">帮助改善应用体验</div>
                </div>
                <div class="settings-item-control">
                    <label class="settings-switch">
                        <input type="checkbox" ${settingsData.privacy.analytics ? 'checked' : ''}
                               onchange="updateSetting('privacy.analytics', this.checked)">
                        <span class="settings-switch-slider"></span>
                    </label>
                </div>
            </div>
        </div>
    `;
}

function applyHardwareAcceleration(on) {
    fetch('/__window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'hwaccel', enabled: !!on }),
    }).catch((err) => console.error('应用硬件加速失败:', err));
}

// 更新设置项
window.updateSetting = async (path, value) => {
    const keys = path.split('.');
    let obj = settingsData;

    for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
    }

    obj[keys[keys.length - 1]] = value;
    await saveSettings();

    // 应用设置变更
    applySetting(path, value);

    console.log(`设置已更新: ${path} = ${value}`);
};

// 应用设置变更
function applySetting(path, value) {
    switch (path) {
        case 'interface.theme':
            applyTheme(value);
            break;
        case 'interface.fontFamily':
            applyFontFamily(value);
            syncFontPreview(value);
            break;
        case 'playback.volume':
            const volumeDisplay = document.querySelector('.settings-value');
            if (volumeDisplay) {
                volumeDisplay.textContent = value + '%';
            }
            if (typeof window.setVolume === 'function') {
                window.setVolume(value);
            } else if (window.UnifiedPlayerController?.setVolume) {
                window.UnifiedPlayerController.setVolume(value);
            }
            break;
        case 'behavior.closeAction':
            window.closeAction = value;
            if (window.appSettings?.behavior) {
                window.appSettings.behavior.closeAction = value;
            }
            break;
        case 'behavior.hardwareAcceleration':
            applyHardwareAcceleration(value);
            break;
        case 'interface.osdLyricsColor':
            applyOsdColor(value);
            break;
        case 'interface.osdLyricsAlign':
            applyOsdAlign(value);
            break;
        case 'interface.osdLyricsFont':
            applyOsdFont(value);
            syncFontPreview(value, 'osdFontPreview', 'osdFontFamilySelect');
            break;
    }
}
async function commitFontChoice(value, ids) {
    const custom = document.getElementById(ids.customId);
    const select = document.getElementById(ids.selectId);
    if (value === '__custom__') {
        if (custom) {
            custom.style.display = '';
            custom.focus();
        }
        return;
    }
    const typed = String(value ?? '').trim();
    if (!typed) {
        if (custom) custom.style.display = 'none';
        if (select) select.value = 'system';
        await window.updateSetting(ids.settingPath, 'system');
        return;
    }
    const fromCustom = custom && document.activeElement === custom;
    if (!fromCustom && custom) custom.style.display = 'none';
    await window.updateSetting(ids.settingPath, typed);
}

window.updateFontFamily = (value) => commitFontChoice(value, {
    customId: 'fontFamilyCustom',
    selectId: 'fontFamilySelect',
    settingPath: 'interface.fontFamily',
});

window.updateOsdFont = (value) => commitFontChoice(value, {
    customId: 'osdFontFamilyCustom',
    selectId: 'osdFontFamilySelect',
    settingPath: 'interface.osdLyricsFont',
});

async function applyOsdColor(color) {
    if (!color) return;
    try {
        const { SetOSDColor } = await import('./bindings/wmplayer/cacheservice.js');
        await SetOSDColor(color);
        console.log('✅ 桌面歌词颜色已同步到 OSD:', color);
    } catch (e) {
        console.warn('⚠️ 同步桌面歌词颜色失败:', e);
    }
}

window.updateOsdColor = async (color) => {
    if (!color) return;
    await window.updateSetting('interface.osdLyricsColor', color);
    const codeEl = document.getElementById('osdColorCode');
    if (codeEl) codeEl.textContent = color;
    const pickerEl = document.getElementById('osdColorNativePicker');
    if (pickerEl) pickerEl.value = color;
    document.querySelectorAll('.osd-color-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color.toLowerCase() === color.toLowerCase());
    });
};

function normalizeOsdAlign(align) {
    return align === 'left' || align === 'right' ? align : 'center';
}

async function applyOsdAlign(align) {
    const next = normalizeOsdAlign(align);
    document.querySelectorAll('.osd-align-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.align === next);
    });
    try {
        const { SetOSDAlign } = await import('./bindings/wmplayer/cacheservice.js');
        await SetOSDAlign(next);
    } catch (e) {
        console.warn('同步桌面歌词对齐失败:', e);
    }
}

async function applyOsdFont(font) {
    const family = String(font || 'system').trim() || 'system';
    try {
        const { SetOSDFont } = await import('./bindings/wmplayer/cacheservice.js');
        await SetOSDFont(family);
    } catch (e) {
        console.warn('同步桌面歌词字体失败:', e);
    }
}

window.updateOsdAlign = async (align) => {
    await window.updateSetting('interface.osdLyricsAlign', normalizeOsdAlign(align));
};

window.selectDownloadPath = async () => {
    try {
        const { SelectMusicFolder } = await import('./bindings/wmplayer/localmusicservice.js');
        const res = await SelectMusicFolder();
        if (res && res.success && res.path) {
            await window.updateSetting('download.downloadPath', res.path);
            renderSettingsPage();
        }
    } catch (error) {
        console.error('选择下载路径失败:', error);
    }
};

// 导出设置数据
window.exportSettings = () => {
    const dataStr = JSON.stringify(settingsData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'music-app-settings.json';
    link.click();
    
    URL.revokeObjectURL(url);
};

// 导入设置数据
window.importSettings = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            settingsData = { ...settingsData, ...imported };
            saveSettings();
            renderSettingsPage();
            console.log('设置导入成功');
        } catch (error) {
            console.error('设置导入失败:', error);
            alert('设置文件格式错误');
        }
    };
    reader.readAsText(file);
};

window.showSettingsPath = async () => {
    try {
        const response = await SettingsService.GetSettingsPath();
        const filePath = response.Data || response.data;
        if (filePath) {
            const { OpenFileFolder } = await import('./bindings/wmplayer/downloadservice.js');
            await OpenFileFolder(filePath);
        }
    } catch (error) {
        console.error('打开设置文件路径失败:', error);
    }
};

window.resetSettings = async () => {
    if (confirm('确定要重置所有设置吗？此操作不可撤销。')) {
        try {
            settingsData = structuredClone(DEFAULT_SETTINGS);
            await saveSettings();
            applyAllSettings();
            renderSettingsPage();
            alert('设置已重置为默认值');
        } catch (error) {
            console.error('重置设置失败:', error);
            alert('重置设置失败');
        }
    }
};

// 打开外部浏览器链接
window.openExternalLink = (url) => {
    try {
        if (Browser && Browser.OpenURL) {
            Browser.OpenURL(url);
        } else {
            window.open(url, '_blank');
        }
    } catch (e) {
        window.open(url, '_blank');
    }
};

// 检查应用更新
window.checkForAppUpdates = async () => {
    const btn = document.getElementById('checkUpdateBtn');
    const infoDiv = document.getElementById('updateStatusInfo');
    if (!btn || !infoDiv) return;

    btn.disabled = true;
    btn.textContent = '检查中...';
    infoDiv.style.display = 'block';
    infoDiv.style.background = 'var(--bg-secondary)';
    infoDiv.style.color = 'var(--text-secondary)';
    infoDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在向 GitHub 查询最新版本...';

    try {
        const res = await UpdateService.CheckForUpdates();
        btn.disabled = false;
        btn.textContent = '检查更新';
        renderUpdateStatus(infoDiv, res);
    } catch (err) {
        btn.disabled = false;
        btn.textContent = '检查更新';
        infoDiv.style.background = 'rgba(239, 68, 68, 0.1)';
        infoDiv.style.color = '#ef4444';
        infoDiv.style.border = '1px solid #ef4444';
        infoDiv.textContent = `检查失败: ${err.message || err}`;
    }
};

function renderUpdateStatus(infoDiv, res) {
    const success = res?.Success ?? res?.success;
    const hasUpdate = res?.HasUpdate ?? res?.hasUpdate;
    const latest = res?.LatestVersion ?? res?.latestVersion ?? '';
    const current = res?.CurrentVersion ?? res?.currentVersion ?? '';
    const notes = res?.ReleaseNotes ?? res?.releaseNotes ?? '';
    const url = res?.ReleaseURL ?? res?.releaseURL ?? res?.releaseUrl ?? '';
    const message = res?.Message ?? res?.message ?? '';

    infoDiv.replaceChildren();
    if (success && hasUpdate) {
        infoDiv.style.background = 'rgba(99, 102, 241, 0.1)';
        infoDiv.style.color = 'var(--accent-color)';
        infoDiv.style.border = '1px solid var(--accent-color)';
        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.marginBottom = '4px';
        title.textContent = `发现新版本 v${latest}（当前 v${current}）`;
        infoDiv.appendChild(title);
        if (notes) {
            const notesEl = document.createElement('div');
            notesEl.style.cssText = 'margin:6px 0;max-height:120px;overflow-y:auto;white-space:pre-wrap;opacity:0.85';
            notesEl.textContent = notes;
            infoDiv.appendChild(notesEl);
        }
        if (url) {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'settings-button';
            link.style.marginTop = '8px';
            link.textContent = '前往下载发布页';
            link.addEventListener('click', () => window.openExternalLink(url));
            infoDiv.appendChild(link);
        }
        return;
    }
    if (success) {
        infoDiv.style.background = 'rgba(34, 197, 94, 0.1)';
        infoDiv.style.color = '#22c55e';
        infoDiv.style.border = '1px solid #22c55e';
        infoDiv.textContent = `当前已是最新版本 (v${current || '未知'})`;
        return;
    }
    infoDiv.style.background = 'rgba(239, 68, 68, 0.1)';
    infoDiv.style.color = '#ef4444';
    infoDiv.style.border = '1px solid #ef4444';
    infoDiv.textContent = message || '检查更新失败';
}
