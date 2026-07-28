#!/bin/bash
# Build every emulated-architecture prebuild, INSIDE the target-arch container.
#
# Run by `prebuilds.yml`'s `build-prebuilds-qemu` job as
#   docker run --platform linux/<arch> -v "$PWD:/w" -w /w <base-image> \
#     bash .github/prebuild-toolchain/emulated-build.sh
# with ARCH set to the `process.arch` token that names the prebuild directory
# (`ppc64` / `s390x` / `riscv64` — NOT the docker platform spelling).
#
# It lives in a FILE rather than inline in the workflow because it is the
# emulated half of a two-machine build and has to be runnable by hand:
# reproducing a failure means running this exact script under `podman run
# --platform`, which is how the qemu-version root cause below was found.
#
# WHY WEAK/RECOMMENDED DEPENDENCIES ARE OFF
# The Fedora list pulled 574 packages, most of them weak dependencies of
# gtk4-devel / gstreamer (pipewire, wireplumber, fonts, bat, 7zip). None is
# needed to compile a Vala library, every one costs emulated install time, and
# the RPM transaction died in wireplumber's `%posttrans` scriptlet — i.e. the
# build was failing inside a package it does not use. Same reasoning for apt's
# recommends.
set -euxo pipefail

: "${ARCH:?ARCH must be set to the prebuild-directory arch token}"

# ONLY BUILD WHAT CHANGED.
#
# `PREBUILD_SKIP` is the `changes` job's decision, passed in verbatim as the
# JSON array it publishes (e.g. `["lightningcss-native","oxfmt-native"]`). Every
# `build_pkg` below consults it, so one emulated leg builds exactly the packages
# a native leg does — the decision is made once, in CI, and this script only
# obeys it.
#
# UNSET MEANS BUILD EVERYTHING, on purpose: run this by hand
# (`podman run --platform linux/ppc64le … bash …/emulated-build.sh`) and you get
# the full leg, which is what reproducing a CI failure needs. Every way of not
# knowing therefore ends in a build, never in a skip.
PREBUILD_SKIP="${PREBUILD_SKIP:-[]}"

# Is <package-dir> in the skip list? Keyed on the directory's basename, the same
# key `changed-packages.mjs` emits. The quotes are part of the match so
# `"http2-native"` cannot be found inside `"http2-native-x"`.
should_build() {
    local key="${1##*/}"
    case "$PREBUILD_SKIP" in
        *"\"${key}\""*) return 1 ;;
        *) return 0 ;;
    esac
}

# Does this leg build anything that needs cargo? Only the Rust bridges do, and
# under emulation the rustup install is a real minute, so it follows them.
needs_rust() {
    should_build packages/infra/lightningcss-native
}

# Detect the package manager: dnf for Fedora (ppc64/s390x), apt for Ubuntu
# (riscv64 — Fedora publishes no riscv64 image).
if command -v dnf > /dev/null 2>&1; then
    dnf install -y --setopt=install_weak_deps=False \
        git tar xz findutils curl file \
        meson vala gcc pkgconf \
        glib2-devel gobject-introspection-devel \
        gtk4-devel gdk-pixbuf2-devel \
        libepoxy-devel \
        gstreamer1-devel \
        gstreamer1-plugins-base-devel \
        gstreamer1-plugins-bad-free-devel \
        libsoup3-devel \
        libnghttp2-devel \
        gnutls-devel \
        json-glib-devel
else
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git tar xz-utils findutils curl ca-certificates file \
        meson valac gcc pkg-config \
        libglib2.0-dev gobject-introspection libgirepository1.0-dev \
        libgtk-4-dev libgdk-pixbuf-2.0-dev \
        libepoxy-dev \
        libgstreamer1.0-dev \
        libgstreamer-plugins-base1.0-dev \
        libgstreamer-plugins-bad1.0-dev \
        libsoup-3.0-dev \
        libnghttp2-dev \
        libgnutls28-dev \
        libjson-glib-dev
fi

# `meson.build` finds the typelib compiler via `find_program('g-ir-compiler')`,
# so fail HERE with a name rather than 40 emulated minutes later inside a
# `meson setup` that cannot say which host is missing it.
command -v g-ir-compiler > /dev/null 2>&1 || {
    echo "::error::g-ir-compiler not found in the ${ARCH} image — meson.build resolves it by name" >&2
    exit 1
}

