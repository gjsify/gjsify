// `gjsify webext build|zip|dev` — browser extensions as a project shape
// (ADR 0077). The command owns the folder around the bundles: one per target,
// with a manifest composed for that target, pages, icons, public files and
// locales. The bundles themselves are ordinary `gjsify build --app browser`
// runs, re-entered in-process like `gjsify dev` does.

import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import type { Command } from '../types/index.js';
import { buildWebext, type BundleRequest } from '../utils/webext/build.js';
import { resolveWebextConfig, selectTargets, type ResolvedWebext } from '../utils/webext/config.js';
import {
    defaultDevProfile,
    resolveWebExt,
    WEB_EXT_MISSING,
    webExtRunArgs,
    type WebExtCommand,
} from '../utils/webext/launch.js';
import type { WebextTarget } from '../utils/webext/targets.js';

interface WebextArgs {
    target?: string[];
    outDir?: string;
    define: string[];
    mode?: string;
    launch: boolean;
    browserBinary?: string;
    profile?: string;
    headless: boolean;
    debounce: number;
}

function loadConfig(cwd: string): ResolvedWebext {
    const manifest = join(cwd, 'package.json');
    if (!existsSync(manifest)) throw new Error(`gjsify webext: no package.json in ${cwd}.`);
    return resolveWebextConfig(JSON.parse(readFileSync(manifest, 'utf8')), cwd);
}

/** `--define K=V` entries on top of the config's map, the way `gjsify build` spells them. */
function effectiveDefines(config: ResolvedWebext, flags: readonly string[]): Record<string, string> {
    const out = { ...config.define };
    for (const flag of flags) {
        const at = flag.indexOf('=');
        if (at <= 0) throw new Error(`gjsify webext: --define "${flag}" is not KEY=VALUE.`);
        out[flag.slice(0, at)] = flag.slice(at + 1);
    }
    return out;
}

/** One bundle, through the ordinary build command in this process. */
async function bundleInProcess(request: BundleRequest): Promise<void> {
    const { runCli } = await import('../cli-app.js');
    const argv = ['build', request.entry, '--app', 'browser', '--format', request.format, '--outfile', request.outfile];
    for (const [key, value] of Object.entries(request.define)) argv.push('--define', `${key}=${value}`);
    if (!request.minify) argv.push('--no-minify');
    await runCli(argv);
}

const targetOption = {
    description: 'Build only these targets (default: every target in gjsify.webext.targets).',
    type: 'string',
    array: true,
} as const;
const outDirOption = {
    description: 'Output directory (default: gjsify.webext.outDir, else .output).',
    type: 'string',
} as const;
const defineOption = {
    description: 'Compile-time constant for every bundle, KEY=VALUE (repeatable); wins over gjsify.webext.define.',
    type: 'string',
    array: true,
    default: [] as string[],
} as const;

async function runBuild(args: WebextArgs, zip: boolean): Promise<void> {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const mode = args.mode === 'development' ? 'development' : 'production';
    await buildWebext({
        config,
        targets: selectTargets(config, args.target),
        outDir: args.outDir ? resolve(cwd, args.outDir) : config.outDir,
        mode,
        define: effectiveDefines(config, args.define),
        inPlace: false,
        zip,
        bundle: bundleInProcess,
    });
}

const webextBuildCommand: Command<unknown, WebextArgs> = {
    command: 'build',
    description: 'Build one extension folder per target: bundles, pages, icons, locales and the manifest.',
    builder: (yargs) =>
        yargs
            .option('target', targetOption)
            .option('out-dir', outDirOption)
            .option('define', defineOption)
            .option('mode', {
                description: 'Passed to the manifest as ctx.mode; development also skips minification.',
                type: 'string',
                choices: ['production', 'development'],
                default: 'production',
            }),
    handler: (args) => runBuild(args, false),
};

const webextZipCommand: Command<unknown, WebextArgs> = {
    command: 'zip',
    description: 'Production build, then one store-ready <name>-<version>-<target>.zip per target.',
    builder: (yargs) =>
        yargs.option('target', targetOption).option('out-dir', outDirOption).option('define', defineOption),
    handler: (args) => runBuild(args, true),
};

/** The dev target when none is asked for: the first Firefox target, since web-ext's Firefox driver needs no extra binary. */
function devTarget(config: ResolvedWebext, requested: string[] | undefined): WebextTarget {
    if (requested && requested.length > 1) throw new Error('gjsify webext dev: pass one --target.');
    const [chosen] = selectTargets(config, requested);
    if (requested && requested.length === 1) return chosen as WebextTarget;
    return config.targets.find((t) => t.browser === 'firefox') ?? (chosen as WebextTarget);
}

/**
 * What the loop watches: every top-level directory except `node_modules`,
 * dot-directories and the output, recursively; the project root itself only
 * for its own entries (`manifest.ts`, `package.json`); and `watch` extras.
 */
