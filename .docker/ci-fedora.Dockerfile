# CI base image — Fedora + every GJS / GNOME devel package the test
# workflow installs. We bake all of `dnf install` from `.github/workflows/
# main.yml` into the image so each CI job skips the 3-5 minute install
# step at job start.
#
# Built per Fedora major (43, 44) by `.github/workflows/build-ci-image.yml`
# on a weekly cron + on pushes that touch this Dockerfile, then pushed to
# `ghcr.io/gjsify/ci-fedora:<major>`. The main test workflow consumes the
# image via `container: ghcr.io/gjsify/ci-fedora:<fedora-version>`.
#
# Build args:
#   FEDORA_VERSION   — major release (43, 44, …). Defaults to 43 so a
#                       `docker build .docker/ci-fedora.Dockerfile` without
#                       --build-arg produces a useable image locally.
#
# Refresh cadence:
#   - Weekly on the schedule below — picks up Fedora security errata.
#   - On every push that touches this Dockerfile.
#   - Manual `workflow_dispatch` for ad-hoc rebuilds.

ARG FEDORA_VERSION=43
FROM fedora:${FEDORA_VERSION}

# Container prerequisites (used by actions/checkout, actions/setup-node,
# the install step, and the test runners). Pre-install here so the main
# workflow's "Install container prerequisites" step becomes a no-op.
# `libatomic` BEFORE setup-node: Node >= 26's prebuilt binary links
# libatomic.so.1, which the minimal Fedora container lacks.
# NOTE: weak deps are left ON (no --setopt=install_weak_deps=False) so this
# image installs EXACTLY what `main.yml`'s plain `dnf install -y` pulled —
# parity with the known-good environment matters more than image size.
#
# `dash` is here to make ONE assertion able to fail. On Fedora `/bin/sh` IS bash, so
# `sh -n` on a script written for `alpine:3.24`'s busybox ash proves nothing — a bashism
# passes here and dies in the container, the one place these legs cannot be debugged
# cheaply. `tests/e2e/prebuild-change-gate` prefers a real POSIX shell and says so when
# it finds none; without this package it always took that weaker path. Measured cost: a
# few hundred KB, and nothing else on the image resolves `sh` through it.
#
# `openssl` is the CLI, not the library: the Fedora base ships `openssl-libs` and no
# `openssl(1)` (measured on `fedora:44`), and nothing else installed here pulls the
# binary in. That single absence is what held `@gjsify/integration-tls-session` out
# of `main.yml`'s integration gate — its `scripts/setup-fixtures.mjs` shells out to
# one `openssl req -x509` to make the server cert, so the suite died with
# `spawnSync openssl ENOENT` at prebuild, before a single assertion ran, and it is
# green on any workstation, which is why nobody noticed. It is the only thing in the
# tree that drives `@gjsify/tls-native`'s Path-A C shim through a REAL handshake —
# session resumption and channel binding (`getFinished()`/`getPeerFinished()` on
# TLS 1.2 `tls-unique` and TLS 1.3 `tls-exporter`). `prebuilds.yml` builds that shim
# and `tls/src/session-access.gjs.spec.ts` covers the pre-handshake API shape;
# neither observes a byte that crossed the wire.
RUN dnf install -y \
    git \
    tar \
    xz \
    findutils \
    libatomic \
    dash \
    openssl \
    && dnf clean all

