// Install backend abstraction.
//
// Default: native backend (resolves packuments via @gjsify/npm-registry,
// extracts tarballs via @gjsify/tar — no Node, no npm required at runtime).
// Fallback: `npm install --no-package-lock --no-audit --no-fund --prefix <dir> <specs...>`,
// for parity with the legacy code path. Switched via
// `GJSIFY_INSTALL_BACKEND=native|npm`.
//
// `gjsify dlx` uses this seam — installing under a cache prefix, with no
// package.json update to the user's project. The native backend matches that
// workflow without ever shelling out to Node.
//
// `--no-package-lock` keeps the cache prepare dir hermetic; the cache key
// already covers reproducibility. `--no-audit --no-fund` cuts ~5s off cold runs.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstallOptions {
    /** Directory to install into (npm `--prefix`). Created by caller. */
    prefix: string;
    /** npm-resolvable specs: `name`, `name@version`, `git+https://...`, tarball URL, ... */
    specs: string[];
    /** Verbose logging passes through `--loglevel verbose`. */
    verbose?: boolean;
    /** Optional registry override (writes a temp `.npmrc` in prefix). */
    registry?: string;
    /**
     * Native backend only: write `<prefix>/gjsify-lock.json` after a successful
     * resolve. When the file exists on next call AND `frozen: true`, the
     * resolver is skipped and downloads use the pinned tarball URL + integrity.
     */
    lockfile?: boolean;
    /** Use `<prefix>/gjsify-lock.json` as the source of truth — fail if missing. */
    frozen?: boolean;
}

const DEFAULT_BACKEND = process.env.GJSIFY_INSTALL_BACKEND ?? 'native';

export async function installPackages(opts: InstallOptions): Promise<void> {
    if (DEFAULT_BACKEND === 'npm') {
        return installViaNpm(opts);
    }
    const { installPackagesNative } = await import('./install-backend-native.js');
    return installPackagesNative(opts);
}

async function installViaNpm({ prefix, specs, verbose, registry }: InstallOptions): Promise<void> {
    if (specs.length === 0) {
        throw new Error('installPackages: empty specs list');
    }

    // Seed an empty package.json so npm doesn't walk up from prefix and pick
    // up the user's project metadata. Cosmetic name/version only.
    writeFileSync(
        join(prefix, 'package.json'),
        JSON.stringify({ name: 'gjsify-dlx-cache', version: '0.0.0', private: true }, null, 2),
    );

    if (registry) {
        writeFileSync(join(prefix, '.npmrc'), `registry=${registry}\n`);
    }

    const args = [
        'install',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
        '--prefix', prefix,
        ...(verbose ? ['--loglevel', 'verbose'] : ['--loglevel', 'warn']),
        ...specs,
    ];

    await new Promise<void>((resolve, reject) => {
        const child = spawn('npm', args, { stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install exited with code ${code}`));
        });
        child.on('error', (err) => {
            const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'npm not found on PATH — install Node.js or set GJSIFY_INSTALL_BACKEND=native (not yet supported)'
                : `npm install failed: ${err.message}`;
            reject(new Error(msg));
        });
    });
}
