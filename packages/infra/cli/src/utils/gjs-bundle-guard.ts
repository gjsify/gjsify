// Build-time guard: a `--app gjs` bundle must not keep bare `node:` imports.
//
// Stock GJS has NO `node:` module loader. A single surviving `import … from "node:fs"`
// makes it abort the ENTIRE module graph before one line executes, with
// "ImportError: Unsupported URI scheme for importing: node".
//
// `--app gjs` maps every Node builtin to its `@gjsify/*` polyfill, so a healthy bundle has
// ZERO of them. But when an alias TARGET cannot be resolved — classically a workspace
// checkout whose `@gjsify/*` packages have no built `lib/`, so `exports["."]` points at a
// file that does not exist — the bundler falls back to external and re-emits the ORIGINAL
// `node:*` specifier. That is a WARNING, not an error: the build "succeeds" and writes a
// bundle that cannot load anywhere. It cost three red CI jobs to notice, because nothing
// between `gjsify build` and CI ever executes the emitted GJS bundle (tsc, lint, format and
// the unit/e2e suites all run the Node entry). The pre-commit hook makes it worse rather
// than better: it rebuilds and AUTO-STAGES `dist/affected.gjs.mjs`, built through this same
// `--app gjs` path, so a developer whose checkout cannot resolve the polyfills commits a
// broken artifact without ever seeing it.
//
// So the refusal belongs at build time, in `gjsify build --app gjs` itself — not in a git
// hook and not in one package's `build:gjs-bundle` script. The invariant is a property of
// the ARTIFACT, and every showcase, every downstream app (buchhaltung, bauplaner,
// Learn6502) and CI all produce it through this one code path.
//
// ## The oracle is the module graph, NOT the emitted text
//
// The first cut grepped the output for `from "node:…"`, and CI caught it:
// `@gjsify/process`'s own test bundle names a case `named-import hrtime (from
// "node:process") preserves .bigint`, so the phrase appears verbatim inside a STRING in a
// bundle that runs under GJS perfectly well. The same trap sits in `@gjsify/cli`'s own
// bundle, which embeds `giNodeShimSource()`'s `--app node` codegen template
// (`import { createRequire } from 'node:module';`). Telling a statement from a quoted
// lookalike needs a JS lexer — but the bundler already did that work: every chunk carries
// the external specifiers it actually imports, exact and engine-independent (npm `rolldown`
// returns it directly, `@gjsify/rolldown-native` forwards it via `synthRolldownOutput`).
//
// Scope is STATIC imports, which is the failure mode above: they are resolved when GJS
// links the module, so one bad specifier kills the whole bundle. A dynamic
// `import('node:x')` throws lazily at its call site — a real bug, but not "the artifact
// cannot load", and not what this gate is for.

// ## `node:` was never the general case
//
// A bare `node:` specifier is one shape of ONE defect: the emitted module imports
// something the GJS loader cannot resolve. GJS's ESM loader has no node_modules walker
// and does not follow `package.json#exports`, so ANY bare specifier that survives into a
// `--app gjs` bundle is dead on arrival — `ImportError: Module not found: <specifier>`,
// again before one line runs. MEASURED: a `.tsx` entry with no JSX configuration makes
// oxc default to the automatic runtime with `importSource: 'react'`, the bundle carries
// `import { jsx } from "react/jsx-runtime"`, rolldown reports that as an
// `UNRESOLVED_IMPORT` **warning**, `gjsify build` exits 0, and `gjs -m` on the artifact
// dies with `ImportError: Module not found: react/jsx-runtime`. The `node:`-only guard
// saw none of it.
//
// The legitimate-vs-broken line is the same one `plugins/unresolved-workspace-import.ts`
// draws one layer up, and for the same reason a blanket "fail on any external" cannot be
// used: a DECLARED external is a promise the caller made and must be honoured. So the
// guard asks the target's OWN externals predicate (`createGjsExternalsPredicate`, the one
// `externalsPlugin` enforces) rather than a second list that can drift, and it ignores
// everything that is not a bare specifier — `gi://Gtk?version=4.0`, `file:`/`resource:`
// URLs and relative sibling-chunk paths all name something GJS can resolve on its own.
// `chunk.imports` also carries the fileNames of other EMITTED chunks, un-prefixed, so the
// emitted set is passed in and excluded by name.

import { locateSurvivingJsx, formatSurvivingJsx } from '@gjsify/rolldown-plugin-gjsify';

/** The bundler-output fields this guard needs, from either engine. */
export interface GuardedChunk {
    /** Emitted chunk name, for the error message. */
    fileName?: string;
    /** External specifiers the chunk STATICALLY imports (rollup/rolldown contract). */
    imports?: readonly string[];
    /** Emitted source, for the syntax check. Present on a written chunk on both engines. */
    code?: string;
}

/**
 * Bare `node:` specifiers a `--app gjs` bundle may keep as static imports.
 *
 * Deliberately EMPTY: every Node builtin has an `@gjsify/*` polyfill that `--app gjs`
 * aliases to, so no specifier both survives into the module graph and loads under GJS.
 *
 * Add an entry ONLY with a comment naming why GJS can resolve it. Each one is a specifier
 * this guard can no longer catch for real.
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
 * Is `id` a BARE package specifier — the only shape GJS's ESM loader cannot resolve on
 * its own?
 *
 * Relative and absolute paths name a file; anything carrying a URL scheme names a
 * loader GJS either has (`gi:`, `file:`, `resource:`) or will report itself. `node:` is
 * classified BEFORE this, because it has its own message and its own symptom.
 * A win32 drive path (`C:\…`) matches the scheme test, which is the intended answer.
 */
