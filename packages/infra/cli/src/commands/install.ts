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

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
            .option('verbose', {
                description: 'Verbose install logging.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
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

    // Workspace install (no args, root pkg.json has `workspaces`) is Phase
    // D.3 — surface a precise error so users don't get a confusing partial
    // result. Project-local `gjsify install <pkg>` inside a workspace child
    // works fine (this branch checks only cwd's pkg.json).
    if ((!args.packages || args.packages.length === 0) && isWorkspaceRoot(cwd)) {
        throw new Error(
            'gjsify install: this project declares a "workspaces" field but ' +
            'workspace-aware install is not yet wired (Phase D.3). For now run ' +
            '`yarn install` for the full monorepo install, or set ' +
            'GJSIFY_INSTALL_BACKEND=npm to delegate to npm.',
        );
    }

    // Yarn-Berry / PnP detection: fall back to yarn with a clear warning
    // rather than producing a half-working node_modules tree.
    if (existsSync(join(cwd, '.pnp.cjs')) || existsSync(join(cwd, '.pnp.loader.mjs'))) {
        throw new Error(
            'gjsify install: detected Yarn PnP (.pnp.cjs) — native install is ' +
            'not PnP-aware yet. Use `yarn install` or set ' +
            'GJSIFY_INSTALL_BACKEND=npm.',
        );
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
        lockfile: true,
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
    }
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
