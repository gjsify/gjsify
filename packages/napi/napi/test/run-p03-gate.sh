#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — P0.3 gate runner: runs the GJS driver and asserts the
# TEARDOWN-TIME output ordering that prints AFTER the script ended
# (cleanup-hook LIFO, exactly-once finalization, removed hook absent).
#
#   cd packages/napi/napi && sh test/run-p03-gate.sh
set -eu
cd "$(dirname "$0")/.."

OUT=$(GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 30 gjs test/p03-gate.js 2>&1)
printf '%s\n' "$OUT"

fail() { echo "RUN-P03-GATE FAIL: $1" >&2; exit 1; }
count() { printf '%s\n' "$OUT" | grep -c "^$1\$" || true; }

printf '%s\n' "$OUT" | grep -q "P0.3 GATE: PASS" || fail "in-process gate did not pass"

# Cleanup hooks: LIFO order 102,101,100; removed hook 103 must NOT run.
printf '%s\n' "$OUT" | tr '\n' ' ' | grep -q "CLEANUP 102 CLEANUP 101 CLEANUP 100" \
    || fail "cleanup hooks not LIFO (expected 102 101 100)"
[ "$(count 'CLEANUP 103')" = "0" ] || fail "removed cleanup hook 103 ran"

# Exactly-once finalization: GC-death finalizers (11,21,31,41) once each,
# NOT again at teardown; teardown finalizers (61 alive wrap, 52 instance
# data) exactly once; 51 (overwritten instance data) never.
for id in 11 21 31 41 61 52; do
    [ "$(count "FINALIZE $id")" = "1" ] || fail "FINALIZE $id ran $(count "FINALIZE $id") times (want 1)"
done
[ "$(count 'FINALIZE 51')" = "0" ] || fail "overwritten instance data 51 was finalized"

# Teardown completed for both envs before JS_DestroyContext.
printf '%s\n' "$OUT" | grep -q "2 env(s) torn down before JS_DestroyContext" \
    || fail "env teardown line missing"

echo "RUN-P03-GATE: PASS (in-process + teardown ordering)"