function devWatchTargets(config: ResolvedWebext, outDir: string): { path: string; recursive: boolean }[] {
    const skip = (name: string): boolean => name === 'node_modules' || name.startsWith('.');
    const out = [{ path: config.root, recursive: false }];
    for (const entry of readdirSync(config.root, { withFileTypes: true })) {
        const full = join(config.root, entry.name);
        if (!entry.isDirectory() || skip(entry.name) || full === outDir || outDir.startsWith(full + sep)) continue;
        out.push({ path: full, recursive: true });
    }
    for (const extra of config.watch) out.push({ path: extra, recursive: true });
    return out;
}

const webextDevCommand: Command<unknown, WebextArgs> = {
    command: 'dev',
    description:
        'Build one target in development mode, launch it in a browser via web-ext, and rebuild in place on change.',
    builder: (yargs) =>
        yargs
            .option('target', {
                ...targetOption,
                description: 'The target to run (default: the first Firefox target).',
            })
            .option('out-dir', { description: 'Output directory (default: <outDir>-dev).', type: 'string' })
            .option('define', defineOption)
            .option('launch', {
                description: 'Start a browser with the extension (--no-launch only rebuilds).',
                type: 'boolean',
                default: true,
            })
            .option('browser-binary', { description: 'Browser executable web-ext should start.', type: 'string' })
            .option('profile', {
                description: 'Browser profile directory (default: $XDG_CACHE_HOME/gjsify/webext/<name>/<target>).',
                type: 'string',
            })
            .option('headless', { description: 'Start the browser without a window.', type: 'boolean', default: false })
            .option('debounce', { description: 'Quiet window in ms before a rebuild.', type: 'number', default: 200 }),
    handler: async (args) => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const target = devTarget(config, args.target);
        const outDir = args.outDir ? resolve(cwd, args.outDir) : `${config.outDir}-dev`;
        const define = effectiveDefines(config, args.define);
        const sourceDir = join(outDir, target.id);

        let webExt: WebExtCommand | null = null;
        if (args.launch) {
            webExt = resolveWebExt(cwd);
            if (webExt === null) throw new Error(WEB_EXT_MISSING);
        }

        let browser: ChildProcess | null = null;
        const stopBrowser = (): void => {
            browser?.kill();
        };
        // Registered BEFORE the loop's own handlers, which end in process.exit.
        process.on('SIGINT', stopBrowser);
        process.on('SIGTERM', stopBrowser);

        const launch = async (): Promise<void> => {
            if (webExt === null || browser !== null) return;
            const profile = args.profile ? resolve(cwd, args.profile) : defaultDevProfile(config.name, target);
            // web-ext creates the profile directory but not its parent (ENOENT on a fresh machine).
            mkdirSync(dirname(profile), { recursive: true });
            const argv = webExtRunArgs({
                sourceDir,
                target,
                profile,
                browserBinary: args.browserBinary,
                headless: args.headless,
            });
            console.log(`[webext] launching ${target.id} with profile ${profile}`);
            const { spawnSupervised } = await import('../utils/watch-loop.js');
            browser = await spawnSupervised(webExt.cmd, argv, webExt.env);
            browser.on('exit', (code) => {
                console.log(`[webext] browser closed (${code ?? 0}) — stopping`);
                process.exit(0);
            });
        };

        const { runWatchLoop } = await import('../utils/watch-loop.js');
        await runWatchLoop({
            dir: cwd,
            dirLabel: '.',
            label: 'webext',
            watch: devWatchTargets(config, outDir),
            ignore: (changed) => changed === outDir || changed.startsWith(outDir + sep),
            build: async () => {
                await buildWebext({
                    config,
                    targets: [target],
                    outDir,
                    mode: 'development',
                    define,
                    inPlace: true,
                    zip: false,
                    bundle: bundleInProcess,
                });
                // After the first SUCCESSFUL build: web-ext on a folder with no manifest.json exits at once.
                await launch();
            },
            spawnChild: null,
            debounceMs: args.debounce,
        });
    },
};

export const webextCommand: Command = {
    command: 'webext <subcommand>',
    description: 'Browser extensions: build, zip and develop one WebExtension for Chrome, Edge, Firefox and Safari.',
    builder: (yargs) =>
        yargs
            .command(
                webextBuildCommand.command as string,
                webextBuildCommand.description,
                webextBuildCommand.builder!,
                webextBuildCommand.handler!,
            )
            .command(
                webextZipCommand.command as string,
                webextZipCommand.description,
                webextZipCommand.builder!,
                webextZipCommand.handler!,
            )
            .command(
                webextDevCommand.command as string,
                webextDevCommand.description,
                webextDevCommand.builder!,
                webextDevCommand.handler!,
            )
            .demandCommand(1)
            .strict(),
};
