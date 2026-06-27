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
RUN dnf install -y \
    git \
    tar \
    xz \
    findutils \
    libatomic \
    && dnf clean all

# GJS + GNOME devel libs. gstreamer1-{,plugins-base-,plugins-bad-free-}
# devel provide the gstreamer-1.0 / gstreamer-sdp-1.0 / gstreamer-webrtc-1.0
# pkg-config files + headers needed to compile @gjsify/webrtc-native at
# Vala build time. libnice-gstreamer1 provides the `nice` plugin webrtcbin
# needs at runtime for the WebRTC test suite.
#
# `glib2` (NOT just `glib2-devel`) ships the `glib-compile-resources` binary
# that the `gjsify gresource` test hard-requires; `gettext` ships `msgfmt`
# for the `gjsify gettext` test. This list MUST stay in lockstep with the
# "Install GJS and GNOME development libraries" step in
# `.github/workflows/main.yml` — that file is the source of truth.
RUN dnf install -y \
    gjs \
    glib2 \
    glib2-devel \
    gettext \
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
