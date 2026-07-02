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

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import type { Command } from '../types/index.js';
import {
    buildDependencyGraph,
    discoverWorkspaces,
    filterWorkspaces,
    topologicalSort,
    type Workspace,
} from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { prefixLines } from '../utils/prefixed-output.js';
import { BuildCacheRunner, buildCacheEnabledByEnv } from '../utils/build-cache.js';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';

// Every child spawned by spawnPrefixed registers here so fail-fast can
// terminate the whole in-flight set instead of waiting on it. On CI a
// single failed package used to leave foreach awaiting its still-running
// siblings — whose nested gjs chains can stall for hours (issue #497).
const activeChildren = new Set<ChildProcess>();

// Grace window between SIGTERM and the SIGKILL escalation.
const KILL_GRACE_MS = 5_000;
// Hard deadline for the in-flight set to drain after a fail-fast kill. A
// killed child whose grandchildren inherit (and keep open) the stdio pipe
// never emits 'close', so we must not wait on it unboundedly.
const DRAIN_DEADLINE_MS = 15_000;

// Read the direct child PIDs of `pid` from /proc/<pid>/task/*/children
// (Linux, CONFIG_PROC_CHILDREN — standard on every mainstream kernel). When
// the per-task children files are unavailable, fall back to one full
// /proc/*/stat scan building a ppid→children map. Both paths use only
// `node:fs` reads, so they behave identically under Node and GJS
// (@gjsify/fs) — unlike a process-group kill, which GJS cannot issue
// (`@gjsify/process.kill` shells out `kill <sig> <pid>` where a negative
// PID parses as an option, and Gio.Subprocess has no group-signal API).
function readDirectChildren(pid: number): number[] | null {
    let taskIds: string[];
    try {
        taskIds = readdirSync(`/proc/${pid}/task`);
    } catch {
        // Process already gone (common) or /proc unavailable.
        return null;
    }
    const kids: number[] = [];
    let readAny = false;
    for (const tid of taskIds) {
        try {
            const data = readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf-8');
            readAny = true;
            for (const tok of data.trim().split(/\s+/)) {
                const n = Number(tok);
                if (Number.isInteger(n) && n > 0) kids.push(n);
            }
        } catch {
            // Thread vanished mid-walk, or kernel lacks CONFIG_PROC_CHILDREN.
        }
    }
    return readAny ? kids : null;
}

// Fallback: scan every /proc/<pid>/stat once and build ppid → children.
// O(#processes) small reads — fine for the rare kill path.
function buildPpidMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    let entries: string[] = [];
    try {
        entries = readdirSync('/proc');
    } catch {
        return map;
    }
    for (const entry of entries) {
        const pid = Number(entry);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
            // comm (field 2) may contain spaces/parens — parse after last ')'.
            const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const ppid = Number(rest[1]);
            if (!Number.isInteger(ppid) || ppid <= 0) continue;
            const siblings = map.get(ppid);
            if (siblings) siblings.push(pid);
            else map.set(ppid, [pid]);
        } catch {
            // Process exited between readdir and read — fine.
        }
    }
    return map;
}

// Snapshot every transitive descendant of `pid`, breadth-first (so
// reversing the list yields deepest-first order for signalling).
function collectDescendants(pid: number): number[] {
    const result: number[] = [];
    const seen = new Set<number>([pid]);
    const queue = [pid];
    let ppidMap: Map<number, number[]> | null = null;
    while (queue.length > 0) {
        const cur = queue.shift()!;
        let kids = readDirectChildren(cur);
        if (kids === null) {
            // children files unreadable — use (and lazily build) the
            // full-scan fallback for this and subsequent levels.
            ppidMap ??= buildPpidMap();
            kids = ppidMap.get(cur) ?? [];
        }
        for (const kid of kids) {
            if (seen.has(kid)) continue;
            seen.add(kid);
            result.push(kid);
            queue.push(kid);
        }
    }
    return result;
}