export function isBareSpecifier(id: string): boolean {
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\\')) return false;
    return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(id);
}

/** What the caller must tell the guard about this build's own promises. */
export interface GjsImportPolicy {
    /**
     * The target's own externals predicate — pass
     * `createGjsExternalsPredicate(userExternal)`, the same one `externalsPlugin`
     * enforces, so the guard and the build cannot disagree about what was declared.
     * Omitted, nothing counts as declared.
     */
    isExternal?: (id: string) => boolean;
    /**
     * Every fileName the build emitted. `chunk.imports` lists sibling CHUNKS by fileName
     * with no `./` prefix, which is indistinguishable from a bare package specifier — so
     * the set is excluded by name rather than guessed at by shape.
     */
    emitted?: readonly string[];
}

/**
 * The distinct bare specifiers `chunks` statically import that nothing in this build
 * promised to provide. Sorted, so the error message and any test are stable.
 */
export function findUnresolvableBareImports(chunks: readonly GuardedChunk[], policy: GjsImportPolicy = {}): string[] {
    const emitted = new Set(policy.emitted ?? []);
    const found = new Set<string>();
    for (const chunk of chunks) {
        for (const specifier of chunk.imports ?? []) {
            // `node:` has its own diagnosis; classifying it here too would report one
            // defect twice with two different fixes.
            if (specifier.startsWith('node:')) continue;
            if (!isBareSpecifier(specifier)) continue;
            if (emitted.has(specifier)) continue;
            if (policy.isExternal?.(specifier)) continue;
            found.add(specifier);
        }
    }
    return [...found].sort();
}

/**
 * Throw when a built `--app gjs` bundle statically imports something GJS cannot
 * resolve — a bare `node:` builtin, or any other bare specifier this build did not
 * declare external.
 *
 * The two are reported separately because they have different symptoms and different
 * fixes: a `node:` specifier aborts with "Unsupported URI scheme", any other bare one
 * with "Module not found", and the first means an alias target failed while the second
 * means the dependency is simply not there.
 */
export function assertGjsBundleLoadable(
    chunks: readonly GuardedChunk[],
    outfile: string,
    policy: GjsImportPolicy = {},
): void {
    const nodeOffenders = findDisallowedNodeImports(chunks);
    if (nodeOffenders.length > 0) {
        throw new Error(
            `gjsify build --app gjs: ${outfile} still imports ${nodeOffenders.length} bare \`node:\` module(s), ` +
                'which stock GJS cannot resolve — it would fail at load with ' +
                '"ImportError: Unsupported URI scheme for importing: node".\n' +
                nodeOffenders.map((s) => `  - ${s}`).join('\n') +
                '\n\nThese should have been aliased to their `@gjsify/*` polyfills. The usual cause is that the ' +
                'alias TARGET could not be resolved, so the bundler externalised the import instead (look for ' +
                'UNRESOLVED_IMPORT warnings above): e.g. a workspace checkout whose `@gjsify/*` packages have no ' +
                'built `lib/`. Build the workspace first (`gjsify run build:infra`), or fix the resolution, then ' +
                'rebuild.',
        );
    }
    const bareOffenders = findUnresolvableBareImports(chunks, policy);
    if (bareOffenders.length === 0) return;
    throw new Error(
        `gjsify build --app gjs: ${outfile} statically imports ${bareOffenders.length} bare package ` +
            'specifier(s) nothing in this build resolves or declares external. GJS has no node_modules walker ' +
            'and does not follow `package.json#exports`, so it aborts the whole module graph at load with ' +
            '"ImportError: Module not found: <specifier>".\n' +
            bareOffenders.map((s) => `  - ${s}`).join('\n') +
            '\n\nRolldown reports these as UNRESOLVED_IMPORT WARNINGS and re-emits the original specifier, ' +
            'which is why the build reached this point at all. Likely causes:\n' +
            '  - the package is not installed — add it as a dependency and `gjsify install`.\n' +
            '  - a JSX entry with no JSX configuration: oxc then defaults to the automatic runtime with ' +
            '`importSource: "react"`, so the bundle imports `react/jsx-runtime`. Set ' +
            '`gjsify.bundler.transform.jsx.importSource` (e.g. `@gjsify/gtk-host`), or tsconfig ' +
            '`"jsx": "react-jsx"` + `"jsxImportSource"`.\n' +
            '  - the specifier is meant to be provided by the host at runtime — then say so, with ' +
            '`gjsify.bundler.external`.',
    );
}

/**
 * Throw when a written `--app gjs` chunk is not parseable JavaScript because raw JSX
 * survived into it. See `@gjsify/rolldown-plugin-gjsify`'s `utils/jsx-survival.ts` for
 * why the oracle is a parse and not a pattern, and for the measurement.
 *
 * Called ONLY when the effective JSX setting PRESERVES JSX, which is the only way it can
 * reach an artifact: oxc compiles it otherwise. That is not a cost dodge but the precise
 * condition — though the cost is real, and measured: parsing the repo's largest bundle
 * (`dist/cli.gjs.mjs`, 6.8 MB) takes ~850 ms, which is not worth paying on every GJS
 * build to re-answer a question the transform already settled.
 */
export function assertGjsBundleParses(chunks: readonly GuardedChunk[], label: string): void {
    for (const chunk of chunks) {
        const code = chunk.code;
        if (typeof code !== 'string' || code.length === 0) continue;
        const found = locateSurvivingJsx(code);
        if (found === null) continue;
        throw new Error(formatSurvivingJsx(found, chunk.fileName ? `${label} (${chunk.fileName})` : label));
    }
}
