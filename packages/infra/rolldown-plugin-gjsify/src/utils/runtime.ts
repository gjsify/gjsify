// Host-runtime detection for the gjsify build tooling.
//
// `@gjsify/cli` and `@gjsify/rolldown-plugin-gjsify` both run under BOTH Node
// and GJS — the CLI ships a Node entry (`lib/index.js`) AND a committed GJS
// bundle (`dist/cli.gjs.mjs`). Several code paths branch on the host: the
// bundler-engine pick (native rolldown vs npm crate), oxc resolution, plugin
// loading, CSS lowering. Before this module each of those re-inlined the same
// `typeof globalThis.imports?.gi !== 'undefined'` probe; this is the single
// source of truth for them.
//
// Kept deliberately pure — no `gi://` / `@girs/*` imports, no side effects —
// so it stays loadable on every host and so consumers can import it via the
// `@gjsify/rolldown-plugin-gjsify/runtime` subpath without pulling the rest of
// the plugin (which transitively loads blueprint-compiler, deepkit, etc.).

/**
 * `true` when running under GJS (GNOME JavaScript / SpiderMonkey).
 *
 * Detected via the GObject-Introspection bridge `globalThis.imports.gi`, which
 * only exists under GJS — Node and browsers never expose it. This is the
 * canonical gjsify host probe; prefer it over re-inlining the `imports.gi`
 * check.
 */
export function isGjs(): boolean {
    return typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
}

/**
 * `true` when running under Node.js.
 *
 * GJS is checked FIRST and short-circuits to `false`: `@gjsify/process` sets
 * `process.versions.node` (for npm-package compatibility), so a bare
 * `process.versions.node` probe is a false Node positive under GJS. Guarding
 * with `isGjs()` keeps the two host predicates mutually exclusive.
 */
export function isNode(): boolean {
    if (isGjs()) return false;
    const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
    return typeof proc?.versions?.node === 'string';
}
