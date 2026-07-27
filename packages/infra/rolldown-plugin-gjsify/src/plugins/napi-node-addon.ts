// For `--app gjs`: transparently route a compiled N-API `.node` addon through
// `@gjsify/napi`'s `loadAddon()` so `import Database from 'better-sqlite3'` /
// `require('bufferutil')` "just works" in a GJS build — no per-project shim, no
// hand-pinned addon path.
//
// This is the FORWARD MIRROR of `gjsGiNodePlugin` (`gjs-gi-node.ts`): that
// plugin rewrites `gi://Ns` → `requireGi` for `--app node` (run GObject code on
// Node); this one rewrites a native-addon acquisition → `loadAddon` for
// `--app gjs` (run Node's `.node` addons on GJS). Both intercept the ONE
// specifier a bundler can see and replace it with a virtual module whose value
// is the runtime bridge.
//
// The problem is always the same: the compiled `.node` is acquired with a
// DYNAMIC `require(<computed path>)` no bundler can rewrite. So we intercept the
// well-known helper the addon uses and replace it with a virtual module that
// returns `loadAddon('<abs .node>')`. Handled conventions (keyed by the import
// a bundler DOES see):
//
//   - direct `.node`     — a `source` (or a `@scope/pkg-<triple>` sibling that
//                          resolves to a `.node`) ending in `.node`.
//   - `node-gyp-build`   — prebuildify layout (bufferutil, utf-8-validate, …).
//                          Default export is a `load(dir)` function.
//   - `bindings`         — node-bindings layout (better-sqlite3, node-sqlite3).
//                          Default export is a `bindings(name)` function.
//   - napi-rs sibling    — `@scope/pkg-<triple>` platform package (or local
//                          `pkg.<triple>.node` fallback), whose exports ARE the
//                          addon API.
//   - napi-rs ENTRY      — the napi-rs GENERATED loader index
//                          (`@node-rs/argon2/index.js`), detected by a
//                          package.json signal and replaced WHOLESALE.
//
// napi-rs GENERATED-LOADER ENTRY replacement: a napi-rs generated index
// (`@node-rs/argon2/index.js`) wraps its acquisition in a
// `require('node:module')` + `createRequire(__filename)` + runtime
// `existsSync`/`process` branch chain whose CJS body does NOT survive `--app gjs`
// bundling (the top-level `require = createRequire(...)` reassignment throws
// `ReferenceError: require`). The sibling/direct interceptions above correctly
// LOCATE the `.node` but cannot rescue that body. So when the entry of a napi-rs
// package resolves, we replace the WHOLE module with
// `module.exports = loadAddon('<abs platform .node>')` (the `napi-rs-entry`
// kind) — the platform `.node` is the current-triple sibling package (only the
// host's optionalDependency is installed) or a local `pkg.<triple>.node`. The
// sibling is named `<self>-<triple>` OR `<napi.packageName>-<triple>`; both
// schemes ship in the wild and `isNapiRsSibling` knows both, which is what
// makes `rolldown`/`oxfmt`/`oxlint` (all `@<scope>/binding-<triple>`) reachable
// and not just `lightningcss`/`@node-rs/*`. Detection is CONSERVATIVE (package.json signal +
// the file must be the package's own native `main` entry + a real host `.node`
// must resolve) so it never rewrites an unrelated package's entry; when no
// current-platform `.node` resolves we fall through to normal resolution rather
// than emit a shim over a missing file. The C/C++ path (node-gyp-build +
// bindings) and napi-rs are all proven byte-identical in the transparent gate.
//
// The addon's compiled `.node` is located by `resolveAddonPath()`, which
// replicates node-gyp-build's OWN selection algorithm (build/Release →
// build/Debug → prebuilds/<platform>-<arch>/<best tag>) so the GJS build routes
// the SAME binary Node would load.
//
// KEY: the shims import `@gjsify/napi` by BARE SPECIFIER (`require('@gjsify/napi')`).
// `@gjsify/napi`'s L1 is a `gjs:polyfill` package reading `imports.gi`; it
// bundles normally, and its native typelib is auto-added to `GI_TYPELIB_PATH` by
// the CLI's `detectNativePackages` (because it declares `gjsify.prebuilds`). The
// callable-helper shims (`node-gyp-build`/`bindings`) stay CJS
// (`module.exports = fn`) so the consumer's `require('node-gyp-build')(dir)`
// call site keeps working through gjsify's cjs-compat interop — a callable, not
// an ESM namespace.
//
// Portability note (same as `gjs-gi-node.ts`): the `filter` is a Rolldown
// fast-path; the internal guard in the handler is the load-bearing check so the
// plugin is correct even when the filter does not pre-filter.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';

const NAPI_ADDON_VIRTUAL_PREFIX = `${GJSIFY_VIRTUAL_PREFIX}napi-addon:`;

/** The kinds of interception, encoded into the virtual-module id. */
type AddonShimKind = 'direct' | 'node-gyp-build' | 'bindings' | 'napi-rs' | 'napi-rs-entry';

/** Bare specifier the shims import — resolved + bundled from the consumer graph. */
const NAPI_BARE_SPECIFIER = '@gjsify/napi';

/**
 * Platform-triple tail of a napi-rs sibling platform package
 * (`@node-rs/argon2-linux-x64-gnu`) or its local fallback
 * (`argon2.linux-x64-gnu.node`). Deliberately narrow — an interception on a
 * false match is self-correcting (it only fires when the specifier ALSO
 * resolves to a real `.node`), but keeping the shape tight avoids needless
 * `this.resolve` probes on ordinary deps.
 */
