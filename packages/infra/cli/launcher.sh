#!/bin/sh
# Wrapper invoked by the Flatpak `command: gjsify`. Sets up the search paths
# for the bundled Vala typelibs (terminal-native / sab-native / http2-native /
# http-soup-bridge), then executes the gjsify CLI bundle under `gjs`.
#
# Inside the sandbox:
#   /app/share/gjsify/cli.gjs.mjs    — the GJS bundle (committed in dist/)
#   /app/lib/girepository-1.0/       — the .so + .typelib files for the
#                                       optional native bridges
#
# `exec` so the user's shell sees gjsify's own exit code (release scripts,
# `gjsify install --immutable && echo ok` chains keep working).
exec gjs -m /app/share/gjsify/cli.gjs.mjs "$@"
