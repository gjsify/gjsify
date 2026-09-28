// `gjsify format` — wraps oxfmt.
//
// Resolves oxfmt's Node launcher from node_modules
// (`node_modules/oxfmt/bin/oxfmt` → `dist/cli.js`) and spawns it with the
// current Node executable. oxfmt is a napi-rs hybrid CLI; the launcher carries
// the per-platform `@oxfmt/binding-<target>` native code as an
// optionalDependency, keeping the Node-free runtime promise for the bundled
// CLI intact (the formatter runs in dev/CI, not in shipped GJS apps).
//
// oxfmt formats JS/TS (+TOML) only. CSS/JSON formatting that the old Biome
// toolchain handled is intentionally DROPPED in the oxc migration — no other
// formatter is wired up for those file types.
//
// A BARE `gjsify format` WRITES. `--check` is the read-only CI mode and
// `--no-write` the read-only local one; there is no flagless report mode.
// This is what every other formatter in the ecosystem does with its bare
// invocation (oxfmt itself, `cargo fmt`, `gofmt -w`-less `go fmt`), it is what
// the sibling `gjsify fix` already did, and the previous report-only default
// silently did nothing in a loop: `gjsify format` was run repeatedly against
// two unformatted files while `--check` kept flagging them, because the
// command that looks like the fix was the diagnosis.
//
// `--init` writes recommended `.oxlintrc.json` + `.oxfmtrc.json` templates
// tuned for GJS/GNOME projects (4-space, single-quote, printWidth 120,
// trailing-comma all, semicolons always, arrow parens always).

import { existsSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { Command } from '../types/index.js';
import {
    OxcNotFoundError,
    findOxfmtConfig,
    loadOxfmtTemplate,
    loadOxlintTemplate,
    printOxcNotFound,
    runOxfmt,
    setOxcExitCode,
    shouldUseNativeOxfmt,
} from '../utils/oxc-resolve.js';
import { scanForNativeSkips } from '../utils/native-skip-scan.js';

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
    description: 'Format JS/TS source files via oxfmt (CSS/JSON formatting is not supported).',
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description: 'Files or directories to format. Default: `.`',
                type: 'string',
                array: true,
            })
            .option('write', {
                description: 'Modify files in place (default: true). Pass --no-write to report drift instead.',
                type: 'boolean',
                default: true,
            })
            .option('check', {
                description:
                    'Report formatting drift without modifying files; exit non-zero if any file is unformatted. Useful for CI.',
                type: 'boolean',
                default: false,
            })
            .option('config-path', {
                description: 'Path to an .oxfmtrc.json. Default: walks up from cwd to find one.',
                type: 'string',
                normalize: true,
            })
            .option('init', {
                description:
                    'Write recommended .oxlintrc.json + .oxfmtrc.json into cwd (skips existing files unless --force).',
                type: 'boolean',
                default: false,
            })
            .option('force', {
                description: 'Overwrite existing .oxlintrc.json / .oxfmtrc.json with --init.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Echo the resolved oxfmt launcher + args before spawning.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();

        if (args.init) {
            handleInit({ cwd, force: args.force ?? false });
            return;
        }

        const paths = (args.paths as string[] | undefined)?.length ? (args.paths as string[]) : ['.'];

        const oxfmtArgs: string[] = [];
        if (args.check) {
            oxfmtArgs.push('--check');
        } else if (args.write === false) {
            // `--no-write` — report drift without modifying files. oxfmt's own
            // bare default is `--write` too, so this branch must be explicit.
            oxfmtArgs.push('--list-different');
        } else {
            oxfmtArgs.push('--write');
        }

        const configPath = (args.configPath as string | undefined) ?? findOxfmtConfig(cwd) ?? undefined;
        if (configPath) oxfmtArgs.push('--config', resolve(configPath));

        oxfmtArgs.push(...paths);

        // Under GJS the native oxfmt formats everything but the files napi oxfmt
        // hands to its Prettier host (Markdown, HTML, Vue, YAML, …), and it drops
        // those without a word. `--check` FAILS on them, so a green check that
        // checked nothing is impossible — asked about exactly the files oxfmt
        // itself would walk with this config, never `node_modules` or ignored ones.
        if (args.check && (await shouldUseNativeOxfmt())) {
            const scan = scanForNativeSkips(paths, cwd, { configPath });
            if (scan.skipped.length > 0) {
                const list = scan.skipped.map((f) => `  ${relative(cwd, f) || f}`).join('\n');
                console.error(
                    `[gjsify format] ERROR: ${scan.skipped.length} file(s) skipped — ` +
                        `the native oxfmt (GJS) has no Prettier host for them (Markdown/HTML/Vue/YAML/…):\n` +
                        `${list}\n` +
                        `  The format check is INCOMPLETE. Run \`gjsify format --check\` under Node to check these ` +
                        `files, or add them to \`ignorePatterns\`.`,
                );
                setOxcExitCode(1);
                return;
            }
        }

        try {
            const code = await runOxfmt(oxfmtArgs, { cwd, verbose: args.verbose });
            setOxcExitCode(code);
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

function handleInit({ cwd, force }: { cwd: string; force: boolean }): void {
    const writeOne = (name: string, contents: string): void => {
        const target = resolve(cwd, name);
        if (existsSync(target) && !force) {
            console.log(`[gjsify format] ${name} exists at ${target} — pass --force to overwrite.`);
            return;
        }
        writeFileSync(target, contents, 'utf-8');
        console.log(`[gjsify format] wrote ${target}`);
    };

    writeOne('.oxlintrc.json', loadOxlintTemplate());
    writeOne('.oxfmtrc.json', loadOxfmtTemplate());
    console.log('[gjsify format] Run `gjsify format` to apply the formatter to the project.');
}
