#!/bin/bash
# SPDX-License-Identifier: MIT
# Build GLib + GObject + GIO + girepository for wasm32-emscripten, static.
#
# Three layers of source, in this order:
#   1. pristine glib 2.90.1 from download.gnome.org
#   2. wasm-vips' Emscripten series, patches 04..10 of 10 (see PATCHES below)
#   3. our delta, docs/poc/gobject-wasm/patches/*.patch
#
# Why only 04..10 of the wasm-vips series: 01 ("Do not build tools"), 02 ("Remove
# GRegex pre-emptively") and 03 ("Disable NLS") are wasm-vips' *product* choices.
# We need the tools question answered differently (girepository needs GRegex, and
# we keep NLS off via a meson option instead), so we take only the portability
# patches and leave the policy ones out.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
poc_activate

SRC="$POC_ROOT/glib"
TARBALL="$POC_ROOT/glib-$POC_GLIB_VERSION.tar.xz"
PSERIES="$POC_ROOT/wasm-vips-patches"

# wasm-vips' glib fork, branch wasm-vips-2.90.1, tip 9dc7b94. Pinned by SHA so a
# later force-push cannot silently change what we built against.
PATCHES=(
    d5944d3bef7f5cb0f001067e21d9ccb49418cce6  # 04 Emscripten doesn't always define
    188b1d1df08b913f24657b09d9c63fdd0d21b077  # 05 pthread_getname_np()
    ad8d43b496b656621495d120b216d7bb87229ad8  # 06 Network libs are not available
    71f176c6e3f9d2b6a6d18ea6ab56f9a7d0634ae2  # 07 Separate checks for Emscripten
    225e2c315067ed9189172381156fd1717f246c6a  # 08 vsnprintf/snprintf from musl
    b8699ac5bb6fc043cae00df41aaf0436d753b7ee  # 09 Add support for WebAssembly
    9dc7b94c0ace4a1b581a17f8d59d0571f1bec3cc  # 10 Fix function pointer cast issues
)

poc_log "glib $POC_GLIB_VERSION -> $POC_SYSROOT"

if [ ! -f "$TARBALL" ]; then
    curl -fL -o "$TARBALL" \
        "https://download.gnome.org/sources/glib/${POC_GLIB_VERSION%.*}/glib-$POC_GLIB_VERSION.tar.xz"
fi

if [ ! -d "$SRC" ]; then
    rm -rf "$POC_ROOT/glib-$POC_GLIB_VERSION"
    tar -C "$POC_ROOT" -xf "$TARBALL"
    mv "$POC_ROOT/glib-$POC_GLIB_VERSION" "$SRC"

    poc_log "applying the wasm-vips portability series (${#PATCHES[@]} patches)"
    mkdir -p "$PSERIES"
    for sha in "${PATCHES[@]}"; do
        [ -f "$PSERIES/$sha.patch" ] || \
            curl -fL -o "$PSERIES/$sha.patch" "https://github.com/kleisauke/glib/commit/$sha.patch"
        patch -d "$SRC" -p1 --no-backup-if-mismatch < "$PSERIES/$sha.patch"
    done

    poc_log "applying our delta"
    for p in "$POC_DIR"/patches/*.patch; do
        patch -d "$SRC" -p1 --no-backup-if-mismatch < "$p"
    done
fi

cd "$SRC"
if [ ! -d _build ]; then
    # pcre2/zlib/gvdb come in as meson subprojects: the host copies are x86_64 and
    # meson would happily find them through the host pkg-config otherwise.
    meson setup _build \
        -Dbuildtype=release \
        -Dprefix="$POC_SYSROOT" \
        -Ddefault_library=static \
        -Dforce_fallback_for=gvdb,pcre2,zlib \
        -Dintrospection=disabled \
        -Dselinux=disabled -Dxattr=false -Dlibmount=disabled -Dsysprof=disabled \
        -Dnls=disabled -Dglib_debug=disabled -Dtests=false \
        -Dglib_assert=false -Dglib_checks=false -Ddtrace=disabled -Dman-pages=disabled \
        --cross-file="$POC_DIR/wasm32-emscripten.ini"
fi

# `-k 0`: 13 of glib's own host tools (gio-querymodules, gdbus-codegen helpers, …)
# link as wasm executables and fail. We never run them, and `install --tag devel`
# does not ship them, so build everything that *can* build and move on.
ninja -C _build -k 0 || true
meson install -C _build --tag devel --no-rebuild

poc_log "installed"
PKG_CONFIG_LIBDIR="$POC_SYSROOT/lib/pkgconfig" \
    pkg-config --modversion girepository-2.0 gobject-2.0 gio-2.0 gmodule-2.0
