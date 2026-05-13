// `gjsify foreach [flags] <script>` — yarn-workspaces-foreach replacement.
//
// Replaces every `yarn workspaces foreach -A -p --no-private --exclude
// '@girs/*' --topological run build` style invocation in monorepo
// scripts. Flags mirror yarn 4's shape so root package.json scripts can
// move over with a 1:1 substitution.
//
// Output is line-prefixed `[<workspace-name>]` when --parallel is set,
// matching yarn's interactive flow. Exit code is non-zero if any child
// process failed; first failure's stderr is forwarded.

import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import type { Command } from '../types/index.js';
import {
    buildDependencyGraph,
    discoverWorkspaces,
    filterWorkspaces,
    topologicalSort,
    type Workspace,
} from '@gjsify/workspace';

interface ForeachOptions {
    script: string;
    args?: string[];
    all?: boolean;
    parallel?: boolean;
    topological?: boolean;
    'topological-dev'?: boolean;
    include?: string[];
    exclude?: string[];
    private?: boolean;
    verbose?: boolean;
    jobs?: number;
}

export const foreachCommand: Command<any, ForeachOptions> = {
    command: 'foreach <script> [args..]',
    description:
        'Run a workspace script across all (or filtered) workspaces. Drop-in for `yarn workspaces foreach`: -A/--all, -p/--parallel, -t/--topological, --include, --exclude, --no-private.',
    builder: (yargs) =>
        yargs
            .positional('script', {
                description: 'Script name to run in each workspace (`run <name>`-equivalent).',
                type: 'string',
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments forwarded to each child invocation.',
                type: 'string',
                array: true,
            })
            .option('all', {
                description: 'Include workspaces declared as `private: true`.',
                type: 'boolean',
                alias: 'A',
                default: false,
            })
            .option('parallel', {
                description: 'Run workspaces in parallel (capped by --jobs).',
                type: 'boolean',
                alias: 'p',
                default: false,
            })
            .option('topological', {
                description: 'Wait for each workspace\'s deps to finish before starting it (production deps only).',
                type: 'boolean',
                alias: 't',
                default: false,
            })
            .option('topological-dev', {
                description: 'Like --topological but also respects devDependencies (often cyclic — use sparingly).',
                type: 'boolean',
                default: false,
            })
            .option('include', {
                description: 'Glob pattern to include workspaces by name (repeatable).',
                type: 'string',
                array: true,
            })
            .option('exclude', {
                description: 'Glob pattern to exclude workspaces by name (repeatable).',
                type: 'string',
                array: true,
            })
            .option('private', {
                // Yargs auto-negates `--no-private` to `private=false`, so the
                // user-facing flag stays `--no-private` (yarn-compatible).
                description: 'Include private workspaces (default true). Pass --no-private to skip them.',
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description: 'Echo every spawned command before running it.',
                type: 'boolean',
                alias: 'v',
                default: false,
            })
            .option('jobs', {
                description: 'Maximum concurrent workspaces in --parallel mode (default: cpu count).',
                type: 'number',
                alias: 'j',
            }),
    handler: async (args) => {
        const cwd = process.cwd();
        const allWorkspaces = discoverWorkspaces(cwd);

        let selected = filterWorkspaces(allWorkspaces, {
            include: args.include,
            exclude: args.exclude,
            noPrivate: args.private === false,
        });

        // Only run on workspaces that actually have the requested script —
        // yarn does this too, otherwise every project that doesn't declare
        // `<script>` would fail and force the user to `--exclude` it.
        selected = selected.filter((ws) => {
            const scripts = (ws.manifest.scripts as Record<string, string> | undefined) ?? {};
            return typeof scripts[args.script] === 'string';
        });

        if (selected.length === 0) {
            console.log(`gjsify foreach: no workspaces match (script="${args.script}", include=${JSON.stringify(args.include ?? [])}, exclude=${JSON.stringify(args.exclude ?? [])})`);
            return;
        }

        if (args.topological || args['topological-dev']) {
            const graph = buildDependencyGraph(selected, {
                includeDev: args['topological-dev'] === true,
            });
            selected = topologicalSort(graph);
        }

        const cmd = args.script;
        const cmdArgs = args.args ?? [];
        const verbose = args.verbose === true;

        if (args.parallel && !args.topological && !args['topological-dev']) {
            const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
            await runParallel(selected, cmd, cmdArgs, jobs, verbose);
            return;
        }
        if (args.parallel) {
            // Topological + parallel: each workspace starts as soon as its
            // deps (in the selected set) have finished. Yarn calls this
            // "topological order with concurrency"; we cap at --jobs.
            const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
            await runTopologicalParallel(selected, cmd, cmdArgs, jobs, verbose, args['topological-dev'] === true);
            return;
        }
        await runSequential(selected, cmd, cmdArgs, verbose);
    },
};

async function runSequential(
    workspaces: readonly Workspace[],
    script: string,
    args: readonly string[],
    verbose: boolean,
): Promise<void> {
    for (const ws of workspaces) {
        await runOne(ws, script, args, /* prefixOutput */ false, verbose);
    }
}

