import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { detectNativePackages, buildNativeEnv } from '../utils/detect-native-packages.js';

interface RunOptions {
    file: string;
    args: string[];
}

export const runCommand: Command<any, RunOptions> = {
    command: 'run <file> [args..]',
    description: 'Run a GJS bundle, automatically setting LD_LIBRARY_PATH and GI_TYPELIB_PATH for any installed native gjsify packages (e.g. @gjsify/webgl).',
    builder: (yargs) => {
        return yargs
            .positional('file', {
                description: 'The GJS bundle to run (e.g. dist/gjs.js)',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments passed through to gjs',
                type: 'string',
                array: true,
                default: [],
            });
    },
    handler: async (args) => {
        const file = resolve(args.file as string);
        const extraArgs = (args.args as string[]) ?? [];
        const cwd = process.cwd();

        const nativePackages = detectNativePackages(cwd);
        const nativeEnv = buildNativeEnv(nativePackages);

        const env = {
            ...process.env,
            ...nativeEnv,
        };

        const gjsArgs = ['-m', file, ...extraArgs];
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
    },
};
