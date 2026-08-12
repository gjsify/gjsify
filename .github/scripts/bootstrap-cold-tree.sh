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
#
# RUNTIME IS ARGUMENT 1 (`node` | `gjs`), so flipping it is a dispatch decision
# rather than an edit to this file — the edit is what diverged last time. Colon
# form `${1:-node}` on purpose: on a `release: published` event every `inputs.*`
# renders as the EMPTY STRING, and `${1-node}` substitutes only when the
# parameter is UNSET, so an explicit empty argument would fall through and fail
# every real release.
#
# WHAT THE ARGUMENT DOES NOT BUY. It switches THIS bootstrap. Node survives every
# value of it: `setup-node`, `npx release-it`, the `node scripts/*` hooks inside
# `.release-it.json` (which no workflow input can reach), `verify-committed-bundles.mjs`,
# and the dispatch step. There is also a THIRD cold-tree bootstrap this does not
# reach — `node scripts/bootstrap-native-facades.mjs` in release.yml's
# `publish-napi` — which is Node-only BY DESIGN: the facade it builds is what the
# GJS bundler engine needs in order to exist.
set -euo pipefail

RUNTIME="${1:-node}"
case "$RUNTIME" in
    node | gjs) ;;
    *)
        echo "::error::bootstrap-cold-tree: unknown runtime '${RUNTIME}' (expected 'node' or 'gjs')." >&2
        exit 2
        ;;
esac

# The one line that must be true rather than merely requested. Everything after
# this script resolves `gjsify` through `node_modules/.bin/gjsify`, so the
# interpreter that will drive `gjsify run build`, `verify-committed-bundles.mjs`
# and the `after:bump` rebuild is a property of THE SHIM THIS SCRIPT LEAVES
# BEHIND — never of the input. A run labelled `gjs` whose bundles were built by
# Node is the class of misinformation that made v0.31.0 unrecoverable, so the
# label is derived at the end, from the shim, and printed there.
report_shim() {
    local shim='node_modules/.bin/gjsify'
    local target interpreter
    target="$(readlink -f "$shim" 2>/dev/null || echo '<dangling>')"
    interpreter="$(head -c 2 "$target" 2>/dev/null || true)"
    if [ "$interpreter" = '#!' ]; then
        interpreter="$(head -n 1 "$target" | sed 's|^#!\s*||')"
    else
        interpreter='node (a plain .js entry, run by whatever spawns it)'
    fi
    echo "DRIVER: every later step runs \`${target}\` via ${interpreter}"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        {
            echo "| Cold-tree bootstrap | \`${RUNTIME}\` (requested) |"
            echo "| --- | --- |"
            echo "| Driver for later steps | \`${target}\` |"
        } >> "$GITHUB_STEP_SUMMARY"
    fi
}

if [ -f packages/infra/cli/lib/index.js ]; then
    echo "Node CLI entry present — the .bin shim is usable, skipping build:infra."
    report_shim
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

if [ "$RUNTIME" = 'gjs' ]; then
    # The revert this file's header describes, reachable without editing it.
    # `$GJSIFY_BOOTSTRAP` is the PREVIOUS release's CLI, which is why a defect
    # here can only be repaired by a release — see the header, and the canary in
    # release-cut.yml that exercises this arm on every cut without blocking it.
    gjs -m "$GJSIFY_BOOTSTRAP" run build:infra
else
    node /tmp/gjsify-node-cli/node_modules/@gjsify/cli/lib/index.js run build:infra
fi

# Hand it back. Left dangling, `verify-committed-bundles` rebuilt
# affected.gjs.mjs 157 bytes short and reported it STALE — the check was right,
# it was being handed the wrong compiler.
ln -sf "$PWD/packages/infra/cli/lib/index.js" node_modules/.bin/gjsify
echo "Handed back to the freshly built CLI: $(node_modules/.bin/gjsify --version)"
report_shim
