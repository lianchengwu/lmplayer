#!/usr/bin/env bash
# wmPlayer Linux 安装脚本
#   ./install.sh              系统安装到 /usr/local（非 root 时自动 sudo）
#   ./install.sh /usr         指定安装前缀
#   ./install.sh --user       用户级安装到 ~/.local，无需 root
set -euo pipefail
cd "$(dirname "$0")"

APP_ID="com.wmplayer.app"

if [[ "${1:-}" == "--user" ]]; then
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
    BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
else
    PREFIX="${1:-/usr/local}"
    BIN_DIR="$PREFIX/bin"
    DATA_DIR="$PREFIX/share"
    if [[ $EUID -ne 0 && $PREFIX != "$HOME"* ]]; then
        exec sudo "$0" "$@"
    fi
fi

install -Dm755 wmplayer "$BIN_DIR/wmplayer"
install -Dm644 "$APP_ID.desktop" "$DATA_DIR/applications/$APP_ID.desktop"
install -Dm644 "$APP_ID.png" "$DATA_DIR/icons/hicolor/256x256/apps/$APP_ID.png"

command -v update-desktop-database >/dev/null \
    && update-desktop-database -q "$DATA_DIR/applications" || true
command -v gtk-update-icon-cache >/dev/null \
    && gtk-update-icon-cache -q "$DATA_DIR/icons/hicolor" || true

echo "✅ wmplayer 已安装: $BIN_DIR/wmplayer"
echo "   应用菜单入口:  $DATA_DIR/applications/$APP_ID.desktop"
