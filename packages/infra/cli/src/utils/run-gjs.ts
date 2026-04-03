// Shared utility for running a GJS bundle with native package env vars.
// Used by both the `run` and `showcase` commands.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { detectNativePackages, resolveNativePackages, buildNativeEnv } from './detect-native-packages.js';

/**
 * Run a GJS bundle, automatically setting LD_LIBRARY_PATH and GI_TYPELIB_PATH
 * for any installed native gjsify packages.
 *
 * Detection uses two strategies:
 * 1. Filesystem walk from CWD (finds packages in the user's project)
 * 2. require.resolve from the bundle's location (finds packages in the CLI's dependency tree)
 */
export async function runGjsBundle(bundlePath: string, extraArgs: string[] = []): Promise<void> {
    const cwd = process.cwd();
    const resolvedBundle = resolve(bundlePath);

    // Detect from CWD (filesystem walk) + bundle location (require.resolve)
    const cwdPackages = detectNativePackages(cwd);
    const bundlePackages = resolveNativePackages(resolvedBundle);

    // Merge, deduplicating by name (CWD takes precedence)
    const seen = new Set(cwdPackages.map(p => p.name));
    const nativePackages = [
        ...cwdPackages,
        ...bundlePackages.filter(p => !seen.has(p.name)),
    ];

    const nativeEnv = buildNativeEnv(nativePackages);

    const env = {
        ...process.env,
        ...nativeEnv,
    };

    const gjsArgs = ['-m', bundlePath, ...extraArgs];
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
