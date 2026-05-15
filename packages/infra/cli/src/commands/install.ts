// `gjsify install [pkg...]` — install packages with gjsify-aware post-checks.
//
// Modes:
//   gjsify install                    → project install (native, reads pkg.json)
//   gjsify install <pkg> [<pkg>...]   → add package(s) to project (native)
//   gjsify install -g <pkg> [...]     → user-global install (XDG, GJS-runnable bin)
//
// All three modes route through `@gjsify/{semver,npm-registry,tar}` via
// `installPackagesNative` — no Node/npm required at runtime. Set
// `GJSIFY_INSTALL_BACKEND=npm` to opt back into the legacy `npm install`
// subprocess flow (useful as escape-hatch for projects that hit a
// missing native-backend feature).
//
// Workspace-aware install (`gjsify install` in a monorepo root with a
// `"workspaces"` field) is Phase D.3 — for now we detect and surface a
// clear error pointing at the in-progress work.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { discoverWorkspaces } from '@gjsify/workspace';
import type { Command } from '../types/index.js';
import {
    buildInstallCommand,
    detectPackageManager,
    runMinimalChecks,
} from '../utils/check-system-deps.js';
import { detectNativePackages } from '../utils/detect-native-packages.js';
import { installPackages } from '../utils/install-backend.js';
import {
    binDirOnPath,
    defaultGlobalLayout,
    linkGlobalBins,
    specToPackageName,
} from '../utils/install-global.js';
import {
    addDependencyEntry,
    defaultRangeFromVersion,
    parseSpec,
    projectSpecsFromPackageJson,
    readPackageJson,
    writePackageJson,
    type DependencyKind,
} from '../utils/pkg-json-edit.js';

interface InstallOptions {
    packages?: string[];
    global?: boolean;
    'save-dev'?: boolean;
    'save-peer'?: boolean;
    'save-optional'?: boolean;
    immutable?: boolean;
    verbose: boolean;
}

export const installCommand: Command<any, InstallOptions> = {
    command: 'install [packages..]',
    description:
        'Install npm dependencies in the current project (or globally with -g), then run gjsify-aware post-checks.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Optional package specs. With none, runs a full project install.',
                type: 'string',
                array: true,
            })
            .option('global', {
                description:
                    'Install into the user-global XDG location and symlink bins into ~/.local/bin.',
                type: 'boolean',
                alias: 'g',
                default: false,
            })
            .option('save-dev', { type: 'boolean', alias: 'D' })
            .option('save-peer', { type: 'boolean' })
            .option('save-optional', { type: 'boolean', alias: 'O' })
            .option('immutable', {
                description:
                    'CI mode: install strictly from gjsify-lock.json, fail if the lockfile is missing or stale. Equivalent to yarn --immutable / npm ci --frozen-lockfile.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Verbose install logging.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        // --immutable is incompatible with explicit `<pkg>` adds and with
        // `--global` (which has no lockfile concept). Matches yarn's
        // behavior: `yarn add --immutable` is a hard error.
        if (args.immutable) {
            if (args.packages && args.packages.length > 0) {
                console.error(
                    'gjsify install --immutable does not accept package arguments. ' +
                    'Remove the package names or drop --immutable.',
                );
                process.exit(1);
            }
            if (args.global) {
                console.error('gjsify install --immutable is incompatible with --global.');
                process.exit(1);
            }
        }
        if (args.global) {
            if (!args.packages || args.packages.length === 0) {
                console.error(
                    'gjsify install --global requires at least one <pkg> argument.',
                );
                process.exit(1);
            }
            for (const flag of ['save-dev', 'save-peer', 'save-optional'] as const) {
                if (args[flag]) {
                    console.warn(
                        `gjsify install --global ignores --${flag}: global installs do not modify a project package.json.`,
                    );
                }
            }
            await installGlobalAndLink(args.packages, { verbose: args.verbose });
            return;
        }

        // Escape-hatch: legacy npm subprocess flow.
        if (process.env.GJSIFY_INSTALL_BACKEND === 'npm') {
            await projectInstallViaNpm(args);
            await runPostInstallChecks();
            return;
        }

        await projectInstallNative(args);
        await runPostInstallChecks();
    },
};

