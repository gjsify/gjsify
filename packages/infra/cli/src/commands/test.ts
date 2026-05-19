// `gjsify test` — build + run + aggregate per-runtime test suite.
//
// Eliminates the `build:test:{gjs,node}` + `test:{gjs,node}` + `test`
// script boilerplate that ~110 workspace packages repeat. Each package
// just needs `src/test.mts` aggregating its `@gjsify/unit` suites; this
// command builds it for GJS + Node and runs each output, aggregating
// exit codes.

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
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
                description:
                    'Build before running. Default: true (use --no-build to skip when bundles already exist).',
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
        const configData = await cfg.forBuild({} as never).catch(() => ({} as Record<string, unknown>));
        const testCfg = (configData as { test?: { entry?: string; outdir?: string; runtimes?: Runtime[] } }).test ?? {};

        const entry = resolve(cwd, args.entry ?? testCfg.entry ?? 'src/test.mts');
        const outdir = resolve(cwd, args.outdir ?? testCfg.outdir ?? 'dist');

        if (!existsSync(entry)) {
            console.error(
                `[gjsify test] no test entry at ${relative(cwd, entry)} — ` +
                    `add an \`src/test.mts\` that aggregates your \`@gjsify/unit\` suites, ` +
                    `or set \`gjsify.test.entry\` in package.json.`,
            );
            process.exit(1);
        }

        const requested: Runtime[] =
            args.runtime === 'gjs'
                ? ['gjs']
                : args.runtime === 'node'
                  ? ['node']
                  : (testCfg.runtimes && testCfg.runtimes.length > 0 ? testCfg.runtimes : ['gjs', 'node']);

        const results: Array<{ runtime: Runtime; ok: boolean; durationMs: number; error?: string }> = [];

        for (const runtime of requested) {
            const outfile = join(outdir, `test.${runtime}.mjs`);

            // Build stage (skip if --no-build OR (not --rebuild AND outfile fresher than src)).
            if (args.build !== false) {
                const needsBuild = args.rebuild || !isFresh(outfile, entry, cwd);
                if (needsBuild) {
                    const buildStart = Date.now();
                    if (args.verbose) {
                        console.log(`[gjsify test] building → ${relative(cwd, outfile)} (—app ${runtime})`);
                    }
                    try {
                        await buildTestBundle(entry, outfile, runtime, args.verbose);
                        if (args.verbose) {
                            console.log(
                                `[gjsify test] built ${runtime} in ${Date.now() - buildStart}ms`,
                            );
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
            process.exit(1);
        }
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
    configData.library = { ...(configData.library ?? {}) };
    configData.bundler = {
        ...(configData.bundler ?? {}),
        input: [entry],
        output: { ...(configData.bundler?.output ?? {}), file: outfile },
    } as never;

    const action = new BuildAction(configData);
    await action.start({ app: runtime, library: false });
}

/** Run a single test bundle and reject on non-zero exit. */
async function runTestBundle(outfile: string, runtime: Runtime): Promise<void> {
    if (runtime === 'gjs') {
        await runGjsBundle(outfile);
        return;
    }
    await new Promise<void>((resolvePromise, reject) => {
        const child = spawn('node', [outfile], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`node exited with code ${code}`));
        });
    });
}

/** True when `outfile` exists and is newer than every `.ts`/`.mts` file under the entry's directory tree. */
function isFresh(outfile: string, entry: string, cwd: string): boolean {
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
    void cwd;
}

function newestMtimeUnder(path: string): number {
    const st = statSync(path);
    if (st.isFile()) return st.mtimeMs;
    let max = st.mtimeMs;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib' || entry.name.startsWith('.')) {
            continue;
        }
        const child = join(path, entry.name);
        const m = newestMtimeUnder(child);
        if (m > max) max = m;
    }
    return max;
}
