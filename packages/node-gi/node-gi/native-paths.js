// SPDX-License-Identifier: MIT
// @gjsify/node-gi — WHERE the native addon lives. ONE definition, shared by the
// two decisions that must never disagree about it:
//
//   1. `index.js#loadNative()` — which binary a CONSUMER loads at runtime.
//   2. `scripts/install.mjs` — whether the `install` lifecycle script has to run
//      a node-gyp source build at all.
//
// WHY THIS MODULE EXISTS: those two used to be one implementation and one
// hard-coded string in a different file. `prebuilds/<platform>-<arch>/node_gi.node`
// spelled twice is the setup for the two silent failures nobody sees in CI — a
// guard that skips the build because it looked in a directory the loader does not
// probe (install succeeds, the first `import` throws), or a guard that rebuilds on
// every install while a perfectly good prebuild sits right beside it (the defect
// the guard was added to remove). Sharing the probe makes both impossible by
// construction: the target-dir spelling, the addon filename and the candidate
// ORDER exist exactly once, here.
//
// NOT the same question as `resolveAddonPath()` in
// packages/infra/rolldown-plugin-gjsify (the `@gjsify/napi` bundler seam). That
// one replicates node-gyp-build's probe order for ARBITRARY third-party addons
// being bundled for `--app gjs`: `build/Release` → `build/Debug` → prebuild, with
// node-gyp-build's `<runtime>.<abi|napi>.node` tag grammar. node-gi's own default
// is deliberately the OPPOSITE way round (prebuild FIRST — see nativeCandidates
// below) and its artifact is a plain `node_gi.node`. Two different questions, two
// definitions; this file is the authority for node-gi's own binary, and the third
// copy is the one that must never be written.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The package root. This module sits beside `index.js`, so its own directory IS
 * the root — the same anchor `index.js` used before the extraction.
 */
export const packageRoot = dirname(fileURLToPath(import.meta.url));

/**
 * The addon's file name, identical in `build/{Release,Debug}/` and in a staged
 * `prebuilds/<target>/` (scripts/stage-prebuild.mjs copies it verbatim). NOT
 * node-gyp-build's tag grammar — nothing in this package parses tags.
 */
export const ADDON_FILENAME = 'node_gi.node';

/**
 * The `<os>-<arch>` prebuild target spelling — `${process.platform}-${process.arch}`,
 * the ONE spelling used across the whole workspace (see AGENTS.md § Runtime &
 * platform model: it is what a running process computes about itself, so
 * resolution needs no translation).
 *
 * A pure function of its arguments so the darwin/win32 branches of anything
 * built on it stay testable from a Linux host; the host values are read only at
 * the outermost call site, as defaults.
 * @param {string} [platform] defaults to `process.platform`
 * @param {string} [arch] defaults to `process.arch`
 * @returns {string} e.g. `linux-x64`, `win32-x64`, `darwin-arm64`
 */
export function hostTarget(platform = process.platform, arch = process.arch) {
    return `${platform}-${arch}`;
}

/**
 * Absolute path of the SHIPPED prebuild for a target. This is the path
 * `scripts/stage-prebuild.mjs` writes, `files: ["prebuilds"]` publishes,
 * `loadNative()` prefers, and `scripts/install.mjs` tests for.
 * @param {string} [target] defaults to the running host's target
 * @returns {string}
 */
export function prebuildAddonPath(target = hostTarget()) {
    return join(packageRoot, 'prebuilds', target, ADDON_FILENAME);
}

/**
 * Absolute path of a LOCALLY BUILT addon — what `node-gyp rebuild` writes.
 * @param {'Release' | 'Debug'} [flavor]
 * @returns {string}
 */
export function buildAddonPath(flavor = 'Release') {
    return join(packageRoot, 'build', flavor, ADDON_FILENAME);
}

/**
 * The ordered list of addon paths to try, most-preferred first.
 *
 * `NODE_GI_NATIVE` pins which binary loads. The package's own test scripts set
 * `build` so local verification always exercises the JUST-BUILT addon — a stale
 * staged prebuild would otherwise shadow build/Release and silently validate the
 * wrong binary (the consumer-facing default below prefers the prebuild).
 *
 * Default order: prefer a shipped prebuild so a consumer needs no C toolchain and
 * no node-gyp — the only install path Deno supports (it runs no postinstall build
 * script). Fall back to a locally built addon (Release, then Debug).
 * @param {Record<string, string | undefined>} [env] defaults to `process.env`
 * @returns {string[]}
 */
export function nativeCandidates(env = process.env) {
    const prebuild = prebuildAddonPath();
    const release = buildAddonPath('Release');
    const debug = buildAddonPath('Debug');
    const prefer = env.NODE_GI_NATIVE;
    if (prefer === 'build') return [release, debug, prebuild];
    if (prefer === 'prebuild') return [prebuild];
    if (prefer) return [prefer]; // an explicit path to a node_gi.node
    return [prebuild, release, debug];
}
