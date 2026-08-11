// Guard against the recurring "library build leaks into src/" footgun.
//
// `BuildAction.buildLibrary` derives its outdir from `dirname(package.json "module" ?? "main")`.
// When a package points `main` at its runtime SOURCE entry (`src/index.ts` — the intended entry
// for Vite/gjsify-compiled consumers, e.g. `@gjsify/adwaita-web`), that outdir is `src/`, so
// `gjsify build --library` writes the compiled tree next to the sources: `src/*.js` / `*2.js`
// duplicates, a `src/_virtual/` helper dir, and a nested `src/<pkg>/src/**` preserve-modules
// tree. These pure helpers let the build action refuse that up front.

import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

/**
 * The literal (non-glob) base directories the input source files live in, derived from the
 * bundler `input` patterns: a file entry maps to its containing dir, a glob is reduced to the
 * literal prefix before the first wildcard (`src/index.ts`, `src` and `src/**` + `/*.ts` all
 * give `<cwd>/src`).
 *
 * The project root is intentionally excluded — a flat library keeping its source at the root and
 * emitting there is an explicit layout, not the `src/`-subdir footgun this guard targets.
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
        // Everything before the first glob metacharacter is a literal path prefix.
        const globIdx = norm.search(/[*?{}[\]()!+@]/);
        let base = globIdx === -1 ? norm : norm.slice(0, globIdx);
        if (globIdx === -1) {
            // Wholly literal: a file path collapses to its dirname, a bare directory stays.
            base = extname(base) ? dirname(base) : base;
        } else {
            // The glob cut mid-segment (`src/fo*`) — drop the trailing partial segment so only
            // the complete literal directory remains.
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
 * `true` when library output written to `outdir` would land inside (or on top of) the input
 * source tree — i.e. `outdir` equals, or is nested under, any input source directory.
 */
export function isOutdirInsideSource(outdir: string, sourceDirs: readonly string[], cwd: string): boolean {
    const absOut = resolve(cwd, outdir);
    return sourceDirs.some((dir) => isInsideOrEqual(absOut, dir));
}

/** The error thrown when a `--library` build would emit into its own source tree. */
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
