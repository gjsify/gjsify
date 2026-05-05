// Install backend abstraction — Phase-4 seam.
//
// Today: spawns `npm install --no-package-lock --no-audit --no-fund --prefix <dir> <specs...>`.
// Future (Phase 4): a GJS-native resolver replaces this without changing
// the public signature, switched via `GJSIFY_INSTALL_BACKEND=native|npm`.
//
// Why npm and not pnpm/yarn? npm ships with Node so users already have it.
// Adding a yarn/pnpm dep would defeat the purpose of `gjsify dlx` (which
// itself is meant to ship binary-free GJS apps).
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
}

const DEFAULT_BACKEND = process.env.GJSIFY_INSTALL_BACKEND ?? 'npm';

export async function installPackages(opts: InstallOptions): Promise<void> {
    if (DEFAULT_BACKEND === 'native') {
        const { installPackagesNative } = await import('./install-backend-native.js');
        return installPackagesNative(opts);
    }
    return installViaNpm(opts);
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
