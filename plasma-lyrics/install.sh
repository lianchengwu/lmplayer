#!/bin/bash
set -e

PLUGIN_ID="org.kde.plasma.wmplayer-lyrics"
PLASMOIDS_DIR="${HOME}/.local/share/plasma/plasmoids"
TARGET_DIR="${PLASMOIDS_DIR}/${PLUGIN_ID}"

echo "🚀 开始安装 wmPlayer KDE Plasma 歌词插件..."

# 确保目标目录存在
mkdir -p "${PLASMOIDS_DIR}"

# 移除旧版本
if [ -d "${TARGET_DIR}" ]; then
    echo "🗑️ 移除已有安装..."
    rm -rf "${TARGET_DIR}"
fi

# 复制文件
echo "📁 部署插件到: ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
cp -r metadata.json contents "${TARGET_DIR}/"

echo "🔄 刷新 Plasma 桌面缓存..."
if command -v kbuildsycoca6 &> /dev/null; then
    kbuildsycoca6 --noincremental || true
fi

echo "✅ 安装完成！你可以在 Plasma 桌面/任务栏中添加组件: [wmPlayer 歌词]"
