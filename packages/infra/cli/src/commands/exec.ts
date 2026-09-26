// `gjsify exec [--runtime <r>] [--rebuild] <bin> [args…]` — run an installed npm bin
// on the runtime gjsify itself is running on (ADR 0076).
//
//   node / bun / deno host → the bin's npm entry, unchanged, on that runtime.
//   gjs host               → the package's own `gjsify.bin` bundle if it ships one,
//                            else the npm entry REBUILT `--app gjs` (Node APIs mapped
//                            to `@gjsify/*`, `.node` addons routed through
//                            `@gjsify/napi`), cached by content, run with `gjs -m`.
//
// A failed rebuild is an error that carries the bundler's diagnostics. There is no
// silent fallback to `node` under GJS: the host may have none, and a tool that
// "worked" on a runtime the user did not ask for hides exactly the gap this command
// exists to expose. `--runtime node` is the explicit, documented escape hatch.

import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import type { Command } from '../types/index.js';
import { doubleDashArgs } from '../utils/double-dash-args.js';
import {
    ExecBinNotFoundError,
    ExecPlanError,
    entryWithinPackage,
    execArtifactPath,
    execCacheKey,
    execCacheRoot,
    findProjectLockfile,
    hashFile,
    planExec,
    resolveExecBin,
    splitExecArgv,
    type ResolvedBin,
} from '../utils/exec-bin.js';
import { cliPackageDir, cliVersion } from '../utils/publish-headers.js';
import { runGjsBundle } from '../utils/run-gjs.js';
import { runRuntimeBundle } from '../utils/run-node.js';

interface ExecOptions {
    entries?: string[];
}

export class ExecRebuildError extends Error {
    constructor(bin: ResolvedBin, entry: string, cause: unknown, verbose: boolean) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(
            `gjsify exec: rebuilding "${bin.binName}" (${bin.pkgName}@${bin.pkgVersion}) for GJS failed.\n` +
                `  entry: ${entry}\n` +
                'Nothing was run — gjsify exec never falls back to another runtime on its own. To run it on Node ' +
                `explicitly: \`gjsify exec --runtime node ${bin.binName}\`.\n` +
                // The warnings were silenced for the rebuild; an error can point back at one
                // (UNRESOLVED_IMPORT behind a load-check failure), so say how to get them.
                (verbose ? '' : `Re-run with \`gjsify exec --verbose ${bin.binName}\` for the bundler's warnings.\n`) +
                `Bundler diagnostics:\n${detail}`,
            { cause },
        );
        this.name = 'ExecRebuildError';
    }
}

/** The nearest `node_modules` walking up from `start`, or null. */
function nearestNodeModules(start: string): string | null {
    let dir = resolve(start);
    for (;;) {
        const candidate = join(dir, 'node_modules');
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Rebuild `entry` as a `--app gjs` bundle and return its path, reusing a cached one
 * whose content key still matches (see `execCacheKey`).
 *
 * Written to a private temp directory and RENAMED into place, so two concurrent
 * `gjsify exec` runs never read a half-written bundle: the loser of the rename race
 * uses the winner's artifact, which has the same key and therefore the same inputs.
 */
async function rebuildForGjs(
    bin: ResolvedBin,
    entry: string,
    opts: { rebuild: boolean; verbose: boolean },
): Promise<string> {
    const nodeModules = bin.nodeModules ?? nearestNodeModules(process.cwd()) ?? join(bin.pkgDir, 'node_modules');
    const lockfile = findProjectLockfile(dirname(nodeModules));
    const key = execCacheKey({
        pkgName: bin.pkgName,
        pkgVersion: bin.pkgVersion,
        entry: entryWithinPackage(bin, entry),
        cliVersion: cliVersion(),
        lockfileHash: lockfile ? hashFile(lockfile) : null,
    });
    const outfile = execArtifactPath(execCacheRoot(nodeModules), bin, entry, bin.installed ? key : 'local');
    const reusable = bin.installed && !opts.rebuild;
    if (reusable && existsSync(outfile)) {
        if (opts.verbose) console.error(`gjsify exec: reusing ${outfile}`);
        return outfile;
    }

    console.error(`gjsify exec: rebuilding ${bin.pkgName}@${bin.pkgVersion} "${bin.binName}" for GJS…`);
    const finalDir = dirname(outfile);
    const tmpDir = `${finalDir}.tmp-${process.pid.toString(16)}-${Date.now().toString(16)}`;
    const tmpOut = join(tmpDir, basename(outfile));
    try {
        const { BuildAction } = await import('../actions/build.js');
        await BuildAction.bundleFileForGjs(entry, tmpOut, {
            verbose: opts.verbose,
            // A bin is executed, never imported.
            preserveDefaultExport: false,
            // An installed dependency's `import.meta.url` is rewritten per module by
            // the node_modules path rewriter; the project's OWN bin is not under
            // node_modules, so its entry keeps its source URL the way `--node-script`
            // does it.
            ...(bin.installed ? {} : { define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) } }),
            // The CLI is bundling on the user's behalf: the project installed wxt,
            // not `@gjsify/fs`, so the polyfills come from beside the running CLI.
            toolchainAnchor: BuildAction.runningCliFile(),
            // Every polyfill of a rebuilt bin comes from the toolchain, so the per-import
            // "did not resolve from the project" notice is the rule here, not a symptom —
            // dozens of lines ahead of `--version`. Warnings only: a failing build still
            // rejects with its diagnostics, and `--verbose` shows them all.
            ...(opts.verbose ? {} : { logLevel: 'silent' as const }),
        });
    } catch (err) {
        rmSync(tmpDir, { recursive: true, force: true });
        throw new ExecRebuildError(bin, entry, err, opts.verbose);
    }
    if (reusable && existsSync(outfile)) {
        // A concurrent run with the same key finished first; its artifact is ours.
        rmSync(tmpDir, { recursive: true, force: true });
        return outfile;
    }
    // Whatever sits under this name now is stale: a forced rebuild, or a directory
    // left by an older layout without the file this one expects.
    rmSync(finalDir, { recursive: true, force: true });
    try {
        renameSync(tmpDir, finalDir);
    } catch (err) {
        // Lost the race to a concurrent run with the same key — its bundle is ours.
        rmSync(tmpDir, { recursive: true, force: true });
        if (!existsSync(outfile)) throw err;
    }
    pruneStaleArtifacts(dirname(finalDir), bin, basename(finalDir));
    return outfile;
}

