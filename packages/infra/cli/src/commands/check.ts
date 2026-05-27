// `gjsify check` — workspace TypeScript-check orchestrator.
//
// In a workspace root: runs `npm run check` across every workspace that
// declares a `check` script (filtered the same way `gjsify foreach` filters:
// excludes `@girs/*`, honours --include/--exclude). Parallel by default.
//
// In a single package (or anywhere a `package.json` with a `check` script
// is reachable from cwd): runs the local `check` script directly. This is
// the natural "tsc --noEmit on the current scope" invocation, analogous to
// `gjsify format` / `lint` / `fix` (which all wrap oxc workspace-wide).
//
// The legacy system-dep-check shape lives under `gjsify system-check` after
// PR #254. The `check` alias on `system-check` stays valid for one release
// — if both `system-check`-style flags (`--json`) and `check`-style scripts
// are reachable here, the `--json` flag routes through this command first
// (since the typescript-check binding is positional `[paths..]`).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import type { Command } from '../types/index.js';
import {
    discoverWorkspaces,
    filterWorkspaces,
    type Workspace,
} from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface CheckOptions {
    include?: string[];
    exclude?: string[];
    parallel?: boolean;
    jobs?: number;
    verbose?: boolean;
}

interface PackageJson {
    name?: string;
    scripts?: Record<string, string>;
    private?: boolean;
}

function readPackageJson(dir: string): PackageJson | null {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson;
    } catch {
        return null;
    }
}

/**
 * Run a single workspace's `check` script. Returns the exit code; non-zero
 * indicates failure. Output is forwarded to the parent's stdout/stderr,
 * line-prefixed with the workspace name when `prefix` is set.
 */
function runCheck(
    ws: Workspace,
    prefix: string | null,
): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn('npm', ['run', 'check', '--if-present'], {
            cwd: ws.location,
            stdio: prefix === null ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        });

        if (prefix !== null && child.stdout && child.stderr) {
            const tag = `[${prefix}] `;
            const forward = (stream: NodeJS.ReadableStream, dest: NodeJS.WriteStream) => {
                stream.on('data', (chunk: Buffer) => {
                    const text = chunk.toString('utf-8');
                    for (const line of text.split('\n')) {
                        if (line.length > 0) dest.write(`${tag}${line}\n`);
                    }
                });
            };
            forward(child.stdout, process.stdout);
            forward(child.stderr, process.stderr);
        }

        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });
}

export const checkCommand: Command<unknown, CheckOptions> = {
    command: 'check',
    description:
        'Run `npm run check` (TypeScript type-check) across the current workspace. In a workspace root: walks every package with a `check` script (excludes @girs/*; honours --include/--exclude). In a single package: runs the local `check` script directly. Symmetric peer of `gjsify format` / `lint` / `fix`. (Legacy system-dep `gjsify check` is now `gjsify system-check` — see #254.)',
    builder: (yargs) =>
        yargs
            .option('include', {
                description: 'Only run in workspaces matching these glob patterns (repeatable).',
                type: 'string',
                array: true,
            })
            .option('exclude', {
                description: 'Skip workspaces matching these glob patterns (repeatable). Always excludes @girs/*.',
                type: 'string',
                array: true,
            })
            .option('parallel', {
                description: 'Run workspace checks in parallel (default). Use --no-parallel to run them sequentially with full per-workspace output.',
                type: 'boolean',
                alias: 'p',
                default: true,
            })
            .option('jobs', {
                description: 'Max parallel workers (when --parallel). Default: os.cpus().length.',
                type: 'number',
                alias: 'j',
            })
            .option('verbose', {
                description: 'Log the per-workspace command before spawning.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const cwd = process.cwd();
        const workspaceRoot = findWorkspaceRoot(cwd);

        // ---- Single-package mode ----
        // Run when we're inside a package that has a `check` script but is
        // NOT itself the workspace root. This is the "I want to tsc just
        // this package" path — equivalent to `npm run check` but spawned
        // through gjsify so the command surface stays uniform with format/
        // lint/fix.
        if (workspaceRoot && cwd !== workspaceRoot) {
            const pkg = readPackageJson(cwd);
            if (pkg?.scripts?.check) {
                if (args.verbose) {
                    console.log(`[check] cwd=${cwd}  → npm run check`);
                }
                const r = spawnSync('npm', ['run', 'check'], { cwd, stdio: 'inherit' });
                process.exit(r.status ?? 1);
            }
            // Fall through to workspace mode when the local package has no
            // check script (cd'd into a non-package dir under the root).
        }

        // ---- Workspace mode ----
        if (!workspaceRoot) {
            console.error('gjsify check: no workspace root found from cwd. Run inside a workspace (or a package within one) with `npm run check` defined.');
            process.exit(1);
        }

        const allWorkspaces = discoverWorkspaces(workspaceRoot);
        // Always exclude @girs/* (type-only packages, no own tsc check).
        const exclude = ['@girs/*', ...(args.exclude ?? [])];
        const filtered = filterWorkspaces(allWorkspaces, {
            include: args.include,
            exclude,
            // noPrivate omitted → include private workspaces (test pkgs often have check).
        });

        // Skip workspaces without a `check` script (manifest.scripts.check).
        const targets = filtered.filter((ws) => {
            const scripts = ws.manifest.scripts as Record<string, string> | undefined;
            return scripts?.check !== undefined;
        });

        if (targets.length === 0) {
            console.error('gjsify check: no workspaces with a `check` script found.');
            process.exit(1);
        }

        if (args.verbose) {
            console.log(`[check] root=${workspaceRoot}  workspaces=${targets.length}  parallel=${args.parallel ? 'yes' : 'no'}`);
        }

        // ---- Sequential mode ----
        if (!args.parallel) {
            let firstFail = 0;
            for (const ws of targets) {
                if (args.verbose) console.log(`[check] → ${ws.name}`);
                const code = await runCheck(ws, null);
                if (code !== 0 && firstFail === 0) firstFail = code;
            }
            if (firstFail !== 0) console.error(`gjsify check: failures in ${targets.filter(async ws => await runCheck(ws, null) !== 0).length}+ workspaces`);
            process.exit(firstFail);
        }

        // ---- Parallel mode (default) ----
        const concurrency = args.jobs ?? Math.max(1, cpus().length);
        const failures: { name: string; code: number }[] = [];

        let cursor = 0;
        const workers: Promise<void>[] = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push((async () => {
                while (true) {
                    const idx = cursor++;
                    if (idx >= targets.length) return;
                    const ws = targets[idx]!;
                    const code = await runCheck(ws, ws.name);
                    if (code !== 0) failures.push({ name: ws.name, code });
                }
            })());
        }
        await Promise.all(workers);

        if (failures.length > 0) {
            console.error(`\ngjsify check: ${failures.length} of ${targets.length} workspace(s) failed:`);
            for (const f of failures) console.error(`  ✗ ${f.name} (exit ${f.code})`);
            process.exit(1);
        }
        if (args.verbose) console.log(`\ngjsify check: ${targets.length} workspace(s) green.`);
        process.exit(0);
    },
};
