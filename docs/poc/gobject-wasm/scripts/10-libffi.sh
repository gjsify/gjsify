#!/bin/bash
# SPDX-License-Identifier: MIT
# Build libffi for wasm32-emscripten.
#
# Upstream git master, NOT a release and NOT a fork: libffi gained a real wasm32
# backend (src/wasm/ffi.c) after 3.5, which implements closures with EM_JS on top
# of the function table. That is the single capability the whole prototype rests
# on — GObject introspection cannot call a JS callback without a closure.
#
# A consumer of these closures must link with:
#   -sALLOW_TABLE_GROWTH -sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction
# 40-node-gi.sh does; a standalone probe has to do it itself.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
poc_activate

SRC="$POC_ROOT/libffi"
poc_log "libffi ($POC_LIBFFI_REF) -> $POC_SYSROOT"

if [ ! -d "$SRC/.git" ]; then
    git clone https://github.com/libffi/libffi.git "$SRC"
fi
cd "$SRC"
git fetch origin
git checkout "$POC_LIBFFI_REF"
git log -1 --format='libffi %h %s'

[ -f configure ] || ./autogen.sh

mkdir -p build-wasm && cd build-wasm
emconfigure ../configure \
    --host=wasm32-unknown-emscripten \
    --prefix="$POC_SYSROOT" \
    --disable-shared --enable-static \
    --disable-dependency-tracking --disable-docs
emmake make -j"$(nproc)"
emmake make install

ls -la "$POC_SYSROOT/lib/libffi.a"
