// `gjsify flatpak deps` — wrap `flatpak-node-generator` to convert a
// yarn.lock / package-lock.json into the JSON sources file that the
// Flatpak manifest references for offline `yarn install` inside the
// build sandbox.
//
// flatpak-node-generator is a Python tool from
// https://github.com/flatpak/flatpak-builder-tools — installed via
// `pipx install flatpak-node-generator` or `pip install --user
// flatpak-node-generator`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Command } from '../../types/index.js';

interface FlatpakDepsOptions {
    lockfile?: string;
    type?: 'yarn' | 'npm';
    out?: string;
    xdgLayout?: boolean;
    nodeChromedriverFromElectron?: string;
    electronNodeHeaders?: boolean;
    verbose?: boolean;
}

export const flatpakDepsCommand: Command<unknown, FlatpakDepsOptions> = {
    command: 'deps',
    description:
        'Generate Flatpak offline-cache sources from a yarn.lock / package-lock.json (wraps `flatpak-node-generator`).',
    builder: (yargs) => {
        return yargs
            .option('lockfile', {
                description: 'Path to lockfile (default: yarn.lock or package-lock.json in cwd)',
                type: 'string',
                normalize: true,
            })
            .option('type', {
                description: 'Lockfile type. Default: detected from filename.',
                choices: ['yarn', 'npm'] as const,
            })
            .option('out', {
                description: 'Output JSON sources file',
                type: 'string',
                default: 'flatpak-node-sources.json',
                normalize: true,
            })
            .option('xdg-layout', {
                description: 'Pass --xdg-layout (recommended for Yarn Berry / PnP setups)',
                type: 'boolean',
                default: true,
            })
            .option('electron-node-headers', {
                description: 'Pass --electron-node-headers',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Print the underlying flatpak-node-generator invocation',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const lockfile = resolve(
            cwd,
            (args.lockfile as string | undefined) ?? detectLockfile(cwd),
        );
        if (!existsSync(lockfile)) {
            throw new Error(
                `gjsify flatpak deps: lockfile ${lockfile} not found (use --lockfile to override)`,
            );
        }

        const type =
            (args.type as 'yarn' | 'npm' | undefined) ??
            (lockfile.endsWith('package-lock.json') ? 'npm' : 'yarn');

        const out = resolve(cwd, args.out ?? 'flatpak-node-sources.json');
        mkdirSync(dirname(out), { recursive: true });

        const cmdArgs = [type, lockfile, '-o', out];
        if (args.xdgLayout !== false) cmdArgs.push('--xdg-layout');
        if (args.electronNodeHeaders) cmdArgs.push('--electron-node-headers');

        if (args.verbose) {
            console.log(`[gjsify flatpak deps] flatpak-node-generator ${cmdArgs.join(' ')}`);
        }

        await new Promise<void>((res, rej) => {
            const child = spawn('flatpak-node-generator', cmdArgs, { stdio: 'inherit' });
            child.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    rej(
                        new Error(
                            'gjsify flatpak deps: flatpak-node-generator not found. ' +
                                'Install via `pipx install flatpak-node-generator` ' +
                                '(see https://github.com/flatpak/flatpak-builder-tools/tree/master/node).',
                        ),
                    );
                } else {
                    rej(err);
                }
            });
            child.on('exit', (code) => {
                if (code === 0) res();
                else rej(new Error(`gjsify flatpak deps: flatpak-node-generator exited with status ${code}`));
            });
        });

        console.log(`[gjsify flatpak deps] wrote ${out}`);
    },
};

function detectLockfile(cwd: string): string {
    if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn.lock';
    if (existsSync(resolve(cwd, 'package-lock.json'))) return 'package-lock.json';
    return 'yarn.lock'; // surfaces a clear "not found" later
}
