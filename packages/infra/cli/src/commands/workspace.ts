// `gjsify workspace <name> [run] <script> [args..]` — yarn-workspace shortcut.
//
// Equivalent to `yarn workspace <name> run <script>`: locates the named
// workspace in the current monorepo, then runs the script there. Used
// extensively in gjsify's own root `package.json` (17 call sites).
//
// BOTH spellings work — the yarn-style `run` prefix is accepted and optional.
// It is deliberately NOT the default and NOT a full CLI proxy: gjsify's command
// names collide with the most common script names, so `workspace <name> build`
// must keep meaning the SCRIPT. See the note at the normalization site below.
//
// With `--with-dependencies` / `-d` (synonym: `--topological` / `-t`) the
// command first runs the SAME script in every transitive workspace
// dependency, in topological build order, then in the target package.
// Skips deps that don't declare the script (`--if-present` behaviour).
// Stops on the first failure unless `--continue-on-error` is passed.
//
// This replaces the manual `gjsify workspace <A> build && gjsify workspace
// <B> build && …` chains in root `build:infra` scripts: cascade build
// failures on uninbuilt workspace deps are the single biggest local-dev
// pain point in this monorepo.

import type { Command } from '../types/index.js';
import { spawnToCompletion } from '../utils/spawn.js';
import { buildDependencyGraph, discoverWorkspaces, topologicalSort, type Workspace } from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { BuildCacheRunner, buildCacheEnabledByEnv } from '../utils/build-cache.js';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { usingSelfShim } from '../utils/gjsify-shim.js';
import { suggestClosest } from '../utils/suggest.js';

interface WorkspaceCmdOptions {
    name: string;
    script: string;
    args?: string[];
    'with-dependencies'?: boolean;
    'continue-on-error'?: boolean;
    'include-dev'?: boolean;
    verbose?: boolean;
    cached?: boolean;
}

