#!/usr/bin/env bash
set -e

# 设置变量
CONTRACT_NAME="bridge_core"
TARGET_DIR="target/wasm32-unknown-unknown/release"

echo "Building contract..."

# 编译 WASM
cargo build --release --target wasm32-unknown-unknown

# 检查 wasm-strip 是否存在（用于减小体积）
if command -v wasm-strip &> /dev/null; then
    echo "Stripping WASM..."
    wasm-strip "${TARGET_DIR}/${CONTRACT_NAME}.wasm"
else
    echo "Warning: wasm-strip not found. Skipping strip step."
    echo "To install: brew install wabt (on macOS) or apt install wabt (on Linux)"
fi

# 复制到方便的位置（可选）
mkdir -p bin
cp "${TARGET_DIR}/${CONTRACT_NAME}.wasm" bin/

echo "Build complete! Wasm file located at: bin/${CONTRACT_NAME}.wasm"

