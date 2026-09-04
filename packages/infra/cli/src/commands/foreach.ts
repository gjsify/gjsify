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

import type { ChildProcess } from 'node:child_process';
import { spawnToCompletion } from '../utils/spawn.js';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import type { Command } from '../types/index.js';
import {
    affectedClosure,
    buildDependencyGraph,
    discoverWorkspaces,
    filterWorkspaces,
    topologicalSort,
    type Workspace,
} from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { cliRuntimeClosure } from '../utils/cli-runtime-closure.js';
import { prefixLines } from '../utils/prefixed-output.js';
import { doubleDashArgs } from '../utils/double-dash-args.js';
import { BuildCacheRunner, buildCacheEnabledByEnv } from '../utils/build-cache.js';
// The ONE runner-selection rule, shared rather than re-derived. This file used to
// carry its own copy; `workspace.ts` grew the bootstrap-CLI branch and the copy
// here did not, so a `gjsify foreach` reached from a cold-tree bootstrap would
// have delegated to npm and lost the shim one level down — silently, and only on
// the OS legs that bootstrap cold. `onboard.ts` already imports it from here.
import { detectPackageManager } from './workspace.js';

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
        // NOT the already-dead case — `ChildProcess.kill()` swallows ESRCH
        // itself and returns false. This guards Node's residual throw paths
        // (EPERM surfacing via an unhandled 'error' emit, unknown signal).
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
    'with-dependencies'?: boolean;
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
                description:
                    'Glob pattern to include workspaces by name (repeatable). A pattern that matches NO discovered workspace is a hard error — a filter selecting nothing is a typo or a caller-side quoting bug, never an intent.',
                type: 'string',
                array: true,
            })
            .option('exclude', {
                description: 'Glob pattern to exclude workspaces by name (repeatable).',
                type: 'string',
                array: true,
            })
            .option('with-dependencies', {
                description:
                    "Also select everything the filtered set DEPENDS ON (production deps; add --topological-dev for devDependencies). --include only filters and --topological only orders, so neither can say 'and the packages these need'. Excludes are re-applied afterwards.",
                type: 'boolean',
                alias: 'd',
                default: false,
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
                // …and keep that tail as the TEXT the caller typed. Without
                // this yargs types a bare number in the array as a `number`,
                // which is how `--verify-timeout 5 --tag latest` reached 209
                // npm publishes as `--verify-timeout --tag latest` (#1531).
                // Declared `type: 'number'` options (`--jobs`) are unaffected.
                'parse-positional-numbers': false,
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
            const fromDoubleDash = doubleDashArgs(args);
            if (fromDoubleDash.length > 0) cmdArgs = [...cmdArgs, ...fromDoubleDash];
        }
        if (exec) {
            // With populate--:true, anything after the literal `--`
            // separator lands in top-level args['--']. yargs DOES NOT
            // attach it to args._ — it's a sibling array.
            const fromDoubleDash = doubleDashArgs(args);
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
                // `return` — a bare `process.exit()` is deferred under GJS and
                // the handler would keep running without a command.
                return process.exit(1);
            }
        }

        assertEveryIncludeMatches(allWorkspaces, args.include);

        let selected = filterWorkspaces(allWorkspaces, {
            include: args.include,
            exclude: args.exclude,
            noPrivate: args.private === false,
        });

        // `--with-dependencies` — the third thing a selection can mean, and the
        // one that had no spelling. `--include` FILTERS and `--topological` only
        // ORDERS what was already selected, so "and everything these need" was
        // inexpressible, and CI's selective build simply assumed every
        // dependency's restored `lib/` was current. A build cache can be
        // complete without being current: caches are branch-scoped, so ONE
        // cancelled build on `main` left later PRs compiling against pre-merge
        // outputs, failing with compiler errors that named a package the PR
        // never touched (#1080). No warmth probe can see that — a stale archive
        // is perfectly complete — so freshness has to come from the selection.
        //
        // AFTER the filter, not before: expanding the unfiltered set would walk
        // out through the very packages the caller excluded (CI excludes
        // `@gjsify/website`, which prod-depends every showcase — expanding first
        // pulled in 56 extra packages and undid selective CI). Excludes are then
        // re-applied, because a dependency may be something the caller took out
        // on purpose and expansion must not smuggle it back in.
        if (args['with-dependencies'] === true) {
            const includeDev = args['topological-dev'] === true;
            const forward = buildDependencyGraph(allWorkspaces, { includeDev });
            const closure = affectedClosure(
                forward,
                selected.map((ws) => ws.name),
            );
            selected = filterWorkspaces(
                allWorkspaces.filter((ws) => closure.has(ws.name)),
                { exclude: args.exclude, noPrivate: args.private === false },
            );
        }

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
                // `return` — see the deferred-exit note on the --exec guard.
                return process.exit(1);
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
                // `return` — the deferred GJS exit otherwise ran the whole
                // unsharded set.
                return process.exit(1);
            }
            const index = Number(m[1]);
            const total = Number(m[2]);
            if (total < 1 || index < 1 || index > total) {
                console.error(
                    `gjsify foreach: invalid --shard "${args.shard}" — need 1 <= index <= total and total >= 1.`,
                );
                // `return` — see the deferred-exit note on the shard guard above.
                return process.exit(1);
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
            // Reaching here means every --include pattern DID match something
            // (assertEveryIncludeMatches above is fatal otherwise) and the set
            // was then narrowed to nothing by --exclude, --no-private, the
            // script-presence filter, or --shard. All four are legitimate, so
            // this stays a clean exit-0 no-op — see the assert's doc comment
            // for why the two cases are not the same condition.
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
            // `return` — the deferred GJS exit otherwise ran the --exec anyway.
            return process.exit(1);
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

        // The serial prefix: every child of this command BOOTS the CLI, so a
        // package the CLI imports must not be written while siblings are starting
        // (the torn `lib/esm` in `utils/cli-runtime-closure.ts`'s header). Building
        // that closure first — alone, in the order the caller already sorted — is a
        // REORDERING, not extra work: the prefix is removed from the parallel set,
        // so the cost is only the parallelism given up over those few packages.
        //
        // Applied to every PARALLEL invocation, not only to `build`. Which scripts
        // rewrite an output tree is not knowable from a script NAME — `build`,
        // `build:types`, a package's own `dist` step and `clear` all do — and
        // gating on the literal string "build" would be the hand-written list this
        // closure exists to replace. A serial run needs no prefix at all: nothing
        // else is in flight to read what it writes.
        const prefixNames = args.parallel === true ? cliRuntimeClosure(allWorkspaces) : new Set<string>();
        const prefix = prefixNames.size > 0 ? selected.filter((ws) => prefixNames.has(ws.name)) : [];
        const sweep = prefix.length > 0 ? selected.filter((ws) => !prefixNames.has(ws.name)) : selected;

        try {
            if (prefix.length > 0) {
                console.error(
                    `[gjsify foreach] serial prefix: ${prefix.length} package(s) the running CLI imports — ` +
                        `${prefix.map((ws) => ws.name).join(', ')}`,
                );
                for (const ws of prefix) {
                    console.error(`[gjsify foreach] start ${ws.name} (serial prefix)`);
                    await runOne(ws, finalCmd, cmdArgs, /* prefixOutput */ true, verbose, exec, cache);
                }
            }
            if (args.parallel && !args.topological && !args['topological-dev']) {
                const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
                await runParallel(sweep, finalCmd, cmdArgs, jobs, verbose, exec, cache);
            } else if (args.parallel) {
                // Topological + parallel: each workspace starts as soon as its
                // deps (in the selected set) have finished. Yarn calls this
                // "topological order with concurrency"; we cap at --jobs.
                const jobs = args.jobs && args.jobs > 0 ? args.jobs : cpus().length;
                await runTopologicalParallel(
                    sweep,
                    finalCmd,
                    cmdArgs,
                    jobs,
                    verbose,
                    args['topological-dev'] === true,
                    exec,
                    cache,
                );
            } else {
                await runSequential(sweep, finalCmd, cmdArgs, verbose, exec, cache);
            }
        } catch (err) {
            // Plain --parallel rejects on the FIRST failure (Promise.all) while
            // sibling children are still running — terminate them so we don't
            // leave orphans holding the CI step's stdio open.
            killActiveChildren();
            console.error((err as Error).message);
            // `return` — the deferred GJS exit otherwise fell through to the
            // success `process.exit(0)` below, clobbering the failure code.
            return process.exit(1);
        }
        // ensureMainLoop() (called inside spawn) keeps GJS alive after every
        // child exits — without an explicit process.exit() the success path
        // would park the loop forever.
        process.exit(0);
    },
};

