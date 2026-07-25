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
//
// TODO(napi-rs): the sibling/direct interception below correctly LOCATES a
// napi-rs addon's `.node` and routes it through `loadAddon`, and it fully
// supports importing a platform sibling DIRECTLY (`@scope/pkg-<triple>`). But a
// napi-rs GENERATED index (`@node-rs/argon2/index.js`) wraps that acquisition in
// a `require('node:module')` + `createRequire` + runtime `existsSync`/`process`
// branch chain whose CJS body does NOT survive `--app gjs` bundling (`ReferenceError:
// require`). Full transparency for the generated loader therefore needs the loader
// ENTRY replaced wholesale (the pinned resolver's `entryReplace` shape) once the
// entry can be robustly auto-detected — deferred. The C/C++ path (node-gyp-build +
// bindings) is the must-have and is proven byte-identical in the transparent gate.
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

import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'rolldown';

const NAPI_ADDON_VIRTUAL_PREFIX = '\0gjsify-napi-addon:';

/** The kinds of interception, encoded into the virtual-module id. */
type AddonShimKind = 'direct' | 'node-gyp-build' | 'bindings' | 'napi-rs';

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

/** Fast-path filter (superset of what `claimSpecifier` claims). Handler re-checks. */
const ADDON_FILTER_RE = new RegExp(
    [
        /\.node$/.source, // direct .node
        /^node-gyp-build(?:\/index\.js)?$/.source, // node-gyp-build helper
        /^bindings(?:\/bindings\.js)?$/.source, // bindings helper
        NAPI_RS_TRIPLE_RE.source, // napi-rs platform sibling
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
            async handler(source, importer) {
                const cls = classifySpecifier(source);
                if (cls === null) return null;
                const ctx = this as unknown as AddonResolveContext;

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
            },
        },
        load(id) {
            const decoded = decodeVirtual(id);
            if (decoded === null) return null;
            return { code: shimFor(decoded.kind, decoded.addonPath), moduleSideEffects: false };
        },
    };
}
