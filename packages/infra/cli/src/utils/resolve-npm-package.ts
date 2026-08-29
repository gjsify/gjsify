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
import { tmpdir } from 'node:os';
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

/**
 * The anchor a resolution was asked from — see {@link resolveInstalledPackage}.
 *
 * `'nowhere'` is a directory inside no project. Under Node it can only fail;
 * under Bun it is where the sixth anchor shows itself.
 */
export type PackageAnchor = 'project' | 'nowhere';

export interface ResolveInstalledPackageOptions extends ResolveNpmPackageOptions {
    /**
     * TEST SEAM — resolve `specifier` from one anchor, or `null`.
     *
     * Injected so Bun's behaviour below is reproducible from Node: a fake that
     * answers the SAME path for both anchors is exactly what Bun does for a
     * package the project never installed, and it is the only way to red this
     * guard on a runtime that does not have the defect.
     */
    resolve?: (specifier: string, anchor: PackageAnchor) => string | null;
}

/**
 * A directory that is inside no project, for the control probe.
 *
 * It does not have to EXIST — measured under bun 1.3.14, a non-existent path
 * still reaches the cache, so this costs no filesystem access. It must have a
 * parent, though: an anchor at the filesystem root (`/__r__.js`) throws even
 * under Bun, which would make the control silently useless.
 */
const CONTROL_ANCHOR = join(tmpdir(), '.gjsify-nonexistent-control-anchor', '__gjsify_resolve__.js');

/**
 * Resolve a bare specifier the way {@link resolveNpmPackage} does, but refuse an
 * answer the RUNTIME invented rather than the project provided.
 *
 * THE SIXTH ANCHOR, which the list above does not mention because it is not
 * ours. Bun auto-installs: `createRequire(<anchor>).resolve('<name>')` falls back
 * to Bun's global install cache instead of throwing, so a package the project
 * never declared resolves anyway. Measured, bun 1.3.14 vs node 24.19.0, asking
 * for `@gjsify/node-gi` from a scratch directory:
 *
 *     node  →  MODULE_NOT_FOUND
 *     bun   →  ~/.bun/install/cache/@gjsify/node-gi@0.44.0@@@1/index.js
 *
 * And it is not only the empty-directory case. A real project with a
 * `package.json` and no `node_modules` — a fresh clone, or any Bun project
 * relying on auto-install — gets the same cache hit, as does one that DECLARES
 * the dependency without installing it. Only a `package.json` beside an EMPTY
 * `node_modules` throws.
 *
 * WHY THAT MATTERS HERE AND NOT FOR {@link resolveNpmPackage}'s other callers.
 * Resolving `rolldown` from a cache is fine: it is a TOOL, it runs and is
 * forgotten. `@gjsify/node-gi`, `@gjsify/gtk-runtime-*` and
 * `@gjsify/node-runtime-*` are PAYLOAD — `utils/ship/app-runtime.ts` copies
 * their bytes into a `.app` that gets redistributed. A cache hit there ships
 * files the project never declared, at whatever version that runtime happened to
 * cache, and silently: the "install `<name>`" line that should have been printed
 * never is. It is also #910's shape one level up, an addon paired with a closure
 * it was not built against.
 *
 * THE DISCRIMINATOR IS A CONTROL, not a list of cache paths. Hardcoding
 * `~/.bun/install/cache` would be this file guessing at another runtime's
 * layout and going stale the first time Bun moves it. Asking the same question
 * from a directory inside no project asks the RUNTIME instead: if both anchors
 * answer with the identical path, the project contributed nothing to that
 * answer. Under Node the control can only throw, so this is a strict no-op
 * there — the resolution it returns is byte-identical to `resolveNpmPackage`'s.
 */
export function resolveInstalledPackage(specifier: string, opts: ResolveInstalledPackageOptions = {}): string | null {
    const resolve =
        opts.resolve ??
        ((spec: string, anchor: PackageAnchor): string | null =>
            anchor === 'project'
                ? resolveNpmPackage(spec, { cwd: opts.cwd, bundleUrl: opts.bundleUrl })
                : tryResolveFromFile(spec, CONTROL_ANCHOR));

    const hit = resolve(specifier, 'project');
    if (hit === null) return null;
    const control = resolve(specifier, 'nowhere');
    return control !== null && control === hit ? null : hit;
}

/** `createRequire(<file>).resolve(specifier)`, or `null`. The file need not exist. */
function tryResolveFromFile(specifier: string, anchorFile: string): string | null {
    try {
        return createRequire(pathToFileURL(anchorFile).href).resolve(specifier);
    } catch {
        // Not resolvable from a directory in no project — which is the answer
        // this probe wants on every runtime without a global-cache fallback.
        return null;
    }
}
