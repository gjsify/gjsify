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
 * `true` when running under Bun.
 *
 * Bun exposes a `globalThis.Bun` object no other runtime provides. Probed
 * FIRST in {@link hostRuntime} because Bun also fakes `process.versions.node`
 * for npm compatibility — a bare `process.versions.node` read is a false Node
 * positive there.
 */
export function isBun(): boolean {
    return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

/**
 * `true` when running under Deno.
 *
 * Deno exposes a `globalThis.Deno` object no other runtime provides. Like Bun,
 * Deno also fakes `process.versions.node`, so it must be probed before the Node
 * fallback.
 */
export function isDeno(): boolean {
    return typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';
}

/**
 * `true` when running under GJS (GNOME JavaScript / SpiderMonkey).
 *
 * Detected via the GObject-Introspection bridge `globalThis.imports.gi`, which
 * only exists under GJS — Node, Bun, Deno and browsers never expose it. This is
 * the canonical gjsify host probe; prefer it over re-inlining the `imports.gi`
 * check.
 */
export function isGjs(): boolean {
    return typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
}

/**
 * The JS runtime hosting the gjsify tooling: `gjs`, `node`, `bun` or `deno`.
 *
 * The single source of truth for host-derived defaults (the default `--app`
 * build target and the default `--runtime` in `run`/`showcase`/`storybook`).
 *
 * Probe order mirrors `packages/node-gi/node-gi/index.js`: **Bun and Deno
 * first** because both fake `process.versions.node` for npm compatibility (so a
 * `process.versions.node` read is a false Node positive there), then GJS (its
 * `@gjsify/process` shim likewise fakes `process.versions.node`), then real
 * Node. Falls back to `node` when nothing matches (e.g. an exotic host) — the
 * gjsify tooling only runs on these four.
 */
export function hostRuntime(): 'gjs' | 'node' | 'bun' | 'deno' {
    if (isBun()) return 'bun';
    if (isDeno()) return 'deno';
    if (isGjs()) return 'gjs';
    return 'node';
}

/**
 * `true` when running under Node.js — and NOT Bun or Deno.
 *
 * Bun and Deno both set `process.versions.node` for npm compatibility, so a
 * bare `process.versions.node` probe is a false Node positive on either — the
 * historical bug this guard fixes. GJS (via `@gjsify/process`) does the same.
 * Guarding on all three keeps the four host predicates mutually exclusive: a
 * host is exactly one of gjs / node / bun / deno.
 */
export function isNode(): boolean {
    if (isBun() || isDeno() || isGjs()) return false;
    const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
    return typeof proc?.versions?.node === 'string';
}

/**
 * The raw GJS runtime version from `imports.system.version` (e.g. `18800` for
 * GJS 1.88.0), or `undefined` when not running under GJS.
 *
 * A distinct probe from {@link isGjs}: use it where the caller needs the numeric
 * version (to format a banner) OR an early GJS short-circuit that must not rely
 * on `@gjsify/process`'s faked `process.versions.node`.
 */
export function gjsSystemVersion(): number | undefined {
    return (globalThis as { imports?: { system?: { version?: number } } }).imports?.system?.version;
}

/**
 * Force a hard exit under GJS via `imports.system.exit(code)`.
 *
 * GJS has no atexit hook and would exit 0 at natural shutdown, so a non-zero
 * `process.exitCode` alone does not stick — the CLI must call `system.exit`
 * explicitly there. Node never exposes `imports`, so this is a no-op returning
 * `false`, letting callers fall back to `process.exit`/`process.exitCode`.
 *
 * @returns `true` when the GJS exit was invoked (running under GJS); `false` on
 *          Node (the caller owns the Node exit path).
 */
export function gjsExit(code: number): boolean {
    const sys = (globalThis as { imports?: { system?: { exit?: (c: number) => void } } }).imports?.system;
    if (sys?.exit) {
        sys.exit(code);
        return true;
    }
    return false;
}
