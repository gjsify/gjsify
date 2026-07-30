// Build-time guard: a `--app node` bundle that USES the GJS ambient globals
// must also have been given `@gjsify/node-gi/globals`.
//
// `print`/`printerr`/`log`/`logError`/`ARGV`/`imports` exist implicitly under
// gjs and nowhere else. On the node target they are seeded by the side-effect
// shim `@gjsify/node-gi/globals`, which the CLI injects when — and only when —
// `detectNodeGiGlobals` finds one of them in an analysis bundle. Injecting it
// unconditionally is not an option: it eagerly loads the native node-gi addon,
// so a cross-platform package's node bundle would stop loading on plain Node.
//
// That makes the decision a PREDICTION about an artifact that does not exist
// yet, and a prediction can be wrong. It was: the analysis pass used to run
// before the explicit-`--globals` register stub was resolved, and that stub is
// one of the two signals `isGjsSourceBuild()` reads — so the analysis bundle
// routed `/register` subpaths to `@gjsify/empty` and emptied `@girs/*` while the
// REAL build resolved them for real. Every ambient global reachable only through
// a register module was therefore invisible to the detector. The build exited 0
// and the emitted bundle died at its first canvas op with
//
//   ReferenceError: imports is not defined
//       at CanvasRenderingContext2D._toDataURL
//
// on node AND bun (the excalibur-jelly-jumper showcase), while gjs — where the
// globals are ambient — ran fine. Nothing between `gjsify build --app node` and
// a user running the bundle ever looked at the artifact.
//
// So this is a POST-condition on what was actually emitted: whatever the
// detector predicted, check it against the bundle. It is deliberately NOT a
// second detector — it runs the SAME `detectGjsAmbientGlobals` over the SAME
// kind of input (bundled, tree-shaken output, parsed by acorn, bare identifiers
// only). Two passes over one oracle that must agree; when they don't, the graph
// they saw differed, which is a bug in the build pipeline, not in user code.
//
// Scope: only when the CLI decided NOT to inject (`--globals auto`, no shim).
// `--globals none` opts out of the whole mechanism explicitly and is skipped.

import { detectGjsAmbientGlobals } from '@gjsify/rolldown-plugin-gjsify/globals';

/**
 * The GJS ambient globals referenced as BARE identifiers in `code`, sorted.
 *
 * Empty for a bundle that only uses the `globalThis.imports` isomorphic-guard
 * shape — that form is a runtime probe, not a dependency, and the detector
 * ignores it for exactly that reason.
 */
export function findUnshimmedGjsGlobals(code: string): string[] {
    return [...detectGjsAmbientGlobals(code)].sort();
}

/**
 * Throw when a `--app node` bundle references GJS ambient globals but was built
 * without the `@gjsify/node-gi/globals` shim.
 *
 * @param code     the emitted bundle source
 * @param outfile  path of the bundle, for the error message
 */
export function assertNodeBundleGlobalsShimmed(code: string, outfile: string): void {
    const offenders = findUnshimmedGjsGlobals(code);
    if (offenders.length === 0) return;
    throw new Error(
        `gjsify build --app node: ${outfile} references ${offenders.length} GJS ambient global(s) that ` +
            'nothing installs on node/bun/deno, so the bundle throws `ReferenceError: <name> is not defined` ' +
            'the first time that code runs:\n' +
            offenders.map((s) => `  - ${s}`).join('\n') +
            '\n\nThe `@gjsify/node-gi/globals` shim seeds them, but it is injected only when the pre-build ' +
            'detection pass finds them — and that pass did not. The two passes therefore disagreed about the ' +
            'module graph. Either the detection ran against a different graph than the one emitted (check that ' +
            'anything feeding `isGjsSourceBuild()` — the `--globals` register stub, `nodeGiGlobalsInject` — is ' +
            'settled BEFORE `detectNodeGiGlobals`), or the offending package should stop reaching for the ' +
            'legacy `imports` object: `gi://<Ns>` and the bare `system`/`gettext`/`cairo` built-ins resolve on ' +
            'both runtimes, `imports` does not.',
    );
}