# GJS + GNOME devel libs. gstreamer1-{,plugins-base-,plugins-bad-free-}
# devel provide the gstreamer-1.0 / gstreamer-sdp-1.0 / gstreamer-webrtc-1.0
# pkg-config files + headers needed to compile @gjsify/webrtc-native at
# Vala build time. libnice-gstreamer1 provides the `nice` plugin webrtcbin
# needs at runtime for the WebRTC test suite.
#
# `glib2` (NOT just `glib2-devel`) ships the `glib-compile-resources` binary
# that the `gjsify gresource` test hard-requires; `gettext` ships `msgfmt`
# for the `gjsify gettext` test — and `msgunfmt`, which `gjsify ship` runs to
# read a staged `.mo` back before folding it into the freedesktop metadata.
#
# `desktop-file-utils` and `appstream` are the two INDEPENDENT readers for the
# metadata `gjsify ship` generates: `desktop-file-validate` parses the `.desktop`
# entry and `appstreamcli validate` the AppStream component. Both were missing
# here, so the only assertions those files ever had were our own — this repo's
# green-CI-that-checked-nothing class, on the one part of the payload a user sees
# first (the app menu entry and the Software listing).
#
# `appstream` also owns BOTH AppStream ITS files under `/usr/share/gettext/its/`
# (`rpm -qf` on this image's Fedora: metainfo.its and metainfo.loc are
# appstream's, not gettext's). gettext resolves AppStream rules only through that
# pair — `xgettext` when it EXTRACTS msgids from a `*.metainfo.xml`, `msgfmt --xml`
# when it merges them back — and the failure of the lookup is the measured
# `cannot locate ITS rules for <file>` (exit 1). `findMetainfoItsPath()` in
# `@gjsify/vite-plugin-gettext` only `console.warn`s when it cannot find the
# file, so its absence would degrade extraction quietly.
#
# `weston` is Xvfb's WAYLAND twin, and it buys a display AXIS, not a second way
# to do the same thing: GdkX11 holds no state between a GSource's prepare() and
# check(), GdkWayland holds libwayland's reader slot there, so #1145 (the uv
# pump left the context prepared and `gtk_window_present()` deadlocked) is
# invisible under Xvfb. Its headless backend needs no GPU, no seat and no DRM.
#
# This list used to carry "MUST stay in lockstep with main.yml" — a convention
# with nothing behind it, which is the shape of every drift this repo has paid
# for. `scripts/check-ci-image-packages.mjs` now derives the answer: any job
# running ON this image that still `dnf install`s something absent here is a
# CI failure naming the package, and any job on a bare `fedora:<major>` must
# appear in that script's ledger with a reason.
RUN dnf install -y \
    gjs \
    glib2 \
    glib2-devel \
    gettext \
    desktop-file-utils \
    appstream \
    gobject-introspection-devel \
    gtk4-devel \
    libsoup3-devel \
    webkitgtk6.0-devel \
    libadwaita-devel \
    gdk-pixbuf2-devel \
    libepoxy-devel \
    gstreamer1-devel \
    gstreamer1-plugins-base-devel \
    gstreamer1-plugins-bad-free-devel \
    libnice-gstreamer1 \
    libgda \
    libgda-sqlite \
    xorg-x11-server-Xvfb \
    mesa-dri-drivers \
    mesa-libGL \
    weston \
    && dnf clean all

# Meson + Vala + Blueprint compiler for the native bridge builds
# (@gjsify/{webrtc-native, tls-native, terminal-native, sab-native,
# http2-native, http-soup-bridge}).
RUN dnf install -y \
    meson \
    vala \
    gcc \
    pkgconf \
    blueprint-compiler \
    && dnf clean all

# Everything the node-gi / napi / prebuild / release jobs used to install for
# themselves. Thirteen jobs ran on a bare `fedora:<major>` and `dnf install`ed
# their set at the start of EVERY run, which is what this image exists to stop:
# during the v0.26.0 release sweep that step took 41 minutes twice (its normal
# cost is 22 seconds) and killed the Adwaita-storybook job on its 45-minute
# timeout, while a Docker Hub pull timeout independently failed `napi`. Neither
# had anything to do with the code, and two of the thirteen sat on the RELEASE
# path, so the same mirror weather could strand a publish.
#
# Ten have switched over. The three left are ALL blocked by one thing — they run
# on `ubuntu-24.04-arm` and `build-ci-image.yml` publishes `linux/amd64` only —
# so widening that `platforms:` list is what retires the last of them.
# `scripts/check-ci-image-packages.mjs` DERIVES that rather than trusting a
# comment: it reads the published arches and each job's runners, and the
# hand-written exemption ledger it replaced is now empty.
#
# Baking these does not weaken what those jobs prove. They are not minimal on
# purpose — every one of them installs gjs and the GNOME devel set itself; the
# thing they genuinely lack is `@gjsify/rolldown-native`, a workspace build
# artifact no base image provides. Verified before adding: no job asserts that
# a system library is ABSENT.
RUN dnf install -y \
    make \
    gcc-c++ \
    python3 \
    unzip \
    curl \
    pkgconf-pkg-config \
    ninja-build \
    valgrind \
    gjs-devel \
    mozjs140-devel \
    gobject-introspection \
    libsoup3 \
    glib-networking \
    libnghttp2-devel \
    gnutls-devel \
    json-glib \
    json-glib-devel \
    libuv \
    cairo \
    cairo-devel \
    cairo-gobject-devel \
    pango \
    gdk-pixbuf2 \
    gtksourceview5-devel \
    adwaita-icon-theme \
    dejavu-sans-fonts \
    dbus-daemon \
    dbus-x11 \
    && dnf clean all

# NOTE: no nodejs/npm baked in — the workflow uses actions/setup-node (Node
# 26.x) which downloads its own copy + corepack, so Fedora's node would only
# be dead weight in the pull. (Was here purely for interactive debugging.)

# Marker so the workflow can verify it picked up the right image
# (`/etc/gjsify-ci-fedora-version`). Helps debug "why didn't my dnf install
# get skipped" — if this file is missing, the container is the bare
# upstream `fedora:N`, not the baked image.
ARG FEDORA_VERSION
RUN echo "${FEDORA_VERSION}" > /etc/gjsify-ci-fedora-version

# Set a non-interactive default. dnf is already configured via the
# install commands above; this just keeps interactive prompts quiet
# when a contributor runs the image manually for debugging.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /workspace
