/**
 * Static import-graph primitives shared by the rules that ask "what does this
 * entry point actually REACH?".
 *
 * Two rules ask that question for different reasons and must not answer it two
 * different ways:
 *   - `headless` (portable, here) — intra-GJS layering: does a root entry that
 *     promises to reach no typelib in fact reach one?
 *   - `runtimes-reachability` (repo, `scripts/`) — cross-runtime: does a slot
 *     declared `polyfill` for a target resolve to code that reaches GLib/Gio?
 *
 * Both are STATIC scans over TypeScript sources, and both share two deliberate
 * limits:
 *   - Only STATIC ESM imports are followed. A `await import('gi://Gtk')` behind
 *     a runtime branch is the sanctioned graceful-degradation shape, not a leak.
 *   - `import type` / `export type … from` are skipped; they erase before the
 *     bundler runs, so they cannot pull a typelib into a bundle.
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** A VALUE import of a `@girs/*` type package — it resolves to a `gi://` body. */
export const GIRS_VALUE_RE = /^\s*import\s+(?!type\b)[^;]*from\s+['"]@girs\//m;
export const GI_URL_RE = /from\s+['"]gi:\/\//;
/**
 * Dynamic `await import('gi://X')` / `import('@girs/X')` — the gamepad /
 * terminal-native / sab-native graceful-degradation pattern. The package stays
 * loadable everywhere; on non-GJS the await throws and the catch branch
 * supplies a no-op fallback.
 */
export const DYNAMIC_GI_RE = /import\s*\(\s*['"](?:gi:\/\/|@girs\/)/;
/**
 * `imports.X` reads — exclude common comment-context appearances by checking
 * the rest of the line doesn't begin with a comment marker. Imperfect but
 * catches the canonical `const x = imports.byteArray` / `imports.gi.Foo`
 * pattern without hand-rolling a TS parser.
 */
export const IMPORTS_LEGACY_RE =
    /(?<!\/\/.*)(?<!\*.*)\bimports\.(?:byteArray|gi|system|signals|cairo|gettext|format|misc|jsUnit|searchPath)/;
/**
 * `<obj>.imports?.gi` / `<obj>.imports.gi` — the "safe" access pattern used by
 * the Vala bridges. Reads `imports` via a typed view of a runtime host and
 * short-circuits to `undefined` where the global does not exist.
 */
export const GJS_IMPORTS_GUARD_RE = /\.imports\??\.gi\b/;

export const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g;
export const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
/** `import type … from` / `export type { … } from` erase at compile time. */
export const TYPE_ONLY_RE = /(?:^|\n)\s*(?:import|export)\s+type\s/;

/**
 * The source extensions every walk in this file agrees on.
 *
 * `tsx` is in the list because a JSX source is a source: `@gjsify/adwaita-react-native`
 * put the first `.tsx` files into a package `src` tree and every scan here skipped them,
 * so a `import Adw from 'gi://Adw'` in `clamp.gtk.tsx` was invisible to the ADR 0014
 * reachability audit while the identical line in a `.ts` file failed it (measured, both
 * ways). Naming the set ONCE is the point — the same class was fixed for
 * `scripts/suite-registration.mjs` and left standing here, because each walk carried its
 * own literal.
 */
export const SOURCE_EXTENSIONS = ['ts', 'mts', 'tsx'];
const SOURCE_EXT_RE = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const SPEC_RE = new RegExp(`\\.spec\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const TEST_ENTRY_RE = new RegExp(`^test(\\..*)?\\.(${SOURCE_EXTENSIONS.join('|')})$`);

/** Source files that never ship in a target bundle. */
export function isNonShippingSource(fileName) {
    return SPEC_RE.test(fileName) || TEST_ENTRY_RE.test(fileName) || fileName.endsWith('.d.ts');
}

/** Every `.ts`/`.mts`/`.tsx` file under `dir`, recursively (skips node_modules). */
export function listSourceFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules') continue;
            listSourceFiles(full, out);
            continue;
        }
        if (!ent.isFile() || !SOURCE_EXT_RE.test(ent.name)) continue;
        if (isNonShippingSource(ent.name)) continue;
        out.push(full);
    }
    return out;
}

/** Resolve a relative ESM specifier (`./x.js`) to an on-disk TS source. */
export function resolveLocalSource(fromFile, spec) {
    const base = resolve(fromFile, '..', spec).replace(/\.(js|mjs)$/, '');
    for (const ext of SOURCE_EXTENSIONS) {
        for (const cand of [`${base}.${ext}`, join(base, `index.${ext}`)]) {
            if (existsSync(cand)) return cand;
        }
    }
    return null;
}

/**
 * The npm package name a bare specifier belongs to (`@scope/pkg/sub` →
 * `@scope/pkg`, `pkg/sub` → `pkg`).
 */
export function packageNameOf(spec) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** The `default` (or single-string) target an `exports` subpath resolves to. */
export function exportTarget(exportsObj, subpath) {
    const entry = exportsObj?.[subpath];
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.default ?? entry.import ?? entry.node ?? null;
    return null;
}

/** Map a package-relative BUILT path (`./lib/esm/x.js`) back to its TS source. */
export function sourceForBuiltPath(pkgDir, rel) {
    if (typeof rel !== 'string') return null;
    const stripped = rel
        .replace(/^\.\//, '')
        .replace(/^(?:lib\/esm|lib\/types|lib|dist)\//, '')
        .replace(/\.d\.ts$/, '')
        .replace(/\.(js|mjs)$/, '');
    for (const ext of SOURCE_EXTENSIONS) {
        for (const cand of [`${stripped}.${ext}`, join(stripped, `index.${ext}`)]) {
            const abs = join(pkgDir, 'src', cand);
            if (existsSync(abs)) return abs;
        }
    }
    return null;
}

/**
 * Walk the module graph rooted at `entryFiles`, following RELATIVE imports
 * inside the package only, and collect every bare specifier reached plus any
 * direct GJS binding.
 */
export async function walkEntryGraph(entryFiles) {
    const seen = new Set();
    /** @type {Array<{spec:string, file:string}>} */
    const bare = [];
    /** @type {Array<{kind:string, file:string}>} */
    const direct = [];
    const queue = [...entryFiles];
    while (queue.length) {
        const file = queue.shift();
        if (!file || seen.has(file)) continue;
        seen.add(file);
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            continue;
        }
        if (GIRS_VALUE_RE.test(text)) direct.push({ kind: '@girs/* value import', file });
        if (GI_URL_RE.test(text)) direct.push({ kind: 'gi:// import', file });
        if (IMPORTS_LEGACY_RE.test(text) && !GJS_IMPORTS_GUARD_RE.test(text)) {
            direct.push({ kind: 'unguarded `imports.*` read', file });
        }
        for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                const spec = m[1];
                if (spec.startsWith('.')) {
                    const local = resolveLocalSource(file, spec);
                    if (local) queue.push(local);
                    continue;
                }
                // Skip pure type imports — they erase before the bundler runs.
                if (re === IMPORT_RE && TYPE_ONLY_RE.test(m[0])) continue;
                bare.push({ spec, file });
            }
        }
    }
    return { bare, direct, files: seen };
}

/** Extract VALUE export names from a TS entry, following local `export *`. */
export async function collectValueExports(file, seen = new Set()) {
    const out = new Set();
    if (!file || seen.has(file) || !existsSync(file)) return out;
    seen.add(file);
    let text;
    try {
        text = await readFile(file, 'utf8');
    } catch {
        return out;
    }
    // `export const|function|class|enum X` — `type`/`interface` deliberately excluded.
    for (const m of text.matchAll(
        /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|abstract\s+class|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
        out.add(m[1]);
    }
    // `export { a, b as c }` (optionally `from '…'`) — drop `type` members.
    // Comments must be stripped BEFORE splitting on `,`: a multi-line export
    // block that groups its members under `// Sync API`-style headings would
    // otherwise yield the heading glued to the next name as a phantom export
    // (`@gjsify/fs` alone produced five). That only surfaces once a slot is
    // flipped to `polyfill` — i.e. exactly when someone reads the list.
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"]\s*)?;?/gm)) {
        const members = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        for (const raw of members.split(',')) {
            const t = raw.trim();
            if (!t || /^type\s/.test(t)) continue;
            const parts = t.split(/\s+as\s+/);
            out.add((parts[1] ?? parts[0]).trim().replace(/^['"]|['"]$/g, ''));
        }
    }
    if (/^export\s+default\s/m.test(text)) out.add('default');
    for (const m of text.matchAll(/^export\s*\*\s*from\s*['"](\.[^'"]+)['"]/gm)) {
        const local = resolveLocalSource(file, m[1]);
        for (const e of await collectValueExports(local, seen)) out.add(e);
    }
    return out;
}
