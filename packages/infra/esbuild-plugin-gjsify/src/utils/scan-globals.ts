// Global-reference scanner for the esbuild plugin's `--auto-globals` feature.
//
// Given a list of entry-point paths, this module reads each file, greps the
// source for known global identifiers, and returns the set of
// `@gjsify/<pkg>/register` (or bare-specifier `<pkg>/register`) modules that
// must be prepended to the build to make those globals available on GJS.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';

const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;

/**
 * Scan a single file's source for known global identifier references and
 * add the matching `/register` paths to the accumulator.
 *
 * The regex uses three patterns to keep false positives low:
 *   - `\bIdent\s*[(.]`     — call (`fetch(...)`) or property access (`Buffer.from`)
 *   - `new\s+Ident`        — constructor (`new Blob(...)`)
 *   - `typeof\s+Ident`     — feature detection (`typeof fetch`)
 */
export async function scanFileForGlobals(
    filePath: string,
    accumulator: Set<string>,
): Promise<void> {
    let code: string;
    try {
        code = await readFile(filePath, 'utf-8');
    } catch {
        return;
    }

    const globalNames = Object.keys(GLOBALS_MAP);
    const identGroup = globalNames.join('|');
    const pattern = new RegExp(
        `\\b(?:${identGroup})\\b(?=\\s*[(.\\[])|new\\s+(?:${identGroup})\\b|typeof\\s+(?:${identGroup})\\b`,
        'g',
    );

    // Use matchAll to iterate over every occurrence without state on the regex object.
    for (const result of code.matchAll(pattern)) {
        const raw = result[0];
        const ident = raw
            .replace(/^new\s+/, '')
            .replace(/^typeof\s+/, '')
            .replace(/\s*[(.\[]$/, '')
            .trim();
        const registerPath = GLOBALS_MAP[ident];
        if (registerPath) accumulator.add(registerPath);
    }
}

/**
 * Combine the scan results with an explicit `--globals` argument.
 *
 * - empty `globalsArg` → return scan results as-is (or empty set if
 *   `autoGlobals` is disabled)
 * - absolute form (`"fetch,crypto"`) → replace scan results entirely
 * - modifier form (`"+crypto,-fetch"`) → add `+` entries and remove `-` entries
 *   from the scan results
 */
export function resolveGlobalsList(
    scanned: Set<string>,
    globalsArg: string,
    autoGlobals: boolean,
): Set<string> {
    const result = autoGlobals ? new Set(scanned) : new Set<string>();
    const trimmed = globalsArg.trim();
    if (!trimmed) return result;

    const tokens = trimmed
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    const hasModifier = tokens.some((t) => t.startsWith('+') || t.startsWith('-'));

    if (!hasModifier) {
        // Absolute whitelist
        result.clear();
        for (const t of tokens) {
            const path = GLOBALS_MAP[t];
            if (path) result.add(path);
        }
        return result;
    }

    for (const t of tokens) {
        if (t.startsWith('+')) {
            const path = GLOBALS_MAP[t.slice(1)];
            if (path) result.add(path);
        } else if (t.startsWith('-')) {
            const path = GLOBALS_MAP[t.slice(1)];
            if (path) result.delete(path);
        } else {
            // Bare token in modifier mode behaves as +token
            const path = GLOBALS_MAP[t];
            if (path) result.add(path);
        }
    }
    return result;
}

/**
 * Write a stub ESM file with `import` statements for the given register
 * paths and return its absolute path, suitable for passing to esbuild's
 * `inject` option.
 *
 * The file lives inside `<cwd>/node_modules/.cache/gjsify/` so that
 * esbuild's module resolver can follow the bare specifiers in the
 * generated imports (otherwise resolving from `/tmp/` fails because there
 * is no `node_modules/` on the parent path).
 *
 * The file name is hashed so repeated builds with the same set reuse the
 * same file (no churn).
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