const NAPI_RS_TRIPLE_RE =
    /-(?:linux|darwin|win32|freebsd|openbsd|sunos|android|aix)-(?:x64|arm64|arm|ia32|ppc64|s390x|riscv64|loong64)(?:-(?:gnu|musl|msvc|eabi|eabihf|androideabi|gnueabihf))?$/;

/**
 * A BARE package specifier (`lightningcss`, `@rolldown/binding-…`) — no leading
 * `.`/`/`/`\`, no protocol (`node:fs`, `gi://Gtk`, `data:…`, `C:\…`), not a
 * `\0` virtual id.
 *
 * Needed because a napi-rs generated loader acquires its binary through a
 * specifier the bundler CANNOT see: `require(`lightningcss-${parts.join('-')}`)`
 * / `require(`../lightningcss.${parts.join('-')}.node`)` are template literals
 * computed at runtime. So neither the sibling nor the direct-`.node`
 * interception can fire, and the only lever is replacing the loader ENTRY —
 * which the caller reaches by its BARE name. Matching only path-shaped ids (as
 * before) meant `import { transform } from 'lightningcss'` was never even
 * offered to the handler, and the addon gate had to hand-alias every bare
 * specifier to its native entry to get coverage.
 *
 * PORTABILITY, and it is load-bearing: this source feeds `ADDON_FILTER_RE`,
 * which `@gjsify/rolldown-native` hands to the Rust core as an `idFilter`
 * STRING. Rust's `regex` crate has no lookaround and no `\0` escape, and it
 * rejects the WHOLE combined filter rather than the offending branch — which
 * silently disables every interception under the GJS engine while npm
 * `rolldown` on Node keeps working. So: no `(?!…)`, and NUL is spelled `\x00`.
 * The asymmetry is invisible to the addon gate, which drives the Node CLI
 * entry, so only a real `--app gjs` build under `gjs` catches a regression here.
 */
// oxlint-disable-next-line no-control-regex -- the NUL is the point: it marks a bundler VIRTUAL id (`\0gjsify-…`), which is never a package specifier and must not be probed.
const BARE_SPECIFIER_RE = /^[^.\\/:\s\x00][^:\s\x00]*$/;

/**
 * Fast-path filter (superset of what `claimSpecifier` claims). Handler re-checks.
 *
 * Exported so `napi-node-addon.spec.ts` can assert its Rust-compatibility (see
 * {@link BARE_SPECIFIER_RE}) — a JS-only construct here disables the plugin
 * entirely under `@gjsify/rolldown-native`, and no build-level test would see
 * it, because every addon gate drives the Node CLI entry.
 */
export const ADDON_FILTER_RE = new RegExp(
    [
        /\.node$/.source, // direct .node
        /^node-gyp-build(?:\/index\.js)?$/.source, // node-gyp-build helper
        /^bindings(?:\/bindings\.js)?$/.source, // bindings helper
        NAPI_RS_TRIPLE_RE.source, // napi-rs platform sibling
        // napi-rs generated-loader ENTRY: the conventional package-root
        // `index.{js,cjs,mjs}` a napi-rs build emits. Narrow on purpose (only
        // `index.*`, not every `.js`) — the handler's `detectNapiRsEntry` gate
        // (package.json signal + native-main match) is the load-bearing check.
        /[/\\]index\.[cm]?js$/.source,
        // A bare specifier, so the handler can resolve it and test the RESOLVED
        // file. Broad by design; the handler's fast rejects keep it cheap.
        BARE_SPECIFIER_RE.source,
    ].join('|'),
);

/** Options for {@link napiNodeAddonPlugin}. */
export interface NapiNodeAddonPluginOptions {
    /**
     * Emit a one-line warning when a native addon is intercepted but
     * `@gjsify/napi` is not resolvable in the consumer graph. Default `true`.
     */
    warnOnMissingNapi?: boolean;
}

// ---------------------------------------------------------------------------
// Addon `.node` path resolution — a faithful port of node-gyp-build's own
// `load.resolve(dir)` (`node_modules/node-gyp-build/node-gyp-build.js`). Do NOT
// "improve" the order: build/Release wins over prebuilds there, so the GJS build
// must route the SAME binary Node loads. The prebuilds tag/tuple selection is
// ported verbatim (parseTuple/matchTuple/compareTuples + parseTags/matchTags/
// compareTags) but tolerant of a missing `abi` (undefined under a GJS build host
// — where only napi-tagged, runtime-agnostic prebuilds legitimately match).
// ---------------------------------------------------------------------------

interface HostTarget {
    platform: string;
    arch: string;
    libc: 'glibc' | 'musl';
    abi: string | undefined; // process.versions.modules — undefined under GJS
    uv: string;
    armv: string;
    runtime: 'node';
}

function isMusl(platform: string): boolean {
    // Match node-gyp-build's isAlpine() probe.
    return platform === 'linux' && existsSync('/etc/alpine-release');
}

function hostTarget(): HostTarget {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;
    const abi = process.versions ? process.versions.modules : undefined;
    const uv = ((process.versions && process.versions.uv) || '').split('.')[0] || '';
    const armv = process.env.ARM_VERSION || (arch === 'arm64' ? '8' : '') || '';
    const libc: 'glibc' | 'musl' = process.env.LIBC === 'musl' || isMusl(platform) ? 'musl' : 'glibc';
    return { platform, arch, libc, abi, uv, armv, runtime: 'node' };
}

