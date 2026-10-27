#!/bin/bash
# SPDX-License-Identifier: MIT
# Install the Emscripten SDK the prototype was measured with.
#
# Pinned on purpose: 6.0.13 is the first release whose `getUnsharedTextDecoderView`
# macro signature matches what emnapi 1.11.3 emits — see 30-emnapi.sh for the one
# place where it still does not.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

poc_log "emsdk $POC_EMSDK_VERSION -> $POC_EMSDK"

if [ ! -d "$POC_EMSDK/.git" ]; then
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$POC_EMSDK"
fi

cd "$POC_EMSDK"
git fetch --depth 1 origin "$POC_EMSDK_VERSION" 2>/dev/null || git fetch origin
./emsdk install "$POC_EMSDK_VERSION"
./emsdk activate "$POC_EMSDK_VERSION"

poc_activate
emcc --version | head -1
