#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — run the whole real-addon matrix (test/addon-matrix.mjs) through
# the generic gate. Every addon must be byte-identical PASS (gate exit 0),
# including node-sqlite3: its Napi::AsyncWorker flow now completes through the
# implemented napi_create/queue/complete_async_work path (was a FINDING while
# async_work was a loud stub). Any other outcome fails the matrix.
#
#   sh test/run-addon-matrix.sh
# Prereq: sh test/addons/setup.sh   (vendors + source-builds the four addons)
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # packages/napi/napi
cd "$DIR"

# The gate self-resolves the Node CLI entry (in-tree, or beside a symlinked
# node_modules in a git worktree). GJSIFY_CLI_ENTRY overrides if exported.

# sqlite3 is the async (async_work) addon; the three others are pure sync C.
ADDONS="bufferutil utf-8-validate argon2 sqlite3"   # expect gate exit 0 (PASS)
fail=0

for a in $ADDONS; do
    node test/addon-gate.mjs "$a"; rc=$?
    if [ "$rc" -ne 0 ]; then echo "MATRIX: $a expected PASS(0) got $rc"; fail=1; fi
done

if [ "$fail" -eq 0 ]; then
    echo "ADDON MATRIX: PASS (4 byte-identical, incl. node-sqlite3 async_work)"
    exit 0
fi
echo "ADDON MATRIX: FAIL"
exit 1
