// Explicit `--globals` CLI flag support.
//
// This module resolves a user-provided comma-separated list of global
// identifiers (e.g. `fetch,Buffer,process,URL,crypto`) into the
// corresponding set of `@gjsify/<pkg>/register` subpaths and writes an
// ESM stub file that the esbuild plugin injects via its
// `autoGlobalsInject` option.
//
// gjsify does NOT scan user code to guess which globals are needed —
// the user declares them explicitly via `gjsify build --globals <list>`
// (or via the default script scaffolded by `@gjsify/create-app`). See
// the "Tree-shakeable Globals" section in AGENTS.md for the rationale.

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { GJS_GLOBALS_MAP, GJS_GLOBALS_GROUPS } from '@gjsify/resolve-npm/globals-map';
import { ALIASES_WEB_FOR_GJS } from '@gjsify/resolve-npm';

const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;
const GLOBALS_GROUPS: Record<string, string[]> = GJS_GLOBALS_GROUPS;

/**
 * Resolve a `--globals` CLI argument into the set of `/register` subpaths
 * that must be injected into the build.
 *
 * The argument is a comma-separated list of identifiers or group names.
 * Group names (`node`, `web`, `dom`) expand to all identifiers in that group.
 * Unknown tokens are silently ignored. Empty or whitespace-only input returns
 * an empty set.
 *
 * Examples:
 *   resolveGlobalsList('fetch,Buffer,process')
 *     → Set { 'fetch/register', '@gjsify/buffer/register', '@gjsify/node-globals/register' }
 *
 *   resolveGlobalsList('node,web')
 *     → Set { '@gjsify/buffer/register', '@gjsify/node-globals/register', 'fetch/register', … }
 *
 *   resolveGlobalsList('')
 *     → Set { }
 */
export function resolveGlobalsList(globalsArg: string): Set<string> {
    const result = new Set<string>();
    const trimmed = globalsArg.trim();
    if (!trimmed) return result;

    for (const rawToken of trimmed.split(',')) {
        const token = rawToken.trim();
        if (!token) continue;
        const group = GLOBALS_GROUPS[token];
        if (group) {
            for (const id of group) {
                const path = GLOBALS_MAP[id];
                if (path) result.add(path);
            }
        } else {
            const path = GLOBALS_MAP[token];
            if (path) result.add(path);
        }
    }
    return result;
}

/**
 * Extract the npm package name from a register specifier.
 *
 * Examples:
 *   `@gjsify/dom-elements/register/document` → `@gjsify/dom-elements`
 *   `@gjsify/fetch/register`                 → `@gjsify/fetch`
 *   `fetch/register`                         → `fetch`
 */
function packageNameFromRegisterPath(registerPath: string): string {
    if (registerPath.startsWith('@')) {
        // scoped: @scope/pkg/...
        const parts = registerPath.split('/');
        return parts.slice(0, 2).join('/');
    }
    // unscoped: pkg/...
    return registerPath.split('/')[0] ?? registerPath;
}

const ALIAS_MAP_FOR_GJS: Record<string, string> = ALIASES_WEB_FOR_GJS as Record<string, string>;

/**
 * Resolve a bare-specifier register path to its canonical `@gjsify/`
 * form using the ALIASES_WEB_FOR_GJS alias table (e.g.
 * `fetch/register/fetch` → `@gjsify/fetch/register/fetch`).
 *
 * The globals-map uses bare specifiers for packages that the gjsify alias
 * plugin rewrites at build time. For the resolvability check we need the
 * CANONICAL package name so we look in the right `node_modules` directory.
 * If no alias is found the original path is returned unchanged.
 */
function resolveRegisterAlias(registerPath: string): string {
    // Direct alias lookup first (handles full `fetch/register/fetch` etc).
    if (ALIAS_MAP_FOR_GJS[registerPath]) return ALIAS_MAP_FOR_GJS[registerPath];
    // Prefix lookup: `web-streams/register/readable` → check `web-streams` alias.
    const pkgName = packageNameFromRegisterPath(registerPath);
    const aliasedPkg = ALIAS_MAP_FOR_GJS[pkgName];
    if (aliasedPkg && !registerPath.startsWith('@')) {
        // Replace the bare-package prefix with the aliased @gjsify/ package name.
        const tail = registerPath.slice(pkgName.length); // e.g. '/register/readable'
        return aliasedPkg + tail;
    }
    return registerPath;
}

