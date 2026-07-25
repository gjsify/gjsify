#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — fetch + source-build the addon matrix into this gitignored
# prefix. Idempotent: skips packages already built. Run from anywhere.
#
#   sh test/addons/setup.sh
#
# The four addons gegentested against the shim (see test/addon-matrix.mjs):
#   bufferutil, utf-8-validate  — node-gyp-build accelerators (ws), pure sync C
#   @node-rs/argon2             — napi-rs (Rust) addon, pure sync; ships the
#                                 compiled per-platform .node (napi-rs prebuilds
#                                 are genuine N-API, no local Rust build needed)
#   sqlite3                     — node-addon-api, ASYNC (napi_create_async_work)
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "==> installing addons into $DIR/node_modules"
npm init -y >/dev/null 2>&1 || true
npm i --prefix . --no-audit --no-fund \
    bufferutil@4 utf-8-validate@6 @node-rs/argon2 sqlite3@5

# Source-build the node-gyp addons so BOTH runtimes load the same .node.
for d in bufferutil utf-8-validate; do
    if [ ! -f "node_modules/$d/build/Release/"*.node ] 2>/dev/null; then
        echo "==> building $d from source"
        ( cd "node_modules/$d" && npm exec -- node-gyp rebuild --force_build=1 )
    fi
done

# node-sqlite3: build the N-API addon from source (amalgamation compile).
if [ ! -f node_modules/sqlite3/build/Release/node_sqlite3.node ]; then
    echo "==> building node-sqlite3 from source"
    ( cd node_modules/sqlite3 && npm exec -- node-gyp rebuild --force_build=1 )
fi

echo "==> done. Run the matrix with:  sh test/run-addon-matrix.sh"
