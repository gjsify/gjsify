#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Build and run every web-worker spike reproducer, GJS first, then Node.
#
#   docs/poc/web-worker/scripts/run-all.sh            # everything
#   docs/poc/web-worker/scripts/run-all.sh 01 05      # only those
#
# Comlink is fetched from the npm registry into $POC_ROOT rather than added as
# a repo dependency: this is a spike, and a devDependency would outlive it.
set -euo pipefail

POC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$POC_DIR/../../.." && pwd)"
POC_ROOT="${POC_ROOT:-$HOME/.cache/gjsify-web-worker-poc}"
OUT="$POC_DIR/out"
COMLINK_VERSION="${COMLINK_VERSION:-4.4.2}"

mkdir -p "$POC_ROOT" "$OUT"

# ---------------------------------------------------------------- comlink ----
COMLINK_PKG="$POC_ROOT/package"
if [[ ! -f "$COMLINK_PKG/dist/esm/comlink.mjs" ]]; then
    echo "==> fetching comlink $COMLINK_VERSION into $POC_ROOT"
    curl -fsSL -o "$POC_ROOT/comlink.tgz" \
        "https://registry.npmjs.org/comlink/-/comlink-$COMLINK_VERSION.tgz"
    tar -xzf "$POC_ROOT/comlink.tgz" -C "$POC_ROOT"
fi

export COMLINK_ESM="$COMLINK_PKG/dist/esm/comlink.mjs"
export COMLINK_NODE_ADAPTER="$COMLINK_PKG/dist/umd/node-adapter.js"

# The GJS worker fixture is raw .mjs and cannot see $POC_ROOT, so it imports
# comlink through a gitignored relative copy.
mkdir -p "$POC_DIR/src/vendor"
cp -f "$COMLINK_ESM" "$POC_DIR/src/vendor/comlink.mjs"

# want <id> [selection...] — true when the selection is empty or names <id>.
# The emptiness test must come AFTER the shift: <id> is always passed, so a
# check on the unshifted $# is a check on <id>, and a bare run skips every case.
# A selection entry matches a leading number too ("01" picks 01-wire-roundtrip),
# which is how the usage line above advertises it.
want() {
    local id="$1"
    shift
    [[ $# -eq 0 ]] && return 0
    for arg in "$@"; do [[ "$id" == "$arg" || "$id" == "$arg"-* ]] && return 0; done
    return 1
}

SELECT=("$@")

run_gjs() {
    local id="$1" src="$2"
    want "$id" "${SELECT[@]}" || return 0
    echo
    echo "=== $id (gjs) ==="
    (cd "$REPO_ROOT" && gjsify build "$src" --app gjs --outfile "$OUT/$id.gjs.mjs" >/dev/null)
    # `gjsify run` echoes a multi-kilobyte GI_TYPELIB_PATH/LD_LIBRARY_PATH line.
    (cd "$REPO_ROOT" && gjsify run "$OUT/$id.gjs.mjs" 2>&1) \
        | grep -avE 'GI_TYPELIB_PATH|LD_LIBRARY_PATH|^\s*$' || true
}

run_gjs 01-wire-roundtrip docs/poc/web-worker/src/01-wire-roundtrip.mts
run_gjs 02-payload-cost   docs/poc/web-worker/src/02-payload-cost.mts
run_gjs 03-ready-buffer   docs/poc/web-worker/src/03-ready-buffer.mts
run_gjs 04-worker-death   docs/poc/web-worker/src/04-worker-death.mts
run_gjs 05-comlink-gjs    docs/poc/web-worker/src/05-comlink-gjs.mts

if want 06 "${SELECT[@]}"; then
    echo
    echo "=== 06-comlink-node (node) ==="
    node "$POC_DIR/src/06-comlink-node.mjs" || true
fi

# ---------------------------------------------------- 07: bundler behaviour ---
if want 07 "${SELECT[@]}"; then
    echo
    echo "=== 07-bundler (build only) ==="
    rm -rf "$OUT/07-bundler"
    mkdir -p "$OUT/07-bundler"
    (cd "$REPO_ROOT" && gjsify build docs/poc/web-worker/src/07-bundler/main.mts \
        --app gjs --outfile "$OUT/07-bundler/main.gjs.mjs" 2>&1 | tail -5) || true

    echo "emitted files:"
    find "$OUT/07-bundler" -type f -printf '  %p (%s bytes)\n' | sort

    local_bundle="$OUT/07-bundler/main.gjs.mjs"
    if [[ -f "$local_bundle" ]]; then
        # The bundle is minified onto one line, so grep -o for a window around
        # the reference instead of printing the matching line.
        echo "what happened to the new URL():"
        grep -aoE '.{0,40}compute\.worker.{0,60}' "$local_bundle" | sed 's/^/  /' | head -5 \
            || echo "  (no compute.worker reference in the bundle)"
        if grep -aq 'GJSIFY_WORKER_ENTRY_MARKER' "$local_bundle"; then
            echo "VERDICT: worker module INLINED into the parent bundle (outcome 3)"
        elif find "$OUT/07-bundler" -name '*worker*' -type f | grep -aqv main; then
            echo "VERDICT: worker emitted as its own entry (outcome 1) — #2338 already done"
        else
            echo "VERDICT: URL left verbatim, no worker entry emitted (outcome 2) — #2338 open"
        fi
    fi
fi

echo
echo "done. Write-up: docs/reports/2026-10-30-web-worker-and-comlink-on-gjs.md"
