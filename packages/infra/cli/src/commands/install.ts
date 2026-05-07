// `gjsify install [pkg...]` — install packages with gjsify-aware post-checks.
//
// Modes:
//   gjsify install                    → project install (npm install)
//   gjsify install <pkg> [<pkg>...]   → add package(s) to project (npm install <pkg>...)
//   gjsify install -g <pkg> [...]     → user-global install (XDG, GJS-runnable bin)
//
// Project mode delegates to `npm install` in cwd and runs `runMinimalChecks()`
// + `detectNativePackages()` to surface missing system deps and `@gjsify/*`
// packages with native prebuilds.
//
// Global mode is the GJS equivalent of `npm i -g`: extracts the package tree
// into `${XDG_DATA_HOME}/gjsify/global/node_modules/<pkg>/` via the native
// install backend (no Node/npm required at runtime), then symlinks the bins
// declared by `gjsify.bin` (preferred) or `bin` (fallback) into
// `~/.local/bin/`. Subsequent commands invoked by name resolve to the
// extracted package, so package-relative assets like `@ts-for-gir/cli`'s
// `dist-templates/` are found by ordinary `__dirname/..` resolution — no
// embedded asset stores, no separate release tarballs.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { Command } from '../types/index.js';
import {
    buildInstallCommand,
    detectPackageManager,
    runMinimalChecks,
} from '../utils/check-system-deps.js';
import { detectNativePackages } from '../utils/detect-native-packages.js';
import { installPackages } from '../utils/install-backend.js';
import {
    binDirOnPath,
    defaultGlobalLayout,
    linkGlobalBins,
    specToPackageName,
} from '../utils/install-global.js';

interface InstallOptions {
    packages?: string[];
    global?: boolean;
    'save-dev'?: boolean;
    'save-peer'?: boolean;
    'save-optional'?: boolean;
    verbose: boolean;
}

export const installCommand: Command<any, InstallOptions> = {
    command: 'install [packages..]',
    description:
        'Install npm dependencies in the current project (or globally with -g), then run gjsify-aware post-checks.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Optional package specs. With none, runs a full project install.',
                type: 'string',
                array: true,
            })
            .option('global', {
                description:
                    'Install into the user-global XDG location and symlink bins into ~/.local/bin.',
                type: 'boolean',
                alias: 'g',
                default: false,
            })
            .option('save-dev', { type: 'boolean', alias: 'D' })
            .option('save-peer', { type: 'boolean' })
            .option('save-optional', { type: 'boolean', alias: 'O' })
            .option('verbose', {
                description: 'Verbose install logging.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        if (args.global) {
            if (!args.packages || args.packages.length === 0) {
                console.error(
                    'gjsify install --global requires at least one <pkg> argument.',
                );
                process.exit(1);
            }
            for (const flag of ['save-dev', 'save-peer', 'save-optional'] as const) {
                if (args[flag]) {
                    console.warn(
                        `gjsify install --global ignores --${flag}: global installs do not modify a project package.json.`,
                    );
                }
            }
            await installGlobalAndLink(args.packages, { verbose: args.verbose });
            return;
        }

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

async function installGlobalAndLink(
    specs: string[],
    opts: { verbose: boolean },
): Promise<void> {
    const layout = defaultGlobalLayout();
    mkdirSync(layout.prefix, { recursive: true });

    console.log(`gjsify install --global  → ${layout.prefix}`);
    console.log(`                  bins → ${layout.binDir}`);

    await installPackages({
        prefix: layout.prefix,
        specs,
        verbose: opts.verbose,
    });

    const packageNames = specs.map(specToPackageName);
    const created = linkGlobalBins(packageNames, layout);

    if (created.length === 0) {
        console.warn(
            '\nNo bins declared (neither `gjsify.bin` nor `bin` in package.json) — nothing was symlinked.',
        );
    } else {
        console.log(`\nLinked ${created.length} bin(s):`);
        for (const e of created) {
            console.log(`  • ${e.link}  →  ${e.target}`);
        }
    }

    if (created.length > 0 && !binDirOnPath(layout.binDir)) {
        console.warn(
            `\nNote: ${layout.binDir} is not on your PATH.\n` +
                `Add it to your shell rc file:\n  export PATH="${layout.binDir}:$PATH"`,
        );
    }
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