/**
 * Drop earlier artifacts of the SAME package version: a rebuild under a new CLI or a
 * moved lockfile leaves the old key behind, and nothing else would ever read it.
 * Best-effort — housekeeping must not fail the run it follows.
 */
function pruneStaleArtifacts(cacheRoot: string, bin: ResolvedBin, keep: string): void {
    const prefix = `${bin.pkgName}@${bin.pkgVersion}`.replace(/[^a-zA-Z0-9._@-]/g, '_');
    let names: string[];
    try {
        names = readdirSync(cacheRoot);
    } catch {
        return;
    }
    for (const name of names) {
        if (name === keep || !name.startsWith(`${prefix}-`) || name.includes('.tmp-')) continue;
        rmSync(join(cacheRoot, name), { recursive: true, force: true });
    }
}

export const execCommand: Command<unknown, ExecOptions> = {
    command: 'exec <entries..>',
    description:
        'Run an installed npm bin on the runtime gjsify runs on: `gjsify exec [--runtime gjs|node|bun|deno] [--rebuild] [--verbose] <bin> [args…]`. ' +
        'On Node/Bun/Deno the bin runs unchanged; on GJS it is rebuilt `--app gjs` once, cached under node_modules/.cache/gjsify/exec/, and run with gjs. ' +
        "Options go BEFORE the bin; everything after it is the bin's own.",
    builder: (yargs) =>
        yargs
            .positional('entries', {
                description: 'gjsify exec options, then the bin name and its arguments.',
                type: 'string',
                array: true,
            })
            // The bin owns its whole flag namespace, as with `gjsify env`/`run`:
            // `gjsify exec prettier --version` must reach prettier.
            .version(false)
            .help(false)
            .parserConfiguration({
                'populate--': true,
                'parse-positional-numbers': false,
                'unknown-options-as-args': true,
            }),
    handler: async (args) => {
        let invocation;
        let bin: ResolvedBin;
        let plan;
        try {
            invocation = splitExecArgv(args.entries ?? [], doubleDashArgs(args));
            bin = resolveExecBin(invocation.bin, process.cwd());
            plan = planExec(bin, invocation.runtime ?? hostRuntime());
        } catch (err) {
            if (err instanceof ExecBinNotFoundError) {
                console.error(err.message);
                // The shell's "command not found", which is what this is.
                return process.exit(127);
            }
            if (err instanceof ExecPlanError) {
                console.error(err.message);
                return process.exit(1);
            }
            throw err;
        }

        const launch = {
            completion: 'exit',
            exitOnSuccess: true,
            quiet: !invocation.verbose,
            quietExit: true,
        } as const;
        if (plan.kind === 'direct') {
            await runRuntimeBundle(plan.runtime, plan.file, invocation.args, launch);
            return;
        }
        if (plan.kind === 'gjs-bundle') {
            await runGjsBundle(plan.file, invocation.args, launch);
            return;
        }
        const bundle = await rebuildForGjs(bin, plan.entry, {
            rebuild: invocation.rebuild,
            verbose: invocation.verbose,
        });
        // The rebuild took its polyfills from beside the CLI, so their native prebuilds
        // (typelibs, shared libraries) are found there too.
        const cliDir = cliPackageDir();
        await runGjsBundle(bundle, invocation.args, { ...launch, nativeRoots: cliDir ? [cliDir] : [] });
    },
};