/**
 * A `--include` pattern that matches ZERO of the discovered workspaces is a
 * hard error. This is the load-bearing half of the fix for repo task #75: the
 * CI classifier emitted its filter pre-quoted (`--include '@gjsify/fs'`), the
 * workflow expanded it unquoted inside a `su … -c "… sh -c '…'"` nesting, the
 * apostrophes became part of every glob, and this command matched nothing,
 * printed one line, and exited 0. A build that did nothing was indistinguishable
 * from a build that succeeded, so the bug lived through every selective PR run
 * — the Build step took 0.65 s and every later step inspected whatever the
 * cache had restored. The quoting was the defect; the SILENCE is why nobody saw
 * it.
 *
 * Scope is deliberately "an include PATTERN matched no workspace", NOT "the
 * final selection is empty". The final selection is legitimately empty in
 * several supported situations and must stay exit-0:
 *   * `--shard 3/4` over a 2-workspace closure — most shards run nothing;
 *   * `--exclude '@gjsify/integration-*'` removing everything the include kept;
 *   * script mode dropping workspaces that don't declare `<script>` (yarn does
 *     this too, and it is why `foreach check` over a closure of script-less
 *     packages is a no-op rather than a failure).
 * All three describe a real, existing set being narrowed to nothing. A pattern
 * that names something the workspace tree does not contain is different in
 * kind: it is a typo, a stale package name, or a caller-side quoting bug, and
 * it can never be what the caller meant. There is no opt-out flag — an escape
 * hatch here would be re-arming exactly the silence this exists to remove.
 */
