// `gjsify run <target> [args..]` — dual-mode runner.
//
//   gjsify run <file>     → existing behavior: run a GJS bundle file
//                          via `gjs -m`, with LD_LIBRARY_PATH +
//                          GI_TYPELIB_PATH set for native packages.
//   gjsify run <script>   → yarn-run-style: look up `<script>` in the
//                          current workspace's package.json `scripts`
//                          and execute it with `node_modules/.bin` on
//                          PATH (workspace + monorepo root).
//
// Phase D.5 added the script-runner side. The two modes coexist via a
// `looksLikeFile()` heuristic: anything with a path separator, JS-ish
// extension, or that resolves to an existing path on disk is treated
// as a bundle file. Everything else is a script name. Users who want
// to disambiguate can pass `./<file>` explicitly.

import { statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Command } from '../types/index.js';
import { runGjsBundle } from '../utils/run-gjs.js';
import { readPackageJson } from '../utils/pkg-json-edit.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';

interface RunOptions {
    target: string;
    args: string[];
}

export const runCommand: Command<unknown, RunOptions> = {
    command: 'run <target> [args..]',
    description:
        'Run a script from package.json (yarn-run-style) or a GJS bundle file. If <target> resolves to a file on disk (or has a path-like prefix), it is launched via gjs with LD_LIBRARY_PATH + GI_TYPELIB_PATH set for native packages. Otherwise it is looked up in the current package.json `scripts`.',
    builder: (yargs) =>
        yargs
            .positional('target', {
                description:
                    'Either a script name (looked up in package.json `scripts`) or a path to a GJS bundle (e.g. dist/gjs.js).',
                type: 'string',
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments passed through to the script / gjs.',
                type: 'string',
                array: true,
                default: [],
            })
            .parserConfiguration({
                // Preserve `--` as args['--'] so callers can write
                //   gjsify run ./server.mjs -- --port 8080
                // without yargs intercepting --port as its own option.
                // Without this, anything after `--` lands in args._ and is
                // silently dropped by the handler.
                'populate--': true,
                // Forward UNKNOWN flags to the target without requiring `--`:
                //   gjsify run dist/app.gjs.mjs serve --port 8080 --year 2025
                // Without this, the top-level `.strict()` (cli-app.ts) rejects
                // --port/--year as "unknown arguments" before they reach the
                // target. Treating unknown options as positional args routes
                // them into the `[args..]` positional (then to the child).
                // Known options (--help / --version) are still handled by gjsify.
                'unknown-options-as-args': true,
            }),
    handler: async (args) => {
        const target = args.target as string;
        // Collect positional args AND anything after the `--` separator.
        // With `parserConfiguration({ 'populate--': true })` in the builder,
        // `gjsify run target -- a b c` puts a, b, c into args['--'] rather
        // than silently discarding them (without it they land in args._ and
        // are never forwarded to the child).
        const positionalArgs = (args.args as string[]) ?? [];
        const doubleDashArgs = (((args as Record<string, unknown>)['--'] as unknown[]) ?? []).filter(
            (v): v is string => typeof v === 'string',
        );
        const extraArgs = [...positionalArgs, ...doubleDashArgs];

        // Script lookup wins over file detection. Without this, a bare
        // `gjsify run build` would resolve to a file when a `./build`
        // directory exists in cwd (e.g. meson's build dir from a Vala
        // prebuild) — masking the package.json's `"build": "…"` script.
        // File mode is still entered for explicit path-shaped targets
        // (`./bundle.js`, `dist/x.mjs`, `/abs/path`).
        const pkg = readPackageJson(join(process.cwd(), 'package.json'));
        const hasScript = pkg?.scripts && typeof (pkg.scripts as Record<string, unknown>)[target] === 'string';

        if (!hasScript && looksLikeFile(target)) {
            const file = resolve(target);
            // Terminal call — exit on success, or the GJS main loop parks
            // this process forever (see RunGjsBundleOptions.exitOnSuccess).
            await runGjsBundle(file, extraArgs, { exitOnSuccess: true });
            return;
        }

        await runScript(target, extraArgs);
    },
};

