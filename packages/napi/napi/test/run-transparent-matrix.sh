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
# Must-pass (gate exit 0): bufferutil + utf-8-validate (node-gyp-build) and
# sqlite3 (bindings) — the C/C++ must-have. argon2 (napi-rs) is a documented
# FINDING (gate exit 2): the .node IS auto-located, but the napi-rs generated
# loader body doesn't survive `--app gjs` (entry-replacement deferred — see the
# matrix entry + napi-node-addon.ts TODO).
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)" # packages/napi/napi
cd "$DIR"

MUST_PASS="bufferutil utf-8-validate sqlite3"
FINDINGS="argon2"
fail=0

for a in $MUST_PASS; do
    node test/transparent-gate.mjs "$a"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "TRANSPARENT MATRIX: $a expected PASS(0) got $rc"
        fail=1
    fi
done

for a in $FINDINGS; do
    node test/transparent-gate.mjs "$a"
    rc=$?
    if [ "$rc" -eq 0 ]; then
        echo "TRANSPARENT MATRIX: $a unexpectedly PASSED (0) — napi-rs now transparent? update the matrix/TODO"
    elif [ "$rc" -eq 2 ]; then
        echo "TRANSPARENT MATRIX: $a FINDING(2) as expected (napi-rs generated loader deferred)"
    else
        echo "TRANSPARENT MATRIX: $a expected FINDING(2) got $rc"
        fail=1
    fi
done

if [ "$fail" -eq 0 ]; then
    echo "TRANSPARENT MATRIX: PASS (3 byte-identical via auto-resolution: node-gyp-build ×2 + bindings; napi-rs = FINDING)"
    exit 0
fi
echo "TRANSPARENT MATRIX: FAIL"
exit 1
