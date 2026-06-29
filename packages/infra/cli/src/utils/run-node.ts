// Shared utility for running a `--app node` bundle on Node.js with the native
// typelib env wired the same way `runGjsBundle` does.
//
// A `gjsify build --app node` bundle of a `gi://` source runs the GObject stack
// through `@gjsify/node-gi` (the Axis-5 reverse bridge). Two things have to be
// true at runtime:
//
//   1. `@gjsify/node-gi` must resolve from the project — it is kept EXTERNAL by
//      the bundler (a native addon), so it has to physically exist in the
//      consumer's node_modules. We verify this up front and emit a clear hint
//      instead of letting Node throw `ERR_MODULE_NOT_FOUND` deep in the bundle.
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
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isNode } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { computeNativeEnvForBundle } from './run-gjs.js';

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
    if (!resolveNodeGi(cwd)) {
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
