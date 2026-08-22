// Shared utility for running a `--app node` bundle on Node.js with the native
// typelib env wired the same way `runGjsBundle` does.
//
// A `--app node` bundle of a `gi://` source runs the GObject stack through `@gjsify/node-gi`
// (the Axis-5 reverse bridge). Two things must hold at runtime:
//
//   1. `@gjsify/node-gi` must resolve FROM THE BUNDLE — the bundler keeps it EXTERNAL (native
//      addon), so it has to physically exist in a node_modules the bundle's own directory can
//      reach, with the CWD as a fallback. Checked up front so the failure is a clear hint
//      rather than an `ERR_MODULE_NOT_FOUND` deep in the bundle (`resolveNodeGiForBundle`).
//   2. `gi://Gtk` / `gi://Adw` must resolve. System typelibs come from the default GI search
//      path, but an `@gjsify/*` Vala bridge ships its typelib in `prebuilds/`, so the SAME
//      `computeNativeEnvForBundle()` walker `runGjsBundle` uses prepends `GI_TYPELIB_PATH` /
//      `LD_LIBRARY_PATH`. A no-op when no native gjsify packages are present.
//
// The node binary is `process.execPath` when the CLI runs under Node, else PATH `node` — under
// the GJS bundle `process.execPath` is `gjs`, which cannot run a `--app node` bundle.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isNode } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { computeNativeEnvForBundle } from './run-gjs.js';
import { RUNTIMES, type ExampleRuntime } from './runtimes.js';
import { type SpawnCompletionContract, describeExit, spawnToCompletion } from './spawn.js';

/**
 * Walk up from `startDir` for `<node_modules>/@gjsify/node-gi`, returning its package directory
 * or null. A plain fs walk because Node's own resolver is not available under the GJS-bundled CLI.
 */
export function resolveNodeGi(startDir: string): string | null {
    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, 'node_modules', '@gjsify', 'node-gi', 'package.json');
        if (existsSync(candidate)) return join(dir, 'node_modules', '@gjsify', 'node-gi');
        const parent = resolve(dir, '..');
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Resolve `@gjsify/node-gi` for a bundle about to launch: the BUNDLE's own directory first, then
 * `cwd`.
 *
 * The bundle's directory is the correct base for the same reason {@link computeNativeEnvForBundle}
 * walks both: node-gi is kept EXTERNAL, so what must be satisfiable is the RUNTIME's resolution
 * of a bare specifier from inside the bundle, which Node performs relative to the importing file,
 * never to cwd. A dlx-cache layout has node-gi beside the bundle and nothing under the user's
 * cwd, so a cwd-only probe rejected a run that would have worked. The cwd probe stays because a
 * project-local `node_modules` legitimately satisfies a bundle built into a `dist/` outside it.
 */
export function resolveNodeGiForBundle(bundlePath: string, cwd: string): string | null {
    const resolvedBundle = resolve(bundlePath);
    return resolveNodeGi(dirname(resolvedBundle)) ?? resolveNodeGi(cwd);
}

/** Pick the node executable: the current one when on Node, else PATH `node`. */
export function nodeBinary(): string {
    return isNode() && process.execPath ? process.execPath : 'node';
}

export interface RunNodeBundleOptions {
    /** The caller's teardown contract — see `RunGjsBundleOptions.completion`. */
    completion: SpawnCompletionContract;
    /** Exit this process with code 0 once the child succeeds (terminal callers). */
    exitOnSuccess?: boolean;
    /** Suppress the `$ <env> node …` echo — see `RunGjsBundleOptions.quiet`. */
    quiet?: boolean;
}

/**
 * Run a `--app node` bundle on Node.js with the native typelib env set (same detection as
 * {@link runGjsBundle}). Throws when `@gjsify/node-gi` is not resolvable.
 */