function isWorkspaceRoot(cwd: string): boolean {
    const pkgPath = join(cwd, 'package.json');
    const pkg = readPackageJson(pkgPath);
    if (!pkg) return false;
    return pkg.workspaces !== undefined;
}

function depKindFromArgs(args: InstallOptions): DependencyKind {
    if (args['save-dev']) return 'devDependencies';
    if (args['save-peer']) return 'peerDependencies';
    if (args['save-optional']) return 'optionalDependencies';
    return 'dependencies';
}

async function projectInstallNative(args: InstallOptions): Promise<void> {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    // Yarn-Berry / PnP detection: fall back to yarn with a clear warning
    // rather than producing a half-working node_modules tree.
    if (existsSync(join(cwd, '.pnp.cjs')) || existsSync(join(cwd, '.pnp.loader.mjs'))) {
        throw new Error(
            'gjsify install: detected Yarn PnP (.pnp.cjs) — native install is ' +
            'not PnP-aware yet. Use `yarn install` or set ' +
            'GJSIFY_INSTALL_BACKEND=npm.',
        );
    }

    // Workspace install (no args, root pkg.json has `workspaces`) — Phase D.3.
    // Project-local `gjsify install <pkg>` inside a workspace child still
    // goes through the single-package code path below (this branch only
    // fires for the root no-args case, which is the `yarn install`
    // equivalent).
    if ((!args.packages || args.packages.length === 0) && isWorkspaceRoot(cwd)) {
        await workspaceInstall(cwd, args);
        return;
    }

    let specs: string[];
    const pkg = readPackageJson(pkgPath);

    const existingSpecs = pkg ? projectSpecsFromPackageJson(pkg) : [];

    if (args.packages && args.packages.length > 0) {
        // Combine new specs with existing manifest deps so a single
        // `gjsify install <new>` doesn't churn the lockfile (would drop
        // every previously-pinned entry otherwise). New specs with the
        // same name as an existing dep override.
        const newNames = new Set(args.packages.map((s) => parseSpec(s).name));
        const carryover = existingSpecs.filter((s) => !newNames.has(parseSpec(s).name));
        specs = [...carryover, ...args.packages];
    } else {
        if (!pkg) {
            throw new Error(`gjsify install: no package.json in ${cwd}`);
        }
        specs = existingSpecs;
        if (specs.length === 0) {
            console.log('gjsify install: no dependencies declared in package.json — nothing to do.');
            return;
        }
    }

    mkdirSync(cwd, { recursive: true });
    const result = await installPackages({
        prefix: cwd,
        specs,
        verbose: args.verbose,
        // --immutable consumes the lockfile verbatim and must NOT rewrite
        // it (the whole point is byte-stability under CI).
        lockfile: !args.immutable,
        frozen: args.immutable,
    });

    // Update package.json only when the user passed explicit packages
    // (the `gjsify install <pkg>...` add-a-dep flow). The no-args refresh
    // flow doesn't mutate manifest entries.
    if (args.packages && args.packages.length > 0 && pkg) {
        const kind = depKindFromArgs(args);
        for (const spec of args.packages) {
            const { name, range } = parseSpec(spec);
            const installed = result.installed.find((r) => r.name === name);
            const finalRange = range ?? (installed ? defaultRangeFromVersion(installed.version) : 'latest');
            addDependencyEntry(pkg, name, finalRange, kind);
        }
        writePackageJson(pkgPath, pkg);

        // Re-sync the lockfile's `requested` field with what
        // `projectSpecsFromPackageJson()` will return on the next
        // invocation. Without this, a `gjsify install foo` (bare name,
        // lockfile records `"foo"`) followed by `gjsify install
        // --immutable` (reads package.json → spec `"foo@^1.2.3"`) would
        // surface a spurious drift error.
        if (!args.immutable) {
            syncLockfileRequested(cwd, projectSpecsFromPackageJson(pkg));
        }
    }
}

function syncLockfileRequested(cwd: string, specs: string[]): void {
    const lockPath = join(cwd, 'gjsify-lock.json');
    if (!existsSync(lockPath)) return;
    try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { requested?: string[] };
        const sorted = [...specs].sort();
        const current = [...(lock.requested ?? [])].sort();
        if (sorted.length === current.length && sorted.every((s, i) => s === current[i])) {
            return; // Already in sync; preserve byte-stability.
        }
        lock.requested = specs;
        writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch {
        // Best-effort sync; if the lockfile is malformed, the next
        // non-immutable install will rewrite it from scratch.
    }
}