// Signal an already-collected descendant set deepest-first, then the direct
// child itself. Snapshot-then-signal (not signal-while-walking) so killing
// the parent can't orphan grandchildren before we enumerated them. The
// snapshot has the usual tree-kill PID-reuse race (a descendant exits and
// the kernel recycles its PID before our signal lands) — accepted, same as
// Node's tree-kill packages; the window is milliseconds.
function signalTree(child: ChildProcess, descendants: readonly number[], signal: 'SIGTERM' | 'SIGKILL'): void {
    for (let i = descendants.length - 1; i >= 0; i--) {
        try {
            process.kill(descendants[i]!, signal);
        } catch {
            // already gone — fine
        }
    }
    try {
        child.kill(signal);
    } catch {
        // already gone — fine
    }
}

function killActiveChildren(): void {
    // The direct child is `npm run <script>` — killing only it leaves the
    // npm-spawned shell → gjs/node build grandchildren alive (observed: an
    // orphaned gjs bundler at 100% CPU for 19+ min after a fail-fast kill).
    // So terminate the whole process TREE of each child via a /proc walk.
    const termSnapshots = new Map<ChildProcess, number[]>();
    for (const child of activeChildren) {
        const descendants = child.pid ? collectDescendants(child.pid) : [];
        termSnapshots.set(child, descendants);
        signalTree(child, descendants, 'SIGTERM');
    }
    const escalate = setTimeout(() => {
        for (const child of activeChildren) {
            // Union a FRESH walk (catches processes spawned after the TERM)
            // with the TERM-time snapshot (catches survivors that were
            // reparented to init when their parent died on SIGTERM — a
            // fresh walk from child.pid can no longer see those).
            const union = new Set<number>(child.pid ? collectDescendants(child.pid) : []);
            for (const pid of termSnapshots.get(child) ?? []) union.add(pid);
            signalTree(child, [...union], 'SIGKILL');
        }
    }, KILL_GRACE_MS);
    // Don't let the escalation timer keep the process alive (Node returns a
    // Timeout with unref(); GJS returns a plain handle without it).
    (escalate as { unref?: () => void }).unref?.();
}

interface ForeachOptions {
    script?: string;
    args?: string[];
    all?: boolean;
    parallel?: boolean;
    topological?: boolean;
    'topological-dev'?: boolean;
    include?: string[];
    exclude?: string[];
    shard?: string;
    private?: boolean;
    verbose?: boolean;
    jobs?: number;
    exec?: boolean;
    cached?: boolean;
}

