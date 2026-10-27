#!/bin/bash
# SPDX-License-Identifier: MIT
# Collect the typelibs that get embedded into the wasm module.
#
# THESE MUST BE 32-BIT (i686), not the host's x86_64 copies.
#
# A typelib bakes in the width of the platform's basic types. On x86_64 `gssize`
# is 64 bit; wasm32 is ILP32, so girepository would read a 64-bit field out of a
# 32-bit slot and every size/offset argument came back as nonsense — the failure
# looks like random marshalling corruption, not like a word-size bug.
#
# girepository cannot generate them here (we build with -Dintrospection=disabled,
# and generating typelibs needs to *run* the target's g-ir-compiler). So we take
# a prebuilt i686 set from a distro package. Fedora's glib2.i686 is what this was
# measured with; override POC_TYPELIB_RPM to point at any other ILP32 build.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

WORK="$POC_ROOT/typelibs-i686"
OUT="$POC_ROOT/typelibs"
poc_log "i686 typelibs -> $OUT"

mkdir -p "$WORK" "$OUT" && cd "$WORK"

RPM="${POC_TYPELIB_RPM:-}"
if [ -z "$RPM" ]; then
    if ! command -v dnf >/dev/null; then
        echo "no dnf: set POC_TYPELIB_RPM to an i686 glib2 rpm (or any ILP32 girepository-1.0 tree)" >&2
        exit 1
    fi
    dnf download --arch=i686 glib2
    RPM=$(ls -t glib2-*.i686.rpm | head -1)
fi

rpm2cpio "$RPM" | cpio -idmu --quiet
find . -path '*/girepository-1.0/*.typelib' -exec cp {} "$OUT/" \;

# GLibUnix/GioUnix describe POSIX APIs emscripten does not provide; leaving them
# out costs one harmless CRITICAL at startup and avoids loading dead bindings.
rm -f "$OUT/GLibUnix-2.0.typelib" "$OUT/GioUnix-2.0.typelib" "$OUT/GIRepository-3.0.typelib"

ls -la "$OUT"