/**
 * Phase D.3 — workspace-aware install. Mirrors what `yarn install` does
 * at a monorepo root:
 *   1. Discover every workspace under the root.
 *   2. Aggregate the union of their external (non-`workspace:`) deps.
 *   3. Run the native install backend ONCE at the root prefix so all
 *      externals land in a single `node_modules/` (poor-man's hoisting —
 *      we don't deduplicate version-range conflicts yet, the BFS resolver
 *      picks first-match).
 *   4. For every `workspace:` reference, symlink the target workspace's
 *      directory into the requesting workspace's `node_modules/<dep>`
 *      so `import '@gjsify/utils'` resolves to the local source.
 *
 * Hoisting strategy is intentionally minimal — D.3 ships the working
 * baseline; per-workspace dedup + nested `node_modules/` for version
 * conflicts are tracked as a follow-up in STATUS.md "Open TODOs".
 */
async function workspaceInstall(cwd: string, args: InstallOptions): Promise<void> {
    const workspaces = discoverWorkspaces(cwd, { includeRoot: true });
    if (workspaces.length === 0) {
        throw new Error(`gjsify install: ${cwd} has a "workspaces" field but no workspaces were discovered`);
    }
    const byName = new Map(workspaces.map((w) => [w.name, w] as const));
    const externalSpecs = new Set<string>();
    interface SymlinkPlan { fromWorkspaceName: string; depName: string; targetLocation: string; }
    const symlinks: SymlinkPlan[] = [];

    for (const ws of workspaces) {
        const m = ws.manifest;
        for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
            const block = m[kind];
            if (!block) continue;
            for (const [depName, spec] of Object.entries(block)) {
                if (typeof spec !== 'string') continue;
                if (spec.startsWith('workspace:')) {
                    const target = byName.get(depName);
                    if (!target) {
                        throw new Error(
                            `gjsify install: ${ws.name} declares "${depName}: ${spec}" but ` +
                            `no workspace with that name exists`,
                        );
                    }
                    symlinks.push({ fromWorkspaceName: ws.name, depName, targetLocation: target.location });
                    continue;
                }
                if (/^(link|file|portal|git\+|https?):/.test(spec)) continue;
                externalSpecs.add(`${depName}@${spec}`);
            }
        }
    }

    console.log(
        `gjsify install: ${workspaces.length} workspace(s), ${externalSpecs.size} external dep spec(s), ${symlinks.length} workspace symlink(s)`,
    );

    if (externalSpecs.size > 0) {
        await installPackages({
            prefix: cwd,
            specs: [...externalSpecs],
            verbose: args.verbose,
            lockfile: !args.immutable,
            frozen: args.immutable,
        });
    } else if (args.verbose) {
        console.log('gjsify install: no external deps to fetch');
    }

    for (const link of symlinks) {
        const target = byName.get(link.fromWorkspaceName);
        if (!target) continue;
        const linkPath = join(target.location, 'node_modules', link.depName);
        mkdirSync(dirname(linkPath), { recursive: true });
        // Remove any prior entry (regular dir, broken symlink, file).
        try {
            const stat = lstatSync(linkPath);
            if (stat.isSymbolicLink() || stat.isFile()) {
                rmSync(linkPath, { force: true });
            } else if (stat.isDirectory()) {
                rmSync(linkPath, { recursive: true, force: true });
            }
        } catch { /* ENOENT — fine, nothing to remove */ }
        // Relative symlink so the repo is portable across checkout paths.
        const relTarget = relative(dirname(linkPath), link.targetLocation);
        symlinkSync(relTarget, linkPath);
    }
    if (symlinks.length > 0) {
        console.log(`gjsify install: wired ${symlinks.length} workspace symlink(s)`);
    }

    // Link workspace bins into `node_modules/.bin/`. Without this,
    // `npm run <script>` (or any `node_modules/.bin`-PATH consumer)
    // cannot find the `gjsify` binary on a fresh checkout — yarn
    // creates these shims at install time; we need to match.
    //
    // Each workspace's `bin` entry maps `<binName>` → `<relative-target>`.
    // For GJS-runnable bins, `gjsify.bin` is preferred — its target is the
    // committed `dist/cli.gjs.mjs` bundle that exists on a fresh checkout,
    // versus the `bin` field which typically points at `lib/index.js`
    // (a build artifact that may not yet exist). The shim wraps the
    // target in a shell script that picks the right interpreter (`gjs -m`
    // for `.mjs` bundles, `node` for `.js` files).
    const wsBinDir = join(cwd, 'node_modules', '.bin');
    let wsBinsCreated = 0;
    for (const ws of workspaces) {
        const m = ws.manifest as Record<string, unknown>;
        const gjsifyBin = (m.gjsify as { bin?: string | Record<string, string> } | undefined)?.bin;
        const nodeBin = m.bin as string | Record<string, string> | undefined;
        // For each bin name, collect both the Node-target and GJS-target
        // when they exist. The shim prefers Node at invocation time
        // because Node's child_process is more reliable than GJS's
        // Gio.Subprocess polyfill (parallel-spawn close-event delivery
        // races under heavy concurrency); GJS is the fallback for fresh
        // checkouts where the Node target hasn't been built yet.
        const merged = mergeWorkspaceBins(ws.name, gjsifyBin, nodeBin);
        if (merged.size === 0) continue;
        mkdirSync(wsBinDir, { recursive: true });
        for (const [binName, { nodeTarget, gjsTarget }] of merged) {
            const linkPath = join(wsBinDir, binName);
            try { rmSync(linkPath, { force: true }); } catch { /* fine */ }
            writeFileSync(linkPath, buildBinShim(ws.location, nodeTarget, gjsTarget), { mode: 0o755 });
            chmodSync(linkPath, 0o755);
            wsBinsCreated++;
        }
    }
    if (wsBinsCreated > 0) {
        console.log(`gjsify install: linked ${wsBinsCreated} workspace bin(s) into node_modules/.bin/`);
    }
}

