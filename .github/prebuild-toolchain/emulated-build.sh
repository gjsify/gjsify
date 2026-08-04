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

# The repo root, captured before any `cd`. `build_pkg` runs in a subshell that
# `cd`s into the package, and the shared stager lives at the root — same reason
# `musl-build.sh` keeps a `WORKSPACE`.
WORKSPACE="$PWD"

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

# Does this leg build anything that needs cargo? Under emulation the rustup
# install is a real minute, so it follows the packages that use it.
#
# `lightningcss-native` is the ONLY Rust bridge this script builds — oxfmt- and
# rolldown-native are deliberately excluded from the emulated legs (see the
# notes at the bottom of this file). If either is ever added here, add it to
# this test in the same change, or its build will run without a toolchain.
needs_rust() {
    should_build packages/infra/lightningcss-native
}

# Detect the package manager: dnf for Fedora (ppc64/s390x), apt for Ubuntu
# (riscv64 — Fedora publishes no riscv64 image).
#
# THE THIRD BRANCH IS A REFUSAL, NOT A GAP. This used to be a two-way
# `if dnf … else apt-get …`, i.e. "not dnf means Debian". Run inside
# `alpine:3.24` it therefore did:
#
#     + command -v dnf          (no output, not found)
#     + apt-get update
#     .../emulated-build.sh: line 79: apt-get: not found
#
# — dying in a confusing place, several lines after the real cause. Alpine is a
# REAL target for this repo (postmarketOS is Alpine-based), it just is not this
# script's: musl prebuilds are built by `prebuilds.yml`'s `build-prebuilds-musl`
# leg, in a native `alpine:3.24` container, because both arches that matter have
# native runners and nothing there needs emulating.
#
# IF a musl build ever does have to come through here, THREE things must land in
# the same change — an apk branch alone would be worse than this refusal:
#   1. the apk package names, which are not the Fedora ones: `ninja-build` (there
#      is no `ninja`), `vala` (no `valac`), `gobject-introspection-dev` for
#      `g-ir-compiler`, `libsoup3-dev`, `nghttp2-dev`, `linux-headers`,
#      `musl-dev`. Alpine has no weak dependencies, so the
#      `install_weak_deps=False` reasoning above simply does not apply.
#   2. `needs_rust()` must NOT install rustup on Alpine. apk's rustc is current
#      enough, and rustup's musl target `*-unknown-linux-musl` defaults to
#      `crt-static` ON, under which cargo CANNOT emit a cdylib at all — the
#      artifact every Rust bridge here is.
#   3. a libc-carrying target token. This one is no longer a silent hazard — it
#      is now a REFUSAL, and that is worth knowing before you try: `build_pkg`
#      stages through `scripts/stage-prebuild.mjs`, which derives the directory
#      from the HOST, so on Alpine it resolves `linux-<arch>-musl` and the arch
#      guard below (`resolved != linux-${ARCH}`) stops the leg. The old
#      hand-written `cp` into `prebuilds/linux-${ARCH}` had no such brake: with
#      `ARCH=arm64` on Alpine it OVERWROTE the committed glibc artifact with a
#      musl one and every declaration check downstream stayed green. What an apk
#      branch would still owe is a target token that carries the libc.
#
# `nodejs` is in both lists for one reason: `build_pkg` stages through
# `scripts/stage-prebuild.mjs`. That is not a convenience — it is what makes the
# emulated legs produce the SAME file set as the native ones (matching by
# extension rather than by a hand-written name list), derive the target token
# from the host instead of from `$ARCH`, and run `checkPrebuildDir()` over what
# they wrote. None of those three held while this script copied by hand.
if command -v dnf > /dev/null 2>&1; then
    dnf install -y --setopt=install_weak_deps=False \
        git tar xz findutils curl file nodejs \
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
elif command -v apt-get > /dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git tar xz-utils findutils curl ca-certificates file nodejs \
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
else
    # Name the host instead of failing later inside a command it does not have.
    echo "::error::no supported package manager in this image ($(cat /etc/os-release 2>/dev/null | grep -m1 '^PRETTY_NAME=' || echo 'unknown OS')) — this script installs via dnf (Fedora) or apt-get (Debian/Ubuntu). See the note above before adding a third." >&2
    exit 1
fi

# `meson.build` finds the typelib compiler via `find_program('g-ir-compiler')`,
# so fail HERE with a name rather than 40 emulated minutes later inside a
# `meson setup` that cannot say which host is missing it.
command -v g-ir-compiler > /dev/null 2>&1 || {
    echo "::error::g-ir-compiler not found in the ${ARCH} image — meson.build resolves it by name" >&2
    exit 1
}

