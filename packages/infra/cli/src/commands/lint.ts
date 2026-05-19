// `gjsify lint` — wraps biome's `lint` mode.
//
// Sibling of `gjsify format`. Spawns biome from node_modules directly
// (no Node launcher). Default behaviour: report-only. Pass `--write`
// for biome's safe-fix mode, or use `gjsify fix` for the combined
// format + safe-lint-fix + organize-imports surface.

import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import {
    BiomeNotFoundError,
    findBiomeConfig,
    printBiomeNotFound,
    runBiome,
} from '../utils/biome-resolve.js';

interface LintOptions {
    paths?: string[];
    write?: boolean;
    configPath?: string;
    verbose?: boolean;
}

export const lintCommand: Command<unknown, LintOptions> = {
    command: 'lint [paths..]',
    description: 'Run Biome lint diagnostics (native binary spawn — no Node launcher).',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Files or directories to lint. Default: `.`',
                type: 'string',
                array: true,
            })
            .option('write', {
                description: 'Apply safe lint fixes in place.',
                type: 'boolean',
                default: false,
            })
            .option('config-path', {
                description:
                    'Path to a biome.json. Default: walks up from cwd to find one.',
                type: 'string',
                normalize: true,
            })
            .option('verbose', {
                description: 'Echo the resolved biome binary + args before spawning.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const paths = (args.paths as string[] | undefined)?.length
            ? (args.paths as string[])
            : ['.'];

        const biomeArgs: string[] = ['lint'];
        if (args.write) biomeArgs.push('--write');

        const configPath =
            (args.configPath as string | undefined) ?? findBiomeConfig(cwd) ?? undefined;
        if (configPath) biomeArgs.push(`--config-path=${resolve(configPath, '..')}`);

        biomeArgs.push(...paths);

        try {
            const code = await runBiome(biomeArgs, { cwd, verbose: args.verbose });
            process.exitCode = code;
        } catch (err) {
            if (err instanceof BiomeNotFoundError) {
                printBiomeNotFound(err);
                process.exitCode = 1;
                return;
            }
            throw err;
        }
    },
};