/**
 * Build a shell shim that prefers Node when its target file exists at
 * invocation time, falling back to GJS otherwise. The runtime check is
 * per-invocation (not at install time) so the same shim works both
 * before and after the workspace's `lib/` has been built — a fresh
 * checkout only has the committed `dist/cli.gjs.mjs`, while every
 * subsequent `npm run build` produces `lib/index.js`.
 *
 * Both targets are absolute paths so the shim is portable across the
 * different cwds that consumers (`yarn run`, `npm run`, direct PATH
 * invocation) call us from.
 */
function buildBinShim(wsLocation: string, nodeTarget?: string, gjsTarget?: string): string {
    const nodeAbs = nodeTarget ? join(wsLocation, nodeTarget) : null;
    const gjsAbs = gjsTarget ? join(wsLocation, gjsTarget) : null;
    if (nodeAbs && gjsAbs) {
        return `#!/bin/sh\nif [ -f "${nodeAbs}" ]; then\n  exec node "${nodeAbs}" "$@"\nfi\nexec gjs -m "${gjsAbs}" "$@"\n`;
    }
    if (nodeAbs) return `#!/bin/sh\nexec node "${nodeAbs}" "$@"\n`;
    if (gjsAbs) return `#!/bin/sh\nexec gjs -m "${gjsAbs}" "$@"\n`;
    throw new Error('buildBinShim: either nodeTarget or gjsTarget must be provided');
}

/**
 * Walk a workspace's `bin` (Node) + `gjsify.bin` (GJS) declarations
 * into a unified `<binName> → {nodeTarget?, gjsTarget?}` map. The
 * shim built from this picks Node at runtime when its target exists,
 * GJS otherwise.
 */
