// Shared utility for running a GJS bundle with native package env vars.
// Used by both the `run` and `showcase` commands.

import { spawn } from 'node:child_process';
import { detectNativePackages, buildNativeEnv } from './detect-native-packages.js';

/**
 * Run a GJS bundle, automatically setting LD_LIBRARY_PATH and GI_TYPELIB_PATH
 * for any installed native gjsify packages.
 */
export async function runGjsBundle(bundlePath: string, extraArgs: string[] = []): Promise<void> {
    const cwd = process.cwd();
    const nativePackages = detectNativePackages(cwd);
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