# THE CLOBBER GUARD, before anything is built — the musl leg's, applied to the one
# other place `ARCH` and the derived target can disagree.
#
# `build_pkg` now asks `stage-prebuild.mjs` which directory to write, and that
# answer comes from the HOST (`process.arch` of the node running inside this
# container). `ARCH` is what the matrix entry claims and what every upload path
# names. They agree only while the emulation really is emulating: with
# `--platform` missing or binfmt not registered, a cached amd64 image runs
# natively, node resolves `linux-x64`, and the leg would stage an x86-64 object
# into a directory named `linux-ppc64` — the `run-on-arch-action` incident
# verbatim, which every downstream check passed.
#
# Importing the module runs no `main()` (it is guarded on `process.argv[1]`), so
# this is a pure read of the very function that will pick the directory.
resolved="$(node -e 'import("./scripts/stage-prebuild.mjs").then((m) => console.log(m.hostStagingTarget()))')"
echo "stage-prebuild.mjs resolves this container as: ${resolved}"
if [ "$resolved" != "linux-${ARCH}" ]; then
    echo "::error::this container resolves as \`${resolved}\`, not \`linux-${ARCH}\` — the emulation is not" >&2
    echo "::error::in effect (or ARCH is wrong). Refusing to build: staging would put a ${resolved}" >&2
    echo "::error::object where a linux-${ARCH} one belongs." >&2
    exit 1
fi

# rustup (lightningcss-native, below). The distro cargo is usually older than
# the rustc >= 1.85 that indexmap@2.14's edition2024 needs.
#
# RETRIED, because one transient fetch discards a whole emulated build. By the
# time this line runs the leg has installed a few hundred packages under QEMU,
# and a bare `curl -sSf` turns any blip into a red `main`: on 2026-08-02 it was
# `curl: (35) Send failure: Connection reset by peer` on s390x, one run after a
# `502 Bad Gateway` from Docker Hub killed ppc64 the same way. Neither said
# anything about this repository's code, and each threw away minutes of
# emulated work — plus every other package that leg had already built.
#
# `--retry-all-errors` is the load-bearing flag: plain `--retry` covers
# transient HTTP codes and timeouts but NOT a connection reset, which is
# precisely what happened. Curl's own retry rather than a shell loop, because
# the download is piped straight into `sh` — re-running the pipeline would
# re-run the installer, not just the fetch.
if needs_rust; then
    curl --proto '=https' --tlsv1.2 -sSf \
        --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 30 \
        https://sh.rustup.rs |
        sh -s -- -y --default-toolchain stable --profile minimal
    export PATH="$HOME/.cargo/bin:$PATH"
else
    echo "SKIP rustup — no Rust bridge is being built on this leg"
fi

# Build one meson package and stage what its build produced.
#   build_pkg <package-dir>
#
# NO ARTIFACT LIST. It used to take one, and the list was the defect: it named
# `.so`/`.typelib`/`.gir` per package by hand, so `webgl` and `webrtc-native`
# silently shipped no `.gir` on every linux target while the darwin legs shipped
# one, and a library renamed in `meson.build` would have kept copying the stale
# name. `scripts/stage-prebuild.mjs` matches by EXTENSION, derives the directory
# from `gjsify.platforms` + the host, and ends in `checkPrebuildDir()` — the
# staged-sibling + `$ORIGIN` check these legs never ran at all.
#
# `--scratch`: this leg uploads and commits nothing; `commit-prebuilds` downloads
# the artifact into the per-target package.
build_pkg() {
    local dir="$1"
    if ! should_build "$dir"; then
        echo "SKIP ${dir} — unchanged (PREBUILD_SKIP=${PREBUILD_SKIP})"
        return 0
    fi
    (
        cd "$dir"
        meson setup build .
        meson compile -C build
        node "${WORKSPACE}/scripts/stage-prebuild.mjs" . --scratch
        # The machine of what was just produced, on the machine that produced
        # it. `audit-runtimes --check` holds the same invariant against the
        # committed tree from any host; this is the same fact at the source,
        # where a mismatch names the leg that made it.
        file "prebuilds/linux-${ARCH}/"*.so
    )
}

# -------- @gjsify/webgl --------
build_pkg packages/framework/webgl

# -------- @gjsify/webrtc-native --------
build_pkg packages/web/webrtc-native

# -------- @gjsify/http-soup-bridge --------
build_pkg packages/node/http-soup-bridge

# -------- @gjsify/http2-native --------
build_pkg packages/node/http2-native

# -------- @gjsify/sab-native --------
build_pkg packages/node/sab-native

# -------- @gjsify/tls-native --------
# GnuTLS OCSP-response parser. Pure C lib link via gnutls.pc; no Rust deps.
build_pkg packages/node/tls-native

# -------- @gjsify/terminal-native --------
# POSIX only (isatty / ioctl TIOCGWINSZ / termios) + GLib; no external
# libraries, so it is the cheapest build in the emulated leg.
build_pkg packages/node/terminal-native

# -------- @gjsify/lightningcss-native --------
# Pure crates.io deps (no submodule). The cargo download + compile is the slow
# step under emulation. Worth it: this is the path that lets `gjsify build` run
# on exotic-arch GJS hosts without the WASM fallback's overhead.
#
# BOTH libraries are staged — the Vala one the typelib names AND the Rust cdylib
# it links against (underscore leaf) — and neither is named here: the extension
# match picks the pair up, and `checkPrebuildDir()` then asserts the sibling is
# present and reachable via `$ORIGIN`. Staging only the first is the #832 failure.
build_pkg packages/infra/lightningcss-native

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
# status/open-todos.md.