export const workspaceCommand: Command<unknown, WorkspaceCmdOptions> = {
    command: 'workspace <name> <script> [args..]',
    description:
        'Run a workspace script. Both `workspace <name> <script>` and the yarn spelling `workspace <name> run <script>` work.',
    builder: (yargs) =>
        yargs
            .positional('name', {
                description: 'Workspace name (matches package.json `name` field).',
                type: 'string',
                demandOption: true,
            })
            .positional('script', {
                description: 'Script name to run inside that workspace.',
                type: 'string',
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments forwarded to the script.',
                type: 'string',
                array: true,
            })
            .option('with-dependencies', {
                // `-t`/`--topological` is the same flag spelled the way
                // `gjsify foreach` already spells it — kept as an alias so
                // muscle memory transfers.
                description:
                    "Pre-build the target workspace's transitive workspace dependencies in topological order before running the script in the target. Deps that don't declare the script are skipped (--if-present behaviour). Replaces manual `gjsify workspace A build && gjsify workspace B build && …` chains.",
                type: 'boolean',
                alias: ['d', 't', 'topological'],
                default: false,
            })
            .option('include-dev', {
                description:
                    'When --with-dependencies is set, also walk devDependencies (production deps only by default — matches `gjsify foreach -t`).',
                type: 'boolean',
                default: false,
            })
            .option('continue-on-error', {
                description:
                    'When --with-dependencies is set, keep running remaining deps after one fails (default: stop on first failure).',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Echo every spawned command before running it.',
                type: 'boolean',
                alias: 'v',
                default: false,
            })
            .option('cached', {
                description:
                    'Content-hash build cache (ADR 0006): skip the script for a workspace whose inputs (src/**, package.json, tsconfig*.json, transitive workspace deps, toolchain versions) are unchanged and restore its stored outputs instead; on miss run it and store the output dirs it modified. Also applies to the deps run via --with-dependencies. Default from GJSIFY_BUILD_CACHE=1.',
                type: 'boolean',
            }),
    handler: async (args) => {
        // Walk up to the monorepo root — `gjsify workspace` is often
        // invoked from a child workspace's script (e.g. website's
        // `build:deps` calls `gjsify workspace @gjsify/adwaita-web …`),
        // where process.cwd() is the child workspace, not the monorepo root.
        const root = findWorkspaceRoot(process.cwd()) ?? process.cwd();
        const allWorkspaces = discoverWorkspaces(root);
        const target = allWorkspaces.find((w) => w.name === args.name);
        if (!target) {
            // IMPORTANT: `return process.exit(N)`, not a bare `process.exit(N)`.
            // Under GJS `process.exit` cannot terminate synchronously (a parked
            // GLib.MainLoop owns the thread) — it SCHEDULES the exit on a
            // GLib.idle source and returns a forever-pending Promise. A bare
            // call therefore falls through to the next statements, dereferences
            // `target.manifest` on `undefined`, and the resulting throw races
            // the already-scheduled exit into a SECOND `system.exit` →
            // `m_should_exit assertion failed` → core dump. `return`-ing halts
            // the handler so exactly one exit is scheduled. (No-op under Node,
            // where `process.exit` never returns.)
            const suggestion = suggestClosest(
                args.name,
                allWorkspaces.map((w) => w.name),
            );
            const hint = suggestion ? ` — did you mean "${suggestion}"?` : '';
            console.error(
                `gjsify workspace: no workspace named "${args.name}"${hint} ` +
                    `(discovered ${allWorkspaces.length} workspace(s) under ${root})`,
            );
            return process.exit(1);
        }
        const runner = detectPackageManager();
        const verbose = args.verbose === true;
        const withDeps = args['with-dependencies'] === true;
        const continueOnError = args['continue-on-error'] === true;

        // yarn spells this `yarn workspace <name> run <script>`, and the header
        // comment above has always advertised that form as the equivalent — so
        // accept it. `run` is an OPTIONAL prefix, not the default: gjsify's own
        // command surface collides head-on with the most common script names
        // (`build`, `check`, `test`, `install`, `publish`, `pack`, `lint`,
        // `format`), so proxying the whole CLI the way yarn does would make
        // `gjsify workspace <name> build` ambiguous between the build COMMAND
        // and the build SCRIPT — and the script reading is the one every script
        // in this repo relies on.
        //
        // A package with a literal `run` script stays reachable: the prefix is
        // only consumed when something follows it (`… run build`), so a bare
        // `gjsify workspace <name> run` still runs that package's `run` script.
        let script = args.script;
        let extraArgs = args.args ?? [];
        if (script === 'run' && extraArgs.length > 0) {
            [script, ...extraArgs] = extraArgs;
        }

        const targetScripts = (target.manifest.scripts as Record<string, string> | undefined) ?? {};
        if (typeof targetScripts[script] !== 'string') {
            const scriptHint = suggestClosest(script, Object.keys(targetScripts));
            console.error(
                `gjsify workspace: workspace "${args.name}" has no script "${script}"` +
                    (scriptHint ? ` — did you mean "${scriptHint}"?` : ''),
            );
            // `return process.exit` — see the not-found branch above for why a
            // bare `process.exit` is unsafe under GJS.
            return process.exit(1);
        }

        // Build the run-list: either just the target, or its transitive
        // workspace-dep closure in topological order followed by the
        // target itself.
        let runList: Workspace[];
        if (withDeps) {
            const closure = collectTransitiveClosure(target, allWorkspaces, args['include-dev'] === true);
            // Sort the closure topologically using the shared @gjsify/workspace
            // algorithm — same code path that drives `gjsify foreach -t`.
            const graph = buildDependencyGraph(closure, { includeDev: args['include-dev'] === true });
            runList = topologicalSort(graph);
        } else {
            runList = [target];
        }

        // Content-hash build cache (ADR 0006 phase 1). Explicit --cached /
        // --no-cached wins; GJSIFY_BUILD_CACHE=1 is the env default so root
        // script chains opt in without editing every nested invocation. Keys
        // are computed against ALL discovered workspaces.
        const cached = args.cached ?? buildCacheEnabledByEnv();
        const cache = cached
            ? new BuildCacheRunner({
                  root,
                  workspaces: allWorkspaces,
                  script: script,
                  args: extraArgs,
                  targets: runList.map((w) => w.name),
              })
            : undefined;

        const failures: { workspace: string; error: Error }[] = [];
        for (const ws of runList) {
            const scripts = (ws.manifest.scripts as Record<string, string> | undefined) ?? {};
            if (typeof scripts[script] !== 'string') {
                // Skip deps that don't declare the script — mirrors
                // `gjsify foreach`'s --if-present behaviour. The target
                // itself was validated above; this branch only filters
                // intermediate deps. A skipped package is also never touched
                // by the build cache (the no-build-package safety rule).
                if (verbose) console.error(`[${ws.name}] (no "${script}" script — skipping)`);
                continue;
            }
            try {
                await runOne(ws, script, extraArgs, runner, verbose, cache);
            } catch (err) {
                const e = err instanceof Error ? err : new Error(String(err));
                console.error(`[${ws.name}] ${e.message}`);
                if (!continueOnError) {
                    // `return` — a bare `process.exit` would not halt under GJS
                    // and the loop would keep running the remaining deps.
                    return process.exit(1);
                }
                failures.push({ workspace: ws.name, error: e });
            }
        }

        if (failures.length > 0) {
            console.error(
                `gjsify workspace: ${failures.length} workspace(s) failed: ${failures.map((f) => f.workspace).join(', ')}`,
            );
            return process.exit(1);
        }

        // ensureMainLoop() (called inside spawn) keeps GJS alive after the
        // child exits — without an explicit process.exit() the success path
        // would park the loop forever. `return` for symmetry with the error
        // paths above (see the not-found branch for the GJS rationale).
        return process.exit(0);
    },
};

