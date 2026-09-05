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

import { readFileSync, statSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { doubleDashArgs } from '../utils/double-dash-args.js';
import { describeExit, spawnToCompletion } from '../utils/spawn.js';
import { runGjsBundle } from '../utils/run-gjs.js';
import { runRuntimeBundle } from '../utils/run-node.js';
import { readPackageJson } from '../utils/pkg-json-edit.js';
import { runNodeScript } from '../utils/node-script.js';
import { nodeShimDir } from '../utils/gjsify-shim.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { gjsifyCommandArgv } from '../utils/simple-command.js';
import { isDaemonCommand } from '../utils/daemon-command.js';
import { discoverWorkspaces } from '@gjsify/workspace';
import { isGjs, hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import {
    EXAMPLE_RUNTIMES,
    isExampleRuntime,
    readDeclaredRuntimes,
    checkRuntimeSupported,
    type ExampleRuntime,
} from '../utils/runtimes.js';

interface RunOptions {
    target: string;
    args: string[];
    workspace?: string;
    runtime?: string;
    nodeScript?: boolean;
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
            .option('workspace', {
                // npm/yarn-style `-w <name>`: run <target> as a SCRIPT in the
                // named workspace instead of the current directory. The name
                // matches the package.json `name`, the workspace-relative path
                // (e.g. `cli`), or the directory basename — so both
                // `-w eco-retrofit-cli` and `-w cli` resolve, matching npm.
                alias: 'w',
                type: 'string',
                description:
                    'Run <target> as a script in the named workspace (by name or path), like `npm run <script> -w <name>`.',
            })
            .option('node-script', {
                // Run an UNBUNDLED `.mjs` that imports `node:*` builtins on the
                // host runtime — bundling it for GJS first when that is the host.
                // Declared here so yargs captures it instead of forwarding it to
                // the target (this command routes unknown flags to the child).
                // Forces file mode, like --runtime.
                type: 'boolean',
                default: false,
                description:
                    'Treat <target> as an unbundled Node-style script (imports `node:` builtins) and run it on the host runtime. Under GJS the file is bundled `--app gjs` on the fly first, which is what makes a repo script runnable on a host that has no Node.',
            })
            .option('runtime', {
                // Runtime selector for a BUNDLE FILE. `gjs` (default) launches
                // the `--app gjs` bundle via `gjs -m`; node/bun/deno launch the
                // `--app node` bundle on that runtime (Node-API is their common
                // ABI, so bun/deno reuse the same node bundle). Declaring it here
                // means yargs captures the flag instead of forwarding it to the
                // target (this command routes unknown flags to the child).
                // Passing --runtime FORCES file mode.
                type: 'string',
                choices: EXAMPLE_RUNTIMES,
                description:
                    'Runtime to launch a bundle FILE on: gjs (default, `--app gjs` bundle) | node | bun | deno (the `--app node` bundle). Forces file mode.',
            })
            // Pass-through runner: the TARGET owns its whole flag namespace, so
            // disable gjsify's own `--version` / `--help` for THIS command. Without
            // this, `gjsify run <target> --help` / `--version` are KNOWN options →
            // yargs prints the gjsify CLI's help/version instead of forwarding them
            // to the target (e.g. `gjsify run start --version` printed gjsify's
            // version, not the run script's). Disabled → they become "unknown" and
            // `unknown-options-as-args` (below) routes them into `[args..]` → child.
            // Same pattern as the `tsc` pass-through command. (`gjsify run --help`
            // with no target now errors "target required" rather than showing this
            // command's help — the accepted pass-through trade-off, as with `tsc`.)
            .version(false)
            .help(false)
            .parserConfiguration({
                // Preserve `--` as args['--'] so callers can write
                //   gjsify run ./server.mjs -- --port 8080
                // without yargs intercepting --port as its own option.
                // Without this, anything after `--` lands in args._ and is
                // silently dropped by the handler.
                'populate--': true,
                // …and hand that tail on as the TEXT the caller typed. Without
                // this yargs types a bare number in the array — and in the
                // `[args..]` positional — as a `number`, which the reader below
                // used to drop outright (#1531).
                'parse-positional-numbers': false,
                // Forward UNKNOWN flags to the target without requiring `--`:
                //   gjsify run dist/app.gjs.mjs serve --port 8080 --year 2025
                // Without this, the top-level `.strict()` (cli-app.ts) rejects
                // --port/--year as "unknown arguments" before they reach the
                // target. Treating unknown options as positional args routes
                // them into the `[args..]` positional (then to the child). With
                // `.version(false).help(false)` above, `--help` / `--version`
                // are unknown too, so they forward to the target like any flag.
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
        const extraArgs = [...positionalArgs, ...doubleDashArgs(args)];

        // `--node-script` (explicit) → run an UNBUNDLED Node-style script on the
        // host runtime; under GJS it is bundled `--app gjs` on the fly first.
        // Checked before `--runtime` and `--workspace`: it is a file mode, and
        // combining it with either is a caller error rather than a precedence
        // question (`--runtime` picks a launcher for a PREBUILT bundle,
        // `--workspace` names a package.json script).
        if (args.nodeScript === true) {
            const isSet = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
            const clash = isSet(args.runtime) ? '--runtime' : isSet(args.workspace) ? '--workspace' : null;
            if (clash) {
                console.error(`gjsify run: --node-script cannot be combined with ${clash}.`);
                return process.exit(1);
            }
            await runNodeScript(target, extraArgs, { completion: 'exit', exitOnSuccess: true });
            return;
        }

        // `--runtime <gjs|node|bun|deno>` (explicit) → run a BUNDLE FILE on the
        // chosen runtime. This FORCES file mode: the runtime selector only makes
        // sense for a prebuilt bundle, and it must beat the script-name lookup.
        // gjs → `runGjsBundle` (gjs -m); node/bun/deno → `runRuntimeBundle` (the
        // `--app node` bundle; bun/deno reuse it). Default gjs keeps back-compat.
        const runtimeArg = args.runtime;
        if (typeof runtimeArg === 'string' && runtimeArg.length > 0) {
            if (typeof args.workspace === 'string' && args.workspace.length > 0) {
                console.error('gjsify run: --runtime cannot be combined with --workspace (file mode vs script mode).');
                return process.exit(1);
            }
            if (!isExampleRuntime(runtimeArg)) {
                console.error(
                    `gjsify run: unknown --runtime "${runtimeArg}" (expected: ${EXAMPLE_RUNTIMES.join(', ')}).`,
                );
                return process.exit(1);
            }
            await runTargetOnRuntime(runtimeArg, target, extraArgs);
            return;
        }

        // `-w <name>` (npm/yarn parity): run <target> as a script in the named
        // workspace's directory rather than the current one. Never file mode.
        if (typeof args.workspace === 'string' && args.workspace.length > 0) {
            await runScriptInWorkspace(args.workspace, target, extraArgs);
            return;
        }

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
            // The default runtime for a bare `gjsify run <file>` FOLLOWS the host
            // runtime the CLI executes in: gjs (global install) → gjs; node/bun/
            // deno (npx/bunx/deno) → that runtime. EXCEPTION: a `--app gjs` bundle
            // can only run on gjs (its gi:// imports are externalized, there is no
            // node-gi shim), so it is always launched on gjs regardless of the
            // host — this keeps `gjsify run dist/index.gjs.js` working when the
            // CLI itself runs under node (e.g. `gjsify foreach test` for the
            // node-cli examples). Pass `--runtime` explicitly to override.
            const host = hostRuntime();
            const runtime = host === 'gjs' || isLikelyGjsBundle(file) ? 'gjs' : host;
            // Terminal calls — exit on success, or the GJS main loop parks
            // this process forever (see RunGjsBundleOptions.exitOnSuccess).
            if (runtime === 'gjs') {
                await runGjsBundle(file, extraArgs, { completion: 'exit', exitOnSuccess: true });
            } else {
                await runRuntimeBundle(runtime, file, extraArgs, { completion: 'exit', exitOnSuccess: true });
            }
            return;
        }

        await runScript(target, extraArgs);
    },
};

/**
 * Run a bundle-file `target` on `runtime`. Validates that the target looks like
 * a file (the runtime selector is for prebuilt bundles, not script names) and,
 * best-effort, that the cwd package's `gjsify.example.runtimes` declaration
 * permits the runtime — turning "this showcase can't run on node yet" into a
 * clean, actionable error instead of a deep bundle crash. gjs → `runGjsBundle`;
 * node/bun/deno → `runRuntimeBundle` (the shared `--app node` launcher).
 */
async function runTargetOnRuntime(runtime: ExampleRuntime, target: string, extraArgs: string[]): Promise<void> {
    if (!looksLikeFile(target)) {
        console.error(
            `gjsify run: --runtime ${runtime} needs a bundle FILE, but "${target}" is not a path.\n` +
                `  Build first (e.g. \`gjsify build src/app.ts --app ${runtime === 'gjs' ? 'gjs' : 'node'} --outfile dist/app.${runtime === 'gjs' ? 'gjs' : 'node'}.mjs\`), then run the output file.`,
        );
        return process.exit(1);
    }

    // Best-effort declaration check against the cwd package (the example dir).
    const pkg = readPackageJson(join(process.cwd(), 'package.json')) as
        | { name?: string; gjsify?: { example?: { runtimes?: unknown } } }
        | undefined;
    const declared = readDeclaredRuntimes(pkg);
    const support = checkRuntimeSupported(runtime, declared, pkg?.name ?? target);
    if (!support.ok) {
        console.error(`gjsify run: ${support.message}`);
        return process.exit(1);
    }

    const file = resolve(target);
    // Terminal call — exit on success (the GJS/GLib loop would otherwise park).
    if (runtime === 'gjs') {
        await runGjsBundle(file, extraArgs, { completion: 'exit', exitOnSuccess: true });
    } else {
        await runRuntimeBundle(runtime, file, extraArgs, { completion: 'exit', exitOnSuccess: true });
    }
}

/**
 * Whether `file` is a `--app gjs` bundle (which can ONLY run on gjs — its
 * `gi://` imports stay as external string literals and boots through a `gjs -m`
 * shebang / `imports.system` stub). Used to keep such a bundle on gjs even when
 * the host is node/bun/deno, so the host-following default in the bare-file run
 * path never sends a gjs bundle to a runtime it cannot load.
 *
 * A `--app node` bundle (even a node-gi reverse-bridge one) rewrites `gi://` to
 * `@gjsify/node-gi` and never keeps a `gi://` import literal, so it is NOT
 * matched here and follows the host runtime.
 */
function isLikelyGjsBundle(file: string): boolean {
    // Fast path on the conventional `.gjs.js` / `.gjs.mjs` naming.
    if (/\.gjs\.[mc]?js$/.test(file)) return true;
    try {
        // gi:// imports + the process/system stub are hoisted to the top of the
        // bundle, so a bounded prefix is enough — bundles can be several MB.
        const head = readFileSync(file, 'utf-8').slice(0, 65536);
        return (
            head.startsWith('#!/usr/bin/env -S gjs') ||
            /(?:from|import)\s*["']gi:\/\//.test(head) ||
            /\bimports\.(?:gi|system)\b/.test(head)
        );
    } catch {
        return false;
    }
}

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
 * Resolve a workspace by npm/yarn `--workspace` semantics — matching the
 * package.json `name`, the workspace-relative path (`packages/infra/cli` or
 * `cli`), or the directory basename — then run `script` in that workspace's
 * directory. Mirrors `npm run <script> --workspace <name>`.
 */
async function runScriptInWorkspace(name: string, script: string, extraArgs: readonly string[]): Promise<void> {
    const root = findWorkspaceRoot(process.cwd()) ?? process.cwd();
    let workspaces;
    try {
        workspaces = discoverWorkspaces(root);
    } catch (err) {
        console.error(`gjsify run: could not read workspaces at ${root}: ${(err as Error).message}`);
        return process.exit(1);
    }
    const ws = workspaces.find((w) => w.name === name || w.relativeLocation === name || basename(w.location) === name);
    if (!ws) {
        const available = workspaces.map((w) => w.relativeLocation).join(', ') || '<none>';
        console.error(`gjsify run: no workspace "${name}" under ${root} (available: ${available})`);
        // `return process.exit` — a bare exit falls through under GJS (see runScript).
        return process.exit(1);
    }
    await runScript(script, extraArgs, ws.location);
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
async function runScript(script: string, extraArgs: readonly string[], cwd: string = process.cwd()): Promise<void> {
    const pkgPath = join(cwd, 'package.json');
    const pkg = readPackageJson(pkgPath);
    if (!pkg) {
        console.error(`gjsify run: no package.json in ${cwd}`);
        // `return process.exit` — under GJS `process.exit` cannot terminate
        // synchronously (a parked GLib.MainLoop owns the thread): it SCHEDULES
        // the exit and returns, so a bare call falls through. Here that reached
        // `tokenizeSimpleCommand(literal)` with `literal === undefined` →
        // `cannot access property "length"` → the throw raced the scheduled
        // exit into a second `system.exit` → `m_should_exit assertion failed`
        // → core dump. The `return` halts the handler so exactly one exit is
        // scheduled (same discipline as commands/workspace.ts). No-op on Node.
        return process.exit(1);
    }
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const literal = scripts[script];
    if (typeof literal !== 'string') {
        const available = Object.keys(scripts).join(', ') || '<none>';
        console.error(`gjsify run: no script "${script}" in ${pkgPath} (available: ${available})`);
        // See the `no package.json` branch above — a bare `process.exit` under
        // GJS falls through to `tokenizeSimpleCommand(undefined)` and core-dumps.
        return process.exit(1);
    }

    const monorepoRoot = findWorkspaceRoot(cwd);
    const binDirs = [join(cwd, 'node_modules', '.bin')];
    if (monorepoRoot && monorepoRoot !== cwd) {
        binDirs.push(join(monorepoRoot, 'node_modules', '.bin'));
    }
    // The self-shim (see `ensureGjsifyShimOnPath`) MUST shadow the workspace
    // `node_modules/.bin/gjsify`, so put its dir ahead of the `.bin` dirs in the
    // child's PATH — otherwise a compound script like `gjsify run a && gjsify
    // run b` resolves `gjsify` to the workspace bin. Two trees need that:
    // under GJS the bin is the Node entry and is unusable in a node-free
    // sandbox, and under a BOOTSTRAP Node CLI (npx / global install) the bin
    // dispatches to build outputs that a cold tree has not produced yet.
    // `GJSIFY_SHIM_DIR` is unset whenever the tree's own CLI is the one
    // running, which keeps that case byte-for-byte unchanged.
    if (process.env.GJSIFY_SHIM_DIR) {
        binDirs.unshift(process.env.GJSIFY_SHIM_DIR);
    }
    // The `node` shim (see `nodeShimDir`) reaches PACKAGE SCRIPTS and nothing
    // else. A script saying `node scripts/x.mjs` means "run this script", which
    // gjsify can serve on a host with no Node; the CLI's own internals asking for
    // `node` mean "I need a real Node", and answering those turned
    // `gjsify tsc`'s honest "not on PATH" diagnosis into a bundling error two
    // layers down (tests/e2e/tsc-node-fallback caught exactly that).
    const nodeShim = nodeShimDir();
    if (nodeShim) binDirs.unshift(nodeShim);
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
        // …and the working directory, for the same reason. The spawn path below
        // passes `cwd` to `spawn()`; this path used to pass it nowhere, so a
        // `gjsify run -w <ws> <script>` resolved the WORKSPACE and then ran the
        // command in the CALLER's directory. Every relative path in the script
        // — `src/app/main.ts`, `dist/…`, `tests/test.mts` — then resolved
        // against the monorepo root.
        //
        // Only this branch was affected, which is why it survived: the fast path
        // fires exactly when the script is a SINGLE `gjsify <subcommand>`, so a
        // compound script (`a && b`) took the shell path and worked. Measured on
        // the two consumers: bauplaner's cli scripts are all single commands and
        // it documents the gap in its AGENTS.md, sidestepping it with
        // `cd cli && …`; buchhaltung's one `-w` use is `build:meson`, a compound
        // command, and it works.
        if (cwd !== process.cwd()) process.chdir(cwd);
        // Track the failure LOCALLY rather than through `process.exitCode`.
        // Under GJS `process.exit()` is deferred (see the note below), so the
        // `process.exit(1)` that used to live in the catch returned instead of
        // terminating, execution fell through to the exit-code line below, and
        // whatever that computed WON. The dispatched command's failure was then
        // reported as success: `gjsify run build:gjsify` exited 0 while the
        // `gjsify build` it dispatched exited 1, so `gjsify onboard` happily
        // published a package whose build had just failed. Anything chaining on
        // `gjsify run <script>` — every `a && b` build script, CI, onboard —
        // got a false green from it.
        let dispatchFailed = false;
        try {
            // Dynamic import to avoid a static cli-app ↔ run.ts import cycle;
            // cli-app is already loaded (the CLI is running through it), so this
            // resolves from cache instantly.
            const { runCli } = await import('../cli-app.js');
            await runCli(inProcArgv);
        } catch (err) {
            console.error((err as Error).message);
            dispatchFailed = true;
        }
        // A watch loop RESOLVES as soon as it is armed and then keeps running,
        // so its resolution is not an ending to exit on: `gjsify run dev` used
        // to take down the loop it had just started, the instant the first
        // build+launch finished. Node never saw it — there the same script takes
        // the shell-spawn path below — and it is the DOCUMENTED entry point:
        // `gjsify create` prints `gjsify run dev`, and every template's `dev`
        // script is a bare `gjsify dev`. Returning leaves the process on the
        // main loop `runWatchLoop` holds, where Ctrl+C ends it.
        if (!dispatchFailed && isDaemonCommand()) return;
        // A thrown command wins over `process.exitCode`; otherwise honour a
        // non-zero code the handler set instead of throwing (e.g. a failing
        // check) — a bare exit(0) here masked those as success too.
        const dispatchCode = dispatchFailed ? 1 : process.exitCode != null ? Number(process.exitCode) : 0;
        // `return process.exit(…)`, never a bare call. Under GJS `process.exit()`
        // is NOT synchronous — with the GLib main loop armed (`ensureMainLoop`,
        // e.g. by a bundle the in-process dispatch just ran) it defers the
        // actual teardown and RETURNS, so execution continues past the call.
        // Without the `return` the function falls through to the shell-spawn
        // fallback below and runs the SAME command a SECOND time (the
        // double-execution bug). Mirrors the file-mode path's `return` after
        // `runGjsBundle`. The return is the real guard; the exit sets the status
        // code for when the loop finally unwinds.
        return process.exit(dispatchCode);
    }

    const fullCmd = extraArgs.length > 0 ? `${literal} ${extraArgs.map(shellEscape).join(' ')}` : literal;
    // `completion: 'exit'` — ensureMainLoop() (called inside the async spawn) keeps
    // GJS alive after the child exits, and both paths below end in `process.exit`,
    // which is what tears it down. `shell: true` deliberately skips the win32
    // rewrite: this is a command LINE, and Node routes it through %COMSPEC%.
    let result;
    try {
        result = await spawnToCompletion(fullCmd, [], { completion: 'exit', cwd, env, shell: true });
    } catch (err) {
        console.error((err as Error).message);
        return process.exit(1);
    }
    if (result.code !== 0) {
        console.error(`script "${script}" exited with ${describeExit(result)}`);
        return process.exit(1);
    }
    return process.exit(0);
}

function shellEscape(arg: string): string {
    if (/^[a-zA-Z0-9_\-./=:@,]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * If `literal` is a SINGLE `gjsify <subcommand> …` command with no shell
 * operators / substitutions / unquoted globs, return the argv to feed `runCli`
 * (the subcommand + its args, with `extraArgs` appended). Otherwise null — the
 * caller falls back to the shell spawn path.
 */
function gjsifyInProcessArgv(literal: string, extraArgs: readonly string[]): string[] | null {
    const argv = gjsifyCommandArgv(literal);
    if (!argv) return null;
    return [...argv, ...extraArgs];
}