function looksLikeFile(target: string): boolean {
    if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) return true;
    if (target.includes('/') || target.includes('\\')) return true;
    if (/\.(c?js|mjs|cjs|gjs)$/.test(target)) return true;
    // Bare names like "build" can collide with build/ directories from
    // meson/vala prebuilds — only treat as a file if it's a regular file,
    // not a directory.
    try {
        const st = statSync(target);
        return st.isFile();
    } catch {
        return false;
    }
}

/**
 * Run a script declared in the current workspace's `package.json#scripts`.
 * Mirrors `yarn run <script>` semantics:
 *   - PATH prepended with `<workspace>/node_modules/.bin` AND the
 *     monorepo-root `node_modules/.bin` (covers locally-installed bins
 *     and hoisted bins)
 *   - extra args appended after the script's literal command, shell-escaped
 *   - executed through `shell: true` so `&&` / `|` / env-var refs work
 *     exactly as in package.json scripts (matches npm/yarn)
 */
async function runScript(script: string, extraArgs: readonly string[]): Promise<void> {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');
    const pkg = readPackageJson(pkgPath);
    if (!pkg) {
        console.error(`gjsify run: no package.json in ${cwd}`);
        process.exit(1);
    }
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const literal = scripts[script];
    if (typeof literal !== 'string') {
        const available = Object.keys(scripts).join(', ') || '<none>';
        console.error(`gjsify run: no script "${script}" in ${pkgPath} (available: ${available})`);
        process.exit(1);
    }

    const monorepoRoot = findWorkspaceRoot(cwd);
    const binDirs = [join(cwd, 'node_modules', '.bin')];
    if (monorepoRoot && monorepoRoot !== cwd) {
        binDirs.push(join(monorepoRoot, 'node_modules', '.bin'));
    }
    // Under GJS, the GJS-runnable `gjsify` shim (see `ensureGjsifyShimOnPath`)
    // MUST shadow the workspace `node_modules/.bin/gjsify`, which is the Node
    // entry and unusable in a node-free sandbox. So put the shim dir ahead of
    // the `.bin` dirs in the child's PATH — otherwise a compound script like
    // `gjsify run a && gjsify run b` resolves `gjsify` to the Node bin and
    // fails. `GJSIFY_SHIM_DIR` is only set under GJS, so this is a no-op on Node.
    if (process.env.GJSIFY_SHIM_DIR) {
        binDirs.unshift(process.env.GJSIFY_SHIM_DIR);
    }
    // Default FORCE_COLOR=1 when not already set, matching yarn / npm
    // script-runner behaviour. Without this, tools that check
    // `process.stdout.isTTY` (chalk, picocolors, biome, …) disable colors
    // whenever the child's stdout is piped — including GitHub Actions
    // (stdout is always a pipe there, but the GHA log viewer renders ANSI
    // fine). Respect user overrides: FORCE_COLOR=0 or NO_COLOR keeps
    // colors off.
    const colorEnv =
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };
    const env = {
        ...process.env,
        ...colorEnv,
        PATH: [...binDirs, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
        npm_lifecycle_event: script,
        npm_package_name: pkg.name ?? '',
        npm_package_version: pkg.version ?? '',
    };

    // In-process fast path: under GJS, the build orchestration chains a
    // heavyweight gjs per level (`foreach → npm → gjsify run X → gjsify <cmd>`),
    // which oversubscribes CI's few cores and thrashes. When the script is a
    // single `gjsify <subcommand>` (no shell operators / substitutions /
    // unquoted globs), dispatch it through the same yargs surface IN THIS
    // process instead of spawning another gjs — collapsing two gjs into one.
    // Anything fancier (compound `&&`, pipes, a non-gjsify command) falls
    // through to the shell spawn below. Node keeps spawning (cheap there); this
    // only triggers under GJS, where the nesting actually hurts. See cli-app.ts.
    const inProcArgv = isGjs() ? gjsifyInProcessArgv(literal, extraArgs) : null;
    if (inProcArgv) {
        // The subcommand runs in our process, so surface the script env on
        // `process.env` (PATH with the workspace .bin dirs, npm_* lifecycle
        // vars) exactly as the spawn path would. We process.exit afterwards, so
        // mutating the global env is fine.
        process.env.PATH = env.PATH;
        process.env.npm_lifecycle_event = env.npm_lifecycle_event;
        process.env.npm_package_name = env.npm_package_name;
        process.env.npm_package_version = env.npm_package_version;
        if (env.FORCE_COLOR !== undefined) process.env.FORCE_COLOR = env.FORCE_COLOR;
        try {
            // Dynamic import to avoid a static cli-app ↔ run.ts import cycle;
            // cli-app is already loaded (the CLI is running through it), so this
            // resolves from cache instantly.
            const { runCli } = await import('../cli-app.js');
            await runCli(inProcArgv);
        } catch (err) {
            console.error((err as Error).message);
            process.exit(1);
        }
        // Honor a non-zero `process.exitCode` set by the dispatched handler
        // (e.g. a failing check that sets the code instead of exiting) —
        // a bare exit(0) here masked such failures as success.
        process.exit(process.exitCode != null ? Number(process.exitCode) : 0);
        // `process.exit()` under GJS is NOT synchronous — with the GLib main
        // loop armed (`ensureMainLoop`, e.g. by a bundle the in-process dispatch
        // just ran) it defers the actual teardown, so execution CONTINUES past
        // the call. Without this `return` the function falls through to the
        // shell-spawn fallback below and runs the SAME command a SECOND time
        // (the double-execution bug). Mirrors the file-mode path's `return`
        // after `runGjsBundle`. Keep both — the return is the real guard, the
        // exit sets the status code for when the loop finally unwinds.
        return;
    }

    const fullCmd = extraArgs.length > 0 ? `${literal} ${extraArgs.map(shellEscape).join(' ')}` : literal;
    // ensureMainLoop() (called inside spawn) keeps GJS alive after the
    // child exits — without an explicit process.exit() the success path
    // would park the loop forever. The error path already exits.
    await new Promise<void>((resolveOk, reject) => {
        const child = spawn(fullCmd, [], { cwd, env, stdio: 'inherit', shell: true });
        child.on('close', (code) => {
            if (code === 0) resolveOk();
            else reject(new Error(`script "${script}" exited with code ${code}`));
        });
        child.on('error', reject);
    }).catch((err: Error) => {
        console.error(err.message);
        process.exit(1);
    });
    process.exit(0);
}

