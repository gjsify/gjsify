// `gjsify flatpak build` — wrap `flatpak-builder` with sensible defaults.
//
// Replaces the project-local `build-flatpak.sh`-style scripts: same flag
// shape (manifest, build-dir, install, repo, bundle), plus a `--tarball`
// helper for Flathub submissions.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from '../../types/index.js';

interface FlatpakBuildOptions {
    manifest?: string;
    buildDir?: string;
    install?: boolean;
    repo?: string;
    bundle?: string;
    tarball?: string;
    forceClean?: boolean;
    sandbox?: boolean;
    deleteBuildDirs?: boolean;
    installDepsFrom?: string;
    verbose?: boolean;
}

export const flatpakBuildCommand: Command<unknown, FlatpakBuildOptions> = {
    command: 'build [manifest]',
    description:
        'Build the Flatpak via `flatpak-builder`. Wraps a typical install + export + bundle + tarball pipeline.',
    builder: (yargs) => {
        return yargs
            .positional('manifest', {
                description: 'Path to the Flatpak manifest (default: first *.json that looks like a manifest in cwd)',
                type: 'string',
                normalize: true,
            })
            .option('build-dir', {
                description: 'flatpak-builder working directory',
                type: 'string',
                default: 'flatpak-build',
                normalize: true,
            })
            .option('install', {
                description: 'After build, run `flatpak-builder --user --install` to install locally',
                type: 'boolean',
                default: false,
            })
            .option('repo', {
                description: 'Export the build into the given OSTree repo (passes `--repo=<dir>` to flatpak-builder)',
                type: 'string',
                normalize: true,
            })
            .option('bundle', {
                description: 'After --repo export, build a single-file bundle (`flatpak build-bundle`) at this path',
                type: 'string',
                normalize: true,
            })
            .option('tarball', {
                description: 'Create a tarball of the build dir (parity with the legacy build-flatpak.sh tarball step)',
                type: 'string',
                normalize: true,
            })
            .option('force-clean', {
                description: 'Pass --force-clean to flatpak-builder (default true)',
                type: 'boolean',
                default: true,
            })
            .option('sandbox', {
                description: 'Pass --sandbox to flatpak-builder (default true)',
                type: 'boolean',
                default: true,
            })
            .option('delete-build-dirs', {
                description: 'Pass --delete-build-dirs to flatpak-builder (default true)',
                type: 'boolean',
                default: true,
            })
            .option('install-deps-from', {
                description: 'Pass --install-deps-from to flatpak-builder (e.g. `flathub`)',
                type: 'string',
            })
            .option('verbose', {
                description: 'Print the underlying flatpak-builder invocations',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const manifest = resolve(cwd, (args.manifest as string | undefined) ?? findDefaultManifest(cwd));
        if (!existsSync(manifest)) {
            throw new Error(`gjsify flatpak build: manifest ${manifest} not found`);
        }

        const buildDir = resolve(cwd, args.buildDir ?? 'flatpak-build');
        const sharedFlags: string[] = [];
        if (args.forceClean !== false) sharedFlags.push('--force-clean');
        if (args.sandbox !== false) sharedFlags.push('--sandbox');
        if (args.deleteBuildDirs !== false) sharedFlags.push('--delete-build-dirs');
        if (args.installDepsFrom) sharedFlags.push(`--install-deps-from=${args.installDepsFrom}`);

        // Reset the build dir so re-runs don't pick up half-stale state.
        if (existsSync(buildDir)) rmSync(buildDir, { recursive: true, force: true });

        await runFlatpakBuilder([...sharedFlags, buildDir, manifest], { verbose: args.verbose });

        if (args.install) {
            await runFlatpakBuilder(
                ['--user', '--install', '--force-clean', buildDir, manifest],
                { verbose: args.verbose },
            );
        }

        if (args.repo) {
            const repoPath = resolve(cwd, args.repo);
            mkdirSync(dirname(repoPath), { recursive: true });
            await runFlatpakBuilder(
                [`--repo=${repoPath}`, '--force-clean', buildDir, manifest],
                { verbose: args.verbose },
            );
        }

        if (args.bundle) {
            if (!args.repo) {
                throw new Error(
                    'gjsify flatpak build: --bundle requires --repo (the bundle is built from the OSTree repo).',
                );
            }
            const bundlePath = resolve(cwd, args.bundle);
            mkdirSync(dirname(bundlePath), { recursive: true });
            const repoPath = resolve(cwd, args.repo);
            const appId = readManifestAppId(manifest);
            await runFlatpak(
                ['build-bundle', repoPath, bundlePath, appId],
                { verbose: args.verbose },
            );
        }

        if (args.tarball) {
            const tarballPath = resolve(cwd, args.tarball);
            mkdirSync(dirname(tarballPath), { recursive: true });
            await runTar(['-czf', tarballPath, '-C', buildDir, '.'], { verbose: args.verbose });
        }

        console.log(`[gjsify flatpak build] done (${buildDir})`);
    },
};

/** Pick the first JSON file in cwd that looks like a Flatpak manifest. */
function findDefaultManifest(cwd: string): string {
    return scanForManifest(cwd) ?? 'flatpak.json';
}

function scanForManifest(cwd: string): string | undefined {
    let entries: string[] = [];
    try {
        entries = readdirSync(cwd);
    } catch {
        return undefined;
    }
    for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        if (name === 'package.json' || name === 'tsconfig.json' || name.startsWith('.')) continue;
        try {
            const json = JSON.parse(readFileSync(resolve(cwd, name), 'utf-8')) as Record<string, unknown>;
            if (typeof json.id === 'string' && typeof json.runtime === 'string' && Array.isArray(json.modules)) {
                return name;
            }
        } catch {
            // Not JSON or unreadable — skip.
        }
    }
    return undefined;
}

function readManifestAppId(manifest: string): string {
    const raw = readFileSync(manifest, 'utf-8');
    const json = JSON.parse(raw) as { id?: unknown };
    if (typeof json.id !== 'string') {
        throw new Error(`gjsify flatpak build: ${manifest} has no string "id" field`);
    }
    return json.id;
}

async function runFlatpakBuilder(args: string[], opts: { verbose?: boolean }) {
    return runProc('flatpak-builder', args, opts, {
        notFoundHint:
            'flatpak-builder not found. Install via your distro (Fedora: `sudo dnf install flatpak-builder`).',
    });
}

async function runFlatpak(args: string[], opts: { verbose?: boolean }) {
    return runProc('flatpak', args, opts, {
        notFoundHint: 'flatpak not found. Install via your distro and add Flathub: see https://flathub.org/setup.',
    });
}

async function runTar(args: string[], opts: { verbose?: boolean }) {
    return runProc('tar', args, opts, { notFoundHint: 'tar not found.' });
}

function runProc(
    cmd: string,
    args: string[],
    opts: { verbose?: boolean },
    extra: { notFoundHint: string },
): Promise<void> {
    if (opts.verbose) {
        console.log(`[gjsify flatpak] ${cmd} ${args.join(' ')}`);
    }
    return new Promise((res, rej) => {
        const child = spawn(cmd, args, { stdio: 'inherit' });
        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                rej(new Error(`gjsify flatpak: ${extra.notFoundHint}`));
            } else {
                rej(err);
            }
        });
        child.on('exit', (code) => {
            if (code === 0) res();
            else rej(new Error(`gjsify flatpak: ${cmd} exited with status ${code}`));
        });
    });
}