export async function runNodeBundle(
    bundlePath: string,
    extraArgs: string[] = [],
    options: RunNodeBundleOptions,
): Promise<void> {
    const cwd = process.cwd();
    if (!resolveNodeGiForBundle(bundlePath, cwd)) {
        throw new Error(
            'Cannot run the storybook on Node: `@gjsify/node-gi` is not installed.\n' +
                'Add @gjsify/node-gi as a dependency to run the storybook on Node, e.g.:\n' +
                '  "devDependencies": { "@gjsify/node-gi": "^0.13.0" }',
        );
    }

    const { env: nativeEnv, envPrefix } = computeNativeEnvForBundle(bundlePath, cwd);
    const env = { ...process.env, ...nativeEnv };
    const nodeBin = nodeBinary();
    const nodeArgs = [bundlePath, ...extraArgs];

    // Echo on stderr, so a child speaking a protocol on stdout stays uncontaminated.
    const cmd = [nodeBin, ...nodeArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${cmd}`);

    let result;
    try {
        result = await spawnToCompletion(nodeBin, nodeArgs, { completion: options.completion, env });
    } catch (err) {
        console.error((err as Error).message);
        return process.exit(1);
    }
    if (result.code !== 0) {
        console.error(`node exited with ${describeExit(result)}`);
        return process.exit(result.code ?? 1);
    }

    if (options.exitOnSuccess) return process.exit(0);
}

/**
 * Whether a `--app node` bundle actually consumes `@gjsify/node-gi` — kept EXTERNAL, so a bundle
 * using gi:// imports the shim by name. A plain Node app does NOT, and must run on node/bun/deno
 * WITHOUT node-gi installed, which is why the check is conditional rather than a flat "this is a
 * node bundle, demand node-gi". The supervised launcher (`utils/watch-loop.ts`) asks the same
 * question for the same reason: `gjsify dev` on a web-server template builds a node bundle that
 * never reaches a typelib.
 */
export function bundleRequiresNodeGi(bundlePath: string): boolean {
    try {
        return readFileSync(bundlePath, 'utf-8').includes('@gjsify/node-gi');
    } catch {
        return false;
    }
}

/**
 * Run a built bundle on a non-gjs runtime (node / bun / deno). All three consume the SAME
 * `--app node` bundle — Node-API is their common ABI — so this is the shared launcher for
 * `gjsify run --runtime` and `gjsify showcase --runtime`. Native typelib env is wired as in
 * {@link runGjsBundle}; `@gjsify/node-gi` is required ONLY when the bundle actually uses gi://.
 *
 * `gjs` is intentionally NOT handled here — the caller dispatches it to {@link runGjsBundle}.
 */
export async function runRuntimeBundle(
    runtime: Exclude<ExampleRuntime, 'gjs'>,
    bundlePath: string,
    extraArgs: string[] = [],
    options: RunNodeBundleOptions,
): Promise<void> {
    const cwd = process.cwd();
    const resolvedBundle = resolve(bundlePath);

    if (bundleRequiresNodeGi(resolvedBundle) && !resolveNodeGiForBundle(resolvedBundle, cwd)) {
        throw new Error(
            `Cannot run this bundle on ${runtime}: it uses gi:// via \`@gjsify/node-gi\`, which is not installed.\n` +
                'Add @gjsify/node-gi as a dependency to run gi:// code off GJS, e.g.:\n' +
                '  "dependencies": { "@gjsify/node-gi": "^0.13.0" }',
        );
    }

    const { env: nativeEnv, envPrefix } = computeNativeEnvForBundle(resolvedBundle, cwd);
    const env = { ...process.env, ...nativeEnv };

    // The shared RUNTIMES launch spec supplies the argv (deno's `--node-modules-dir=manual`
    // etc.); the `node` runtime substitutes the resolved binary, since under a GJS-hosted CLI
    // `process.execPath` is gjs.
    const [, launchArgs] = RUNTIMES[runtime].launch(resolvedBundle, extraArgs);
    const cmd = runtime === 'node' ? nodeBinary() : RUNTIMES[runtime].probe;

    // Echo on stderr so a child speaking a protocol on stdout stays clean.
    const shown = [cmd, ...launchArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    if (!options.quiet) console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${shown}`);

    // Re-raise the CHILD's own code rather than a blanket 1 — a script run through
    // `--node-script` reports its status through this path, and a caller reading `$?` needs
    // the real one. A spawn failure has no code of its own and falls back to 1.
    const failed = (code: number): never => {
        process.exitCode = code;
        return process.exit(code);
    };

    let result;
    try {
        result = await spawnToCompletion(cmd, launchArgs, { completion: options.completion, env });
    } catch (err) {
        console.error((err as Error).message);
        return failed(1);
    }
    if (result.code !== 0) {
        console.error(`${runtime} exited with ${describeExit(result)}`);
        return failed(result.code ?? 1);
    }

    if (options.exitOnSuccess) return process.exit(0);
}
