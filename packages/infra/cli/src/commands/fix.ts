// `gjsify fix` — combined oxc fix pass.
//
// Runs `oxfmt --write` (format JS/TS in place) followed by `oxlint --fix`
// (apply safe lint fixes). Mirrors the one-shot ergonomics of the former
// Biome `check --write`, now split across the two oxc tools.
//
// Naming: deliberately distinct from `gjsify check` (workspace TS check) and
// `gjsify system-check` (system-dependency verifier).

import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import {
    OxcNotFoundError,
    findOxfmtConfig,
    findOxlintConfig,
    printOxcNotFound,
    runOxfmt,
    runOxlint,
    setOxcExitCode,
} from '../utils/oxc-resolve.js';

interface FixOptions {
    paths?: string[];
    write?: boolean;
    configPath?: string;
    verbose?: boolean;
}

export const fixCommand: Command<unknown, FixOptions> = {
    command: 'fix [paths..]',
    description: 'Run oxfmt --write then oxlint --fix — format + safe lint fixes in one pass.',
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
                description: 'Path to an .oxlintrc.json. Default: walks up from cwd to find one.',
                type: 'string',
                normalize: true,
            })
            .option('verbose', {
                description: 'Echo the resolved oxc launchers + args before spawning.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const paths = (args.paths as string[] | undefined)?.length ? (args.paths as string[]) : ['.'];
        const verbose = args.verbose ?? false;
        const writeMode = args.write !== false;

        try {
            // 1. Format JS/TS in place (or report drift when --no-write).
            const fmtArgs: string[] = [writeMode ? '--write' : '--list-different'];
            const fmtConfig = (args.configPath as string | undefined) ?? findOxfmtConfig(cwd) ?? undefined;
            if (fmtConfig) fmtArgs.push('--config', resolve(fmtConfig));
            fmtArgs.push(...paths);
            const fmtCode = await runOxfmt(fmtArgs, { cwd, verbose });

            // 2. Apply safe lint fixes (skipped in report-only mode).
            const lintArgs: string[] = [];
            if (writeMode) lintArgs.push('--fix');
            const lintConfig = (args.configPath as string | undefined) ?? findOxlintConfig(cwd) ?? undefined;
            if (lintConfig) lintArgs.push('--config', resolve(lintConfig));
            lintArgs.push(...paths);
            const lintCode = await runOxlint(lintArgs, { cwd, verbose });

            setOxcExitCode(fmtCode || lintCode);
        } catch (err) {
            if (err instanceof OxcNotFoundError) {
                printOxcNotFound(err);
                setOxcExitCode(1);
                return;
            }
            throw err;
        }
    },
};
