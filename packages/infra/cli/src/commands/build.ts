import { Config } from '../config.js';
import { BuildAction } from '../actions/build.js';
import type { Command, CliBuildOptions } from '../types/index.js';
import { SOURCE_DIALECTS } from '@gjsify/rolldown-plugin-gjsify';

// NO `normalize: true` ON THE GLOB-BEARING OPTIONS — `entry-points` and
// `exclude` are PATTERNS, not paths.
//
// yargs' `normalize` runs `path.normalize()` over every value, which on win32
// rewrites separators: `src/**/*.{ts,js}` becomes `src\**\*.{ts,js}`. Those
// patterns go to fast-glob, whose own source says why that must not happen
// ("we cannot use the standard `path.normalize` method, because on Windows
// platform it will use of backslashes") — and the failure is not a clean
// no-match. With no `/` left, fast-glob finds no static base, walks from `.`,
// follows the workspace's relative `node_modules/@gjsify/*` symlinks with
// unbounded depth and no cycle detection, and dies of heap exhaustion after
// tens of minutes without writing one output file. That is issue #914's
// "`--library` is pathologically slow" report, in full: every `build:gjsify`
// script in the tree passes its entry points as globs. See
// `rolldown-plugin-gjsify/src/utils/entry-points.ts` for the second layer.
//
// The flag had also been copied onto twelve options that are not paths at all
// (booleans, `choices` enums, comma-separated identifier lists). Normalizing
// those is meaningless, and it is what made the one place it is harmful look
// like house style. `outfile`/`outdir` keep it: they ARE single paths, and
// nothing globs them.
export const buildCommand: Command<unknown, CliBuildOptions> = {
    command: 'build [entryPoints..]',
    description: 'Build and bundle your Gjs project',
    builder: (yargs) => {
        return yargs
            .option('entry-points', {
                description:
                    'The entry points you want to bundle. Defaults to bundler.input from package.json#gjsify or .gjsifyrc.js, falling back to src/index.ts when neither is set.',
                array: true,
                type: 'string',
                // No yargs `default` here on purpose. A yargs default value
                // is indistinguishable from "user passed the flag" in the
                // parsed args (cliArgs.entryPoints?.length is truthy either
                // way), so the merge step in config.ts would unconditionally
                // overwrite `bundler.input` declared in package.json#gjsify —
                // silently ignoring `gjsify.bundler.input: "src/start.ts"`
                // and producing a bundle from the wrong entry point. The
                // fallback to src/index.ts is applied in config.ts AFTER
                // merging with the cosmiconfig data.
                defaultDescription: 'src/index.ts (fallback)',
                coerce: (arg: string[]) => {
                    // Removes duplicates
                    return [...new Set(arg)];
                },
            })
            .option('exclude', {
                description: 'An array of glob patterns to exclude entry-points and aliases',
                array: true,
                type: 'string',
                default: [],
            })
            .option('verbose', {
                description: 'Switch on the verbose mode',
                type: 'boolean',
                default: false,
            })
            .option('app', {
                description:
                    'Build target for an application. Defaults to the target of the HOST runtime running the CLI: gjs when run under gjs, node when run under node/bun/deno (both consume the --app node bundle). Set `gjsify.app` in package.json#gjsify to override the host default.',
                type: 'string',
                choices: ['gjs', 'node', 'browser', 'nativescript'],
                // No yargs `default: 'gjs'` — a yargs default is
                // indistinguishable from a user-set value and would clobber
                // `package.json#gjsify.app` in config.ts (same footgun as
                // `globals`/`entryPoints`). The host-derived fallback is applied
                // post-merge in `Config.forBuild`: CLI flag > config file > host
                // default (`buildAppForRuntime(hostRuntime())`).
                defaultDescription: 'host runtime target (gjs on gjs, else node)',
            })
            .option('format', {
                description: 'Override the default output format',
                type: 'string',
                choices: ['iife', 'esm', 'cjs'],
            })
            .option('minify', {
                description:
                    'Minify the bundled output. Defaults to true; use --no-minify to emit pretty-printed code (e.g. for debugging or readable bundle review).',
                type: 'boolean',
                defaultDescription: 'true',
            })
            .option('library', {
                description: 'Use this if you want to build a library for Gjsify',
                type: 'boolean',
                default: false,
            })
            .option('outfile', {
                alias: 'o',
                description:
                    'Sets the output file name for the build operation. If no outfile is specified, the outfile will be parsed from the package.json. Only used if application mode is active',
                type: 'string',
                normalize: true,
            })
            .option('outdir', {
                alias: 'd',
                description:
                    'Sets the output directory for the build operation. If no outdir is specified, the outdir will be parsed from the package.json. Only used if library mode is active',
                type: 'string',
                normalize: true,
            })
            .option('reflection', {
                alias: 'r',
                description: "Enables TypeScript types on runtime using Deepkit's type compiler",
                type: 'boolean',
                default: false,
            })
            .option('log-level', {
                description:
                    'The log level can be changed to prevent esbuild from printing warning and/or error messages to the terminal',
                type: 'string',
                choices: ['silent', 'error', 'warning', 'info', 'debug', 'verbose'],
                default: 'warning',
            })
            .option('dialect', {
                description:
                    "The dialect the SOURCE is written in. 'react-native' aliases 'react-native' onto '@gjsify/react-native' and fails the build on an import whose ADR 0032 support-table status is not supported/partial. GJS and Node app builds. This is NOT gjsify.runtimes['react-native'], which declares the runtime a package RUNS on — the two answer opposite questions.",
                type: 'string',
                choices: [...SOURCE_DIALECTS],
            })
            .option('gi-renderer', {
                description:
                    "Resolve `gi://Ns?version=X` to the target's widget renderer instead of an empty module (ADR 0034 stage 9): --app browser answers gi://Adw and gi://Gtk out of @gjsify/adwaita-web, --app nativescript out of @gjsify/adwaita-nativescript. A namespace with no renderer, and a ?version= the renderer's vocabulary was not generated against, both FAIL the build by name. Off by default — a gi:// import on those targets is usually a GJS-only code path pulled in transitively.",
                type: 'boolean',
            })
            .option('console-shim', {
                description:
                    'Inject a console shim into GJS builds for clean output without the GLib prefix and with working ANSI colors. Use --no-console-shim to disable. Only applies to GJS app builds.',
                type: 'boolean',
                default: true,
            })
            .option('globals', {
                description:
                    "Comma-separated list of global identifiers, 'auto' (default) to detect automatically from the bundled output, or 'none' to disable. The 'auto' token may be combined with explicit identifiers/groups (e.g. 'auto,dom') for cases where the detector cannot statically see a global because it's accessed via indirection. Each identifier is mapped to the corresponding `@gjsify/<pkg>/register` module and injected into the bundle. See the CLI Reference docs for the full list of known identifiers. Only applies to GJS app builds.",
                type: 'string',
                // No yargs `default: 'auto'` — a yargs default is
                // indistinguishable from a user-set value and would always
                // clobber `package.json#gjsify.globals` / `.gjsifyrc.*` in
                // config.ts (same footgun as `entryPoints`/`bundler.input`).
                // The 'auto' fallback is applied post-merge in `Config.forBuild`
                // so precedence is: CLI flag > config file > 'auto'.
            })
            .option('shebang', {
                description:
                    'Prepend a target-appropriate shebang to the output and mark it executable (chmod 755): `#!/usr/bin/env -S gjs -m` for --app gjs, `#!/usr/bin/env node` for --app node. Applies to GJS and Node app builds with a single --outfile. Default: false (use --shebang to enable, or set `shebang: true` in `.gjsifyrc.js`).',
                type: 'boolean',
            })
            .option('external', {
                description:
                    'Module names that should NOT be bundled — EXACT package names only, matched literally on both bundler engines (no globs). Repeat the flag or pass a comma-separated list (e.g. --external typedoc,prettier). Appended to the per-app built-in externals; register subpaths (`<pkg>/register[/…]`) are always force-inlined for --app gjs regardless of this flag.',
                array: true,
                type: 'string',
                default: [] as string[],
                coerce: (arg: string[]) =>
                    arg.flatMap((v) =>
                        v
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                    ),
            })
            .option('define', {
                description:
                    'Substitute compile-time constants. Each entry is KEY=VALUE where VALUE is a JS expression (string literals must be quoted: --define VERSION=\'"1.2.3"\'). Repeat the flag or pass comma-separated. See https://esbuild.github.io/api/#define',
                array: true,
                type: 'string',
                default: [] as string[],
            })
            .option('alias', {
                description:
                    'Map module specifiers at bundle time. Each entry is FROM=TO (e.g. --alias typedoc=@gjsify/empty). Layered on top of the built-in alias map. Useful for stubbing heavy deps the test scenario never executes.',
                array: true,
                type: 'string',
                default: [] as string[],
                coerce: (arg: string[]) =>
                    arg.flatMap((v) =>
                        v
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                    ),
            })
            .option('exclude-globals', {
                description:
                    'Comma-separated global identifiers to remove from auto-detection results. Use for false positives from dead browser-compat code whose polyfills require unavailable native libraries (e.g. --exclude-globals fetch,XMLHttpRequest).',
                type: 'string',
            })
            .option('watch', {
                alias: 'w',
                description:
                    'Watch source files and rebuild on change. Logs each rebuild with duration; clean SIGINT shutdown. Only valid with --app gjs|node|browser (rejected with --library). Requires the npm `rolldown` engine — run under Node, not the GJS-bundled CLI.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        // NOTE: `gjsify build` runs under BOTH Node (npm `rolldown`) and GJS
        // (native `@gjsify/rolldown-native`, PR #483). The Node-free release
        // pipeline dogfoods the GJS path — `gjsify run build` under the
        // GJS-bundled CLI rebuilds the bundle. Do NOT gate this on the runtime.
        const config = new Config();
        const configData = await config.forBuild(args);
        const action = new BuildAction(configData);
        await action.start({
            library: args.library,
            // `configData.app` carries the CLI-flag > config-file > host-default
            // resolution done in `Config.forBuild` (the yargs `--app` default was
            // dropped so the config-file value survives). `BuildAction.start`
            // falls back to 'gjs' only if this is somehow undefined.
            app: configData.app,
            watch: args.watch,
        });
    },
};
