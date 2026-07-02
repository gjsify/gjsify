// Guard against the recurring "library build leaks into src/" footgun.
//
// `BuildAction.buildLibrary` derives its output directory from
// `dirname(package.json "module" ?? "main")`. When a package points `main`
// at its runtime SOURCE entry (`src/index.ts` — the intended entry for
// Vite/gjsify-compiled consumers, e.g. `@gjsify/adwaita-web`), that derived
// outdir is `src/`, so `gjsify build --library` writes the compiled `.js`
// tree straight next to the sources: `src/*.js` / `*2.js` duplicates, a
// `src/_virtual/` helper dir, and a nested `src/<pkg>/src/**` preserve-modules
// tree. These pure helpers let the build action refuse that up front instead
// of silently corrupting the source tree.

import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

/**
 * The literal (non-glob) base directories the build's input source files live
 * in, derived from the bundler `input` patterns. A file entry maps to its
 * containing dir, a glob is reduced to the literal prefix before the first
 * wildcard:
 *   - `src/index.ts`   → `<cwd>/src`
 *   - `src/**` + `/*.ts` → `<cwd>/src`
 *   - `src`            → `<cwd>/src`
 *
 * The project root itself is intentionally excluded — a flat library that
 * keeps its source at the project root and emits there is an explicit layout,
 * not the `src/`-subdir footgun this guard targets.
 */
export function inputSourceDirs(input: unknown, cwd: string): string[] {
    const patterns: string[] = [];
    const push = (v: unknown) => {
        if (typeof v === 'string' && v.length > 0) patterns.push(v);
    };
    if (typeof input === 'string') push(input);
    else if (Array.isArray(input)) input.forEach(push);
    else if (input && typeof input === 'object') Object.values(input as Record<string, unknown>).forEach(push);

    const root = resolve(cwd);
    const dirs = new Set<string>();
    for (const raw of patterns) {
        const norm = raw.replace(/\\/g, '/');
        // Cut the pattern at the first glob metacharacter — everything before
        // it is a literal path prefix.
        const globIdx = norm.search(/[*?{}[\]()!+@]/);
        let base = globIdx === -1 ? norm : norm.slice(0, globIdx);
        if (globIdx === -1) {
            // Whole pattern is literal: a file path collapses to its dirname,
            // a bare directory stays as-is.
            base = extname(base) ? dirname(base) : base;
        } else {
            // The glob cut mid-segment (`src/`, `src/fo*`) — drop the trailing
            // partial segment so we keep only the complete literal directory.
            base = base.replace(/\/[^/]*$/, '');
        }
        const abs = resolve(root, base || '.');
        if (abs !== root) dirs.add(abs);
    }
    return [...dirs];
}

/** `true` when `child` is `parent` itself or nested somewhere under it. */
function isInsideOrEqual(child: string, parent: string): boolean {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * `true` when writing library output to `outdir` would land build artifacts
 * inside (or directly on top of) the input source tree. Unsafe iff `outdir`
 * equals, or is nested under, any input source directory.
 *
 *   isOutdirInsideSource('src',      ['<cwd>/src'])       → true   (leak)
 *   isOutdirInsideSource('src/nest', ['<cwd>/src'])       → true   (leak)
 *   isOutdirInsideSource('dist/esm', ['<cwd>/src'])       → false  (safe)
 *   isOutdirInsideSource('lib',      ['<cwd>/src'])       → false  (safe)
 */
export function isOutdirInsideSource(outdir: string, sourceDirs: readonly string[], cwd: string): boolean {
    const absOut = resolve(cwd, outdir);
    return sourceDirs.some((dir) => isInsideOrEqual(absOut, dir));
}

/**
 * The error thrown when a `--library` build would emit into its own source
 * tree. Names both remedies so the fix is actionable at the point of failure.
 */
export function libraryOutputLeakError(outdir: string): Error {
    return new Error(
        `gjsify build --library: refusing to write output into "${outdir}", which holds the ` +
            `input source — a library build there produces src/*.js duplicates, *2.js, a ` +
            `_virtual/ helper dir, and a nested preserve-modules tree, silently corrupting the ` +
            `sources. This output dir was derived from package.json "main"/"module" pointing at ` +
            `a source path. Fix it by pointing "main"/"module" at the built library (e.g. ` +
            `lib/index.js) or by passing an explicit --outdir <dir> outside the source tree.`,
    );
}