function assertEveryIncludeMatches(allWorkspaces: readonly Workspace[], include: readonly string[] | undefined): void {
    if (!include || include.length === 0) return;
    const unmatched = include.filter((pattern) => filterWorkspaces(allWorkspaces, { include: [pattern] }).length === 0);
    if (unmatched.length === 0) return;

    const lines: string[] = [
        `gjsify foreach: --include matched no workspace (${unmatched.length} of ${include.length} pattern(s)):`,
    ];
    for (const pattern of unmatched) {
        lines.push(`  ${JSON.stringify(pattern)}`);
        // The task-#75 signature: the pattern only fails because the caller's
        // shell quotes ended up INSIDE the value. Name it outright — that
        // failure reads as "package not found" and sends people hunting in the
        // wrong place.
        const unquoted = stripSurroundingQuotes(pattern);
        if (unquoted !== pattern && filterWorkspaces(allWorkspaces, { include: [unquoted] }).length > 0) {
            lines.push(
                `    → matches as ${JSON.stringify(unquoted)}: the QUOTES are part of the value. A shell expansion`,
                `      is not re-scanned for quoting, so a pre-quoted filter spliced through \`sh -c\` arrives with`,
                `      the quotes attached. Pass the bare name and let word splitting do the work.`,
            );
            continue;
        }
        const near = allWorkspaces
            .map((w) => w.name)
            .filter((name) => name.toLowerCase().includes(unquoted.replace(/\*/g, '').toLowerCase()))
            .slice(0, 3);
        if (near.length > 0) lines.push(`    → did you mean: ${near.join(', ')}?`);
    }
    lines.push(
        `  ${allWorkspaces.length} workspace(s) discovered. Refusing to run: a filter that selects nothing would`,
        `  otherwise exit 0 and look exactly like a successful run over the whole set.`,
    );
    console.error(lines.join('\n'));
    // Under GJS `process.exit()` is DEFERRED (no atexit — the call returns), so
    // a bare exit here RETURNED to the handler, which kept going and could
    // spawn children for the patterns that DID match before the scheduled exit
    // fired. The throw is what actually stops the run on GJS; on Node the
    // exit(1) halts first and the throw is dead code.
    // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path; see the comment above.
    process.exit(1);
    throw new Error('gjsify foreach: --include matched no workspace');
}

/** Drop ONE matching pair of surrounding `'` or `"` — the quoting-bug probe. */
function stripSurroundingQuotes(s: string): string {
    if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0]) return s.slice(1, -1);
    return s;
}

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

async function spawnPrefixed(cmd: string, args: readonly string[], cwd: string, prefix: string | null): Promise<void> {
    // `completion: 'exit'` — every path out of this command's handler ends in
    // `process.exit(…)` (see the handler's tail), which is what quits the GLib
    // main loop `spawn()` arms under GJS. That keeps foreach on the STREAMING
    // async path: live prefixed output and real parallelism, both of which the
    // blocking path would destroy. See utils/spawn.ts for the full contract.
    let tracked: ChildProcess | null = null;
    const flushers: Array<() => void> = [];
    try {
        const result = await spawnToCompletion(cmd, args, {
            completion: 'exit',
            cwd,
            stdio: prefix ? 'pipe' : 'inherit',
            // Default FORCE_COLOR=1 unless the user explicitly opted out, so
            // tools that key on `process.stdout.isTTY` (chalk, picocolors, …)
            // still emit ANSI colors under gjsify foreach. Mirrors yarn / npm.
            color: true,
            onSpawn: (child) => {
                tracked = child;
                activeChildren.add(child);
                // Under GJS, `process.stdout.write` is a BLOCKING
                // `Gio.write_all`. Writing each prefixed line LIVE during a
                // PARALLEL foreach to a backpressuring pipe (a CI log
                // collector that drains slowly) stalls the single GLib main
                // loop on a full pipe → every parallel child's pipe backs up →
                // their reads stall → the whole run HANGS. (A tty or a file
                // sink never backpressures, which is why it only bites in CI.)
                // On a NON-tty sink we therefore BUFFER each child's prefixed
                // output and flush it as ONE write when that child closes: the
                // child is already done by then, so its own read can't stall,
                // and concurrent flushes serialize into brief loop stalls
                // instead of a deadlock. On a tty (interactive) we keep live
                // line-prefixing for responsive output.
                const buffered = !process.stdout.isTTY;
                if (prefix && child.stdout && child.stderr) {
                    flushers.push(prefixLines(child.stdout, process.stdout, prefix, buffered));
                    flushers.push(prefixLines(child.stderr, process.stderr, prefix, buffered));
                }
            },
        });
        for (const flush of flushers) flush();
        if (result.code !== 0) {
            throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.code}`);
        }
    } finally {
        if (tracked) activeChildren.delete(tracked);
    }
}
