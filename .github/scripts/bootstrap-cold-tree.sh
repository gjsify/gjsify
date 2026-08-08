#!/usr/bin/env bash
# Make a COLD checkout able to build itself, then hand it its own toolchain.
#
# A fresh CI tree has no `packages/infra/cli/lib/index.js` — it is a build
# output. Without it `node_modules/.bin/gjsify` dangles, and the GJS bootstrap
# bundle cannot fill the gap either: under GJS the only bundler engine is
# `@gjsify/rolldown-native`, whose JS facade is itself a build output, so it
# would have to bundle its own bundler.
#
# `$GJSIFY_BOOTSTRAP` is no way out: it is downloaded from
# `releases/latest/download/cli.gjs.mjs`, i.e. ALWAYS THE PREVIOUS RELEASE'S
# CLI. A bug that reaches this step can therefore only be repaired by a
# release — and this step is what a release runs. Measured twice: v0.24.1 lost
# @gjsify/napi to it, and v0.31.0's cut and publish both died on it.
#
# So: jump-start with a PUBLISHED @gjsify/cli under NODE, where `isNode()` is
# genuinely true and `process.exit()` is immediate rather than idle-scheduled
# through a GLib main loop — then HAND THE SHIM BACK, because everything after
# this resolves `gjsify` through it and the release must be built, verified and
# cut by the CLI this commit ships, not by the last one.
#
# TEMPORARY BY INTENT. The project's direction is to run as much as possible ON
# gjsify — CI included — because running the toolchain on itself is what makes
# its defects observable at all. Revert this to
# `gjs -m "$GJSIFY_BOOTSTRAP" run build:infra` once BOTH hold:
#   1. a RELEASED @gjsify/cli carries the fixes this step trips over (#1038:
#      `gjsify tsc` exiting 0 when it can spawn no compiler); and
#   2. a NON-BLOCKING job exercises the GJS-hosted bootstrap, so the next
#      regression there is a signal rather than a deadlocked release.
# Without (2) a revert only re-arms the trap for the next CLI bug.
#
# ONE script, called by every workflow that needs it. The duplicate copy in
# release.yml is exactly why v0.31.0's publish still failed after the cut was
# fixed: the fix went to one of the two.
set -euo pipefail

if [ -f packages/infra/cli/lib/index.js ]; then
    echo "Node CLI entry present — the .bin shim is usable, skipping build:infra."
    exit 0
fi

CLI_VERSION="$(node -p "require('./packages/infra/cli/package.json').version")"
mkdir -p /tmp/gjsify-node-cli
(cd /tmp/gjsify-node-cli && npm init -y >/dev/null 2>&1)
# Retries through the window where a release has bumped every package.json but
# npm does not yet serve that version — see the script's own comment.
(cd /tmp/gjsify-node-cli && "${GITHUB_WORKSPACE}/.github/scripts/install-published-cli.sh" "${CLI_VERSION}")

# `build:infra` runs PACKAGE SCRIPTS, and those call bare `gjsify`, which
# resolves through this shim — a workspace symlink to the very file this step
# exists to create. Without repointing it the child dies on MODULE_NOT_FOUND.
ln -sf /tmp/gjsify-node-cli/node_modules/@gjsify/cli/lib/index.js node_modules/.bin/gjsify
echo "Node bootstrap CLI: $(node_modules/.bin/gjsify --version)"

node /tmp/gjsify-node-cli/node_modules/@gjsify/cli/lib/index.js run build:infra

# Hand it back. Left dangling, `verify-committed-bundles` rebuilt
# affected.gjs.mjs 157 bytes short and reported it STALE — the check was right,
# it was being handed the wrong compiler.
ln -sf "$PWD/packages/infra/cli/lib/index.js" node_modules/.bin/gjsify
echo "Handed back to the freshly built CLI: $(node_modules/.bin/gjsify --version)"
