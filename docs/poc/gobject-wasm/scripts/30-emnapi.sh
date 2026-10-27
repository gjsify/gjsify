#!/bin/bash
# SPDX-License-Identifier: MIT
# Fetch emnapi (the N-API implementation for Emscripten) and build libemnapi.a.
#
# emnapi is what lets node-gi's unmodified N-API C++ stay unmodified: it provides
# napi_* on top of an Emscripten module instead of on top of Node's V8 embedding.
#
# Two things here are not "just install the package":
#
#  1. dist/library_napi.js is preprocessed by emscripten's JS macro pass and uses
#     getUnsharedTextDecoderView(), whose signature changed. Against emsdk 6.0.13
#     it expands wrong and every napi_get_value_string_* returns garbage. We
#     rewrite the two call sites to the plain subarray they are equivalent to in a
#     non-threaded build (no SharedArrayBuffer => the view is never shared).
#
#  2. There is no cmake/configure step: we compile the nine sources the runtime
#     actually needs and archive them. node-gi is built with NODE_GI_HAS_LIBUV=0,
#     but emnapi's own async_work/threadsafe_function still reference its vendored
#     libuv shims, so those come along.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
poc_activate

EN="$POC_ROOT/emnapi"
poc_log "emnapi $POC_EMNAPI_VERSION -> $EN"
mkdir -p "$EN" && cd "$EN"

fetch_pkg() { # <npm-name> <version> <dest-dir>
    local base="${1#@}"
    local tgz="${base//\//-}-$2.tgz" # npm pack names @scope/name as scope-name
    [ -f "$tgz" ] || npm pack "$1@$2" --silent >/dev/null
    [ -d "$3" ] || { mkdir -p "$3" && tar -C "$3" --strip-components=1 -xf "$tgz"; }
}

fetch_pkg emnapi "$POC_EMNAPI_VERSION" emnapi
fetch_pkg "@emnapi/core" "$POC_EMNAPI_VERSION" emnapi-core
fetch_pkg "@emnapi/runtime" "$POC_EMNAPI_VERSION" emnapi-runtime
fetch_pkg node-addon-api "${POC_NODE_ADDON_API_VERSION:-8.9.2}" node-addon-api

# (1) the getUnsharedTextDecoderView fix — see the header comment.
NAPI_JS="$EN/emnapi/dist/library_napi.js"
if [ ! -f "$EN/emnapi/dist/library_napi.orig.js" ]; then
    cp "$NAPI_JS" "$EN/emnapi/dist/library_napi.orig.js"
    sed -i "s/{{{ getUnsharedTextDecoderView('HEAPU8', 'ptr', 'end') }}}/HEAPU8.subarray(ptr, end)/g" "$NAPI_JS"
    grep -c 'HEAPU8.subarray(ptr, end)' "$NAPI_JS"
fi

# (2) libemnapi.a
cd "$EN/emnapi"
mkdir -p build
SOURCES=(
    src/async_cleanup_hook.c src/async_context.c src/async_work.c
    src/js_native_api.c src/node_api.c src/threadsafe_function.c
    src/uv/threadpool.c src/uv/unix/async.c src/uv/unix/core.c
)
OBJS=()
for s in "${SOURCES[@]}"; do
    o="build/$(echo "$s" | tr / _).o"
    emcc -O1 -fexceptions -I include/node -I src -c "$s" -o "$o"
    OBJS+=("$o")
done
emar rcs build/libemnapi.a "${OBJS[@]}"
ls -la build/libemnapi.a
