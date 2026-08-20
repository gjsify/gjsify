// `gjsify test` — build + run + aggregate per-runtime test suite.
//
// Eliminates the `build:test:{gjs,node}` + `test:{gjs,node}` + `test`
// script boilerplate that ~110 workspace packages repeat. Each package
// just needs `src/test.mts` aggregating its `@gjsify/unit` suites; this
// command builds it for GJS + Node and runs each output, aggregating
// exit codes.

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { isRuntimeAvailable, RUNTIMES } from '../utils/runtimes.js';
import { nodeBinary } from '../utils/run-node.js';
import { describeExit, spawnToCompletion } from '../utils/spawn.js';
import type { Command } from '../types/index.js';
import { Config } from '../config.js';
import { BuildAction } from '../actions/build.js';
import { runGjsBundle } from '../utils/run-gjs.js';

type Runtime = 'gjs' | 'node';

interface TestOptions {
    runtime?: Runtime | 'all';
    entry?: string;
    outdir?: string;
    rebuild?: boolean;
    build?: boolean;
    verbose?: boolean;
}

export const testCommand: Command<unknown, TestOptions> = {
    command: 'test',
    description:
        'Build + run the package’s `src/test.mts` suite on GJS and Node and aggregate the results. Replaces the per-package `build:test:{gjs,node}` + `test:{gjs,node}` script boilerplate.',
    builder: (yargs) => {
        return yargs
            .option('runtime', {
                description: 'Target runtime. Default: both.',
                type: 'string',
                choices: ['gjs', 'node', 'all'],
                default: 'all',
            })
            .option('entry', {
                description: 'Path to the test entry. Default: `src/test.mts` (or `gjsify.test.entry`).',
                type: 'string',
                normalize: true,
            })
            .option('outdir', {
                description: 'Output directory for the built test bundles. Default: `dist/`.',
                type: 'string',
                normalize: true,
            })
            .option('rebuild', {
                description: 'Always rebuild the test bundles, even when they look up-to-date.',
                type: 'boolean',
                default: false,
            })
            .option('build', {
                description: 'Build before running. Default: true (use --no-build to skip when bundles already exist).',
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description: 'Print resolved entry/outdir + per-step timing.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();

        // Resolve config: gjsify.test.{entry,outdir,runtimes}.
        const cfg = new Config();
        const configData = await cfg.forBuild({} as never).catch(() => ({}) as Record<string, unknown>);
        const testCfg = (configData as { test?: { entry?: string; outdir?: string; runtimes?: Runtime[] } }).test ?? {};

        const entry = resolve(cwd, args.entry ?? testCfg.entry ?? 'src/test.mts');
        const outdir = resolve(cwd, args.outdir ?? testCfg.outdir ?? 'dist');

        if (!existsSync(entry)) {
            console.error(
                `[gjsify test] no test entry at ${relative(cwd, entry)} — ` +
                    `add an \`src/test.mts\` that aggregates your \`@gjsify/unit\` suites, ` +
                    `or set \`gjsify.test.entry\` in package.json.`,
            );
            // `return` — a bare `process.exit()` is deferred under GJS and the
            // handler would try to build the missing entry anyway.
            return process.exit(1);
        }

        // EXPLICIT (`--runtime node`) vs DEFAULT (`all`, or a package's declared
        // set) is the whole distinction here, and it decides what an absent
        // runtime means. Asked for by name, its absence is the answer to the
        // question and must fail loudly. Reached only because it is in the
        // default set, its absence is a fact about the host — and failing there
        // reports a PASSING suite as a failed run: on a Node-less GJS host
        // (postmarketOS/aarch64, gjs 1.88, no node) `gjsify test` printed
        // `✅ gjs (267ms)  ❌ node (27ms) — spawn node ENOENT` for a suite whose
        // every assertion passed.
        const explicit = args.runtime === 'gjs' || args.runtime === 'node';
        const requested: Runtime[] =
            args.runtime === 'gjs'
                ? ['gjs']
                : args.runtime === 'node'
                  ? ['node']
                  : testCfg.runtimes && testCfg.runtimes.length > 0
                    ? testCfg.runtimes
                    : ['gjs', 'node'];

        // Skipping is NOT silent — a skipped runtime is reported, so "tests
        // passed" never quietly means "on fewer runtimes than you think".
        const runnable = explicit ? requested : requested.filter((rt) => isRuntimeAvailable(rt));
        for (const rt of requested.filter((rt) => !runnable.includes(rt))) {
            console.log(
                `[gjsify test] skipping ${rt} — no \`${RUNTIMES[rt].probe}\` on PATH (not requested explicitly)`,
            );
        }
        if (runnable.length === 0) {
            console.error(
                `[gjsify test] none of the default runtimes (${requested.join(', ')}) is available on this host.\n` +
                    `  Install one, or pin the set: \`gjsify test --runtime <rt>\` / \`gjsify.test.runtimes\` in package.json.`,
            );
            return process.exit(1);
        }

        const results: Array<{ runtime: Runtime; ok: boolean; durationMs: number; error?: string }> = [];

        for (const runtime of runnable) {
            const outfile = join(outdir, `test.${runtime}.mjs`);

            // Build stage (skip if --no-build OR (not --rebuild AND outfile fresher than src)).
            if (args.build !== false) {
                const needsBuild = args.rebuild || !isFresh(outfile, entry);
                if (needsBuild) {
                    const buildStart = Date.now();
                    if (args.verbose) {
                        console.log(`[gjsify test] building → ${relative(cwd, outfile)} (—app ${runtime})`);
                    }
                    try {
                        await buildTestBundle(entry, outfile, runtime, args.verbose);
                        if (args.verbose) {
                            console.log(`[gjsify test] built ${runtime} in ${Date.now() - buildStart}ms`);
                        }
                    } catch (err) {
                        console.error(`[gjsify test] build failed for ${runtime}:`, (err as Error).message);
                        results.push({ runtime, ok: false, durationMs: 0, error: 'build failed' });
                        continue;
                    }
                } else if (args.verbose) {
                    console.log(
                        `[gjsify test] ${runtime}: bundle is up-to-date — skipping build (use --rebuild to force)`,
                    );
                }
            } else if (!existsSync(outfile)) {
                console.error(
                    `[gjsify test] --no-build but ${relative(cwd, outfile)} doesn't exist. ` +
                        `Build first or drop --no-build.`,
                );
                results.push({ runtime, ok: false, durationMs: 0, error: 'no bundle' });
                continue;
            }

            // Run stage.
            const runStart = Date.now();
            try {
                await runTestBundle(outfile, runtime);
                results.push({ runtime, ok: true, durationMs: Date.now() - runStart });
            } catch (err) {
                results.push({
                    runtime,
                    ok: false,
                    durationMs: Date.now() - runStart,
                    error: (err as Error).message,
                });
            }
        }

        // Summary + aggregate exit.
        const summary = results
            .map((r) => `${r.ok ? '✅' : '❌'} ${r.runtime} (${r.durationMs}ms)${r.error ? ` — ${r.error}` : ''}`)
            .join('  ');
        console.log(`[gjsify test] ${summary}`);

        const anyFailed = results.some((r) => !r.ok);
        if (anyFailed) {
            // `return` — the deferred GJS exit otherwise fell through to the
            // success `process.exit(0)` below, clobbering the failure code.
            return process.exit(1);
        }
        // Explicit success exit: under GJS the spawn-armed main loop would
        // otherwise park this process after the summary. (runGjsBundle
        // deliberately does NOT exit mid-flow — an unconditional exit there
        // truncated this multi-runtime loop after the first gjs bundle.)
        process.exit(0);
    },
};

/** Build a single test bundle in-process via `BuildAction`. */
async function buildTestBundle(
    entry: string,
    outfile: string,
    runtime: Runtime,
    verbose: boolean | undefined,
): Promise<void> {
    const config = new Config();
    // forBuild's interactive prompts are skipped because we pass through
    // ArgumentsCamelCase shape with only the relevant fields.
    const configData = await config.forBuild({
        entryPoints: [entry],
        outfile,
        app: runtime,
        verbose: verbose ?? false,
        logLevel: 'warning',
        exclude: [],
    } as never);

    // Override bundler entry-input so gjsify.test.entry doesn't fight with
    // gjsify.bundler.input. The build action picks `output.file` straight from
    // the merged config; we set it explicitly here so package.json#main /
    // bundler.output.file from the surrounding project don't redirect the
    // bundle elsewhere.
    configData.library = { ...configData.library };
    configData.bundler = {
        ...configData.bundler,
        input: [entry],
        output: { ...configData.bundler?.output, file: outfile },
    } as never;

    const action = new BuildAction(configData);
    await action.start({ app: runtime, library: false });
}

/** Run a single test bundle and reject on non-zero exit. */
async function runTestBundle(outfile: string, runtime: Runtime): Promise<void> {
    if (runtime === 'gjs') {
        // `completion: 'exit'` (this handler ends in `process.exit`) WITHOUT
        // `exitOnSuccess`: the two answer different questions, and exiting here
        // would truncate the multi-runtime loop after the first bundle.
        await runGjsBundle(outfile, [], { completion: 'exit' });
        return;
    }
    // `nodeBinary()`, never a bare `'node'`: under GJS `process.execPath` is
    // the `gjs` interpreter, which cannot run a `--app node` bundle, and on a
    // host without Node a bare literal dies `spawn node ENOENT` — which is
    // how a fully passing GJS suite was reported as a failed run.
    const result = await spawnToCompletion(nodeBinary(), [outfile], { completion: 'exit' });
    if (result.code !== 0) throw new Error(`node exited with ${describeExit(result)}`);
}

/** True when `outfile` exists and is newer than every `.ts`/`.mts` file under the entry's directory tree. */
function isFresh(outfile: string, entry: string): boolean {
    if (!existsSync(outfile)) return false;
    const outMtime = statSync(outfile).mtimeMs;
    const srcRoot = dirname(entry);
    // Conservative: walk the src tree once. If the package has no `src/`,
    // fall back to entry-only check.
    try {
        const newest = newestMtimeUnder(existsSync(srcRoot) ? srcRoot : entry);
        return outMtime >= newest;
    } catch {
        // On any FS error, force rebuild to stay safe.
        return false;
    }
}

function newestMtimeUnder(path: string): number {
    const st = statSync(path);
    if (st.isFile()) return st.mtimeMs;
    let max = st.mtimeMs;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === 'lib' ||
            entry.name.startsWith('.')
        ) {
            continue;
        }
        const child = join(path, entry.name);
        const m = newestMtimeUnder(child);
        if (m > max) max = m;
    }
    return max;
}