export const foreachCommand: Command<unknown, ForeachOptions> = {
    command: 'foreach [script] [args..]',
    description:
        'Run a workspace script across all (or filtered) workspaces. Drop-in for `yarn workspaces foreach`: -A/--all, -p/--parallel, -t/--topological, --include, --exclude, --no-private. Pass --exec to run an arbitrary command instead of a script.',
    builder: (yargs) =>
        yargs
            .positional('script', {
                description:
                    'Script name to run in each workspace (`run <name>`-equivalent). With --exec, the command to run instead.',
                type: 'string',
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
                description: "Wait for each workspace's deps to finish before starting it (production deps only).",
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
            })
            .option('exec', {
                description:
                    'Treat <script> [args..] as an arbitrary command (yarn `workspaces foreach exec`-equivalent) instead of a package.json script lookup. Workspace filtering by script presence is skipped. Use `-- <cmd> <args...>` to pass flags to the command without yargs intercepting them.',
                type: 'boolean',
                default: false,
            })
            .option('cached', {
                description:
                    'Content-hash build cache (ADR 0006): skip a workspace whose inputs (src/**, package.json, tsconfig*.json, transitive workspace deps, toolchain versions) are unchanged and restore its stored outputs instead; on miss run the script and store the output dirs it modified. Script mode only. Default from GJSIFY_BUILD_CACHE=1.',
                type: 'boolean',
            })
            .option('shard', {
                description:
                    'Run only a deterministic slice "<index>/<total>" (1-based) of the matched workspaces, e.g. --shard 2/4. For fanning a long run across parallel CI jobs. Partitions by sorted name (round-robin) so the shards are disjoint and their union is the full set; order-independent, so safe for tests but NOT for ordered builds.',
                type: 'string',
            })
            .parserConfiguration({
                // Preserve `--` as args._['--'] so callers can write
                //   gjsify foreach --exec -- npm publish --tag latest
                // without yargs grabbing --tag/--access/etc.
                'populate--': true,
            }),
    handler: async (args) => {
        // Walk up to the monorepo root — foreach is sometimes invoked
        // from inside a child workspace's script chain.
        const cwd = findWorkspaceRoot(process.cwd()) ?? process.cwd();
        const allWorkspaces = discoverWorkspaces(cwd);

        const exec = args.exec === true;

        // In --exec mode, support both
        //   gjsify foreach --exec npm something          (no flags in command)
        //   gjsify foreach --exec -- npm publish --tag X (flags in command)
        // The `--` form is the typical one: `populate--: true` puts the
        // post-separator argv into args._['--'], where yargs cannot grab
        // --tag/--access/etc. as its own options.
        let cmd: string | undefined = args.script;
        let cmdArgs: readonly string[] = args.args ?? [];
        if (!exec) {
            // Script mode silently DROPPED everything after `--` (only --exec
            // consumed args['--']). Forward them to each child invocation,
            // matching `yarn workspaces foreach run <script> -- <flags>`.
            const fromDoubleDash = (((args as Record<string, unknown>)['--'] as unknown[]) ?? []).filter(
                (v): v is string => typeof v === 'string',
            );
            if (fromDoubleDash.length > 0) cmdArgs = [...cmdArgs, ...fromDoubleDash];
        }
        if (exec) {
            // With populate--:true, anything after the literal `--`
            // separator lands in top-level args['--']. yargs DOES NOT
            // attach it to args._ — it's a sibling array.
            const fromDoubleDash = (((args as Record<string, unknown>)['--'] as unknown[]) ?? []).filter(
                (v): v is string => typeof v === 'string',
            );
            if (fromDoubleDash.length > 0) {
                if (!cmd) {
                    cmd = fromDoubleDash[0]!;
                    cmdArgs = [...cmdArgs, ...fromDoubleDash.slice(1)];
                } else {
                    cmdArgs = [...cmdArgs, ...fromDoubleDash];
                }
            }
            if (!cmd) {
                console.error(
                    'gjsify foreach --exec: missing command. Pass it after `--`, e.g. `gjsify foreach --exec -- npm publish --tag latest`.',
                );
                process.exit(1);
            }
        }

        let selected = filterWorkspaces(allWorkspaces, {
            include: args.include,
            exclude: args.exclude,
            noPrivate: args.private === false,
        });

        // In script mode, only run on workspaces that actually have the
        // requested script — yarn does this too, otherwise every project
        // that doesn't declare `<script>` would fail and force the user to
        // `--exclude` it. In --exec mode the command runs unconditionally
        // (yarn's `workspaces foreach exec` semantics).
        if (!exec) {
            if (!cmd) {
                console.error(
                    'gjsify foreach: missing <script> positional. Pass --exec to run an arbitrary command instead.',
                );
                process.exit(1);
            }
            const scriptName = cmd;
            selected = selected.filter((ws) => {
                const scripts = (ws.manifest.scripts as Record<string, string> | undefined) ?? {};
                return typeof scripts[scriptName] === 'string';
            });
        }

        // Optional sharding: run only a deterministic slice of the matched set,
        // for fanning a long foreach (e.g. tests) across N parallel CI jobs.
        // "<index>/<total>", 1-based. Partition by sorted name, round-robin, so
        // the shards are disjoint and their union is exactly the full matched
        // set with even-ish balance. Applied AFTER include/exclude + the
        // script-presence filter so each shard is a slice of the actually-
        // runnable set. Order-independent → safe for tests, NOT for ordered
        // builds (it runs before the topological sort below, which then just
        // orders whatever this shard kept).
        if (typeof args.shard === 'string' && args.shard.length > 0) {
            const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(args.shard);
            if (!m) {
                console.error(
                    `gjsify foreach: invalid --shard "${args.shard}" — expected "<index>/<total>" (1-based), e.g. 2/4.`,
                );
                process.exit(1);
            }
            const index = Number(m[1]);
            const total = Number(m[2]);
            if (total < 1 || index < 1 || index > total) {
                console.error(
                    `gjsify foreach: invalid --shard "${args.shard}" — need 1 <= index <= total and total >= 1.`,
                );
                process.exit(1);
            }
            if (total > 1) {
                const byName = [...selected].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
                selected = byName.filter((_, i) => i % total === index - 1);
                console.log(
                    `gjsify foreach: shard ${index}/${total} → ${selected.length} of ${byName.length} workspace(s)`,
                );
            }
        }

        if (selected.length === 0) {
            console.log(
                `gjsify foreach: no workspaces match (${exec ? 'exec' : 'script'}="${cmd}", include=${JSON.stringify(args.include ?? [])}, exclude=${JSON.stringify(args.exclude ?? [])})`,
            );
            return;
        }

        if (args.topological || args['topological-dev']) {
            const graph = buildDependencyGraph(selected, {
                includeDev: args['topological-dev'] === true,
            });
            selected = topologicalSort(graph);
        }

        const verbose = args.verbose === true;
        // `cmd` is guaranteed string at this point — both branches above
        // exit on undefined, but TS doesn't narrow through them.
        const finalCmd = cmd!;

        // Content-hash build cache (ADR 0006 phase 1). Explicit --cached /
        // --no-cached wins; GJSIFY_BUILD_CACHE=1 is the env default so a
        // whole root-script chain (`gjsify run build`) can opt in without
        // editing every nested invocation. Keys are computed against ALL
        // discovered workspaces (a dep outside the --include filter still
        // participates in its dependents' keys).
        const cached = args.cached ?? buildCacheEnabledByEnv();
        if (args.cached === true && exec) {
            // Only the EXPLICIT flag errors — the GJSIFY_BUILD_CACHE env
            // default covers whole script chains (CI sets it once for the
            // build job) where an --exec invocation is simply not cacheable.
            console.error('gjsify foreach: --cached only applies to script mode, not --exec.');
            process.exit(1);
        }
        const cache =
            cached && !exec
                ? new BuildCacheRunner({
                      root: cwd,
                      workspaces: allWorkspaces,
                      script: finalCmd,
                      args: cmdArgs,
                      targets: selected.map((w) => w.name),
                  })
                : undefined;

        try {
            if (args.parallel && !args.topological && !args['topological-dev']) {
                const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
                await runParallel(selected, finalCmd, cmdArgs, jobs, verbose, exec, cache);
            } else if (args.parallel) {
                // Topological + parallel: each workspace starts as soon as its
                // deps (in the selected set) have finished. Yarn calls this
                // "topological order with concurrency"; we cap at --jobs.
                const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
                await runTopologicalParallel(
                    selected,
                    finalCmd,
                    cmdArgs,
                    jobs,
                    verbose,
                    args['topological-dev'] === true,
                    exec,
                    cache,
                );
            } else {
                await runSequential(selected, finalCmd, cmdArgs, verbose, exec, cache);
            }
        } catch (err) {
            // Plain --parallel rejects on the FIRST failure (Promise.all) while
            // sibling children are still running — terminate them so we don't
            // leave orphans holding the CI step's stdio open.
            killActiveChildren();
            console.error((err as Error).message);
            process.exit(1);
        }
        // ensureMainLoop() (called inside spawn) keeps GJS alive after every
        // child exits — without an explicit process.exit() the success path
        // would park the loop forever.
        process.exit(0);
    },
};

