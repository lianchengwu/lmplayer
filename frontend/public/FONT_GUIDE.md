# 字体使用指南

## 📖 概述

本音乐应用采用了完整的字体管理系统，提供了多种字体选择和使用方式，确保在不同场景下都有最佳的显示效果。

## 🎯 字体分类

### 1. 主要字体栈

#### 主界面字体 (`--font-primary`)
```css
font-family: "Inter", "Source Han Sans CN", -apple-system, BlinkMacSystemFont, 
             "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", 
             "Helvetica Neue", Arial, sans-serif;
```
- **用途**: 界面文字、按钮、菜单等
- **特点**: 现代、简洁、易读

#### 音乐专用字体 (`--font-music`)
```css
font-family: "Poppins", "Source Han Sans CN", -apple-system, BlinkMacSystemFont,
             "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
             "Helvetica Neue", Arial, sans-serif;
```
- **用途**: 歌曲标题、艺术家名称、音乐相关内容
- **特点**: 友好、温暖、音乐感

#### 等宽字体 (`--font-mono`)
```css
font-family: "JetBrains Mono", "SF Mono", Monaco, "Cascadia Code", "Roboto Mono",
             Consolas, "Courier New", monospace;
```
- **用途**: 文件路径、代码、数据显示
- **特点**: 等宽、清晰、专业

#### 中文优先字体 (`--font-chinese`)
```css
font-family: "Source Han Sans CN", "PingFang SC", "Hiragino Sans GB", 
             "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
```
- **用途**: 中文歌词、中文内容
- **特点**: 中文显示优化

## 📏 字体大小系统

| 变量名 | 大小 | 像素值 | 用途 |
|--------|------|--------|------|
| `--font-size-xs` | 0.75rem | 12px | 版权信息、细节文字 |
| `--font-size-sm` | 0.875rem | 14px | 按钮文字、标签 |
| `--font-size-base` | 1rem | 16px | 正文内容 |
| `--font-size-lg` | 1.125rem | 18px | 重要信息 |
| `--font-size-xl` | 1.25rem | 20px | 歌曲标题 |
| `--font-size-2xl` | 1.5rem | 24px | 页面标题 |
| `--font-size-3xl` | 1.875rem | 30px | 大标题 |
| `--font-size-4xl` | 2.25rem | 36px | 超大标题 |

## ⚖️ 字重系统

| 变量名 | 数值 | 用途 |
|--------|------|------|
| `--font-weight-light` | 300 | 轻量文字 |
| `--font-weight-normal` | 400 | 正常文字 |
| `--font-weight-medium` | 500 | 中等强调 |
| `--font-weight-semibold` | 600 | 半粗体 |
| `--font-weight-bold` | 700 | 粗体 |

## 🎨 使用方法

### 1. CSS 变量方式
```css
.element {
    font-family: var(--font-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
}
```

### 2. CSS 类方式
```html
<!-- 字体类型 -->
<div class="font-primary">主界面字体</div>
<div class="font-music">音乐字体</div>
<div class="font-mono">等宽字体</div>
<div class="font-chinese">中文字体</div>

<!-- 字体大小 -->
<div class="text-xs">超小文字</div>
<div class="text-sm">小文字</div>
<div class="text-base">基础文字</div>
<div class="text-lg">大文字</div>

<!-- 字重 -->
<div class="font-light">轻字重</div>
<div class="font-normal">正常字重</div>
<div class="font-medium">中等字重</div>
<div class="font-semibold">半粗字重</div>
<div class="font-bold">粗字重</div>

<!-- 组合使用 -->
<div class="font-music text-xl font-semibold">歌曲标题</div>
```

### 3. 特定用途类
```html
<div class="title-font">页面标题</div>
<div class="song-title-font">歌曲名称</div>
<div class="artist-font">艺术家名称</div>
<div class="path-font">文件路径</div>
<div class="lyrics-font">歌词内容</div>
<div class="button-font">按钮文字</div>
<div class="code-font">代码内容</div>
```

## 🎵 音乐应用场景

### 歌曲信息显示
```html
<div class="song-info">
    <div class="song-title-font text-xl font-semibold">歌曲名称</div>
    <div class="artist-font text-sm font-normal">艺术家</div>
</div>
```

### 歌词显示
```html
<div class="lyrics-container">
    <div class="lyrics-font text-lg leading-relaxed">歌词内容</div>
</div>
```

### 文件路径显示
```html
<div class="path-font text-sm">/path/to/music/file.mp3</div>
```

## 📁 字体文件管理

### 字体文件位置
```
frontend/public/fonts/
├── Inter-Light.woff2
├── Inter-Regular.woff2
├── Inter-Medium.woff2
├── Inter-SemiBold.woff2
├── Inter-Bold.woff2
├── Poppins-Light.woff2
├── Poppins-Regular.woff2
├── Poppins-Medium.woff2
├── Poppins-SemiBold.woff2
├── JetBrainsMono-Regular.woff2
├── JetBrainsMono-Medium.woff2
├── SourceHanSansCN-Regular.woff2
└── SourceHanSansCN-Medium.woff2
```

### 字体加载优化
- 使用 `font-display: swap` 确保文字快速显示
- 提供多种格式 (woff2, woff, ttf) 确保兼容性
- 使用 `local()` 优先使用系统字体
- 合理的字体回退栈

## 🔧 自定义字体

### 添加新字体
1. 将字体文件放入 `frontend/public/fonts/` 目录
2. 在 `fonts.css` 中添加 `@font-face` 定义
3. 更新相应的字体变量
4. 创建对应的CSS类

### 示例：添加新字体
```css
@font-face {
    font-family: "CustomFont";
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: local("CustomFont Regular"), local("CustomFont-Regular"),
         url("./fonts/CustomFont-Regular.woff2") format("woff2"),
         url("./fonts/CustomFont-Regular.woff") format("woff");
}

:root {
    --font-custom: "CustomFont", var(--font-primary);
}

.font-custom {
    font-family: var(--font-custom);
}
```

## 🎨 主题适配

字体系统与主题系统完全兼容：
- 浅色主题：使用深色文字
- 深色主题：使用浅色文字
- 磨砂主题：优化对比度
- 磨砂黑主题：增强可读性

## 📱 响应式考虑

虽然应用不支持小屏幕，但字体系统仍然考虑了不同屏幕密度：
- 高DPI屏幕优化
- 字体平滑渲染
- 合适的字体大小比例

## 🔍 测试和验证

访问 `/font-test.html` 查看完整的字体系统演示，包括：
- 所有字体类型展示
- 字体大小对比
- 字重效果
- 音乐应用场景
- 不同主题下的效果

## 💡 最佳实践

1. **语义化使用**: 根据内容类型选择合适的字体
2. **一致性**: 同类内容使用相同的字体设置
3. **可读性**: 确保足够的对比度和合适的字体大小
4. **性能**: 只加载必要的字体文件
5. **回退**: 始终提供合适的字体回退方案

## 🚀 未来扩展

字体系统设计为可扩展的，可以轻松添加：
- 新的字体类型
- 更多字体大小
- 特殊效果字体
- 动态字体加载
- 用户自定义字体
