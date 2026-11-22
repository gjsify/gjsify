#!/bin/sh
# Builds the probe bundle, installs it as a --user Flatpak from /tmp, runs phase A and phase B (a
# new process), then uninstalls it. Needs flatpak-builder and org.gnome.Platform//49 + Sdk//49.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=${WORK:-/tmp/gjsify-secret-probe}
id=org.gjsify.SecretStoreProbe
rm -rf "$work" && mkdir -p "$work"
cp "$here/$id.yml" "$work/"
(cd "$here/.." && gjsify build flatpak-probe/probe.ts --app gjs --outfile "$work/probe.mjs")
(cd "$work" && flatpak-builder --user --force-clean --disable-rofiles-fuse --install "$work/build" "$id.yml")
flatpak info --show-permissions "$id"
flatpak run "$id" A
flatpak run "$id" B
flatpak uninstall --user -y --delete-data "$id"