function mergeWorkspaceBins(
    pkgName: string,
    gjsifyBin: string | Record<string, string> | undefined,
    nodeBin: string | Record<string, string> | undefined,
): Map<string, { nodeTarget?: string; gjsTarget?: string }> {
    const out = new Map<string, { nodeTarget?: string; gjsTarget?: string }>();
    const baseName = pkgName.startsWith('@') ? pkgName.slice(pkgName.indexOf('/') + 1) : pkgName;
    const get = (key: string) => {
        let entry = out.get(key);
        if (!entry) { entry = {}; out.set(key, entry); }
        return entry;
    };
    if (typeof nodeBin === 'string') {
        get(baseName).nodeTarget = nodeBin;
    } else if (nodeBin && typeof nodeBin === 'object') {
        for (const [k, v] of Object.entries(nodeBin)) {
            if (typeof v === 'string' && v.length > 0) get(k).nodeTarget = v;
        }
    }
    if (typeof gjsifyBin === 'string') {
        get(baseName).gjsTarget = gjsifyBin;
    } else if (gjsifyBin && typeof gjsifyBin === 'object') {
        for (const [k, v] of Object.entries(gjsifyBin)) {
            if (typeof v === 'string' && v.length > 0) get(k).gjsTarget = v;
        }
    }
    return out;
}

async function projectInstallViaNpm(args: InstallOptions): Promise<void> {
    const npmArgs = ['install'];
    if (args['save-dev']) npmArgs.push('--save-dev');
    if (args['save-peer']) npmArgs.push('--save-peer');
    if (args['save-optional']) npmArgs.push('--save-optional');
    if (args.verbose) npmArgs.push('--loglevel', 'verbose');
    if (args.packages && args.packages.length > 0) {
        npmArgs.push(...args.packages);
    }
    await spawnNpm(npmArgs);
}

async function spawnNpm(npmArgs: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const child = spawn('npm', npmArgs, { stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install exited with code ${code}`));
        });
        child.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            const msg = code === 'ENOENT'
                ? 'npm not found on PATH — install Node.js first.'
                : `npm install failed: ${err.message}`;
            reject(new Error(msg));
        });
    }).catch((err: Error) => {
        console.error(err.message);
        process.exit(1);
    });
}

async function installGlobalAndLink(
    specs: string[],
    opts: { verbose: boolean },
): Promise<void> {
    const layout = defaultGlobalLayout();
    mkdirSync(layout.prefix, { recursive: true });

    console.log(`gjsify install --global  → ${layout.prefix}`);
    console.log(`                  bins → ${layout.binDir}`);

    await installPackages({
        prefix: layout.prefix,
        specs,
        verbose: opts.verbose,
    });

    const packageNames = specs.map(specToPackageName);
    const created = linkGlobalBins(packageNames, layout);

    if (created.length === 0) {
        console.warn(
            '\nNo bins declared (neither `gjsify.bin` nor `bin` in package.json) — nothing was symlinked.',
        );
    } else {
        console.log(`\nLinked ${created.length} bin(s):`);
        for (const e of created) {
            console.log(`  • ${e.link}  →  ${e.target}`);
        }
    }

    if (created.length > 0 && !binDirOnPath(layout.binDir)) {
        console.warn(
            `\nNote: ${layout.binDir} is not on your PATH.\n` +
                `Add it to your shell rc file:\n  export PATH="${layout.binDir}:$PATH"`,
        );
    }
}

async function runPostInstallChecks(): Promise<void> {
    console.log('\n--- gjsify post-install checks ---');

    // 1. System deps that GJS apps typically need.
    const results = runMinimalChecks();
    const missing = results.filter((r) => !r.found && r.severity === 'required');
    if (missing.length > 0) {
        console.warn('Missing required system dependencies:\n');
        for (const dep of missing) {
            console.warn(`  ✗  ${dep.name}`);
        }
        const pm = detectPackageManager();
        const cmd = buildInstallCommand(pm, missing);
        if (cmd) console.warn(`\nInstall with:\n  ${cmd}`);
    } else {
        console.log('System dependencies OK.');
    }

    // 2. Surface @gjsify/* packages with native prebuilds — `gjsify run`
    //    will set LD_LIBRARY_PATH / GI_TYPELIB_PATH for these automatically.
    const native = detectNativePackages(process.cwd());
    if (native.length > 0) {
        console.log(
            `\nDetected ${native.length} @gjsify/* package(s) with native prebuilds:`,
        );
        for (const pkg of native) {
            console.log(`  • ${pkg.name}`);
        }
        console.log('\nUse `gjsify run <bundle>` to launch with LD_LIBRARY_PATH/GI_TYPELIB_PATH set.');
    }
}