async function runParallel(
    workspaces: readonly Workspace[],
    script: string,
    args: readonly string[],
    concurrency: number,
    verbose: boolean,
): Promise<void> {
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
        workers.push((async () => {
            while (cursor < workspaces.length) {
                const i = cursor++;
                await runOne(workspaces[i]!, script, args, /* prefixOutput */ true, verbose);
            }
        })());
    }
    await Promise.all(workers);
}

async function runTopologicalParallel(
    workspaces: readonly Workspace[],
    script: string,
    args: readonly string[],
    concurrency: number,
    verbose: boolean,
    includeDev: boolean,
): Promise<void> {
    const selectedNames = new Set(workspaces.map((w) => w.name));
    const remaining = new Map<string, Set<string>>();
    for (const ws of workspaces) {
        const wsDeps = new Set<string>();
        const m = ws.manifest;
        for (const block of [
            m.dependencies,
            includeDev ? m.devDependencies : undefined,
            m.optionalDependencies,
        ]) {
            if (!block) continue;
            for (const [name, spec] of Object.entries(block)) {
                if (typeof spec !== 'string') continue;
                if (!spec.startsWith('workspace:')) continue;
                if (selectedNames.has(name)) wsDeps.add(name);
            }
        }
        remaining.set(ws.name, wsDeps);
    }
    const byName = new Map(workspaces.map((w) => [w.name, w]));
    const done = new Set<string>();
    let inflight = 0;

    return new Promise<void>((resolve, reject) => {
        let error: Error | null = null;
        const pump = (): void => {
            if (error) return;
            while (inflight < concurrency) {
                const ready = [...remaining.entries()]
                    .filter(([, deps]) => [...deps].every((d) => done.has(d)))
                    .map(([n]) => n);
                if (ready.length === 0) break;
                const next = ready.sort()[0]!;
                remaining.delete(next);
                inflight++;
                runOne(byName.get(next)!, script, args, /* prefixOutput */ true, verbose)
                    .then(() => {
                        inflight--;
                        done.add(next);
                        if (remaining.size === 0 && inflight === 0) {
                            resolve();
                            return;
                        }
                        pump();
                    })
                    .catch((e: unknown) => {
                        error = e instanceof Error ? e : new Error(String(e));
                        // Wait for in-flight tasks to finish (yarn does the
                        // same — surfaces all errors instead of abruptly
                        // killing siblings).
                        if (inflight === 0) reject(error);
                    });
            }
            if (remaining.size > 0 && inflight === 0 && !error) {
                reject(new Error(
                    `gjsify foreach --topological: stuck — workspaces ${[...remaining.keys()].join(', ')} have unsatisfied deps in the selected set`,
                ));
            }
        };
        pump();
    });
}

async function runOne(
    ws: Workspace,
    script: string,
    args: readonly string[],
    prefixOutput: boolean,
    verbose: boolean,
): Promise<void> {
    // Use the same package manager that invoked us — yarn under yarn,
    // npm under npm, gjsify under gjsify. Default to `npm` for portability
    // when nothing is detectable; the script-runner (D.5) will replace
    // this once `gjsify run` ships.
    const runner = detectPackageManager();
    const argv = runner === 'gjsify'
        ? ['run', script, ...args]
        : ['run', script, ...(args.length > 0 ? ['--', ...args] : [])];
    if (verbose) {
        console.error(`[${ws.name}] $ ${runner} ${argv.join(' ')}`);
    }
    await spawnPrefixed(runner, argv, ws.location, prefixOutput ? `[${ws.name}] ` : null);
}

function detectPackageManager(): 'yarn' | 'npm' | 'gjsify' {
    // `npm_config_user_agent` is set by npm/yarn/pnpm — first token is
    // `<name>/<version>`. Reuse it so `gjsify foreach build` invoked
    // through `yarn run` keeps using yarn, etc.
    const ua = process.env.npm_config_user_agent ?? '';
    if (ua.startsWith('yarn/')) return 'yarn';
    if (ua.startsWith('gjsify/')) return 'gjsify';
    return 'npm';
}

function spawnPrefixed(
    cmd: string,
    args: readonly string[],
    cwd: string,
    prefix: string | null,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd,
            stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            env: process.env,
        });
        if (prefix && child.stdout && child.stderr) {
            prefixLines(child.stdout, process.stdout, prefix);
            prefixLines(child.stderr, process.stderr, prefix);
        }
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
        child.on('error', (err) => reject(err));
    });
}

function prefixLines(
    src: NodeJS.ReadableStream,
    sink: NodeJS.WritableStream,
    prefix: string,
): void {
    let buf = '';
    src.setEncoding('utf-8');
    src.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
            sink.write(prefix + buf.slice(0, idx + 1));
            buf = buf.slice(idx + 1);
        }
    });
    src.on('end', () => {
        if (buf.length > 0) sink.write(prefix + buf + '\n');
    });
}
