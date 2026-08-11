// Shared runtime-selector tooling for running gjsify examples/showcases across
// the FOUR runtimes gjsify targets: gjs, node, bun, deno.
//
// Both the CLI (`gjsify run` / `gjsify showcase --runtime`) and the examples (the
// node-gi `harness.mjs`) consume this, so the RUNTIMES map, the
// runtime→build-target mapping and `availableRuntimes()` live in ONE place instead
// of a per-example copy.
//
// Intentionally PURE (only `node:child_process` and the side-effect-free
// `@gjsify/rolldown-plugin-gjsify/runtime` host detector, no `gi://` or native
// imports) so an external example can deep-import it from the installed CLI
// (`@gjsify/cli/lib/utils/runtimes.js`) without pulling in the whole bundler — the
// same deep-import precedent as `@gjsify/cli/lib/utils/run-gjs.js`.

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
 * `deno` uses `--node-modules-dir=manual`: `auto` would re-resolve the example's
 * heavy build-time dep tree (`@gjsify/cli` + platform binaries) and hang, when the
 * app only needs the already-linked runtime dep `@gjsify/node-gi`.
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
 * The caller must resolve the runtime BEFORE gating on it. Calling
 * `runMinimalChecks()` (which marks `gjs` `required`) above the line that resolves
 * `args.runtime` made every showcase unreachable on a host without gjs — `--runtime
 * node` aborted with "Missing system dependencies: ✗ GJS" before reaching the
 * branch that never touches gjs, the default path included.
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
 * Whether a specific runtime is runnable here. The HOST runtime needs no PATH probe
 * — the CLI is executing on it; every other runtime is probed via
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
 * Deliberately NOT a plain `hostRuntime()`. A showcase's canonical artifact is its
 * `--app gjs` bundle (`gjsify.main`) — what every showcase ships and what `gjsify
 * dlx` installs. Following the host instead makes `npx @gjsify/cli showcase <name>`
 * (host = node) ask for the `--app node` bundle, which most showcases do not ship
 * and which also needs `@gjsify/node-gi` in the consumer's project, so the
 * first-run experience of the primary documented entry point failed on a missing
 * file.
 *
 * Same rule `gjsify run` applies in its bare-file path (`isLikelyGjsBundle`), with
 * "is it a gjs artifact" answered by the command rather than by sniffing the file.
 * `--runtime` still overrides, and a host WITHOUT gjs keeps following the host so
 * node-capable showcases stay runnable there.
 */
export function defaultExampleRuntime(): ExampleRuntime {
    return isRuntimeAvailable('gjs') ? 'gjs' : hostRuntime();
}

// An example/showcase MAY declare which runtimes it supports:
//
//   "gjsify": { "example": { "runtimes": ["gjs", "node", "bun", "deno"] } }
//
// Optional: a package without it is unconstrained and runs on any requested
// runtime. The declaration lets a GTK/Adw showcase say `["gjs"]` so `--runtime
// node` fails with an actionable error instead of crashing deep in a bundle it
// cannot run.

interface ExampleGjsifyField {
    example?: { runtimes?: unknown };
}

/**
 * A package's declared example runtimes, or `null` when it declares none (the
 * permissive case). Unknown entries are dropped so a future runtime name does not
 * hard-error against an older CLI.
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
 * Validate a requested runtime against a package's declaration; a `null`
 * declaration is permissive. Returns a message rather than throwing, so callers
 * print it and exit cleanly.
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