async function runSequential(
    workspaces: readonly Workspace[],
    script: string,
    args: readonly string[],
    verbose: boolean,
    exec: boolean,
    cache?: BuildCacheRunner,
): Promise<void> {
    for (const ws of workspaces) {
        await runOne(ws, script, args, /* prefixOutput */ false, verbose, exec, cache);
    }
}

async function runParallel(
    workspaces: readonly Workspace[],
    script: string,
    args: readonly string[],
    concurrency: number,
    verbose: boolean,
    exec: boolean,
    cache?: BuildCacheRunner,
): Promise<void> {
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
        workers.push(
            (async () => {
                while (cursor < workspaces.length) {
                    const i = cursor++;
                    await runOne(workspaces[i]!, script, args, /* prefixOutput */ true, verbose, exec, cache);
                }
            })(),
        );
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
    exec: boolean,
    cache?: BuildCacheRunner,
): Promise<void> {
    const selectedNames = new Set(workspaces.map((w) => w.name));
    const remaining = new Map<string, Set<string>>();
    for (const ws of workspaces) {
        const wsDeps = new Set<string>();
        const m = ws.manifest;
        for (const block of [m.dependencies, includeDev ? m.devDependencies : undefined, m.optionalDependencies]) {
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
    const total = workspaces.length;
    const done = new Set<string>();
    let inflight = 0;

    // Stall observability + self-protection. With prefixed output BUFFERED on
    // non-tty sinks (flush-on-close), a CI log shows only COMPLETED children —
    // when the run stalls, nothing identifies who is stuck (issue #497's
    // 3h45-silence-to-the-cap pattern). So on non-tty (or --verbose) every
    // start is echoed live on foreach's own stderr, a watchdog WARNS once no
    // workspace has completed for a while, and after a hard stall budget the
    // run aborts with the in-flight set named instead of riding the CI job cap.
    const liveProgress = !process.stdout.isTTY || verbose;
    const inflightStarts = new Map<string, number>();
    const STALL_WARN_MS = 5 * 60_000;
    const stallAbortMinutes = Number(process.env['GJSIFY_FOREACH_STALL_MINUTES'] ?? '20');
    const STALL_ABORT_MS =
        (Number.isFinite(stallAbortMinutes) && stallAbortMinutes > 0 ? stallAbortMinutes : 20) * 60_000;

    return new Promise<void>((resolve, reject) => {
        let error: Error | null = null;
        let lastActivity = Date.now();
        const describeInflight = (): string =>
            [...inflightStarts.entries()].map(([n, t]) => `${n} (${Math.round((Date.now() - t) / 1000)}s)`).join(', ');
        const failFast = (e: Error): void => {
            // First error wins. KILL the in-flight siblings instead of
            // waiting for them (yarn waits — but a sibling's nested build
            // chain can stall for hours on CI, see issue #497), and bound
            // the drain with a hard deadline in case a killed child's pipe
            // never closes.
            if (error) return;
            error = e;
            killActiveChildren();
            const deadline = setTimeout(() => settle(), DRAIN_DEADLINE_MS);
            (deadline as { unref?: () => void }).unref?.();
        };
        const watchdog = setInterval(() => {
            const idle = Date.now() - lastActivity;
            if (idle < STALL_WARN_MS || inflightStarts.size === 0) return;
            console.error(
                `[gjsify foreach] WARNING: no workspace completed for ${Math.round(idle / 60_000)}min — in-flight: ${describeInflight()}`,
            );
            if (idle >= STALL_ABORT_MS) {
                failFast(
                    new Error(
                        `gjsify foreach: stalled — no workspace completed for ${Math.round(idle / 60_000)}min (override via GJSIFY_FOREACH_STALL_MINUTES); killed in-flight: ${describeInflight()}`,
                    ),
                );
            }
        }, 60_000);
        (watchdog as { unref?: () => void }).unref?.();
        const settle = (): void => {
            clearInterval(watchdog);
            if (error) reject(error);
            else resolve();
        };
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
                inflightStarts.set(next, Date.now());
                if (liveProgress) {
                    console.error(`[gjsify foreach] start ${next} (${done.size}/${total} done, ${inflight} in flight)`);
                }
                runOne(byName.get(next)!, script, args, /* prefixOutput */ true, verbose, exec, cache)
                    .then(() => {
                        done.add(next);
                    })
                    .catch((e: unknown) => {
                        failFast(e instanceof Error ? e : new Error(String(e)));
                    })
                    .finally(() => {
                        // Release the slot on BOTH success AND failure. The old
                        // code decremented `inflight` only in `.then`, so a
                        // FAILED task left `inflight` stuck above 0 → the
                        // `inflight === 0` guard never held → the promise never
                        // settled → hang. Under Node the empty event loop bails
                        // it out (exiting 0, silently masking the failure);
                        // under GJS `ensureMainLoop()` keeps the process alive
                        // forever (the 6-hour CI timeout). Settling here fixes
                        // both: fail-fast with the real error, on either runtime.
                        inflight--;
                        inflightStarts.delete(next);
                        lastActivity = Date.now();
                        if (error) {
                            if (inflight === 0) settle();
                        } else if (remaining.size === 0 && inflight === 0) {
                            settle();
                        } else {
                            pump();
                        }
                    });
            }
            if (remaining.size > 0 && inflight === 0 && !error) {
                clearInterval(watchdog);
                reject(
                    new Error(
                        `gjsify foreach --topological: stuck — workspaces ${[...remaining.keys()].join(', ')} have unsatisfied deps in the selected set`,
                    ),
                );
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
    exec: boolean,
    cache?: BuildCacheRunner,
): Promise<void> {
    if (exec) {
        // Arbitrary-command mode: spawn `<script> <args...>` directly
        // (yarn `workspaces foreach exec`-equivalent). Used by callers
        // that need to run binaries the workspace doesn't expose as a
        // package.json script — e.g. `gjsify foreach --exec npm publish`.
        if (verbose) {
            console.error(`[${ws.name}] $ ${script} ${args.join(' ')}`);
        }
        await spawnPrefixed(script, args, ws.location, prefixOutput ? `[${ws.name}] ` : null);
        return;
    }
    // Content-hash build cache: on a key hit the stored outputs are
    // restored and the script is skipped entirely; on a miss the output
    // dirs are snapshotted so only the dirs the script MODIFIED are stored
    // after it succeeds (never a committed, no-build lib/).
    if (cache && cache.tryRestore(ws)) return;
    const before = cache?.snapshotOutputs(ws);
    // Use the same package manager that invoked us — yarn under yarn,
    // npm under npm, gjsify under gjsify. Default to `npm` for portability
    // when nothing is detectable; the script-runner (D.5) will replace
    // this once `gjsify run` ships.
    const runner = detectPackageManager();
    const argv =
        runner === 'gjsify' ? ['run', script, ...args] : ['run', script, ...(args.length > 0 ? ['--', ...args] : [])];
    if (verbose) {
        console.error(`[${ws.name}] $ ${runner} ${argv.join(' ')}`);
    }
    await spawnPrefixed(runner, argv, ws.location, prefixOutput ? `[${ws.name}] ` : null);
    if (cache && before) cache.storeAfterSuccess(ws, before);
}

function detectPackageManager(): 'yarn' | 'npm' | 'gjsify' {
    // Under GJS there is no Node — neither `npm` nor `yarn` can run scripts, so
    // the runner is `gjsify` itself via the GJS shim on PATH
    // (`ensureGjsifyShimOnPath`). Makes node-free `gjsify foreach` work.
    if (isGjs()) return 'gjsify';
    // `npm_config_user_agent` is set by npm/yarn/pnpm — first token is
    // `<name>/<version>`. Reuse it so `gjsify foreach build` invoked
    // through `yarn run` keeps using yarn, etc.
    const ua = process.env.npm_config_user_agent ?? '';
    if (ua.startsWith('yarn/')) return 'yarn';
    if (ua.startsWith('gjsify/')) return 'gjsify';
    return 'npm';
}

function spawnPrefixed(cmd: string, args: readonly string[], cwd: string, prefix: string | null): Promise<void> {
    // Default FORCE_COLOR=1 unless the user explicitly opted out, so tools
    // that key on `process.stdout.isTTY` (chalk, picocolors, …) still emit
    // ANSI colors when run under gjsify foreach. Mirrors yarn / npm.
    const colorEnv =
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd,
            stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            env: { ...process.env, ...colorEnv },
        });
        activeChildren.add(child);
        // Under GJS, `process.stdout.write` is a BLOCKING `Gio.write_all`.
        // Writing each prefixed line LIVE during a PARALLEL foreach to a
        // backpressuring pipe (a CI log collector that drains slowly) stalls
        // the single GLib main loop on a full pipe → every parallel child's
        // pipe backs up → their reads stall → the whole run HANGS. (A tty or a
        // file sink never backpressures, which is why it only bites in CI.)
        // On a NON-tty sink we therefore BUFFER each child's prefixed output
        // and flush it as ONE write when that child closes: the child is
        // already done by then, so its own read can't stall, and concurrent
        // flushes serialize into brief loop stalls instead of a deadlock. On a
        // tty (interactive) we keep live line-prefixing for responsive output.
        const buffered = !process.stdout.isTTY;
        const flushers: Array<() => void> = [];
        if (prefix && child.stdout && child.stderr) {
            flushers.push(prefixLines(child.stdout, process.stdout, prefix, buffered));
            flushers.push(prefixLines(child.stderr, process.stderr, prefix, buffered));
        }
        child.on('close', (code) => {
            activeChildren.delete(child);
            for (const flush of flushers) flush();
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
        child.on('error', (err) => {
            activeChildren.delete(child);
            reject(err);
        });
    });
}
