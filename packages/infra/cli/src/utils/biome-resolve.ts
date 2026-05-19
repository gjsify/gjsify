// biome native-binary resolution + spawn helpers.
//
// Biome ships its real binary as per-platform optionalDependencies of
// `@biomejs/biome` (e.g. `@biomejs/cli-linux-x64/biome`). The published
// `bin/biome` script in @biomejs/biome is a Node.js launcher that picks
// the right platform package and spawns its binary. gjsify skips that
// Node launcher and resolves the platform-specific binary directly —
// same pattern as gjsify resolves @gjsify/<vala>-native prebuilds from
// node_modules at runtime.
//
// Resolution order (workspace-aware):
//   1. Project's local node_modules (cwd → cwd/node_modules)
//   2. Workspace root's node_modules (walk up via findWorkspaceRoot)
//   3. ENOENT → install hint

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { findWorkspaceRoot } from './workspace-root.js';

/** Map Node.js `process.platform` + `arch` to the biome platform-package suffix. */
function biomePackageSuffix(): string {
    const platform = process.platform;
    const arch = process.arch;

    let plat: string;
    if (platform === 'linux') plat = 'linux';
    else if (platform === 'darwin') plat = 'darwin';
    else if (platform === 'win32') plat = 'win32';
    else throw new Error(`[gjsify biome] Unsupported platform: ${platform}`);

    let a: string;
    if (arch === 'x64') a = 'x64';
    else if (arch === 'arm64') a = 'arm64';
    else throw new Error(`[gjsify biome] Unsupported arch on ${plat}: ${arch}`);

    // musl detection on Linux — biome ships separate musl binaries.
    // Standard approach (matches biome's own launcher): probe for the
    // musl loader. glibc systems have `/lib/ld-linux-*`, musl has
    // `/lib/ld-musl-*`.
    if (plat === 'linux') {
        try {
            const { readdirSync } = require('node:fs') as typeof import('node:fs');
            const libEntries = readdirSync('/lib');
            if (libEntries.some((e) => e.startsWith('ld-musl-'))) {
                return `${plat}-${a}-musl`;
            }
        } catch {
            // /lib unreadable — fall through, glibc is the safer default
        }
    }
    return `${plat}-${a}`;
}

/** Binary filename inside the platform package — `.exe` on Windows. */
function biomeBinFilename(): string {
    return process.platform === 'win32' ? 'biome.exe' : 'biome';
}

/**
 * Search a starting directory's `node_modules/<pkg>/<binFile>` for the
 * biome binary. Returns absolute path or null if not present.
 */
function probeNodeModules(dir: string, pkg: string, binFile: string): string | null {
    const candidate = join(dir, 'node_modules', pkg, binFile);
    return existsSync(candidate) ? candidate : null;
}

/**
 * Resolve the absolute path to the biome native binary for the current
 * platform. Walks cwd → workspace-root looking for the matching
 * `@biomejs/cli-<platform>-<arch>` package.
 *
 * Throws with a clear install-hint when not found.
 */
export function findBiomeBin(cwd: string = process.cwd()): string {
    const suffix = biomePackageSuffix();
    const pkg = `@biomejs/cli-${suffix}`;
    const binFile = biomeBinFilename();

    // 1. Local node_modules
    const local = probeNodeModules(cwd, pkg, binFile);
    if (local) return local;

    // 2. Walk up to workspace root, probe its node_modules
    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot && wsRoot !== cwd) {
        const fromRoot = probeNodeModules(wsRoot, pkg, binFile);
        if (fromRoot) return fromRoot;
    }

    // 3. Walk parent dirs as a last resort (handles nested-without-workspace setups)
    let dir = resolve(cwd, '..');
    for (let i = 0; i < 6; i++) {
        const found = probeNodeModules(dir, pkg, binFile);
        if (found) return found;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }

    throw new BiomeNotFoundError(pkg, cwd);
}

export class BiomeNotFoundError extends Error {
    constructor(public pkg: string, public cwd: string) {
        super(
            `[gjsify biome] biome native binary not found.\n` +
                `  Expected: ${pkg}/biome in node_modules of ${cwd} or any workspace root above it.\n` +
                `  Install it via: gjsify install -D @biomejs/biome\n` +
                `  (this adds @biomejs/biome to devDependencies; the matching @biomejs/cli-<platform>-<arch> ` +
                `package lands automatically as an optionalDependency.)`,
        );
        this.name = 'BiomeNotFoundError';
    }
}

/**
 * Walk up from a starting directory to find the nearest `biome.json` or
 * `biome.jsonc`. Returns absolute path or null. Workspace-aware: also
 * probes the workspace root.
 */
export function findBiomeConfig(cwd: string = process.cwd()): string | null {
    const candidates = ['biome.json', 'biome.jsonc'];

    let dir = cwd;
    for (let i = 0; i < 12; i++) {
        for (const name of candidates) {
            const path = join(dir, name);
            if (existsSync(path)) return path;
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

export interface RunBiomeOptions {
    cwd?: string;
    verbose?: boolean;
}

/**
 * Spawn biome with the given args. Inherits stdio so biome's own output
 * (formatted source, lint diagnostics, summary lines) reaches the user.
 *
 * Returns the exit code as a number; never throws on non-zero exit
 * (callers check the code).
 */
export function runBiome(args: string[], opts: RunBiomeOptions = {}): Promise<number> {
    const cwd = opts.cwd ?? process.cwd();
    const bin = findBiomeBin(cwd);

    if (opts.verbose) {
        console.log(`[gjsify biome] ${bin} ${args.join(' ')}`);
    }

    return new Promise((res, rej) => {
        const spawnOpts: SpawnOptions = { stdio: 'inherit', cwd };
        const child = spawn(bin, args, spawnOpts);

        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                rej(new BiomeNotFoundError(`<resolved bin>`, cwd));
            } else {
                rej(err);
            }
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                console.error(`[gjsify biome] terminated by signal ${signal}`);
                res(1);
                return;
            }
            res(code ?? 0);
        });
    });
}

/**
 * Lazy-load the embedded `biome.json.tmpl` content. The static-read-inliner
 * matches this readFileSync(new URL(<lit>, import.meta.url), 'utf-8')
 * shape at build time and inlines the file into the GJS bundle, so the
 * template is available without runtime file I/O against the install dir.
 */
export function loadBiomeTemplate(): string {
    return readFileSync(
        new URL('../templates/biome.json.tmpl', import.meta.url),
        'utf-8',
    );
}

/** Helper for callers to surface the install hint to the user cleanly. */
export function printBiomeNotFound(err: BiomeNotFoundError): void {
    console.error(err.message);
}

/**
 * Has `@biomejs/biome` (the npm wrapper package) been declared in the
 * project's `package.json` devDependencies or dependencies? Useful as a
 * cheap pre-flight check — `gjsify flatpak init`'s G.2 post-format hook
 * uses this to decide whether to auto-format its outputs.
 */
export function hasBiomeDevDep(cwd: string = process.cwd()): boolean {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return Boolean(
            pkg?.devDependencies?.['@biomejs/biome'] ||
                pkg?.dependencies?.['@biomejs/biome'],
        );
    } catch {
        return false;
    }
}
