// oxc (oxlint + oxfmt) resolution + spawn helpers.
//
// Replaces the former `biome-resolve.ts`. oxc ships its tools differently
// from Biome:
//
//   - The user-facing npm packages `oxlint` and `oxfmt` are thin Node ESM
//     launchers (`bin/oxlint` → `dist/cli.js`, `bin/oxfmt` → `dist/cli.js`).
//   - The actual native code lives in per-platform NAPI binding packages
//     (`@oxlint/binding-<target>`, `@oxfmt/binding-<target>`, e.g.
//     `@oxlint/binding-linux-x64-gnu`), declared as optionalDependencies of
//     the launcher package and loaded via napi-rs's `requireNative()`.
//
// Unlike Biome — whose per-platform package was a single self-contained Rust
// binary we could spawn directly, skipping its Node launcher — oxlint's JS
// plugin API (used by the internal `oxlint-plugin-gjsify` rule) lives in the
// JS launcher (`dist/cli.js`). The plugin host loads `.ts`/`.js` plugin files
// at runtime, so a configured plugin REQUIRES spawning oxlint through its Node
// launcher rather than calling a bare binary. We therefore resolve and spawn
// the package launcher with `node` for both tools — uniform and correct for
// the plugin case.
//
// Resolution order (workspace-aware) for each launcher:
//   1. Project's local node_modules (cwd)
//   2. Workspace root's node_modules (walk up via findWorkspaceRoot)
//   3. Parent dirs as a last resort
//   4. ENOENT → install hint
//
// We still reuse Biome's platform/arch/musl detection — it's used to name the
// expected NAPI binding package in the not-found install hint, so the user
// knows exactly which optionalDependency npm failed to place.

import { existsSync, readFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { findWorkspaceRoot } from './workspace-root.js';

export type OxcTool = 'oxlint' | 'oxfmt';

/**
 * Map Node.js `process.platform` + `arch` (+ musl on Linux) to the
 * napi-rs binding-package suffix oxc uses, e.g. `linux-x64-gnu`,
 * `linux-x64-musl`, `darwin-arm64`, `win32-x64-msvc`.
 *
 * Mirrors biome-resolve's platform detection (same musl probe), adapted to
 * oxc's napi-rs target naming (gnu/musl libc suffix on Linux, -msvc on
 * Windows).
 */
function oxcBindingSuffix(): string {
    const platform = process.platform;
    const arch = process.arch;

    let plat: string;
    if (platform === 'linux') plat = 'linux';
    else if (platform === 'darwin') plat = 'darwin';
    else if (platform === 'win32') plat = 'win32';
    else throw new Error(`[gjsify oxc] Unsupported platform: ${platform}`);

    let a: string;
    if (arch === 'x64') a = 'x64';
    else if (arch === 'arm64') a = 'arm64';
    else throw new Error(`[gjsify oxc] Unsupported arch on ${plat}: ${arch}`);

    if (plat === 'linux') {
        // musl detection on Linux — oxc ships separate musl/gnu bindings.
        // Same approach as biome's launcher: probe for the musl loader.
        // glibc systems have `/lib/ld-linux-*`, musl has `/lib/ld-musl-*`.
        let libc = 'gnu';
        try {
            const { readdirSync } = require('node:fs') as typeof NodeFs;
            const libEntries = readdirSync('/lib');
            if (libEntries.some((e) => e.startsWith('ld-musl-'))) {
                libc = 'musl';
            }
        } catch {
            // /lib unreadable — fall through, glibc is the safer default
        }
        return `${plat}-${a}-${libc}`;
    }

    if (plat === 'win32') return `${plat}-${a}-msvc`;
    // darwin
    return `${plat}-${a}`;
}

/** NAPI binding scope per tool: `@oxlint/binding-*` / `@oxfmt/binding-*`. */
function bindingPackageName(tool: OxcTool): string {
    const scope = tool === 'oxlint' ? '@oxlint' : '@oxfmt';
    return `${scope}/binding-${oxcBindingSuffix()}`;
}

/**
 * Search a starting directory's `node_modules/<pkg>/<relPath>` and return the
 * absolute path if it exists, else null.
 */
function probeNodeModules(dir: string, pkg: string, relPath: string): string | null {
    const candidate = join(dir, 'node_modules', pkg, relPath);
    return existsSync(candidate) ? candidate : null;
}

/**
 * Resolve the absolute path to a tool's Node ESM launcher
 * (`node_modules/<tool>/bin/<tool>`). Walks cwd → workspace-root → parents.
 *
 * Throws {@link OxcNotFoundError} with a clear install hint when not found.
 */
export function findOxcLauncher(tool: OxcTool, cwd: string = process.cwd()): string {
    const relPath = join('bin', tool);

    // 1. Local node_modules
    const local = probeNodeModules(cwd, tool, relPath);
    if (local) return local;

    // 2. Walk up to workspace root, probe its node_modules
    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot && wsRoot !== cwd) {
        const fromRoot = probeNodeModules(wsRoot, tool, relPath);
        if (fromRoot) return fromRoot;
    }

    // 3. Walk parent dirs as a last resort (nested-without-workspace setups)
    let dir = resolve(cwd, '..');
    for (let i = 0; i < 6; i++) {
        const found = probeNodeModules(dir, tool, relPath);
        if (found) return found;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }

    throw new OxcNotFoundError(tool, cwd);
}

