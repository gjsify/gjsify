// Shared utility for running a `--app node` bundle on Node.js with the native
// typelib env wired the same way `runGjsBundle` does.
//
// A `gjsify build --app node` bundle of a `gi://` source runs the GObject stack
// through `@gjsify/node-gi` (the Axis-5 reverse bridge). Two things have to be
// true at runtime:
//
//   1. `@gjsify/node-gi` must resolve FROM THE BUNDLE — it is kept EXTERNAL by
//      the bundler (a native addon), so it has to physically exist in a
//      node_modules the bundle's own directory can reach (that is where Node
//      will look), with the CWD as a fallback. We verify this up front and emit
//      a clear hint instead of letting Node throw `ERR_MODULE_NOT_FOUND` deep in
//      the bundle. See `resolveNodeGiForBundle`.
//   2. `gi://Gtk` / `gi://Adw` etc. must resolve. System typelibs come from the
//      default GI search path, but any `@gjsify/*` Vala bridge a story pulls in
//      ships its typelib in `prebuilds/` — so we reuse the SAME
//      `computeNativeEnvForBundle()` walker `runGjsBundle` uses to prepend
//      `GI_TYPELIB_PATH` / `LD_LIBRARY_PATH`. It is a no-op when no native
//      gjsify packages are present (the storybook's common case).
//
// The node binary is `process.execPath` when the CLI itself runs under Node, and
// the PATH `node` otherwise (under the committed GJS bundle `process.execPath` is
// `gjs`, which cannot run a `--app node` bundle).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isNode } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { computeNativeEnvForBundle } from './run-gjs.js';
import { RUNTIMES, type ExampleRuntime } from './runtimes.js';

/**
 * Walk up from `startDir` looking for `<node_modules>/@gjsify/node-gi`. Returns
 * the package directory, or null when it is not installed anywhere on the chain.
 * A plain fs walk (works identically on Node and GJS) — Node's own resolver is
 * not available under the GJS-bundled CLI.
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
 * Resolve `@gjsify/node-gi` for a bundle we are about to launch: from the
 * BUNDLE's own directory first, then from `cwd`.
 *
 * The bundle's directory is the correct base and cwd is the fallback, for the
 * same reason {@link computeNativeEnvForBundle} walks both: `@gjsify/node-gi` is
 * kept EXTERNAL, so what has to be satisfiable is the RUNTIME's resolution of a
 * bare specifier from inside the bundle — which Node performs relative to the
 * importing file, never relative to cwd. A dlx-cache layout
 * (`~/.cache/gjsify/dlx/<sha>/node_modules/<pkg>/dist/bundle.mjs`) has node-gi
 * sitting right beside the bundle and nothing at all under the user's cwd, so a
 * cwd-only probe rejected a run that would have worked. The cwd probe is kept
 * because a project-local `node_modules` legitimately satisfies a bundle built
 * into a `dist/` outside it (a `--outfile /tmp/…` build from a project root).
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
    /** Exit this process with code 0 once the child succeeds (terminal callers). */
    exitOnSuccess?: boolean;
}

/**
 * Run a `--app node` bundle on Node.js, auto-setting LD_LIBRARY_PATH and
 * GI_TYPELIB_PATH for any installed native gjsify packages (same detection as
 * {@link runGjsBundle}). Verifies `@gjsify/node-gi` is resolvable first and
 * throws a clear, actionable error otherwise.
 */
export async function runNodeBundle(
    bundlePath: string,
    extraArgs: string[] = [],
    options: RunNodeBundleOptions = {},
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

    // Echo the exact command (stderr, so a child speaking a protocol on stdout
    // stays uncontaminated) so users can reproduce the run without the wrapper.
    const cmd = [nodeBin, ...nodeArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${cmd}`);

    const child = spawn(nodeBin, nodeArgs, { env, stdio: 'inherit' });

    await new Promise<void>((resolvePromise, reject) => {
        child.on('close', (code) => {
            if (code !== 0) reject(new Error(`node exited with code ${code}`));
            else resolvePromise();
        });
        child.on('error', reject);
    }).catch((err) => {
        console.error((err as Error).message);
        process.exit(1);
    });

    if (options.exitOnSuccess) process.exit(0);
}

/**
 * Whether a `--app node` bundle actually consumes `@gjsify/node-gi` (the gi://
 * reverse bridge is kept EXTERNAL, so a bundle that uses gi:// imports the shim
 * by name). A plain Node app (express, a pure `node:*` program) does NOT, and
 * must run on node/bun/deno WITHOUT node-gi installed — so the node-gi check is
 * conditional on this, not unconditional like the storybook path.
 */
export function bundleRequiresNodeGi(bundlePath: string): boolean {
    try {
        return readFileSync(bundlePath, 'utf-8').includes('@gjsify/node-gi');
    } catch {
        return false;
    }
}

/**
 * Run a built bundle on a non-gjs runtime (node / bun / deno). All three consume
 * the SAME `--app node` bundle (Node-API is their common ABI), so this is the
 * shared launcher `gjsify run --runtime` and `gjsify showcase --runtime` use for
 * node/bun/deno. The native typelib env is wired exactly like {@link runGjsBundle}
 * (so a bundle pulling an `@gjsify/*` Vala bridge resolves its prebuild), and
 * `@gjsify/node-gi` is required ONLY when the bundle actually uses gi://.
 *
 * `gjs` is intentionally NOT handled here — the caller dispatches it to
 * {@link runGjsBundle}.
 */
export async function runRuntimeBundle(
    runtime: Exclude<ExampleRuntime, 'gjs'>,
    bundlePath: string,
    extraArgs: string[] = [],
    options: RunNodeBundleOptions = {},
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

    // Reuse the shared RUNTIMES launch spec for the argv (deno's
    // `--node-modules-dir=manual`, etc.), substituting the resolved node binary
    // for the `node` runtime (under a GJS-hosted CLI `process.execPath` is gjs).
    const [, launchArgs] = RUNTIMES[runtime].launch(resolvedBundle, extraArgs);
    const cmd = runtime === 'node' ? nodeBinary() : RUNTIMES[runtime].probe;

    // Echo on stderr so a child speaking a protocol on stdout stays clean.
    const shown = [cmd, ...launchArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${shown}`);

    const child = spawn(cmd, launchArgs, { env, stdio: 'inherit' });

    await new Promise<void>((resolvePromise, reject) => {
        child.on('close', (code) => {
            if (code !== 0) reject(new Error(`${runtime} exited with code ${code}`));
            else resolvePromise();
        });
        child.on('error', reject);
    }).catch((err) => {
        console.error((err as Error).message);
        process.exit(1);
    });

    if (options.exitOnSuccess) process.exit(0);
}