function readdirSafe(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

/** First `*.node` in `dir` (sorted for determinism), or null. */
function firstNodeFile(dir: string): { file: string; all: string[] } | null {
    const all = readdirSafe(dir)
        .filter((n) => n.endsWith('.node'))
        .sort();
    if (all.length === 0) return null;
    return { file: all[0], all };
}

interface Tuple {
    name: string;
    platform: string;
    architectures: string[];
}

function parseTuple(name: string): Tuple | null {
    const arr = name.split('-');
    if (arr.length !== 2) return null;
    const platform = arr[0];
    const architectures = arr[1].split('+');
    if (!platform || architectures.length === 0 || !architectures.every(Boolean)) return null;
    return { name, platform, architectures };
}

interface Tags {
    file: string;
    specificity: number;
    runtime?: string;
    napi?: boolean;
    abi?: string;
    uv?: string;
    armv?: string;
    libc?: string;
}

function parseTags(file: string): Tags | null {
    const arr = file.split('.');
    const extension = arr.pop();
    const tags: Tags = { file, specificity: 0 };
    if (extension !== 'node') return null;
    for (const tag of arr) {
        if (tag === 'node' || tag === 'electron' || tag === 'node-webkit') {
            tags.runtime = tag;
        } else if (tag === 'napi') {
            tags.napi = true;
        } else if (tag.slice(0, 3) === 'abi') {
            tags.abi = tag.slice(3);
        } else if (tag.slice(0, 2) === 'uv') {
            tags.uv = tag.slice(2);
        } else if (tag.slice(0, 4) === 'armv') {
            tags.armv = tag.slice(4);
        } else if (tag === 'glibc' || tag === 'musl') {
            tags.libc = tag;
        } else {
            continue;
        }
        tags.specificity++;
    }
    return tags;
}

function runtimeAgnostic(tags: Tags): boolean {
    return tags.runtime === 'node' && tags.napi === true;
}

/**
 * Resolve the best `prebuilds/<platform>-<arch>/<file>.node` for `pkgRoot`,
 * ported from node-gyp-build's `resolve(dir)` — tolerant of a missing `abi`.
 */
function resolvePrebuild(pkgRoot: string, host: HostTarget): string | null {
    const prebuildsDir = join(pkgRoot, 'prebuilds');
    const tuple = readdirSafe(prebuildsDir)
        .map(parseTuple)
        .filter((t): t is Tuple => t !== null && t.platform === host.platform && t.architectures.includes(host.arch))
        // Prefer single-arch prebuilds over multi-arch (compareTuples).
        .sort((a, b) => a.architectures.length - b.architectures.length)[0];
    if (!tuple) return null;

    const tupleDir = join(prebuildsDir, tuple.name);
    const winner = readdirSafe(tupleDir)
        .map(parseTags)
        .filter((t): t is Tags => {
            if (t === null) return false;
            if (t.runtime && t.runtime !== host.runtime && !runtimeAgnostic(t)) return false;
            // abi undefined (GJS host): reject an abi-pinned, non-napi prebuild —
            // only runtime-agnostic napi prebuilds legitimately match.
            if (t.abi && t.abi !== host.abi && !t.napi) return false;
            if (t.uv && t.uv !== host.uv) return false;
            if (t.armv && t.armv !== host.armv) return false;
            if (t.libc && t.libc !== host.libc) return false;
            return true;
        })
        // compareTags: matching runtime first, abi over napi, then specificity.
        .sort((a, b) => {
            if (a.runtime !== b.runtime) return a.runtime === host.runtime ? -1 : 1;
            if (a.abi !== b.abi) return a.abi ? -1 : 1;
            if (a.specificity !== b.specificity) return a.specificity > b.specificity ? -1 : 1;
            return 0;
        })[0];
    return winner ? join(tupleDir, winner.file) : null;
}

/** A native addon package root has no resolvable compiled `.node`. */
export class AddonNotBuiltError extends Error {
    constructor(pkgRoot: string) {
        super(
            `[gjsify-napi-addon] no compiled .node found for '${pkgRoot}'. Build it ` +
                `(node-gyp / prebuildify) or install a prebuild before bundling for --app gjs.`,
        );
        this.name = 'AddonNotBuiltError';
    }
}

/**
 * Locate the compiled `.node` for an addon package root, matching
 * node-gyp-build's probe order: `build/Release` → `build/Debug` →
 * `prebuilds/<platform>-<arch>/<best tag>`. Throws {@link AddonNotBuiltError}
 * when nothing is found.
 *
 * @param pkgRoot Absolute path to the addon package root (dir with package.json).
 * @param opts.warn Optional sink for a non-fatal warning (ambiguous build dir).
 */
export function resolveAddonPath(pkgRoot: string, opts?: { warn?: (msg: string) => void }): string {
    const host = hostTarget();

    for (const flavor of ['Release', 'Debug']) {
        const dir = join(pkgRoot, 'build', flavor);
        const hit = firstNodeFile(dir);
        if (hit) {
            if (hit.all.length > 1 && opts?.warn) {
                opts.warn(
                    `[gjsify-napi-addon] ${hit.all.length} .node files in ${dir} ` +
                        `(${hit.all.join(', ')}); picking '${hit.file}'. If wrong, import the ` +
                        `.node directly.`,
                );
            }
            return join(dir, hit.file);
        }
    }

    const prebuild = resolvePrebuild(pkgRoot, host);
    if (prebuild) return prebuild;

    throw new AddonNotBuiltError(pkgRoot);
}

/**
 * Walk up from an importer file to the nearest `package.json` directory (the
 * addon package root). Returns null when none is found (should not happen for a
 * real node_modules dep).
 */
export function nearestPackageRoot(importerFile: string): string | null {
    let dir = isAbsolute(importerFile) ? dirname(importerFile) : dirname(resolve(importerFile));
    // Guard against an infinite loop at the filesystem root.
    for (let i = 0; i < 64; i++) {
        if (existsSync(join(dir, 'package.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Shim generators — the virtual-module bodies. All import `@gjsify/napi` by BARE
// specifier. The callable-helper shims are CJS (`module.exports = fn`) so the
// consumer's `require('node-gyp-build')(dir)` / `require('bindings')(name)` stays
// callable through cjs-compat interop.
// ---------------------------------------------------------------------------

/** Direct `.node` import → the addon's exports (ESM default). */
export function directNodeShim(addonPath: string): string {
    return (
        `import { loadAddon } from ${JSON.stringify(NAPI_BARE_SPECIFIER)};\n` +
        `export default loadAddon(${JSON.stringify(addonPath)});\n`
    );
}

/** `node-gyp-build` replacement — a callable `load(dir)` carrying `.path()`. */
export function nodeGypBuildShim(addonPath: string): string {
    return (
        `const { loadAddon } = require(${JSON.stringify(NAPI_BARE_SPECIFIER)});\n` +
        `function load() { return loadAddon(${JSON.stringify(addonPath)}); }\n` +
        `load.path = function () { return ${JSON.stringify(addonPath)}; };\n` +
        `load.resolve = load.path;\n` +
        `module.exports = load;\n`
    );
}

/** `bindings` replacement — a callable `bindings(name)` returning the addon. */
export function bindingsShim(addonPath: string): string {
    return (
        `const { loadAddon } = require(${JSON.stringify(NAPI_BARE_SPECIFIER)});\n` +
        `function bindings() { return loadAddon(${JSON.stringify(addonPath)}); }\n` +
        `module.exports = bindings;\n`
    );
}

/** napi-rs sibling → the raw native exports as the module value. */
export function napiRsShim(addonPath: string): string {
    return (
        `const { loadAddon } = require(${JSON.stringify(NAPI_BARE_SPECIFIER)});\n` +
        `module.exports = loadAddon(${JSON.stringify(addonPath)});\n`
    );
}

function shimFor(kind: AddonShimKind, addonPath: string): string {
    switch (kind) {
        case 'direct':
            return directNodeShim(addonPath);
        case 'node-gyp-build':
            return nodeGypBuildShim(addonPath);
        case 'bindings':
            return bindingsShim(addonPath);
        case 'napi-rs':
        case 'napi-rs-entry':
            // Both hand back the raw native exports as the module value. The
            // `napi-rs-entry` kind replaces the whole GENERATED loader; `napi-rs`
            // replaces a directly-imported platform sibling. Same body.
            return napiRsShim(addonPath);
    }
}

function encodeVirtual(kind: AddonShimKind, addonPath: string): string {
    return `${NAPI_ADDON_VIRTUAL_PREFIX}${kind}:${addonPath}`;
}

function decodeVirtual(id: string): { kind: AddonShimKind; addonPath: string } | null {
    if (!id.startsWith(NAPI_ADDON_VIRTUAL_PREFIX)) return null;
    const rest = id.slice(NAPI_ADDON_VIRTUAL_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep === -1) return null;
    const kind = rest.slice(0, sep) as AddonShimKind;
    const addonPath = rest.slice(sep + 1);
    return { kind, addonPath };
}

/**
 * Classify a specifier for interception. Pure decision logic (no filesystem
 * probing beyond what `resolveAddonPath` does via the importer) — exported for
 * the unit tests. Returns the shim kind + the package root to probe, or the
 * literal `.node` path for the direct case.
 */
export function classifySpecifier(
    source: string,
): { kind: 'node-gyp-build' | 'bindings' } | { kind: 'direct-node' } | { kind: 'napi-rs-candidate' } | null {
    if (source === 'node-gyp-build' || source === 'node-gyp-build/index.js') return { kind: 'node-gyp-build' };
    if (source === 'bindings' || source === 'bindings/bindings.js') return { kind: 'bindings' };
    if (source.endsWith('.node')) return { kind: 'direct-node' };
    // A napi-rs platform sibling (`@scope/pkg-<triple>`) — only a CANDIDATE; the
    // handler confirms by resolving it to a real `.node`.
    const last = source.split('/').pop() ?? source;
    if (!source.startsWith('.') && NAPI_RS_TRIPLE_RE.test(last)) return { kind: 'napi-rs-candidate' };
    return null;
}

// ---------------------------------------------------------------------------
// napi-rs GENERATED-LOADER ENTRY detection + platform `.node` resolution.
//
// A napi-rs package ships a generated `index.js` loader whose CJS body
// (`require = createRequire(__filename)` + a per-platform require chain) does
// not survive `--app gjs` bundling. We detect that the RESOLVED entry is such a
// package's native `main` and replace the whole module. Detection is by
// package.json SIGNAL (preferred over source-shape sniffing) and is deliberately
// conservative so we never hijack an unrelated package's entry.
// ---------------------------------------------------------------------------

/** Minimal package.json shape read for napi-rs detection. */
export interface AddonPackageJson {
    name?: string;
    main?: string;
    module?: string;
    exports?: unknown;
    browser?: string;
    napi?: unknown;
    optionalDependencies?: Record<string, string>;
}

/**
 * A package.json describes a napi-rs generated-loader package when EITHER
 * signal holds — both are package.json-level (not source sniffing):
 *
 *   (a) a top-level `napi` config OBJECT (`{ binaryName, targets, … }`) — the
 *       napi-rs CLI's own build block. An ordinary npm package never declares a
 *       `napi` object at the manifest root.
 *   (b) at least one `optionalDependencies` entry that is a platform SIBLING
 *       (see {@link isNapiRsSibling}) — the napi-rs prebuilt-binary convention,
 *       under either naming scheme: `<self>-<triple>` (`@node-rs/argon2` ships
 *       `@node-rs/argon2-linux-x64-gnu`) or `<napi.packageName>-<triple>`
 *       (`rolldown` ships `@rolldown/binding-linux-x64-gnu`). The key MUST
 *       carry a known prefix AND end in a platform triple, so a normal optional
 *       dep (`fsevents`) can't match.
 *
 * Neither fires on a normal package, so pairing this with the "resolved file IS
 * the package's own native main entry" check (see {@link detectNapiRsEntry})
 * makes entry-replacement safe. Exported for the unit tests.
 */
export function isNapiRsPackageJson(pkg: AddonPackageJson): boolean {
    if (pkg && typeof pkg.napi === 'object' && pkg.napi !== null) return true;
    const opt = pkg?.optionalDependencies;
    if (opt) {
        for (const dep of Object.keys(opt)) {
            if (isNapiRsSibling(pkg, dep)) return true;
        }
    }
    return false;
}

function readPackageJsonSafe(pkgRoot: string): AddonPackageJson | null {
    try {
        return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as AddonPackageJson;
    } catch {
        return null;
    }
}

/**
 * Decide whether an absolute file path is the NATIVE generated-loader entry of a
 * napi-rs package. Returns the package root + parsed manifest when it is, else
 * null. "Native entry" = the package's `main` (default `index.js`) — NOT its
 * `browser`/wasm fallback and NOT a deep file — so we only ever replace the one
 * generated loader, never an unrelated module. Filesystem-based (reads the
 * nearest package.json); the plugin memoizes calls. Exported for the unit tests.
 */
export function detectNapiRsEntry(entryFile: string): { pkgRoot: string; pkg: AddonPackageJson } | null {
    if (!isAbsolute(entryFile) || !/\.[cm]?js$/.test(entryFile)) return null;
    const pkgRoot = nearestPackageRoot(entryFile);
    if (pkgRoot === null) return null;
    const pkg = readPackageJsonSafe(pkgRoot);
    if (pkg === null || !isNapiRsPackageJson(pkg)) return null;
    // The resolved file must be one of the package's OWN native entry points —
    // reject a `browser`/wasm fallback or any deep module inside the package.
    const target = stripJsExt(resolve(entryFile));
    const isNativeEntry = nativeEntrySpecs(pkg).some((spec) => stripJsExt(resolve(pkgRoot, spec)) === target);
    if (!isNativeEntry) return null;
    return { pkgRoot, pkg };
}

/** Drop a trailing `.js` / `.mjs` / `.cjs` — see {@link nativeEntrySpecs}. */
function stripJsExt(p: string): string {
    return p.replace(/\.[cm]?js$/, '');
}

/**
 * Every path a napi-rs manifest names as its NATIVE entry — `main`, `module`,
 * and the `exports["."]` target(s) — with the `browser` condition deliberately
 * excluded (that is the wasm / pure-JS fallback, which must keep resolving
 * normally: it needs no addon and works on GJS as-is).
 *
 * Both halves of this matter, and each was a real miss:
 *
 *   - `main` ALONE is not enough. A dual package declares the CJS twin in
 *     `main` while a bundler resolves the ESM one — `lightningcss` says
 *     `main: "node/index.js"` and ships `node/index.mjs` beside it, which is
 *     what `--app gjs` actually loads. Comparing only against `main` rejected
 *     the very file being bundled, so the rewrite silently never happened and
 *     the generated loader's runtime `require(\`lightningcss-${…}\`)` shipped
 *     into the bundle.
 *   - Matching is therefore extension-INSENSITIVE (`stripJsExt`): the `.js` /
 *     `.mjs` / `.cjs` twins of a declared entry are the same generated loader.
 *     It stays narrow because the path itself must still be one the manifest
 *     names — a deep module inside the package never matches.
 *
 * Defaults to `index.js` (node's own default `main`) when the manifest names
 * nothing at all.
 */
function nativeEntrySpecs(pkg: AddonPackageJson): string[] {
    const specs: string[] = [];
    const add = (v: unknown): void => {
        if (typeof v === 'string' && v && !specs.includes(v)) specs.push(v);
    };
    add(pkg.main);
    add(pkg.module);
    // `exports["."]` is a string, or a condition object whose values are
    // strings / nested condition objects. Walk it, skipping `browser`.
    const walk = (node: unknown, depth: number): void => {
        if (typeof node === 'string') return add(node);
        if (depth > 4 || node === null || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [condition, value] of Object.entries(node as Record<string, unknown>)) {
            if (condition === 'browser' || condition === 'types') continue;
            walk(value, depth + 1);
        }
    };
    const exportsField = pkg.exports;
    if (typeof exportsField === 'string') {
        add(exportsField);
    } else if (exportsField !== null && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
        const map = exportsField as Record<string, unknown>;
        // Two legal shapes: a SUBPATH map (keys start with `.`) — then only `.`
        // is the package entry — or a bare CONDITION object, which IS the entry.
        // Distinguishing them matters: walking a subpath map wholesale would
        // make `./some-subpath` a candidate entry.
        const isSubpathMap = Object.keys(map).some((k) => k.startsWith('.'));
        walk(isSubpathMap ? map['.'] : map, 0);
    }
    if (specs.length === 0) specs.push('index.js');
    return specs;
}

/** napi-rs binaryName (from `napi.binaryName`/`napi.name`, else the unscoped pkg name). */
function napiBinaryName(pkg: AddonPackageJson): string | null {
    const napi = pkg.napi;
    if (napi && typeof napi === 'object') {
        const cfg = napi as { binaryName?: unknown; name?: unknown };
        const bn = typeof cfg.binaryName === 'string' ? cfg.binaryName : cfg.name;
        if (typeof bn === 'string' && bn) return bn;
    }
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name.replace(/^@[^/]+\//, '');
    return null;
}

/**
 * The name PREFIXES a napi-rs package's platform siblings can carry, most
 * specific first. A sibling is always `<prefix>-<triple>`.
 *
 * Two conventions are in the wild, and only knowing both covers the toolchain
 * this project builds on:
 *
 *   - `<self>-<triple>` — the sibling is named after the package itself
 *     (`lightningcss` → `lightningcss-linux-x64-gnu`; `@node-rs/argon2` →
 *     `@node-rs/argon2-linux-x64-gnu`). This was the only shape handled.
 *   - `<napi.packageName>-<triple>` — napi-rs lets a package publish its
 *     binaries under a SEPARATE scope, declared in the manifest's own napi
 *     block. `rolldown` ships `@rolldown/binding-linux-x64-gnu`, `oxfmt`
 *     ships `@oxfmt/binding-linux-x64-gnu`, `oxlint` ships
 *     `@oxlint/binding-linux-x64-gnu` — none of which starts with the
 *     package's own name, so the `<self>-` test missed every one of them.
 *
 * That gap is why the three packages at the centre of this build chain
 * (bundler, formatter, linter) could not load transparently under GJS while
 * `lightningcss` could: `isNapiRsPackageJson` recognises all four (they all
 * carry a `napi` config object), so the ENTRY is detected — but with no
 * sibling resolvable, `resolveNapiRsEntryAddon` returns null and the rewrite
 * is skipped, leaving the generated loader's CJS body to ship into the bundle
 * and throw. Conservative by construction either way: a prefix only matters
 * when it also resolves to a real `.node`.
 *
 * `napi.packageName` is read defensively — an arbitrary manifest may put
 * anything there, and a non-string must not poison the prefix list.
 */
function napiSiblingPrefixes(pkg: AddonPackageJson): string[] {
    const prefixes: string[] = [];
    const napi = pkg.napi;
    if (napi && typeof napi === 'object') {
        const { packageName } = napi as { packageName?: unknown };
        if (typeof packageName === 'string' && packageName) prefixes.push(packageName);
    }
    if (typeof pkg.name === 'string' && pkg.name && !prefixes.includes(pkg.name)) prefixes.push(pkg.name);
    return prefixes;
}

/**
 * Is `dep` a platform sibling of `pkg` — `<prefix>-<triple>` for one of the
 * prefixes above? Both halves must hold: a bare prefix match would claim an
 * ordinary dependency, and a bare triple match would claim an unrelated
 * package's binaries. Exported for the unit tests.
 */
export function isNapiRsSibling(pkg: AddonPackageJson, dep: string): boolean {
    if (!NAPI_RS_TRIPLE_RE.test(dep)) return false;
    return napiSiblingPrefixes(pkg).some((prefix) => dep.startsWith(`${prefix}-`));
}

/**
 * The napi-rs short platform triple for the CURRENT host (`linux-x64-gnu`,
 * `darwin-arm64`, `win32-x64-msvc`, …) — the tail napi-rs stamps into a sibling
 * package name (`@node-rs/argon2-linux-x64-gnu`) and a local binary
 * (`argon2.linux-x64-gnu.node`). Selects BOTH the sibling package and the
 * local-file fallback — see `resolveNapiRsEntryAddon` for why the sibling path
 * cannot just take whatever resolves. Returns null for a host napi-rs doesn't
 * name, and the caller then widens rather than guessing.
 */
function hostNapiRsTriple(): string | null {
    const platform = process.platform;
    const arch = process.arch;
    const archTok: Record<string, string> = {
        x64: 'x64',
        arm64: 'arm64',
        arm: 'arm',
        ia32: 'ia32',
        ppc64: 'ppc64',
        s390x: 's390x',
        riscv64: 'riscv64',
    };
    const a = archTok[arch];
    if (!a) return null;
    switch (platform) {
        case 'linux': {
            if (arch === 'arm') return 'linux-arm-gnueabihf';
            const libc = process.env.LIBC === 'musl' || isMusl('linux') ? 'musl' : 'gnu';
            return `linux-${a}-${libc}`;
        }
        case 'darwin':
            return `darwin-${a}`;
        case 'win32':
            return `win32-${a}-msvc`;
        case 'freebsd':
            return `freebsd-${a}`;
        case 'android':
            return arch === 'arm' ? 'android-arm-eabi' : `android-${a}`;
        default:
            return null;
    }
}

/** Decode a napi virtual id back to its raw `.node` path (safety net for a resolve hit). */
function rawAddonPath(id: string): string {
    const decoded = decodeVirtual(id);
    return decoded ? decoded.addonPath : id;
}

/**
 * Resolve the current-platform compiled `.node` for a napi-rs generated-loader
 * package: the current-triple sibling package (`@scope/pkg-<triple>`, whose own
 * `main` IS the `.node` — npm installs ONLY the host's optionalDependency, so
 * the one that resolves is the host's), then a local `pkg.<triple>.node`. Reuses
 * the plugin's `ctx.resolve` sibling-resolution path (`skipSelf` so this
 * plugin's own napi-rs-candidate interception is bypassed → a raw `.node` id).
 * Returns null when no current-platform binary is present — the caller then
 * DOES NOT rewrite, so we never shim over a missing file.
 */
async function resolveNapiRsEntryAddon(
    ctx: AddonResolveContext,
    pkgRoot: string,
    pkg: AddonPackageJson,
    importer: string,
): Promise<string | null> {
    const siblings = Object.keys(pkg.optionalDependencies ?? {}).filter((dep) => isNapiRsSibling(pkg, dep));
    const triple = hostNapiRsTriple();
    // HOST TRIPLE FIRST, and alone whenever we can name it. The older code took
    // the first sibling that resolved, on the premise that "npm installs only
    // the host's optionalDependency, so the one that resolves is the host's".
    // That premise does not hold here: `gjsify install` materialises EVERY
    // platform package, so `lightningcss`'s `darwin-x64` sibling resolves on a
    // Linux box and won — baking a Mach-O `.dylib`-bearing `.node` into a linux
    // GJS bundle, which `loadAddon` can only fail on at runtime. Selecting by
    // the host triple is also what node-gyp-build and napi-rs' own generated
    // loaders do, so this matches the binary Node would have loaded.
    const ordered = triple === null ? siblings : siblings.filter((dep) => dep.endsWith(`-${triple}`));
    for (const dep of ordered) {
        const resolved = await ctx.resolve(dep, importer, { skipSelf: true });
        if (!resolved) continue;
        const abs = rawAddonPath(resolved.id);
        if (abs.endsWith('.node') && existsSync(abs)) return abs;
    }
    // Local in-package binary (`<binaryName>.<host-triple>.node`) — deterministic
    // host-triple match so a wrong-platform local file is never picked.
    const binaryName = napiBinaryName(pkg);
    if (binaryName && triple) {
        const local = join(pkgRoot, `${binaryName}.${triple}.node`);
        if (existsSync(local)) return local;
    }
    return null;
}

/** Minimal shape of the Rolldown PluginContext bits this plugin uses. */
interface AddonResolveContext {
    resolve(source: string, importer?: string, options?: { skipSelf?: boolean }): Promise<{ id: string } | null>;
    warn?: (msg: string) => void;
}

/** Emit a non-fatal warning through the context, if it supports it. */
function warnSafe(ctx: AddonResolveContext, msg: string): void {
    if (typeof ctx.warn === 'function') ctx.warn(msg);
}

/**
 * Resolve a direct `.node` specifier to an EXISTING absolute path
 * (relative/bare/abs), or null when it does not resolve to a real file. Null is
 * load-bearing: a napi-rs generated loader statically references a local
 * `./pkg.<triple>.node` fallback that is absent when the binary ships in the
 * sibling platform package — that dead branch must fall through to normal
 * (external) resolution, NOT be rewritten to a shim over a missing file.
 */
async function resolveNodeFile(
    ctx: AddonResolveContext,
    source: string,
    importer: string | undefined,
): Promise<string | null> {
    if (isAbsolute(source)) return existsSync(source) ? source : null;
    if (importer !== undefined) {
        // Importer-relative path math first (a plain `./foo.node`), then the full
        // resolver chain (a bare `pkg/foo.node`). Only claim an EXISTING file.
        const rel = resolve(dirname(importer), source);
        if (existsSync(rel)) return rel;
        const resolved = await ctx.resolve(source, importer, { skipSelf: true });
        if (resolved && resolved.id.endsWith('.node') && existsSync(resolved.id)) return resolved.id;
        return null;
    }
    return null;
}

/**
 * Transparent `.node`-addon loader for `gjsify build --app gjs`.
 *
 * resolveId (`order: 'pre'`, importer-aware) intercepts a native-addon
 * acquisition and rewrites it to a virtual module whose value is
 * `loadAddon('<abs .node>')`. Inert unless such a specifier is in the graph —
 * every other id returns null. Register ONLY for `--app gjs` (the C-ABI runs
 * under `@gjsify/napi`); never for node/browser/nativescript.
 */
export function napiNodeAddonPlugin(options: NapiNodeAddonPluginOptions = {}): Plugin {
    const warnOnMissingNapi = options.warnOnMissingNapi !== false;
    let missingNapiChecked = false;

    // Memoize napi-rs entry detection per resolved file — the `index.*` filter
    // fires the handler for every package's index entry across every build pass;
    // this bounds the package.json reads to one per unique entry file.
    const napiEntryCache = new Map<string, { pkgRoot: string; pkg: AddonPackageJson } | null>();
    function detectNapiRsEntryCached(entryFile: string): { pkgRoot: string; pkg: AddonPackageJson } | null {
        const cached = napiEntryCache.get(entryFile);
        if (cached !== undefined) return cached;
        const info = detectNapiRsEntry(entryFile);
        napiEntryCache.set(entryFile, info);
        return info;
    }

    // Bare-specifier → entry-file resolution, memoized per (specifier, importer
    // DIRECTORY) since that pair is what node resolution actually depends on.
    // The widened filter offers every bare import here and almost none of them
    // is a native addon, so this cache is what keeps the extra `ctx.resolve` to
    // one per unique pair rather than one per import site.
    const bareEntryCache = new Map<string, string | null>();

    /**
     * The FILE a specifier denotes, for napi-rs entry detection:
     *   - absolute path  → itself (an already-resolved or hand-aliased entry).
     *   - bare specifier → resolved through the full chain (so aliases and
     *     export conditions apply — under `--app gjs` that is what picks a
     *     package's `browser`/wasm fallback over its native entry, and
     *     `detectNapiRsEntry` then correctly declines to rewrite it).
     *   - anything else (relative paths) → null, unchanged from before.
     */
    async function entryFileFor(
        ctx: AddonResolveContext,
        source: string,
        importer: string | undefined,
    ): Promise<string | null> {
        if (isAbsolute(source)) return source;
        if (!BARE_SPECIFIER_RE.test(source)) return null;
        // Never recurse through our own shims' import.
        if (source === NAPI_BARE_SPECIFIER || source.startsWith(`${NAPI_BARE_SPECIFIER}/`)) return null;
        const key = `${source}\0${importer === undefined ? '' : dirname(importer)}`;
        const cached = bareEntryCache.get(key);
        if (cached !== undefined) return cached;
        let file: string | null = null;
        try {
            const resolved = await ctx.resolve(source, importer, { skipSelf: true });
            // An external / virtual / unresolvable id is not a file on disk.
            if (resolved && isAbsolute(resolved.id) && existsSync(resolved.id)) file = resolved.id;
        } catch {
            /* resolution failure is not our error to raise — fall through */
        }
        bareEntryCache.set(key, file);
        return file;
    }

    async function warnIfNapiMissing(ctx: AddonResolveContext, importer: string | undefined): Promise<void> {
        if (!warnOnMissingNapi || missingNapiChecked) return;
        missingNapiChecked = true; // check once per build — interception is rare
        try {
            const found = await ctx.resolve(NAPI_BARE_SPECIFIER, importer, { skipSelf: true });
            if (!found) {
                warnSafe(
                    ctx,
                    `[gjsify-napi-addon] a native .node addon was intercepted but '${NAPI_BARE_SPECIFIER}' ` +
                        `is not resolvable — the bundle will fail at load. Install it: gjsify install ${NAPI_BARE_SPECIFIER}`,
                );
            }
        } catch {
            /* best-effort probe */
        }
    }

    return {
        name: 'gjsify-napi-node-addon',
        resolveId: {
            order: 'pre' as const,
            filter: { id: ADDON_FILTER_RE },
            async handler(source, rawImporter) {
                const ctx = this as unknown as AddonResolveContext;
                // The two engines disagree on "no importer": npm `rolldown`
                // passes `undefined`, `@gjsify/rolldown-native` passes `null`
                // (its hook payload round-trips through JSON, which has no
                // `undefined`). Every guard below is written `=== undefined`,
                // and `null` passes all of them — `dirname(null)` then threw
                // `The "path" argument must be of type string. Received type
                // object` and took the whole GJS build down as an
                // UNHANDLEABLE_ERROR. Normalise once, at the boundary.
                const importer = typeof rawImporter === 'string' ? rawImporter : undefined;
                const cls = classifySpecifier(source);

                if (cls !== null) {
                    // Direct `.node` — resolve the file path itself.
                    if (cls.kind === 'direct-node') {
                        const abs = await resolveNodeFile(ctx, source, importer);
                        if (abs === null) return null; // unresolvable — let the default chain error
                        await warnIfNapiMissing(ctx, importer);
                        return { id: encodeVirtual('direct', abs) };
                    }

                    // napi-rs platform sibling — confirm it resolves to a `.node`.
                    if (cls.kind === 'napi-rs-candidate') {
                        const resolved = await ctx.resolve(source, importer, { skipSelf: true });
                        if (!resolved || !resolved.id.endsWith('.node')) return null; // not a native sibling
                        await warnIfNapiMissing(ctx, importer);
                        return { id: encodeVirtual('napi-rs', resolved.id) };
                    }

                    // node-gyp-build / bindings — probe the importer's package root.
                    if (importer === undefined) return null;
                    const pkgRoot = nearestPackageRoot(importer);
                    if (pkgRoot === null) return null;
                    const addonPath = resolveAddonPath(pkgRoot, { warn: (m) => warnSafe(ctx, m) }); // throws → build error
                    await warnIfNapiMissing(ctx, importer);
                    return { id: encodeVirtual(cls.kind, addonPath) };
                }

                // napi-rs GENERATED-LOADER ENTRY (`index.*` filter). Replace the
                // whole module only when the resolved file IS the native `main`
                // of a napi-rs package (package.json signal) AND a current-platform
                // `.node` resolves. Otherwise fall through (never a shim over a
                // missing file, never an unrelated package's entry rewritten).
                // The specifier may be the entry PATH (an internal import, or a
                // caller that already aliased it) or the package's BARE name —
                // the ordinary `import { transform } from 'lightningcss'`. For
                // the bare form the entry file is only known after resolution,
                // so resolve first and test the resolved id. `entryFileFor`
                // memoizes both the resolve and the rejection.
                const entryFile = await entryFileFor(ctx, source, importer);
                if (entryFile === null) return null;
                const entry = detectNapiRsEntryCached(entryFile);
                if (entry !== null) {
                    const addonPath = await resolveNapiRsEntryAddon(ctx, entry.pkgRoot, entry.pkg, entryFile);
                    if (addonPath !== null) {
                        await warnIfNapiMissing(ctx, importer);
                        return { id: encodeVirtual('napi-rs-entry', addonPath) };
                    }
                }
                return null;
            },
        },
        load(id) {
            const decoded = decodeVirtual(id);
            if (decoded === null) return null;
            return { code: shimFor(decoded.kind, decoded.addonPath), moduleSideEffects: false };
        },
    };
}
