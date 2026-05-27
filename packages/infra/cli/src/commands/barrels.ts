// `gjsify barrels` — regenerate `index.ts` barrel files for a set of
// directories. Drop-in replacement for `barrelsby` (unmaintained 2022+).
//
// Examples:
//   gjsify barrels src/systems src/components       # regenerate two barrels
//   gjsify barrels --check src/types                # CI guard — exit 1 on drift
//   gjsify barrels --ext js src/utils               # NodeNext-style import-extensions
//
// Conventions:
//   - A directory literally named `types/` emits `export type *` (type-only
//     re-export) — avoids dragging value imports through type-only barrels.
//   - An empty directory yields `export {};` so TypeScript still parses the
//     file as a module.
//   - Output is sorted by file name (locale-compare) — deterministic diffs.
//   - `--check` exits non-zero on drift without writing (pre-commit / CI use).

import type { Command } from '../types/index.js';
import {
    DEFAULT_BARRELS_EXCLUDES,
    DEFAULT_BARRELS_HEADER,
    generateBarrels,
    type BarrelExtension,
} from '../actions/barrels-generate.js';

interface BarrelsOptions {
    paths?: string[];
    ext?: BarrelExtension;
    baseDir?: string;
    exclude?: string[];
    header?: string;
    semicolon?: boolean;
    singleQuotes?: boolean;
    check?: boolean;
    verbose?: boolean;
}

export const barrelsCommand: Command<unknown, BarrelsOptions> = {
    command: 'barrels [paths..]',
    description: 'Regenerate `index.ts` barrel files for the given directories. Drop-in replacement for `barrelsby`.',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Directories whose `index.ts` to (re)generate. May also be passed via `--paths`.',
                type: 'string',
                array: true,
            })
            .option('paths', {
                alias: 'p',
                description: 'Alternative to positional — repeatable list of directories.',
                type: 'string',
                array: true,
            })
            .option('ext', {
                description: 'Import-specifier extension. Default: `none` (bundler-mode resolution).',
                type: 'string',
                choices: ['js', 'ts', 'none'] as const,
                default: 'none' as BarrelExtension,
            })
            .option('base-dir', {
                alias: 'b',
                description: 'Resolve `paths` against this directory. Default: cwd.',
                type: 'string',
            })
            .option('exclude', {
                description:
                    'Regex(es) of file names to skip. Repeatable. Defaults: `\\.test\\.`, `\\.spec\\.`, `\\.test-data\\.`.',
                type: 'string',
                array: true,
            })
            .option('header', {
                description: 'Header comment prepended to every generated file.',
                type: 'string',
            })
            .option('semicolon', {
                description: 'Emit trailing `;` on each export line. Negate with `--no-semicolon`. Default: omitted.',
                type: 'boolean',
                default: false,
            })
            .option('single-quotes', {
                description: 'Use `\'` for import specifiers. Default: true. Pass `--no-single-quotes` for `"`.',
                type: 'boolean',
                default: true,
            })
            .option('check', {
                description: 'Report drift without modifying files; exit non-zero if any barrel is stale.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Log each file scanned + written.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        // Both positional (`gjsify barrels src/a src/b`) and the named option
        // (`--paths src/a --paths src/b`) land in `args.paths` since they share
        // the same name. Yargs concatenates when both are present.
        const paths = Array.from(new Set(((args.paths as string[] | undefined) ?? []).filter(Boolean)));

        if (paths.length === 0) {
            console.error(
                '[gjsify barrels] no paths provided. Pass directories as positional arguments or via --paths.',
            );
            process.exitCode = 1;
            return;
        }

        const excludePatterns = (args.exclude as string[] | undefined)?.length
            ? (args.exclude as string[])
            : [...DEFAULT_BARRELS_EXCLUDES];

        const drift = await generateBarrels({
            paths,
            extension: (args.ext as BarrelExtension | undefined) ?? 'none',
            baseDir: (args.baseDir as string | undefined) ?? process.cwd(),
            exclude: excludePatterns.map((src) => new RegExp(src)),
            header: (args.header as string | undefined) ?? DEFAULT_BARRELS_HEADER,
            noSemicolon: args.semicolon === false || args.semicolon === undefined,
            singleQuotes: args.singleQuotes !== false,
            check: args.check ?? false,
            verbose: args.verbose ?? false,
        });

        if (args.check && drift > 0) {
            console.error(`[gjsify barrels] ${drift} barrel file(s) drifted. Run without --check to fix.`);
            process.exitCode = 1;
        }
    },
};