/**
 * Return true if `registerPath`'s base package is present in the
 * project's node_modules tree (checked by walking up from `fromDir`).
 *
 * Bare-specifier register paths (e.g. `fetch/register/fetch`) are first
 * resolved to their canonical `@gjsify/` form via the alias map so the
 * presence check searches the right `node_modules` directory.
 *
 * The check is a simple `package.json` existence test — the same fast
 * approach Node's own resolver uses as the first step. We walk up the
 * directory tree (like Node's require algorithm) so nested
 * `node_modules` trees (e.g. workspace setups) are handled correctly.
 *
 * Returns false — never throws — so a missing package causes a graceful
 * skip rather than a build crash.
 */
export function isRegisterPathResolvable(registerPath: string, fromDir: string): boolean {
    // Resolve bare-specifier aliases to @gjsify/ canonical form first.
    const canonical = resolveRegisterAlias(registerPath);
    const pkgName = packageNameFromRegisterPath(canonical);
    const parts = pkgName.split('/');
    // Walk up the directory tree mirroring Node's module-resolution
    // algorithm: check <dir>/node_modules/<pkg>/package.json at each level.
    let dir = fromDir;
    const root = dir.slice(0, dir.indexOf('/') + 1) || '/';
    while (true) {
        const candidate = join(dir, 'node_modules', ...parts, 'package.json');
        if (existsSync(candidate)) return true;
        if (dir === root) break;
        const parent = join(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return false;
}

/**
 * Filter `registerPaths` to only those whose base package is resolvable
 * from `fromDir`. Emits a `console.warn` for each skipped path —
 * skipping silently would mask genuine missing-polyfill cases.
 *
 * Trade-off: if a project intentionally relies on a bundled polyfill
 * for a global that is also referenced in a typeof-guard inside an npm
 * dep, and that polyfill is not a direct/transitive dep, the warn makes
 * the gap visible so the developer can add the dep explicitly.
 */
export function filterResolvableRegisterPaths(
    registerPaths: Set<string>,
    fromDir: string,
): Set<string> {
    const out = new Set<string>();
    for (const p of registerPaths) {
        if (isRegisterPathResolvable(p, fromDir)) {
            out.add(p);
        } else {
            console.warn(
                `[gjsify] --globals auto: skipping register import '${p}' — ` +
                `package '${packageNameFromRegisterPath(p)}' is not installed in this project. ` +
                `If you need this global, add the package as a dependency or use --exclude-globals to suppress this warning.`,
            );
        }
    }
    return out;
}

/**
 * Write a stub ESM file with `import` statements for the given register
 * paths and return its absolute path, suitable for passing to esbuild's
 * `inject` option via the plugin's `autoGlobalsInject` field.
 *
 * The file lives inside `<cwd>/node_modules/.cache/gjsify/` so esbuild's
 * module resolver can follow the bare specifiers in the generated imports.
 *
 * The file name is hashed by content so repeated builds with the same
 * set reuse the same file (no churn, idempotent on disk).
 */
export async function writeRegisterInjectFile(
    registerPaths: Set<string>,
    cwd: string = process.cwd(),
): Promise<string | null> {
    if (registerPaths.size === 0) return null;

    const sorted = [...registerPaths].sort();
    const content = sorted.map((p) => `import '${p}';`).join('\n') + '\n';
    const hash = createHash('sha1').update(content).digest('hex').slice(0, 10);

    const cacheDir = join(cwd, 'node_modules', '.cache', 'gjsify');
    await mkdir(cacheDir, { recursive: true });

    const path = join(cacheDir, `auto-globals-${hash}.mjs`);
    await writeFile(path, content, 'utf-8');
    return path;
}