function shellEscape(arg: string): string {
    if (/^[a-zA-Z0-9_\-./=:@,]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * If `literal` is a SINGLE `gjsify <subcommand> …` command with no shell
 * operators / substitutions / unquoted globs, return the argv to feed `runCli`
 * (the subcommand + its args, with `extraArgs` appended). Otherwise null — the
 * caller falls back to the shell spawn path. Quotes are honoured so a quoted
 * glob (`'src/**'`) survives as a single literal token, exactly as the shell
 * would hand it to `gjsify` (which does its own glob expansion).
 */
function gjsifyInProcessArgv(literal: string, extraArgs: readonly string[]): string[] | null {
    const tokens = tokenizeSimpleCommand(literal);
    if (!tokens || tokens.length < 2 || tokens[0] !== 'gjsify') return null;
    return [...tokens.slice(1), ...extraArgs];
}

/**
 * Quote-aware tokenizer for a SIMPLE command line (no shell features beyond
 * single/double quoting). Returns the tokens, or null if the string contains
 * anything the shell would treat specially — operators (`&& | ; < > &`),
 * substitutions (`$(...)` / backticks / `$VAR`), unquoted globs/expansions
 * (`* ? { } [ ] ~`), comments (`#`), or an unterminated quote — in which case
 * the caller MUST use the real shell instead.
 */
function tokenizeSimpleCommand(cmd: string): string[] | null {
    const tokens: string[] = [];
    let cur = '';
    let has = false;
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i]!;
        if (quote === "'") {
            if (c === "'") quote = null;
            else cur += c;
            continue;
        }
        if (quote === '"') {
            if (c === '"') quote = null;
            else if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) cur += cmd[++i];
            else if (c === '$' || c === '`')
                return null; // substitution inside "…"
            else cur += c;
            continue;
        }
        if (c === "'" || c === '"') {
            quote = c;
            has = true;
            continue;
        }
        if (c === ' ' || c === '\t') {
            if (has) {
                tokens.push(cur);
                cur = '';
                has = false;
            }
            continue;
        }
        if ('|&;<>`$()\\\n\r*?{}[]~#!'.includes(c)) return null;
        cur += c;
        has = true;
    }
    if (quote) return null; // unterminated quote
    if (has) tokens.push(cur);
    return tokens;
}
