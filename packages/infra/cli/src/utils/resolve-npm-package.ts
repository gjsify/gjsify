// Multi-anchor npm-package resolver for the GJS-bundled CLI.
//
// GJS's native ESM loader has no node_modules walker — a bare `await import('rolldown')`
// from inside the bundle throws `ImportError: Module not found: rolldown` even when the
// package is physically present in a node_modules above the caller's cwd.
//
// `createRequire(import.meta.url)` works under Node, and under GJS with `@gjsify/module`'s
// polyfill it walks the node_modules chain from the URL it was anchored at — but only ONE
// chain, the one rooted at the anchor's parent. When the bundle lives at
// `<install>/dist/cli.gjs.mjs` and the user runs it from an unrelated cwd whose
// `node_modules` is the only place rolldown is present, anchoring on the bundle URL misses
// it. So a bare specifier is tried against several anchors, first hit wins:
//
//   1. `GJSIFY_NODE_PATH` env override (NODE_PATH semantics — each entry is a synthetic
//      `node_modules` parent).
//   2. Caller-supplied anchor dir (typically process.cwd()).
//   3. Workspace root from `findWorkspaceRoot(anchorDir)` — the monorepo top when invoked
//      from a sub-package directory.
//   4. Bundle path's parent chain (`import.meta.url` of THIS module).
//   5. Parent dirs of the anchor (nested-without-workspace layouts).
//
// Precedents: `commands/tsc.ts` (workspace-root + cwd anchoring), `utils/oxc-resolve.ts`
// (parent-dir walker).

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { delimiter, join, resolve } from 'node:path';
import { findWorkspaceRoot } from './workspace-root.js';

export interface ResolveNpmPackageOptions {
    /** Anchor directory to search from (typically the caller's cwd). */
    cwd?: string;
    /**
     * Bundle path or module URL to anchor the bundle-side createRequire at. Pass
     * `import.meta.url` from the call site so the bundle's own node_modules chain stays
     * reachable even when the CLI is invoked from an unrelated cwd.
     */
    bundleUrl?: string;
}

/**
 * Resolve a bare npm specifier through the anchors listed above, returning the resolved
 * module's absolute path or null when every anchor failed. Callers usually wrap the result in
 * `pathToFileURL().href` before a dynamic `import(...)`.
 */
export function resolveNpmPackage(specifier: string, opts: ResolveNpmPackageOptions = {}): string | null {
    const cwd = opts.cwd ?? process.cwd();

    const envPath = process.env['GJSIFY_NODE_PATH'];
    if (envPath) {
        // `path.delimiter`, not `':'` — NODE_PATH uses `;` on Windows, where splitting on a
        // colon destroys even a SINGLE entry (`C:\tools` → `['C', '\tools']`), so the
        // documented override silently did nothing there and fell through to anchor 2.
        for (const dir of envPath.split(delimiter).filter(Boolean)) {
            const hit = tryResolveFromDir(specifier, resolve(dir));
            if (hit) return hit;
        }
    }

    const fromCwd = tryResolveFromDir(specifier, cwd);
    if (fromCwd) return fromCwd;

    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot && wsRoot !== cwd) {
        const fromWsRoot = tryResolveFromDir(specifier, wsRoot);
        if (fromWsRoot) return fromWsRoot;
    }

    // Anchored at the bundle URL so the install-time layout (`<install>/node_modules/rolldown`
    // next to the CLI bundle) stays reachable when the bundle is run from an unrelated cwd.
    if (opts.bundleUrl) {
        try {
            const req = createRequire(opts.bundleUrl);
            return req.resolve(specifier);
        } catch {
            // Fall through.
        }
    }

    // Last resort for nested layouts without a workspace marker. Depth-capped so a
    // pathological layout cannot turn a failed resolve into a filesystem walk to `/`.
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
 * Resolve `specifier` as if a fictional source file at `<dir>/__gjsify_resolve__.js` were
 * doing the lookup: createRequire walks up from the anchor's PARENT for `node_modules/<pkg>`,
 * so seeding it inside `<dir>` makes `<dir>/node_modules/<pkg>` the first hit.
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
