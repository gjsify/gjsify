#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — run the real-addon matrix through the TRANSPARENT gate
# (test/transparent-gate.mjs): prove `napiNodeAddonPlugin` auto-resolves each
# addon's compiled `.node` (no hand-pinned addonPath) and that GJS-under-shim is
# byte-identical to Node. The forward mirror of `gjsGiNodePlugin`.
#
#   sh test/run-transparent-matrix.sh
# Prereq: sh test/addons/setup.sh   (vendors + source-builds the addons)
#
# Must-pass (gate exit 0), all byte-identical via transparent auto-resolution:
# bufferutil + utf-8-validate (node-gyp-build) + sqlite3 (bindings) — the C/C++
# addons — AND argon2 (napi-rs), whose GENERATED loader is now ENTRY-REPLACED
# (`napiNodeAddonPlugin` detects the native `index.js` and swaps it for
# `module.exports = loadAddon(<abs .node>)`; see the matrix entry).
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)" # packages/napi/napi
cd "$DIR"

MUST_PASS="bufferutil utf-8-validate sqlite3 argon2"
fail=0

for a in $MUST_PASS; do
    node test/transparent-gate.mjs "$a"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "TRANSPARENT MATRIX: $a expected PASS(0) got $rc"
        fail=1
    fi
done

if [ "$fail" -eq 0 ]; then
    echo "TRANSPARENT MATRIX: PASS (4 byte-identical via auto-resolution: node-gyp-build ×2 + bindings + napi-rs entry-replacement)"
    exit 0
fi
echo "TRANSPARENT MATRIX: FAIL"
exit 1
