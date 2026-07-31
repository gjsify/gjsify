// Shared runtime-selector tooling for running gjsify examples/showcases across
// the FOUR runtimes gjsify targets: gjs, node, bun, deno.
//
// This is the single source of truth generalized from the node-gi quad-runtime
// example's `harness.mjs`. Both the CLI (`gjsify run`/`gjsify showcase
// --runtime`) and the examples (the node-gi `harness.mjs`) consume it — so the
// RUNTIMES map, the runtime→build-target mapping and `availableRuntimes()` live
// in ONE place instead of a per-example copy.
//
// The module is intentionally PURE (only `node:child_process` and the pure,
// side-effect-free `@gjsify/rolldown-plugin-gjsify/runtime` host detector, no
// `gi://` / native imports) so an external example can deep-import it from the
// installed CLI (`@gjsify/cli/lib/utils/runtimes.js`) without pulling the whole
// bundler in. Mirrors the existing `@gjsify/cli/lib/utils/run-gjs.js`
// deep-import precedent used by the dlx e2e suites.

import { execFileSync } from 'node:child_process';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';

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

/**
 * Does running an example/showcase on `runtime` require the GJS SYSTEM
 * dependencies — i.e. a `gjs` binary on PATH?
 *
 * DERIVED from `buildApp`, deliberately not a second table: "consumes the
 * `--app gjs` bundle" and "needs a gjs interpreter" are the same fact, and a
 * hand-written second list drifts the first time a runtime is added.
 *
 * The caller must resolve the runtime BEFORE gating on it. `gjsify showcase`
 * called `runMinimalChecks()` — which marks `gjs` `required` — three statements
 * ABOVE the line resolving `args.runtime`, so `--runtime node` aborted with
 * "Missing system dependencies: ✗ GJS" before reaching the `runtime !== 'gjs'`
 * branch that never touches gjs. Every showcase was unreachable on a host
 * without gjs (Windows, plain Node/bun/deno) — including the default path,
 * since `defaultExampleRuntime()` falls back to the host runtime for exactly
 * those hosts.
 */
export function requiresGjsSystemDeps(runtime: ExampleRuntime): boolean {
    return buildAppForRuntime(runtime) === 'gjs';
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

/**
 * Whether a specific runtime is runnable here. The HOST runtime (the one the
 * CLI itself executes in — gjs / node / bun / deno) is always available: we are
 * running on it, so no PATH probe is needed. Every other runtime is probed via
 * `<binary> --version`.
 */
export function isRuntimeAvailable(runtime: ExampleRuntime): boolean {
    return runtime === hostRuntime() ? true : isRuntimeOnPath(RUNTIMES[runtime].probe);
}

/** Which of gjs/node/bun/deno are runnable on this host. */
export function availableRuntimes(): ExampleRuntime[] {
    return EXAMPLE_RUNTIMES.filter((rt) => isRuntimeAvailable(rt));
}

/**
 * The default `--runtime` for running a prebuilt EXAMPLE/SHOWCASE: `gjs`
 * whenever gjs is runnable here, else the host runtime.
 *
 * This is deliberately NOT a plain `hostRuntime()`. A showcase's canonical
 * artifact is its `--app gjs` bundle (`gjsify.main`) — that is what every
 * showcase ships, what the `gjs` path installs via `gjsify dlx`, and what the
 * docs call the default. Following the host instead means `npx @gjsify/cli
 * showcase <name>` (host = node) silently asks for the `--app node` bundle,
 * which most showcases do not ship and which additionally needs
 * `@gjsify/node-gi` in the consumer's project — so the FIRST-RUN experience of
 * the primary documented entry point failed on a missing file.
 *
 * Same rule `gjsify run` already applies in its bare-file path, where a
 * `--app gjs` bundle stays on gjs regardless of host (`isLikelyGjsBundle`);
 * here the "is it a gjs artifact" question is answered by the command instead
 * of by sniffing the file. `--runtime` still overrides explicitly, and a host
 * WITHOUT gjs (a plain Node/bun/deno box) keeps following the host so the
 * node-capable showcases stay runnable there.
 */
export function defaultExampleRuntime(): ExampleRuntime {
    return isRuntimeAvailable('gjs') ? 'gjs' : hostRuntime();
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
