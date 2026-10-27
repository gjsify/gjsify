#!/bin/bash
# SPDX-License-Identifier: MIT
# Shared settings for the GObject-in-Wasm prototype build. Source this, never run it.
#
# Everything lands under $POC_ROOT, which is deliberately OUTSIDE the repo: the
# toolchain and the sysroot are ~2 GB of build output and none of it is tracked.
set -euo pipefail

POC_ROOT="${POC_ROOT:-$HOME/.cache/gjsify-wasm}"
POC_SYSROOT="$POC_ROOT/sysroot"      # wasm32 libs + headers + .pc files
POC_OUT="${POC_OUT:-$POC_ROOT/out}"  # node_gi.mjs / node_gi.wasm / emnapi.mjs
POC_EMSDK="$POC_ROOT/emsdk"
POC_EMSDK_VERSION="${POC_EMSDK_VERSION:-6.0.13}"
POC_GLIB_VERSION="${POC_GLIB_VERSION:-2.90.1}"
POC_EMNAPI_VERSION="${POC_EMNAPI_VERSION:-1.11.3}"
# libffi must be git master: the wasm32 backend (src/wasm/ffi.c) is newer than 3.5.
POC_LIBFFI_REF="${POC_LIBFFI_REF:-master}"

# The worktree this PoC lives in — node-gi's C++ sources are read from here.
POC_REPO="${POC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
POC_NODE_GI="$POC_REPO/packages/node-gi/node-gi"
POC_DIR="$POC_REPO/docs/poc/gobject-wasm"

export POC_ROOT POC_SYSROOT POC_OUT POC_EMSDK POC_REPO POC_NODE_GI POC_DIR

# Every script needs the toolchain on PATH and pkg-config pointed at OUR sysroot,
# never the host's /usr/lib64/pkgconfig.
poc_activate() {
    # shellcheck disable=SC1091
    source "$POC_EMSDK/emsdk_env.sh" >/dev/null 2>&1
    export PKG_CONFIG_LIBDIR="$POC_SYSROOT/lib/pkgconfig"
}

# pkg-config for a static wasm link. The `-pthread` strip is load-bearing: GLib's
# .pc files carry it unconditionally, and passing it to a non-threaded link fails
# with `wasm-ld: error: --shared-memory is disallowed by <x>.c.o`. See the report's
# "single-threaded" section for why the prototype stays off threads.
poc_pkgconfig() {
    pkg-config "$@" | sed 's/-pthread//g'
}

poc_log() { printf '\n==> %s\n' "$*"; }
