#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

npm run build --prefix frontend
cargo build --release --bin wmplayer

echo "built: $(pwd)/target/release/wmplayer"
