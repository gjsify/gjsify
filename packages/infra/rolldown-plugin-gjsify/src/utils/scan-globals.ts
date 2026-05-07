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
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { GJS_GLOBALS_MAP, GJS_GLOBALS_GROUPS } from '@gjsify/resolve-npm/globals-map';

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