# rustup (lightningcss-native, below). The distro cargo is usually older than
# the rustc >= 1.85 that indexmap@2.14's edition2024 needs.
if needs_rust; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
        sh -s -- -y --default-toolchain stable --profile minimal
    export PATH="$HOME/.cargo/bin:$PATH"
else
    echo "SKIP rustup — no Rust bridge is being built on this leg"
fi

# Build one meson package and stage the artifacts it names.
#   build_pkg <package-dir> <artifact> [<artifact> …]
build_pkg() {
    local dir="$1"
    shift
    if ! should_build "$dir"; then
        echo "SKIP ${dir} — unchanged (PREBUILD_SKIP=${PREBUILD_SKIP})"
        return 0
    fi
    (
        cd "$dir"
        meson setup build .
        meson compile -C build
        mkdir -p "prebuilds/linux-${ARCH}"
        for artifact in "$@"; do
            cp "build/${artifact}" "prebuilds/linux-${ARCH}/"
        done
        echo "${dir} prebuilds for linux-${ARCH}:"
        ls -lh "prebuilds/linux-${ARCH}/"
        # The machine of what was just produced, on the machine that produced
        # it. `audit-runtimes --check` holds the same invariant against the
        # committed tree from any host; this is the same fact at the source,
        # where a mismatch names the leg that made it.
        file "prebuilds/linux-${ARCH}/"*.so
    )
}

# -------- @gjsify/webgl --------
build_pkg packages/framework/webgl libgwebgl.so Gwebgl-0.1.typelib

# -------- @gjsify/webrtc-native --------
build_pkg packages/web/webrtc-native libgjsifywebrtc.so GjsifyWebrtc-0.1.typelib

# -------- @gjsify/http-soup-bridge --------
build_pkg packages/node/http-soup-bridge \
    libgjsifyhttpsoupbridge.so GjsifyHttpSoupBridge-1.0.gir GjsifyHttpSoupBridge-1.0.typelib

# -------- @gjsify/http2-native --------
build_pkg packages/node/http2-native \
    libgjsifyhttp2.so GjsifyHttp2-1.0.gir GjsifyHttp2-1.0.typelib

# -------- @gjsify/sab-native --------
build_pkg packages/node/sab-native \
    libgjsifysabnative.so GjsifySabNative-1.0.gir GjsifySabNative-1.0.typelib

# -------- @gjsify/tls-native --------
# GnuTLS OCSP-response parser. Pure C lib link via gnutls.pc; no Rust deps.
build_pkg packages/node/tls-native \
    libgjsifytls.so GjsifyTls-1.0.gir GjsifyTls-1.0.typelib

# -------- @gjsify/terminal-native --------
# POSIX only (isatty / ioctl TIOCGWINSZ / termios) + GLib; no external
# libraries, so it is the cheapest build in the emulated leg.
build_pkg packages/node/terminal-native \
    libgjsifyterminal.so GjsifyTerminal-1.0.gir GjsifyTerminal-1.0.typelib

# -------- @gjsify/lightningcss-native --------
# Pure crates.io deps (no submodule). The cargo download + compile is the slow
# step under emulation. Worth it: this is the path that lets `gjsify build` run
# on exotic-arch GJS hosts without the WASM fallback's overhead.
#
# BOTH libraries are staged — the Vala one the typelib names AND the Rust
# cdylib it links against (underscore leaf). Staging only the first is the
# #832 failure: the loader resolves the directory and finds nothing there.
build_pkg packages/infra/lightningcss-native \
    libgjsifylightningcss.so libgjsify_lightningcss.so \
    GjsifyLightningcss-1.0.gir GjsifyLightningcss-1.0.typelib

# NOTE: @gjsify/oxfmt-native is intentionally NOT built here — it path-deps
# into the refs/oxc submodule and its crate graph is the same order of
# magnitude as rolldown's, so the emulation-cost argument below applies
# verbatim.
#
# NOTE: @gjsify/rolldown-native is intentionally NOT built here. The rolldown
# crate graph (tokio + oxc + ~250 transitive crates) compiles in ~5 min on
# native x86_64; under emulation that easily blows the 6-hour job timeout.
# Multi-arch rolldown prebuilds wait for either (a) a coherent crates.io
# publish so the cargo build doesn't pull the whole rolldown workspace, or
# (b) cross-compilation via `cross` rather than qemu-user. Tracked in
# STATUS.md "Open TODOs".
