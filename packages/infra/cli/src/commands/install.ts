// `gjsify install [pkg...]` — thin npm wrapper with gjsify-aware post-checks.
//
// The actual install is delegated to `npm install` in the user's project root
// (no `--prefix` rewrite, unlike `gjsify dlx`). After install completes we run
// `runMinimalChecks()` so missing system deps (gjs, gtk4, libsoup, ...) surface
// immediately, and report any installed `@gjsify/*` packages that ship native
// prebuilds so users know they can use `gjsify run` to wire `LD_LIBRARY_PATH` /
// `GI_TYPELIB_PATH` automatically.
//
// Modes:
//   gjsify install                    → project install (npm install)
//   gjsify install <pkg> [<pkg>...]   → add package(s) (npm install <pkg>...)

import { spawn } from 'node:child_process';
import type { Command } from '../types/index.js';
import {
    buildInstallCommand,
    detectPackageManager,
    runMinimalChecks,
} from '../utils/check-system-deps.js';
import { detectNativePackages } from '../utils/detect-native-packages.js';

interface InstallOptions {
    packages?: string[];
    'save-dev'?: boolean;
    'save-peer'?: boolean;
    'save-optional'?: boolean;
    verbose: boolean;
}

export const installCommand: Command<any, InstallOptions> = {
    command: 'install [packages..]',
    description:
        'Install npm dependencies in the current project, then run gjsify-aware post-checks.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Optional package specs. With none, runs a full project install.',
                type: 'string',
                array: true,
            })
            .option('save-dev', { type: 'boolean', alias: 'D' })
            .option('save-peer', { type: 'boolean' })
            .option('save-optional', { type: 'boolean', alias: 'O' })
            .option('verbose', {
                description: 'Verbose npm logging.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const npmArgs = ['install'];
        if (args['save-dev']) npmArgs.push('--save-dev');
        if (args['save-peer']) npmArgs.push('--save-peer');
        if (args['save-optional']) npmArgs.push('--save-optional');
        if (args.verbose) npmArgs.push('--loglevel', 'verbose');
        if (args.packages && args.packages.length > 0) {
            npmArgs.push(...args.packages);
        }

        await spawnNpm(npmArgs);

        await runPostInstallChecks();
    },
};

async function spawnNpm(npmArgs: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const child = spawn('npm', npmArgs, { stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install exited with code ${code}`));
        });
        child.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            const msg = code === 'ENOENT'
                ? 'npm not found on PATH — install Node.js first.'
                : `npm install failed: ${err.message}`;
            reject(new Error(msg));
        });
    }).catch((err: Error) => {
        console.error(err.message);
        process.exit(1);
    });
}

async function runPostInstallChecks(): Promise<void> {
    console.log('\n--- gjsify post-install checks ---');

    // 1. System deps that GJS apps typically need.
    const results = runMinimalChecks();
    const missing = results.filter((r) => !r.found && r.severity === 'required');
    if (missing.length > 0) {
        console.warn('Missing required system dependencies:\n');
        for (const dep of missing) {
            console.warn(`  ✗  ${dep.name}`);
        }
        const pm = detectPackageManager();
        const cmd = buildInstallCommand(pm, missing);
        if (cmd) console.warn(`\nInstall with:\n  ${cmd}`);
    } else {
        console.log('System dependencies OK.');
    }

    // 2. Surface @gjsify/* packages with native prebuilds — `gjsify run`
    //    will set LD_LIBRARY_PATH / GI_TYPELIB_PATH for these automatically.
    const native = detectNativePackages(process.cwd());
    if (native.length > 0) {
        console.log(
            `\nDetected ${native.length} @gjsify/* package(s) with native prebuilds:`,
        );
        for (const pkg of native) {
            console.log(`  • ${pkg.name}`);
        }
        console.log('\nUse `gjsify run <bundle>` to launch with LD_LIBRARY_PATH/GI_TYPELIB_PATH set.');
    }
}
