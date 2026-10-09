#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fmt --check
cargo test --locked
cargo clippy --all-targets -- -D warnings
cargo build --locked --release --lib --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/shift_core.wasm web/assets/shift_core.wasm
node --check web/app.js
node --check web/fixtures/frame.js
