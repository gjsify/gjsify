#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — better-sqlite3 MEMORY LEG (valgrind memcheck; plan §10).
#
#   cd packages/napi/napi && sh test/consumer-mem.sh
#
# Builds the GJS mem-loop (test/consumer-mem-loop.mjs) with the same
# @gjsify/napi node-addon resolver the consumer gate uses, then runs it under
# valgrind through a load->workout->exit loop. better-sqlite3 exercises the
# wrap/type-tag/finalizer paths hard; the process exit runs env teardown, where
# a wrap/ref/finalizer UAF would surface. Leak checking is OFF (the GJS runtime
# holds still-reachable state at exit, and kUserland refs leak by Node-parity
# design) — the focus is memory ERRORS (invalid read/write/UAF/double-free).
# --error-exitcode makes any invalid access fail the leg. Mirrors p04-mem.sh.
set -eu
cd "$(dirname "$0")/.."

PKG="$(pwd)"
ROOT="$(cd "$PKG/../../.." && pwd)"
CLI="$ROOT/packages/infra/cli/lib/index.js"
CONSUMER="$PKG/test/consumer"
BSQ="$CONSUMER/node_modules/better-sqlite3"
ADDON="$BSQ/build/Release/better_sqlite3.node"
PREBUILDS="$BSQ/prebuilds"
RESOLVER="$PKG/test/consumer-node-resolver.mjs"
PREBUILD_DIR="$PKG/prebuilds/linux-x64"
TMP="$(mktemp -d)"
BUNDLE="$TMP/mem-loop.gjs.mjs"
RC="$CONSUMER/.gjsifyrc.mjs"

[ -f "$ADDON" ] || { echo "CONSUMER-MEM FAIL: addon not built at $ADDON" >&2; exit 1; }
[ -f "$PKG/lib/esm/index.js" ] || node "$CLI" build --library 'src/ts/**/*.{ts,js}'

cleanup() {
    rm -f "$RC" || true
    [ -d "$PREBUILDS.disabled" ] && mv "$PREBUILDS.disabled" "$PREBUILDS" || true
    rm -rf "$TMP" || true
}
trap cleanup EXIT INT TERM

# Ephemeral resolver config + force the source-built .node (disable prebuild).
printf 'import { nodeAddonResolver } from %s;\nexport default { bundler: { plugins: [nodeAddonResolver({ addonPath: %s })] } };\n' \
    "\"$RESOLVER\"" "\"$ADDON\"" > "$RC"
[ -d "$PREBUILDS" ] && mv "$PREBUILDS" "$PREBUILDS.disabled" || true

echo "== building mem-loop bundle =="
( cd "$CONSUMER" && node "$CLI" build "$PKG/test/consumer-mem-loop.mjs" --app gjs \
    --outfile "$BUNDLE" --alias "better-sqlite3=$BSQ/lib/index.js" )
[ -f "$BUNDLE" ] || { echo "CONSUMER-MEM FAIL: no bundle" >&2; exit 1; }

VG="valgrind --tool=memcheck --leak-check=no --error-exitcode=42 --errors-for-leak-kinds=none"

echo "== leg: better-sqlite3 load -> workout loop -> exit (under GJS + shim) =="
env GJS_DISABLE_JIT=1 GI_TYPELIB_PATH="$PREBUILD_DIR" LD_LIBRARY_PATH="$PREBUILD_DIR" \
    $VG --log-file="$TMP/mem.vg.log" \
    gjs -m "$BUNDLE" 20
cp "$TMP/mem.vg.log" /tmp/consumer-mem.vg.log
grep -E "ERROR SUMMARY" "$TMP/mem.vg.log"
grep -q "ERROR SUMMARY: 0 errors" "$TMP/mem.vg.log" || {
    echo "CONSUMER-MEM FAIL: leg reported memory errors (see /tmp/consumer-mem.vg.log)" >&2
    exit 1
}
echo "CONSUMER MEM LEG: CLEAN (0 memcheck errors)"
