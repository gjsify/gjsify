// `gjsify fix` — runs biome's combined `check --write` mode.
//
// Equivalent to biome's `check` (format + safe-lint-fix + organize-imports).
// Default writes fixes in-place; pass `--no-write` to report-only.
// Naming: deliberately distinct from `gjsify check` (which verifies
// system dependencies).

import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import {
    BiomeNotFoundError,
    findBiomeConfig,
    printBiomeNotFound,
    runBiome,
} from '../utils/biome-resolve.js';

interface FixOptions {
    paths?: string[];
    write?: boolean;
    configPath?: string;
    verbose?: boolean;
}

export const fixCommand: Command<unknown, FixOptions> = {
    command: 'fix [paths..]',
    description:
        'Run Biome check --write — format + safe-lint-fix + organize-imports in one pass.',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Files or directories to fix. Default: `.`',
                type: 'string',
                array: true,
            })
            .option('write', {
                description: 'Apply fixes in place (default: true). Pass --no-write to report only.',
                type: 'boolean',
                default: true,
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

        const biomeArgs: string[] = ['check'];
        if (args.write !== false) biomeArgs.push('--write');

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
