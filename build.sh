#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

npm run build --prefix frontend
cargo build --release --bin wmplayer

# Linux 打包：二进制 + desktop 入口 + 图标 + install.sh
if [[ "$(uname)" == "Linux" ]]; then
    pkg=dist/wmplayer-linux-amd64
    rm -rf "$pkg"
    mkdir -p "$pkg"
    cp target/release/wmplayer "$pkg/wmplayer"
    cp packaging/linux/com.wmplayer.app.desktop \
       packaging/linux/com.wmplayer.app.png \
       packaging/linux/install.sh "$pkg/"
    chmod +x "$pkg/install.sh"
    tar -C dist -czvf wmplayer-linux-amd64.tar.gz wmplayer-linux-amd64
    echo "packaged: $(pwd)/wmplayer-linux-amd64.tar.gz"
fi

echo "built: $(pwd)/target/release/wmplayer"
