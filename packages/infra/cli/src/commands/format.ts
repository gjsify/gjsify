// `gjsify format` — wraps biome's `format` mode.
//
// Resolves biome's native binary from node_modules (skipping the Node
// launcher in @biomejs/biome/bin/biome) and spawns it directly. This
// keeps the Node-free promise intact: biome's per-platform package
// (e.g. @biomejs/cli-linux-x64) carries a self-contained Rust binary.
//
// `--init` writes a recommended biome.json template tuned for GJS/GNOME
// projects (4-space JS/TS, 2-space JSON+CSS, single-quotes, lineWidth
// 120, biome's recommended linter + a few GJS-specific opt-outs).

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import {
    BiomeNotFoundError,
    findBiomeConfig,
    loadBiomeTemplate,
    printBiomeNotFound,
    runBiome,
} from '../utils/biome-resolve.js';

interface FormatOptions {
    paths?: string[];
    write?: boolean;
    check?: boolean;
    configPath?: string;
    init?: boolean;
    force?: boolean;
    verbose?: boolean;
}

export const formatCommand: Command<unknown, FormatOptions> = {
    command: 'format [paths..]',
    description:
        'Format source files via Biome (native binary spawn — no Node launcher).',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Files or directories to format. Default: `.`',
                type: 'string',
                array: true,
            })
            .option('write', {
                description: 'Modify files in place (default: stdout / report).',
                type: 'boolean',
                default: false,
            })
            .option('check', {
                description:
                    'Report formatting drift without modifying files; exit non-zero if any file is unformatted. Useful for CI.',
                type: 'boolean',
                default: false,
            })
            .option('config-path', {
                description:
                    'Path to a biome.json. Default: walks up from cwd to find one.',
                type: 'string',
                normalize: true,
            })
            .option('init', {
                description:
                    'Write a recommended biome.json into cwd (skips if one exists; --force to overwrite).',
                type: 'boolean',
                default: false,
            })
            .option('force', {
                description: 'Overwrite an existing biome.json with --init.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Echo the resolved biome binary + args before spawning.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();

        if (args.init) {
            await handleInit({ cwd, force: args.force ?? false });
            return;
        }

        const paths = (args.paths as string[] | undefined)?.length
            ? (args.paths as string[])
            : ['.'];

        const biomeArgs: string[] = ['format'];
        if (args.write && !args.check) biomeArgs.push('--write');
        // --check is the CI semantic: don't write, exit non-zero on drift.
        // Biome's default mode (no --write) already reports drift + exits
        // non-zero. We forward neither flag and let biome's defaults apply.

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

async function handleInit({ cwd, force }: { cwd: string; force: boolean }): Promise<void> {
    const target = resolve(cwd, 'biome.json');
    if (existsSync(target) && !force) {
        console.log(`[gjsify format] biome.json exists at ${target} — pass --force to overwrite.`);
        process.exitCode = 0;
        return;
    }
    writeFileSync(target, loadBiomeTemplate(), 'utf-8');
    console.log(`[gjsify format] wrote ${target}`);
    console.log(
        `[gjsify format] Run \`gjsify format --write .\` to apply the formatter to the project.`,
    );
}
