// Build-time guard: a `--app gjs` bundle must not keep bare `node:` imports.
//
// Stock GJS has NO `node:` module loader. A single surviving
// `import … from "node:fs"` makes it abort the ENTIRE module graph before one
// line executes:
//
//   Gjs-WARNING **: JS ERROR: ImportError: Unsupported URI scheme for importing: node
//   Gjs-CRITICAL **: Failed to resolve imports for module: '…/dist/cli.gjs.mjs'
//
// `--app gjs` maps every Node builtin to its `@gjsify/*` polyfill, so a healthy
// bundle has ZERO of them. But when an alias TARGET cannot be resolved — the
// classic case being a workspace checkout whose `@gjsify/*` packages have no
// built `lib/`, so `exports["."]` points at a file that does not exist — the
// bundler falls back to treating the import as external and re-emits the
// ORIGINAL `node:*` specifier. That is a WARNING, not an error: the build
// "succeeds" and writes a bundle that cannot load anywhere. It cost three red
// CI jobs to notice, because nothing between `gjsify build` and CI ever
// executes the emitted GJS bundle (tsc, lint, format and the unit/e2e suites
// all run the Node entry).
//
// The pre-commit hook makes it worse rather than better: it rebuilds and
// AUTO-STAGES `dist/cli.gjs.mjs`, so a developer whose checkout cannot resolve
// the polyfills commits a broken artifact without ever seeing it.
//
// So the refusal belongs at build time, in `gjsify build --app gjs` itself —
// not in a git hook and not in one package's `build:gjs-bundle` script. The
// invariant is a property of the ARTIFACT, and every showcase, every downstream
// app (buchhaltung, bauplaner, Learn6502) and CI all produce it through this
// one code path. A hook would protect only commits in this repo; a per-package
// script would protect one package.
//
// ## The oracle is the module graph, NOT the emitted text
//
// The first cut of this guard grepped the output for `from "node:…"`. That is
// wrong, and CI caught it: `@gjsify/process`'s own test bundle names a case
//
//   await it(`named-import hrtime (from "node:process") preserves .bigint`, …)
//
// so the phrase appears verbatim inside a STRING, in a bundle that loads and
// runs under GJS perfectly well. The same trap sits in `@gjsify/cli`'s own
// bundle, which embeds `giNodeShimSource()`'s `--app node` codegen template
// (`import { createRequire } from 'node:module';`). Telling a statement from a
// quoted lookalike needs a JS lexer — but the bundler already did that work:
// every chunk carries the list of external specifiers it actually imports. That
// list is exact, engine-independent (npm `rolldown` returns it directly,
// `@gjsify/rolldown-native` forwards it through `synthRolldownOutput`), and
// free.
//
// Scope is STATIC imports, which is precisely the failure mode above: they are
// resolved when GJS links the module, so one bad specifier kills the whole
// bundle. A dynamic `import('node:x')` throws lazily at its call site instead —
// a real bug, but not "the artifact cannot load", and not what this gate is
// for.

/** The one bundler-output field this guard needs, from either engine. */
export interface GuardedChunk {
    /** Emitted chunk name, for the error message. */
    fileName?: string;
    /** External specifiers the chunk STATICALLY imports (rollup/rolldown contract). */
    imports?: readonly string[];
}

/**
 * Bare `node:` specifiers a `--app gjs` bundle may keep as static imports.
 *
 * Deliberately EMPTY. Every Node builtin has an `@gjsify/*` polyfill that
 * `--app gjs` aliases to, so there is no specifier that both survives into the
 * module graph and loads under GJS. Reading the graph instead of the text is
 * what keeps this list empty — the entries an earlier text-scanning version
 * needed (`node:module`, `node:process`) were quoted lookalikes, never imports.
 *
 * Add an entry ONLY with a comment naming why GJS can resolve it. Each one is a
 * specifier this guard can no longer catch for real.
 */
export const GJS_ALLOWED_NODE_IMPORTS: readonly string[] = [];

/**
 * The distinct bare `node:` specifiers `chunks` statically import, minus the
 * allowlist. Sorted, so the error message and any test are stable.
 */
export function findDisallowedNodeImports(
    chunks: readonly GuardedChunk[],
    allowed: readonly string[] = GJS_ALLOWED_NODE_IMPORTS,
): string[] {
    const found = new Set<string>();
    for (const chunk of chunks) {
        for (const specifier of chunk.imports ?? []) {
            if (!specifier.startsWith('node:')) continue;
            if (allowed.includes(specifier)) continue;
            found.add(specifier);
        }
    }
    return [...found].sort();
}

/**
 * Throw when a built `--app gjs` bundle statically imports Node builtins.
 *
 * @param chunks   the emitted chunks, as reported by the bundler
 * @param outfile  path of the bundle, for the error message
 */
export function assertGjsBundleLoadable(chunks: readonly GuardedChunk[], outfile: string): void {
    const offenders = findDisallowedNodeImports(chunks);
    if (offenders.length === 0) return;
    throw new Error(
        `gjsify build --app gjs: ${outfile} still imports ${offenders.length} bare \`node:\` module(s), ` +
            'which stock GJS cannot resolve — it would fail at load with ' +
            '"ImportError: Unsupported URI scheme for importing: node".\n' +
            offenders.map((s) => `  - ${s}`).join('\n') +
            '\n\nThese should have been aliased to their `@gjsify/*` polyfills. The usual cause is that the ' +
            'alias TARGET could not be resolved, so the bundler externalised the import instead (look for ' +
            'UNRESOLVED_IMPORT warnings above): e.g. a workspace checkout whose `@gjsify/*` packages have no ' +
            'built `lib/`. Build the workspace first (`gjsify run build:infra`), or fix the resolution, then ' +
            'rebuild.',
    );
}
