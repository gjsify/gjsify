import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { runGjsBundle } from '../utils/run-gjs.js';

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
        await runGjsBundle(file, extraArgs);
    },
};
