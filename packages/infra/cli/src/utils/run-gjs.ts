// Shared utility for running a GJS bundle with native package env vars.
// Used by `gjsify run`, `gjsify dlx`, and the showcase command (via dlx).
//
// Detection runs the same exhaustive node_modules walker (`detectNativePackages`)
// from two starting points and merges by package name (CWD shadows bundle):
//
//   1. process.cwd()          — picks up native deps in the user's project
//                               (yarn / pnpm / npm node_modules walking up).
//   2. dirname(bundlePath)    — picks up native deps in whatever node_modules
//                               the bundle lives in. Critical for `gjsify dlx`
//                               where the bundle resides in
//                               `~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/`
//                               and the user's CWD is unrelated. The bundle-side
//                               walk also catches transitive deps' typelibs.
//
// Env composition is split out as `computeNativeEnvForBundle()` — a pure
// function that takes a bundle path + cwd and returns the env it would inject.
// This lets the e2e tests assert the env without spawning gjs.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { detectNativePackages, buildNativeEnv } from './detect-native-packages.js';

/**
 * Pure env computation for a given bundle. Returns the LD_LIBRARY_PATH /
 * GI_TYPELIB_PATH values that {@link runGjsBundle} would inject into the
 * spawned `gjs` process, plus the formatted env-prefix string used for the
 * `$ …` echo.
 */
export function computeNativeEnvForBundle(
    bundlePath: string,
    cwd: string = process.cwd(),
): { env: { LD_LIBRARY_PATH: string; GI_TYPELIB_PATH: string }; envPrefix: string } {
    const resolvedBundle = resolve(bundlePath);

    const cwdPackages = detectNativePackages(cwd);
    const bundlePackages = detectNativePackages(dirname(resolvedBundle));

    const seen = new Set(cwdPackages.map((p) => p.name));
    const nativePackages = [
        ...cwdPackages,
        ...bundlePackages.filter((p) => !seen.has(p.name)),
    ];

    const env = buildNativeEnv(nativePackages);
    const envPrefix = Object.entries(env)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');

    return { env, envPrefix };
}

/**
 * Run a GJS bundle, automatically setting LD_LIBRARY_PATH and GI_TYPELIB_PATH
 * for any installed native gjsify packages discoverable from either the CWD
 * or the bundle's own node_modules tree.
 */
export async function runGjsBundle(bundlePath: string, extraArgs: string[] = []): Promise<void> {
    const { env: nativeEnv, envPrefix } = computeNativeEnvForBundle(bundlePath);

    const env = {
        ...process.env,
        ...nativeEnv,
    };

    const gjsArgs = ['-m', bundlePath, ...extraArgs];

    // Print the exact command being executed so users can copy-paste it to
    // run gjs directly without the wrapper. Env vars are only shown if we
    // actually set any (i.e. native gjsify packages were detected).
    const gjsCommand = ['gjs', ...gjsArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    console.log(`$ ${envPrefix ? `${envPrefix} ` : ''}${gjsCommand}`);

    const child = spawn('gjs', gjsArgs, { env, stdio: 'inherit' });

    await new Promise<void>((resolvePromise, reject) => {
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`gjs exited with code ${code}`));
            } else {
                resolvePromise();
            }
        });
        child.on('error', reject);
    }).catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
