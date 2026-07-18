// Shared runtime-selector tooling for running gjsify examples/showcases across
// the FOUR runtimes gjsify targets: gjs, node, bun, deno.
//
// This is the single source of truth generalized from the node-gi quad-runtime
// example's `harness.mjs`. Both the CLI (`gjsify run`/`gjsify showcase
// --runtime`) and the examples (the node-gi `harness.mjs`) consume it — so the
// RUNTIMES map, the runtime→build-target mapping and `availableRuntimes()` live
// in ONE place instead of a per-example copy.
//
// The module is intentionally PURE (only `node:child_process`, no `gi://` /
// native imports) so an external example can deep-import it from the installed
// CLI (`@gjsify/cli/lib/utils/runtimes.js`) without pulling the whole bundler
// in. Mirrors the existing `@gjsify/cli/lib/utils/run-gjs.js` deep-import
// precedent used by the dlx e2e suites.

import { execFileSync } from 'node:child_process';

/** The runtimes a built gjsify example/showcase can run on. `gjs` is the reference. */
export type ExampleRuntime = 'gjs' | 'node' | 'bun' | 'deno';

/** All runtimes, in canonical order (gjs first — it is the reference). */
export const EXAMPLE_RUNTIMES: readonly ExampleRuntime[] = ['gjs', 'node', 'bun', 'deno'];

export interface RuntimeSpec {
    /** Binary probed on PATH to decide availability (`<probe> --version`). */
    readonly probe: string;
    /**
     * The `gjsify build --app <buildApp>` target this runtime consumes. `gjs`
     * runs the native `--app gjs` bundle; node/bun/deno all reuse the SAME
     * `--app node` bundle (gi:// → `@gjsify/node-gi`; Node-API is their common
     * ABI), so bun/deno never need their own build target.
     */
    readonly buildApp: 'gjs' | 'node';
    /** argv to launch a built `entry` (+ optional extra args) under this runtime. */
    readonly launch: (entry: string, extraArgs?: readonly string[]) => [string, string[]];
}

/**
 * The runtime map — the generalization of the node-gi harness's `RUNTIMES`.
 * `deno` uses `--node-modules-dir=manual`: `auto` would re-resolve the example's
 * heavy build-time dep tree (`@gjsify/cli` + platform binaries) and hang, when
 * the app only needs the already-linked runtime dep `@gjsify/node-gi`.
 */
export const RUNTIMES: Record<ExampleRuntime, RuntimeSpec> = {
    gjs: { probe: 'gjs', buildApp: 'gjs', launch: (e, a = []) => ['gjs', ['-m', e, ...a]] },
    node: { probe: 'node', buildApp: 'node', launch: (e, a = []) => ['node', [e, ...a]] },
    bun: { probe: 'bun', buildApp: 'node', launch: (e, a = []) => ['bun', [e, ...a]] },
    deno: {
        probe: 'deno',
        buildApp: 'node',
        launch: (e, a = []) => ['deno', ['run', '-A', '--node-modules-dir=manual', e, ...a]],
    },
};

/** Type guard: is `value` one of the four known runtimes? */
export function isExampleRuntime(value: string): value is ExampleRuntime {
    return (EXAMPLE_RUNTIMES as readonly string[]).includes(value);
}

/** The `gjsify build --app <target>` a runtime consumes (`gjs`, else `node`). */
export function buildAppForRuntime(runtime: ExampleRuntime): 'gjs' | 'node' {
    return RUNTIMES[runtime].buildApp;
}

/** Whether `<probe> --version` succeeds (i.e. the runtime binary is on PATH). */
export function isRuntimeOnPath(probe: string): boolean {
    try {
        execFileSync(probe, ['--version'], { stdio: 'ignore', timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

/** Whether a specific runtime is runnable here (node is always assumed — we ARE node/a runtime). */
export function isRuntimeAvailable(runtime: ExampleRuntime): boolean {
    return runtime === 'node' ? true : isRuntimeOnPath(RUNTIMES[runtime].probe);
}

/** Which of gjs/node/bun/deno are runnable on this host. */
export function availableRuntimes(): ExampleRuntime[] {
    return EXAMPLE_RUNTIMES.filter((rt) => isRuntimeAvailable(rt));
}

// --- Per-example runtime declaration ---------------------------------------
//
// An example/showcase MAY declare which runtimes it supports:
//
//   "gjsify": { "example": { "runtimes": ["gjs", "node", "bun", "deno"] } }
//
// This is OPTIONAL and back-compat: a package WITHOUT the declaration is treated
// as unconstrained (runs on any requested runtime). The declaration lets a
// GTK/Adw showcase say `["gjs"]` so `--runtime node` fails with a clear,
// actionable error instead of crashing deep in a bundle it can't run (e.g.
// before node-gi's GTK layer exists).

interface ExampleGjsifyField {
    example?: { runtimes?: unknown };
}

/**
 * Read a package's declared example runtimes. Returns the (validated) list, or
 * `null` when the package declares none — the "unconstrained / permissive" case.
 * Unknown entries in the list are dropped (so a future runtime name doesn't hard
 * error against an older CLI).
 */
export function readDeclaredRuntimes(pkg: { gjsify?: ExampleGjsifyField } | null | undefined): ExampleRuntime[] | null {
    const list = pkg?.gjsify?.example?.runtimes;
    if (!Array.isArray(list)) return null;
    return list.filter((v): v is ExampleRuntime => typeof v === 'string' && isExampleRuntime(v));
}

export interface RuntimeSupportResult {
    ok: boolean;
    /** A clear, actionable message when `ok === false`; undefined otherwise. */
    message?: string;
}

/**
 * Validate a requested runtime against a package's declaration. A `null`
 * declaration is permissive (always ok). When the runtime is not in the
 * declared set, returns a clear, actionable error message (never throws) so
 * callers can print it and exit cleanly.
 */
export function checkRuntimeSupported(
    runtime: ExampleRuntime,
    declared: ExampleRuntime[] | null,
    name: string,
): RuntimeSupportResult {
    if (declared === null) return { ok: true };
    if (declared.includes(runtime)) return { ok: true };
    const supported = declared.length > 0 ? declared.join(', ') : '(none)';
    return {
        ok: false,
        message:
            `"${name}" does not support --runtime ${runtime}.\n` +
            `  Declared runtimes: ${supported}.\n` +
            `  Run it on one of the declared runtimes, e.g. --runtime ${declared[0] ?? 'gjs'}.`,
    };
}