export class OxcNotFoundError extends Error {
    constructor(
        public tool: OxcTool,
        public cwd: string,
    ) {
        const binding = (() => {
            try {
                return bindingPackageName(tool);
            } catch {
                return `@${tool === 'oxlint' ? 'oxlint' : 'oxfmt'}/binding-<platform>`;
            }
        })();
        super(
            `[gjsify oxc] ${tool} not found.\n` +
                `  Expected: ${tool}/bin/${tool} in node_modules of ${cwd} or any workspace root above it.\n` +
                `  Install it via: gjsify install -D ${tool}\n` +
                `  (this adds ${tool} to devDependencies; the matching ${binding} ` +
                `napi binding lands automatically as an optionalDependency.)`,
        );
        this.name = 'OxcNotFoundError';
    }
}

/**
 * Walk up from a starting directory to find the nearest oxlint config
 * (`.oxlintrc.json`). Returns absolute path or null.
 */
export function findOxlintConfig(cwd: string = process.cwd()): string | null {
    return findConfigFile(cwd, ['.oxlintrc.json']);
}

/**
 * Walk up from a starting directory to find the nearest oxfmt config
 * (`.oxfmtrc` / `.oxfmtrc.json`). Returns absolute path or null.
 */
export function findOxfmtConfig(cwd: string = process.cwd()): string | null {
    return findConfigFile(cwd, ['.oxfmtrc', '.oxfmtrc.json']);
}

function findConfigFile(cwd: string, names: string[]): string | null {
    let dir = cwd;
    for (let i = 0; i < 12; i++) {
        for (const name of names) {
            const path = join(dir, name);
            if (existsSync(path)) return path;
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

export interface RunOxcOptions {
    cwd?: string;
    verbose?: boolean;
}

/**
 * Spawn an oxc tool (oxlint / oxfmt) via its Node ESM launcher. Inherits
 * stdio so the tool's own output (diagnostics, reformatted files, summary
 * lines) reaches the user.
 *
 * The launcher is run with the current Node executable (`process.execPath`)
 * so the JS plugin host is available — required for oxlint's `jsPlugins`.
 *
 * Returns the exit code; never throws on non-zero exit (callers check it).
 */
export function runOxc(tool: OxcTool, args: string[], opts: RunOxcOptions = {}): Promise<number> {
    const cwd = opts.cwd ?? process.cwd();
    const launcher = findOxcLauncher(tool, cwd);
    const node = process.execPath || 'node';

    if (opts.verbose) {
        console.log(`[gjsify oxc] ${node} ${launcher} ${args.join(' ')}`);
    }

    return new Promise((res, rej) => {
        const spawnOpts: SpawnOptions = { stdio: 'inherit', cwd };
        const child = spawn(node, [launcher, ...args], spawnOpts);

        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                rej(new OxcNotFoundError(tool, cwd));
            } else {
                rej(err);
            }
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                console.error(`[gjsify oxc] ${tool} terminated by signal ${signal}`);
                res(1);
                return;
            }
            res(code ?? 0);
        });
    });
}

/** Convenience wrappers. */
export function runOxlint(args: string[], opts: RunOxcOptions = {}): Promise<number> {
    return runOxc('oxlint', args, opts);
}

export function runOxfmt(args: string[], opts: RunOxcOptions = {}): Promise<number> {
    return runOxc('oxfmt', args, opts);
}

/**
 * Lazy-load the embedded `.oxlintrc.json` scaffold template. The
 * static-read-inliner matches this `readFileSync(new URL(<lit>,
 * import.meta.url), 'utf-8')` shape at build time and inlines the file into
 * the GJS bundle, so the template is available without runtime file I/O
 * against the install dir. (Same mechanism the old `loadBiomeTemplate()`
 * relied on — the shape must stay exactly this for the inliner to fire.)
 */
export function loadOxlintTemplate(): string {
    return readFileSync(new URL('../templates/oxlintrc.json.tmpl', import.meta.url), 'utf-8');
}

/** Lazy-load the embedded `.oxfmtrc` scaffold template (same inliner shape). */
export function loadOxfmtTemplate(): string {
    return readFileSync(new URL('../templates/oxfmtrc.tmpl', import.meta.url), 'utf-8');
}

/** Helper for callers to surface the install hint to the user cleanly. */
export function printOxcNotFound(err: OxcNotFoundError): void {
    console.error(err.message);
}

/**
 * Has the given oxc tool's npm package (or its companion) been declared in the
 * project's dependencies? Useful as a cheap pre-flight check — `gjsify flatpak
 * init`'s post-format hook uses this to decide whether to auto-format outputs.
 *
 * Checks for `oxfmt` by default (the formatter), since that is what the
 * post-format hook would invoke.
 */
export function hasOxcDevDep(cwd: string = process.cwd(), tool: OxcTool = 'oxfmt'): boolean {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return Boolean(pkg?.devDependencies?.[tool] || pkg?.dependencies?.[tool]);
    } catch {
        return false;
    }
}
