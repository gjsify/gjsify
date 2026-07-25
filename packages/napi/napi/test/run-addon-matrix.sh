#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — run the whole real-addon matrix (test/addon-matrix.mjs) through
# the generic gate. Sync addons must be byte-identical PASS (gate exit 0); the
# async addon (node-sqlite3) is EXPECTED to fail at the async_work boundary
# (gate exit 2 = FINDING). Any other outcome fails the matrix.
#
#   sh test/run-addon-matrix.sh
# Prereq: sh test/addons/setup.sh   (vendors + source-builds the four addons)
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # packages/napi/napi
cd "$DIR"

# The gate self-resolves the Node CLI entry (in-tree, or beside a symlinked
# node_modules in a git worktree). GJSIFY_CLI_ENTRY overrides if exported.

SYNC="bufferutil utf-8-validate argon2"   # expect gate exit 0 (PASS)
ASYNC="sqlite3"                            # expect gate exit 2 (FINDING)
fail=0

for a in $SYNC; do
    node test/addon-gate.mjs "$a"; rc=$?
    if [ "$rc" -ne 0 ]; then echo "MATRIX: $a expected PASS(0) got $rc"; fail=1; fi
done
for a in $ASYNC; do
    node test/addon-gate.mjs "$a"; rc=$?
    if [ "$rc" -ne 2 ]; then echo "MATRIX: $a expected FINDING(2) got $rc"; fail=1; fi
done

if [ "$fail" -eq 0 ]; then
    echo "ADDON MATRIX: PASS (3 sync byte-identical, 1 async FINDING as expected)"
    exit 0
fi
echo "ADDON MATRIX: FAIL"
exit 1
