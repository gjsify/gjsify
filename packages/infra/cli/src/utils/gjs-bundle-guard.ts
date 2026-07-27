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

/**
 * Bare `node:` specifiers this scan tolerates in a `--app gjs` bundle.
 *
 * Every Node builtin has an `@gjsify/*` polyfill that `--app gjs` aliases to,
 * so nothing here is permitted because GJS could load it — the one entry is a
 * detector limitation, spelled out so it cannot be widened by accident.
 *
 * - `node:module` — NOT an import. `@gjsify/cli`'s GJS bundle contains the
 *   bundler, and `giNodeShimSource()`
 *   (`rolldown-plugin-gjsify/src/plugins/gjs-gi-node.ts`) carries the string
 *   ``  `import { createRequire } from 'node:module';\n`  `` — the shim source
 *   it GENERATES for `--app node` builds. The scan is textual, not a JS lexer,
 *   so a specifier quoted inside a template literal is indistinguishable from a
 *   real statement. Present verbatim in `origin/main`'s bundle, which loads
 *   under GJS.
 *
 * Add an entry ONLY with a comment naming why it is permitted. Note the cost of
 * each one: an allowlisted specifier that later becomes a REAL import is no
 * longer caught, so keep this list at the length of the demonstrated need.
 */
export const GJS_ALLOWED_NODE_IMPORTS: readonly string[] = ['node:module'];

/**
 * Matches the import FORMS a bundler emits, so a `node:…` mentioned inside a
 * string literal (e.g. the `@gjsify/streams` hint "Import \"node:stream/web\"
 * or …", which is present in every healthy bundle) is not mistaken for one.
 *
 * Covers `from "node:x"`, the bare side-effect `import "node:x"`, dynamic
 * `import("node:x")` and `require("node:x")`, with or without the whitespace a
 * minified bundle drops.
 */
const IMPORT_FORM = /(?:^|[^\w$.])(?:from|import|require)\s*\(?\s*(["'])(node:[^"']+)\1/g;

/**
 * The distinct bare `node:` specifiers `code` still imports, minus the
 * allowlist. Sorted, so the error message and any test are stable.
 */
export function findDisallowedNodeImports(
    code: string,
    allowed: readonly string[] = GJS_ALLOWED_NODE_IMPORTS,
): string[] {
    const found = new Set<string>();
    // `matchAll` needs the /g flag reset between calls — the regex is module
    // scoped, so copy it rather than relying on `lastIndex` housekeeping.
    for (const m of code.matchAll(new RegExp(IMPORT_FORM.source, 'g'))) {
        const specifier = m[2];
        if (!allowed.includes(specifier)) found.add(specifier);
    }
    return [...found].sort();
}

/**
 * Throw when a built `--app gjs` bundle still imports Node builtins.
 *
 * @param code     the emitted bundle source
 * @param outfile  path of the bundle, for the error message
 */
export function assertGjsBundleLoadable(code: string, outfile: string): void {
    const offenders = findDisallowedNodeImports(code);
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