/**
 * Walk the workspace-dep graph from `target`, collecting every transitive
 * workspace dependency (production + optional, plus devDependencies when
 * `includeDev`). The returned list includes `target` itself so the caller
 * can pass it straight to `buildDependencyGraph` / `topologicalSort`.
 */
function collectTransitiveClosure(
    target: Workspace,
    allWorkspaces: readonly Workspace[],
    includeDev: boolean,
): Workspace[] {
    const byName = new Map<string, Workspace>();
    for (const ws of allWorkspaces) byName.set(ws.name, ws);

    const seen = new Set<string>();
    const out: Workspace[] = [];
    const stack: Workspace[] = [target];
    while (stack.length > 0) {
        const ws = stack.pop()!;
        if (seen.has(ws.name)) continue;
        seen.add(ws.name);
        out.push(ws);

        const m = ws.manifest;
        const blocks = [
            m.dependencies,
            includeDev ? m.devDependencies : undefined,
            m.optionalDependencies,
            // peerDependencies excluded by default (yarn does the same)
        ];
        for (const block of blocks) {
            if (!block) continue;
            for (const [depName, spec] of Object.entries(block)) {
                if (typeof spec !== 'string') continue;
                if (!spec.startsWith('workspace:')) continue;
                const dep = byName.get(depName);
                if (!dep) continue;
                if (!seen.has(dep.name)) stack.push(dep);
            }
        }
    }
    return out;
}

async function runOne(
    ws: Workspace,
    script: string,
    extraArgs: readonly string[],
    runner: 'yarn' | 'npm' | 'gjsify',
    verbose: boolean,
    cache?: BuildCacheRunner,
): Promise<void> {
    // Build-cache fast path: on a key hit restore the stored outputs and
    // skip the script; on a miss snapshot the output dirs so only what the
    // script MODIFIED is stored after success (never a committed no-build
    // lib/ — see utils/build-cache.ts).
    if (cache && cache.tryRestore(ws)) return;
    const before = cache?.snapshotOutputs(ws);
    const argv =
        runner === 'gjsify'
            ? ['run', script, ...extraArgs]
            : ['run', script, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])];
    if (verbose) {
        console.error(`[${ws.name}] $ ${runner} ${argv.join(' ')}`);
    }
    // `completion: 'exit'` — every path out of this command's handler ends in
    // `process.exit(…)`, which quits the GLib main loop `spawn()` arms under
    // GJS, so the streaming async path stays safe here. See utils/spawn.ts.
    //
    // `color: true` defaults FORCE_COLOR=1 unless the user explicitly opted
    // out (matches yarn / npm / gjsify run) — without it, tools that key on
    // isTTY (chalk, picocolors, oxc) drop colors when stdout is a pipe,
    // including GitHub Actions where the log viewer renders ANSI fine.
    const { code } = await spawnToCompletion(runner, argv, {
        completion: 'exit',
        cwd: ws.location,
        color: true,
    });
    if (code !== 0) {
        throw new Error(`${runner} ${argv.join(' ')} exited with code ${code}`);
    }
    if (cache && before) cache.storeAfterSuccess(ws, before);
}

export function detectPackageManager(): 'yarn' | 'npm' | 'gjsify' {
    // Under GJS there is no Node, so neither `npm` nor `yarn` can run scripts —
    // the only option is `gjsify` itself, resolved via the GJS shim on PATH
    // (see `ensureGjsifyShimOnPath`). This is what makes node-free multi-package
    // orchestration work in the Flatpak sandbox.
    if (isGjs()) return 'gjsify';
    // Same answer for a BOOTSTRAP CLI on Node, for a reason one level deeper
    // than it looks. `ensureGjsifyShimOnPath()` puts a working `gjsify` ahead of
    // the tree's `node_modules/.bin` — but npm RE-PREPENDS `node_modules/.bin`
    // for every lifecycle script it starts, so delegating to npm here restores
    // the tree's not-yet-built shim one level down and undoes the repair.
    // Measured on a cold tree: `run build:infra` cleared its first clause and
    // then died inside `npm run build` with `Cannot find module
    // …/packages/infra/cli/lib/index.js`. Running the script ourselves keeps the
    // bootstrap CLI's identity all the way down — which is exactly what the GJS
    // branch above already relies on, and why Linux CI never saw this.
    if (usingSelfShim()) return 'gjsify';
    const ua = process.env.npm_config_user_agent ?? '';
    if (ua.startsWith('yarn/')) return 'yarn';
    if (ua.startsWith('gjsify/')) return 'gjsify';
    return 'npm';
}
