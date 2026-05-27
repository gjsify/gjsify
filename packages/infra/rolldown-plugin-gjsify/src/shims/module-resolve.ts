// Runtime resolver for the on-disk location of a bundled `node_modules` file.
//
// Why this exists
// ---------------
// `rewrite-node-modules-paths.ts` rewrites a bundled module's `import.meta.url`
// / `__dirname` / `__filename` so that dynamic data-file reads (a dep loading
// its own i18n JSON, `package.json`, templates, …) still find those files on
// disk after bundling. The naive rewrite baked a path relative to the bundle's
// BUILD location, which is only correct while the bundle and `node_modules/`
// keep the arrangement they had at build time. Once the bundle is PUBLISHED in
// an npm package and installed at `node_modules/<pkg>/bin/<bundle>`, that baked
// path lands one `node_modules` level too deep → ENOENT at runtime.
//
// Instead we resolve the dep at RUNTIME from the bundle's actual location, so
// it works wherever the bundle ends up.
//
// Three correctness constraints shape the implementation:
//
//  1. *Location anchor.* The resolver must anchor at the BUNDLE's URL, not its
//     own. When a consumer bundles this shim it lives under
//     `node_modules/@gjsify/rolldown-plugin-gjsify/...`, so the path rewriter
//     would rewrite this file's own `import.meta.url` too. We therefore take no
//     `import.meta.url` here and read the anchor from `globalThis.
//     __gjsifyBundleUrl`, captured by a one-line banner at byte 0 of the bundle —
//     the single point where `import.meta.url` is unambiguously the bundle's URL.
//
//  2. *exports-map safety.* `createRequire(...).resolve("<pkg>/<deep/path>")` is
//     rejected by strict `"exports"` maps under Node's native `createRequire`
//     (the `--app node` target), and `@gjsify/module` is exports-aware too. So
//     we never resolve the deep path directly: we resolve the PACKAGE ROOT and
//     join the subpath literally, which no `exports` map can block.
//
//  3. *Lazy / self-contained safety.* `import.meta.url` is normally a passive
//     string — the extremely common `createRequire(import.meta.url)` pattern
//     does NOT require the URL to point at an existing file (createRequire only
//     resolves later, lazily). A self-contained bootstrap bundle (e.g. gjsify's
//     own committed `cli.gjs.mjs`, which runs to CREATE `node_modules` before it
//     exists) bundles its deps' code but has no `node_modules` at runtime. So
//     resolution must never THROW: when a dep can't be resolved we fall back to
//     the bundle's own location, keeping `createRequire(import.meta.url)` /
//     `new URL(rel, import.meta.url)` valid (lazy) instead of crashing — exactly
//     the pre-fix semantics for that case.
//
// @ts-ignore — `node:{module,url,path}` are resolved by the consumer's
// `gjsify build` run (aliased to `@gjsify/{module,url,path}`), not by tsc here.
import { createRequire } from 'node:module';
// @ts-ignore — see above.
import { pathToFileURL, fileURLToPath } from 'node:url';
// @ts-ignore — see above.
import { dirname, join } from 'node:path';

interface BundleAnchorHost {
    __gjsifyBundleUrl?: string;
}

type RequireResolve = (request: string) => string;

/**
 * Split a bundled-file spec into its package name and the path within the
 * package. Handles scoped names:
 *   "typedoc/dist/lib/app.js"   → { pkg: "typedoc",        subpath: "dist/lib/app.js" }
 *   "@scope/name/sub/file.js"   → { pkg: "@scope/name",    subpath: "sub/file.js" }
 *   "typedoc"                   → { pkg: "typedoc",        subpath: "" }
 */
export function splitPackageSpec(spec: string): { pkg: string; subpath: string } {
    const parts = spec.split('/');
    const segments = spec.startsWith('@') ? 2 : 1;
    return {
        pkg: parts.slice(0, segments).join('/'),
        subpath: parts.slice(segments).join('/'),
    };
}

/** The bundle's own URL (set by the byte-0 banner). Throws only if the banner didn't run. */
function bundleAnchorUrl(): string {
    const anchor = (globalThis as unknown as BundleAnchorHost).__gjsifyBundleUrl;
    if (!anchor) {
        throw new Error(
            'gjsify: __gjsifyBundleUrl is not set — the bundle-URL banner did not run. ' +
                'The module-resolve shim is only valid in single-file app builds (gjsify build --app gjs|node).',
        );
    }
    return anchor;
}

// `createRequire` anchored at the bundle URL — built lazily so the banner is
// guaranteed to have run, and so a build that never hits a rewritten read pays
// nothing.
let _resolve: RequireResolve | null = null;
function bundleResolve(): RequireResolve {
    if (!_resolve) _resolve = createRequire(bundleAnchorUrl()).resolve;
    return _resolve;
}

/**
 * Find the on-disk root directory of `pkg`, exports-map-agnostic.
 *
 * `package.json` is resolvable for nearly every package and points straight at
 * the root. When a strict `exports` map blocks it, fall back to the package's
 * main entry (always an export) and derive the root from the
 * `node_modules/<pkg>` boundary in its path. Throws when `pkg` is not installed.
 */
function resolvePackageRoot(pkg: string): string {
    const resolve = bundleResolve();
    try {
        return dirname(resolve(`${pkg}/package.json`));
    } catch {
        const main = resolve(pkg);
        const marker = `/node_modules/${pkg}/`;
        const idx = main.lastIndexOf(marker);
        return idx >= 0 ? main.slice(0, idx + marker.length - 1) : dirname(main);
    }
}

// Per-spec memo — resolution walks the filesystem and bundled deps read their
// data files repeatedly (per-locale i18n lookups, etc.).
const _cache = new Map<string, string>();

/**
 * Absolute on-disk path for a bundled dep file `<pkg>/<subpath>`, or — when the
 * dep can't be resolved at runtime (no `node_modules`, e.g. a self-contained
 * bootstrap bundle) — the bundle's own path as a non-throwing fallback. See
 * constraint 3 in the file header.
 */
function resolveFile(spec: string): string {
    const cached = _cache.get(spec);
    if (cached !== undefined) return cached;
    let abs: string;
    try {
        const { pkg, subpath } = splitPackageSpec(spec);
        const root = resolvePackageRoot(pkg);
        abs = subpath ? join(root, subpath) : root;
    } catch {
        abs = fileURLToPath(bundleAnchorUrl());
    }
    _cache.set(spec, abs);
    return abs;
}

/** Absolute path of the bundled dep file `<pkg>/<subpath>` at runtime. */
export function __gjsifyModuleFile(spec: string): string {
    return resolveFile(spec);
}

/** `file://` URL of `<pkg>/<subpath>` — replaces a rewritten `import.meta.url`. */
export function __gjsifyModuleUrl(spec: string): string {
    return pathToFileURL(resolveFile(spec)).href;
}

/** Directory of `<pkg>/<subpath>` — replaces a rewritten `__dirname`. */
export function __gjsifyModuleDir(spec: string): string {
    return dirname(resolveFile(spec));
}
