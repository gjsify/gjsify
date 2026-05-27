// `gjsify lint` — wraps oxlint.
//
// Sibling of `gjsify format`. Spawns oxlint via its Node launcher
// (`node_modules/oxlint/bin/oxlint` → `dist/cli.js`) — NOT a bare binary —
// because oxlint's JS-plugin host (used by the internal
// `oxlint-plugin-gjsify` rule) lives in the JS launcher. Default behaviour:
// report-only. Pass `--fix` for oxlint's safe-fix mode, or use `gjsify fix`
// for the combined oxfmt + oxlint --fix surface.

import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { OxcNotFoundError, findOxlintConfig, printOxcNotFound, runOxlint } from '../utils/oxc-resolve.js';

interface LintOptions {
    paths?: string[];
    fix?: boolean;
    configPath?: string;
    verbose?: boolean;
}

export const lintCommand: Command<unknown, LintOptions> = {
    command: 'lint [paths..]',
    description: 'Run oxlint diagnostics (spawned via its Node launcher to support JS plugins).',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Files or directories to lint. Default: `.`',
                type: 'string',
                array: true,
            })
            .option('fix', {
                description: 'Apply safe lint fixes in place.',
                type: 'boolean',
                default: false,
            })
            .option('config-path', {
                description: 'Path to an .oxlintrc.json. Default: walks up from cwd to find one.',
                type: 'string',
                normalize: true,
            })
            .option('verbose', {
                description: 'Echo the resolved oxlint launcher + args before spawning.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const paths = (args.paths as string[] | undefined)?.length ? (args.paths as string[]) : ['.'];

        const oxlintArgs: string[] = [];
        if (args.fix) oxlintArgs.push('--fix');

        const configPath = (args.configPath as string | undefined) ?? findOxlintConfig(cwd) ?? undefined;
        if (configPath) oxlintArgs.push('--config', resolve(configPath));

        oxlintArgs.push(...paths);

        try {
            const code = await runOxlint(oxlintArgs, { cwd, verbose: args.verbose });
            process.exitCode = code;
        } catch (err) {
            if (err instanceof OxcNotFoundError) {
                printOxcNotFound(err);
                process.exitCode = 1;
                return;
            }
            throw err;
        }
    },
};
