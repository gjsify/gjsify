// Multi-anchor npm-package resolver for the GJS-bundled CLI.
//
// GJS's native ESM loader has no node_modules walker — a bare
// `await import('rolldown')` from inside the bundle throws
// `ImportError: Module not found: rolldown` even when the package is
// physically present in a node_modules above the caller's cwd.
//
// `createRequire(import.meta.url)` works when invoked under Node, and
// when invoked under GJS *with* `@gjsify/module`'s polyfill it walks the
// node_modules chain from the URL it was anchored at. But it walks
// only ONE chain — the one rooted at the anchor's parent. When the
// bundle lives at `<install>/dist/cli.gjs.mjs` and the user runs
// `gjs -m <install>/dist/cli.gjs.mjs build …` from a completely
// unrelated cwd (`/tmp/sandbox/`) whose `node_modules` is the only
// place rolldown is present, anchoring on the bundle URL misses it.
//
// This helper resolves a bare specifier against multiple anchors in
// order — the first one that resolves wins:
//
//   1. `GJSIFY_NODE_PATH` env override (colon-separated dir list,
//      matches Node's NODE_PATH semantics — each entry is treated as a
//      synthetic `node_modules` parent).
//   2. Caller-supplied anchor dir (typically process.cwd()).
//   3. Workspace root from `findWorkspaceRoot(anchorDir)` — finds the
//      monorepo top when invoked from a sub-package directory.
//   4. Bundle path's parent chain (`import.meta.url` of THIS module).
//   5. Parent dirs of the anchor (fallback for nested-without-workspace
//      setups — matches `oxc-resolve.ts`'s walker).
//
// Returns the absolute path on success (the caller usually wraps it in
// `pathToFileURL().href` before passing to dynamic `import(...)`).
// Returns null when every anchor failed.
//
// Reference: `packages/infra/cli/src/commands/tsc.ts` (workspace-root +
// cwd anchoring precedent) and `packages/infra/cli/src/utils/oxc-resolve.ts`
// (parent-dir walker precedent).

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { delimiter, join, resolve } from 'node:path';
import { findWorkspaceRoot } from './workspace-root.js';

export interface ResolveNpmPackageOptions {
    /** Anchor directory to search from (typically the caller's cwd). */
    cwd?: string;
    /**
     * Bundle path or module URL to anchor the bundle-side createRequire
     * at. Pass `import.meta.url` from the call site so the bundle's
     * own node_modules chain stays reachable even when the CLI is
     * invoked from an unrelated cwd.
     */
    bundleUrl?: string;
}

/**
 * Resolve a bare npm specifier through multiple createRequire anchors.
 * Returns the absolute filesystem path of the resolved module, or null
 * if no anchor succeeded.
 *
 * Each anchor is tried in priority order — `GJSIFY_NODE_PATH` (highest)
 * → caller cwd → workspace root → bundle URL → parent-dir walk from
 * cwd. The first anchor whose `require.resolve()` succeeds wins.
 */
export function resolveNpmPackage(specifier: string, opts: ResolveNpmPackageOptions = {}): string | null {
    const cwd = opts.cwd ?? process.cwd();

    // 1. GJSIFY_NODE_PATH env override (NODE_PATH-like) — each entry is
    //    treated as a directory whose own `node_modules` participates
    //    in the lookup. Mirrors Node's NODE_PATH semantics.
    const envPath = process.env['GJSIFY_NODE_PATH'];
    if (envPath) {
        // `path.delimiter`, not `':'` — Node's own NODE_PATH uses `;` on
        // Windows, and this override claims to mirror NODE_PATH semantics. Split
        // on a colon there and even a SINGLE entry is destroyed: `C:\tools`
        // becomes `['C', '\tools']`, neither of which resolves, so the documented
        // override silently did nothing on Windows and fell through to anchor 2.
        // `commands/run.ts` and `utils/run-lifecycle-script.ts` already get this
        // right; this was the site that was missed.
        for (const dir of envPath.split(delimiter).filter(Boolean)) {
            const hit = tryResolveFromDir(specifier, resolve(dir));
            if (hit) return hit;
        }
    }

    // 2. Caller cwd → walk up for nearest node_modules/<pkg>.
    const fromCwd = tryResolveFromDir(specifier, cwd);
    if (fromCwd) return fromCwd;

    // 3. Workspace root (monorepo top, if any).
    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot && wsRoot !== cwd) {
        const fromWsRoot = tryResolveFromDir(specifier, wsRoot);
        if (fromWsRoot) return fromWsRoot;
    }

    // 4. Bundle path's own parent chain — anchored at the bundle URL
    //    so the install-time node_modules layout (e.g.
    //    `<install>/node_modules/rolldown` next to the CLI bundle)
    //    is reachable even when the user runs the bundle directly from
    //    an unrelated cwd.
    if (opts.bundleUrl) {
        try {
            const req = createRequire(opts.bundleUrl);
            return req.resolve(specifier);
        } catch {
            // Fall through.
        }
    }

    // 5. Parent-dir walk from cwd as a last resort (nested
    //    package layouts without a workspace marker). Capped at 8
    //    levels to avoid runaway filesystem walks on pathological
    //    layouts. Matches the depth `oxc-resolve.ts` uses for its
    //    equivalent walker.
    let dir = resolve(cwd, '..');
    for (let i = 0; i < 8; i++) {
        const hit = tryResolveFromDir(specifier, dir);
        if (hit) return hit;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }

    return null;
}

/**
 * Attempt to resolve `specifier` as if a fictional source file at
 * `<dir>/__gjsify_resolve__.js` were doing the lookup. createRequire's
 * algorithm walks up from the anchor's parent for `node_modules/<pkg>`
 * so seeding it inside `<dir>` makes `<dir>/node_modules/<pkg>` the
 * first hit.
 */
function tryResolveFromDir(specifier: string, dir: string): string | null {
    try {
        const sentinel = pathToFileURL(join(dir, '__gjsify_resolve__.js')).href;
        const req = createRequire(sentinel);
        return req.resolve(specifier);
    } catch {
        return null;
    }
}
