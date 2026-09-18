#!/bin/bash
set -e

PLUGIN_ID="org.kde.plasma.wmplayer-lyrics"
TARGET_DIR="${HOME}/.local/share/plasma/plasmoids/${PLUGIN_ID}"

echo "🗑️ 卸载 wmPlayer KDE Plasma 歌词插件..."

if [ -d "${TARGET_DIR}" ]; then
    rm -rf "${TARGET_DIR}"
    echo "✅ 插件目录已移除: ${TARGET_DIR}"
else
    echo "ℹ️ 未发现已安装的插件目录。"
fi

if command -v kbuildsycoca6 &> /dev/null; then
    kbuildsycoca6 --noincremental || true
fi

echo "👋 卸载完成！"
