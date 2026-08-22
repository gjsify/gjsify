// `gjsify dev` — the inner development loop: watch, rebuild, relaunch.
//
// It exists because `gjsify build --watch` cannot serve it on the host that
// needs it most. That flag drives rolldown's watcher API, which only the npm
// engine exposes (`bundler-pick.ts` refuses under `@gjsify/rolldown-native`), so
// on a Node-free GJS host the loop was manual: edit, Ctrl-C, rebuild, relaunch.
// `gjsify storybook --watch` had already shown the way around it — watch with
// `fs.watch` and rebuild by re-entering the ordinary build command, which needs
// no watcher API and is runtime-agnostic. That loop is now shared
// (`utils/watch-loop.ts`) and this command is its second caller.
//
// WHAT to build is not re-declared here: it is read out of the project's own
// `build:gjs` / `build:node` script (`utils/dev-plan.ts`), so the dev loop and
// `gjsify run build` cannot drift into building different bundles.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { type DevPlan, noBundleError, planDev } from '../utils/dev-plan.js';
import { buildAppForRuntime, type ExampleRuntime, EXAMPLE_RUNTIMES } from '../utils/runtimes.js';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';

interface DevCliOptions {
    entry?: string;
    runtime?: string;
    script?: string;
    globals?: string;
    outfile?: string;
    watchDir?: string;
    debounce: number;
    buildOnly: boolean;
}

interface ProjectPackage {
    scripts?: Record<string, string>;
    gjsify?: { main?: string; example?: { node?: string } };
}

function readPackage(cwd: string): ProjectPackage {
    try {
        return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as ProjectPackage;
    } catch {
        // A missing or malformed package.json is not this command's error to
        // report: `planDev` refuses right after, naming the flags that make
        // `gjsify dev` work in a directory with no manifest at all.
        return {};
    }
}

export const devCommand: Command<unknown, DevCliOptions> = {
    command: 'dev [entry]',
    description: 'Watch this project, rebuild on change and relaunch the app.',
    builder: (yargs) =>
        yargs
            .positional('entry', {
                description:
                    'Entry point to build (default: the one the build script names, e.g. src/index.ts from `build:gjs`).',
                type: 'string',
            })
            .option('runtime', {
                description:
                    'Runtime to build for and launch on: gjs | node | bun | deno (default: the host runtime). ' +
                    'node/bun/deno build the same `--app node` bundle.',
                type: 'string',
                choices: EXAMPLE_RUNTIMES as readonly string[],
                // No yargs `default` — the host default is applied in the
                // handler, so `hostRuntime()` is evaluated where it can be seen.
                defaultDescription: 'host runtime (gjs on gjs, else node/bun/deno)',
            })
            .option('script', {
                description:
                    'package.json script the build flags are read from (default: build:gjs, or build:node for node/bun/deno).',
                type: 'string',
            })
            .option('globals', { description: 'Override the build script `--globals` value.', type: 'string' })
            .option('outfile', { description: 'Override the build script `--outfile` path.', type: 'string' })
            .option('watch-dir', {
                description: 'Directory watched recursively (default: the directory of the entry point).',
                type: 'string',
            })
            .option('debounce', {
                description: 'Quiet window in ms after a change before rebuilding.',
                type: 'number',
                default: 200,
            })
            .option('build-only', {
                description: 'Rebuild on every change but never launch the app.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const cwd = process.cwd();
        const pkg = readPackage(cwd);

        // The cast, not a guard: yargs' `choices` above already rejects anything
        // outside the four, and `hostRuntime()` returns exactly that union — a
        // second check here would be validating our own vocabulary.
        const runtime = (args.runtime ?? hostRuntime()) as ExampleRuntime;
        const app = buildAppForRuntime(runtime);

        const scriptName = args.script ?? (app === 'gjs' ? 'build:gjs' : 'build:node');
        let plan: DevPlan;
        try {
            plan = planDev({
                scripts: pkg.scripts ?? {},
                scriptName,
                app,
                declaredBundle: app === 'gjs' ? pkg.gjsify?.main : pkg.gjsify?.example?.node,
                entry: args.entry,
                globals: args.globals,
                outfile: args.outfile,
                watchDir: args.watchDir,
            });
        } catch (err) {
            console.error((err as Error).message);
            // `return process.exit()`: under GJS a bare `process.exit()` only
            // SCHEDULES the exit and returns, so execution would fall through
            // into the watch loop and the deferred exit would never carry its
            // code. Same trap as `showcase.ts` / `storybook.ts`.
            return process.exit(1);
        }

        const bundlePath = plan.bundle === undefined ? undefined : resolve(cwd, plan.bundle);
        if (bundlePath === undefined && !args.buildOnly) {
            console.error(noBundleError(scriptName, app).message);
            return process.exit(1);
        }
        const watchDir = resolve(cwd, plan.watchDir);
        if (!existsSync(watchDir)) {
            // `fs.watch` on a missing directory throws a bare ENOENT with the
            // path buried in a stack — say which directory was DERIVED and how
            // to override it instead.
            console.error(
                `gjsify dev: nothing to watch — ${relative(cwd, watchDir) || watchDir} does not exist.\n` +
                    `  Point the loop at your sources:   gjsify dev --watch-dir <dir>`,
            );
            return process.exit(1);
        }
        const target = bundlePath === undefined ? `\`${scriptName}\` output` : relative(cwd, bundlePath);
        console.log(`Watching ${relative(cwd, watchDir) || '.'} → ${target} (runtime: ${runtime})`);

        // In-process build — runtime-agnostic (Node uses npm rolldown, GJS the
        // @gjsify/rolldown-native facade), no re-spawn of the CLI binary.
        const { runCli } = await import('../cli-app.js');
        const { runWatchLoop, spawnBundleSupervised } = await import('../utils/watch-loop.js');

        await runWatchLoop({
            dir: watchDir,
            dirLabel: relative(cwd, watchDir) || '.',
            label: 'dev',
            build: () => runCli(plan.buildArgv),
            spawnChild:
                args.buildOnly || bundlePath === undefined
                    ? null
                    : () => spawnBundleSupervised(runtime, bundlePath, cwd, 'this project'),
            // Passed even under `--build-only`: what makes the loop feed itself
            // is the WRITE, not the launch.
            output: bundlePath,
            debounceMs: args.debounce,
        });
    },
};
