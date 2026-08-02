#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — conformance memory leg (valgrind memcheck).
#
#   cd packages/napi/napi && sh scripts/conformance-mem.sh
#
# Builds every conformance addon (node-gyp), then runs a GC-stressed
# load→run→exit loop over several UNMODIFIED Node N-API test addons under
# valgrind. Focus: memory ERRORS (invalid read/write/UAF) across repeated
# addon exercise + forced GC — the crash class the shim must never hit. Leak
# checking is OFF (the GJS runtime + Node-parity never-freed userland refs are
# still-reachable at exit, so leak signal would be all noise, exactly as in
# test/p03-mem.sh). GJS_DISABLE_JIT avoids JIT false positives under valgrind.
set -eu
cd "$(dirname "$0")/.."

# 1) Ensure the addons are built (node-gyp) — idempotent/cached.
node scripts/conformance.mjs --build-only >/dev/null

# The per-target package, a SIBLING of this one since ADR 0017: @gjsify/napi
# ships no prebuilds/ of its own, so a consumer downloads only the binary their
# machine can load. Same directory `scripts/conformance.mjs` pins.
PRE=../napi-linux-x64/prebuilds/linux-x64
VG="valgrind --tool=memcheck --leak-check=no --error-exitcode=42 --errors-for-leak-kinds=none"
LOG=/tmp/conformance-mem.vg.log

echo "== conformance load -> run -> exit loop under valgrind =="
env GJS_DISABLE_JIT=1 GI_TYPELIB_PATH="$PRE" LD_LIBRARY_PATH="$PRE" \
    $VG --log-file="$LOG" \
    gjs -m conformance/mem-loop.mjs

grep -E "ERROR SUMMARY" "$LOG"
grep -q "ERROR SUMMARY: 0 errors" "$LOG" || {
    echo "CONFORMANCE MEM FAIL: valgrind reported memory errors (see $LOG)" >&2
    exit 1
}
echo "CONFORMANCE MEM: CLEAN (0 memcheck errors)"
