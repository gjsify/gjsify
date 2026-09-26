// `gjsify exec <bin>` — the pure half: which file a bin name means, which runtime
// runs it, and the key its rebuilt artifact is cached under (ADR 0076).
//
// Kept free of spawning and bundling so every decision is unit-testable on any host;
// `commands/exec.ts` is the thin shell that acts on the answers.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { normalizeBinMap } from './bin-shim.js';
import { DEP_CHANGE_LOCKFILES } from './package-inputs.js';
import { readPackageJson } from './pkg-json.js';
import type { ExampleRuntime } from './runtimes.js';

/** `gjsify exec`'s own options and the bin invocation that follows them. */
export interface ExecInvocation {
    runtime: ExampleRuntime | null;
    rebuild: boolean;
    verbose: boolean;
    bin: string;
    args: string[];
}

const EXEC_RUNTIMES: readonly ExampleRuntime[] = ['gjs', 'node', 'bun', 'deno'];

/**
 * Split `gjsify exec [options] <bin> [args…]`. Options are gjsify's only BEFORE the
 * bin name; everything after it belongs to the bin, flags included, as with `npx`
 * — `gjsify exec wxt --runtime x` hands `--runtime x` to wxt. yargs cannot draw
 * that line (a declared option is taken wherever it appears), so the command
 * declares none and this function reads the leading ones.
 *
 * `tail` is what yargs split off at the first `--`: one AFTER the bin belongs to
 * the bin, one BEFORE it only separates (`gjsify exec -- --weird-bin-name`).
 */
export function splitExecArgv(entries: readonly string[], tail: readonly string[] = []): ExecInvocation {
    const out: Omit<ExecInvocation, 'bin' | 'args'> = { runtime: null, rebuild: false, verbose: false };
    const setRuntime = (value: string | undefined): void => {
        if (value === undefined || !(EXEC_RUNTIMES as readonly string[]).includes(value)) {
            throw new ExecPlanError(
                `gjsify exec: --runtime expects one of ${EXEC_RUNTIMES.join(', ')}, got ${value === undefined ? 'nothing' : `"${value}"`}.`,
            );
        }
        out.runtime = value as ExampleRuntime;
    };
    let i = 0;
    for (; i < entries.length; i++) {
        const word = entries[i]!;
        if (!word.startsWith('-')) break;
        if (word === '--rebuild') out.rebuild = true;
        else if (word === '--verbose') out.verbose = true;
        else if (word === '--runtime') setRuntime(entries[++i]);
        else if (word.startsWith('--runtime=')) setRuntime(word.slice('--runtime='.length));
        else {
            throw new ExecPlanError(
                `gjsify exec: unknown option "${word}" before the bin name. Options for the bin go AFTER it ` +
                    '(`gjsify exec <bin> --flag`); gjsify exec itself takes --runtime <gjs|node|bun|deno>, --rebuild, --verbose.',
            );
        }
    }
    if (i < entries.length) {
        return { ...out, bin: entries[i]!, args: [...entries.slice(i + 1), ...(tail.length ? ['--', ...tail] : [])] };
    }
    if (tail.length > 0) return { ...out, bin: tail[0]!, args: tail.slice(1) };
    throw new ExecPlanError('gjsify exec: no bin given. Usage: gjsify exec [--runtime <r>] [--rebuild] <bin> [args…]');
}

/** A bin name resolved to the files that implement it. */
export interface ResolvedBin {
    binName: string;
    pkgName: string;
    pkgVersion: string;
    /** Real path of the owning package's directory. */
    pkgDir: string;
    /** npm `bin` target (real path) — the file node/bun/deno run. Null when only `gjsify.bin` names it. */
    entry: string | null;
    /** `gjsify.bin` target (real path) — a bundle the package already ships for GJS. */
    gjsEntry: string | null;
    /**
     * The `node_modules` directory the package was found through, or null for the
     * project's OWN bin. The rebuilt bundle is written below it — see
     * {@link execCacheRoot} for why it cannot live in the XDG cache.
     */
    nodeModules: string | null;
    /**
     * True when the package's real location is inside a `node_modules` tree, i.e. an
     * INSTALLED copy whose version string identifies its content. A workspace link or
     * the project's own bin is edited in place without a version bump, so its rebuild
     * is never reused.
     */
    installed: boolean;
}

export class ExecBinNotFoundError extends Error {
    constructor(
        readonly binName: string,
        readonly searched: readonly string[],
    ) {
        super(
            `gjsify exec: no bin named "${binName}" in this project.\n` +
                `Looked in the nearest package.json and in:\n${searched.map((d) => `  ${d}`).join('\n') || '  (no node_modules found)'}\n` +
                `Install the package that provides it (\`gjsify install <pkg>\`), or use \`gjsify dlx\` for a one-off run.`,
        );
        this.name = 'ExecBinNotFoundError';
    }
}

export class ExecPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExecPlanError';
    }
}

type Manifest = {
    name?: string;
    version?: string;
    bin?: string | Record<string, string>;
    gjsify?: { bin?: string | Record<string, string> };
};

function readManifest(pkgDir: string): Manifest | null {
    return readPackageJson(join(pkgDir, 'package.json')) as Manifest | null;
}

function realOrNull(path: string): string | null {
    try {
        return realpathSync(path);
    } catch {
        return null;
    }
}

function isInsideNodeModules(path: string): boolean {
    return path.split(sep).includes('node_modules');
}

/** The bin's targets in `pkgDir`, or null when the package does not declare `binName`. */
function binFromPackage(pkgDir: string, binName: string, nodeModules: string | null): ResolvedBin | null {
    const manifest = readManifest(pkgDir);
    if (!manifest?.name) return null;
    const npmTarget =
        manifest.bin === undefined ? undefined : normalizeBinMap(manifest.name, manifest.bin).get(binName);
    const gjsTarget =
        manifest.gjsify?.bin === undefined
            ? undefined
            : normalizeBinMap(manifest.name, manifest.gjsify.bin).get(binName);
    if (npmTarget === undefined && gjsTarget === undefined) return null;
    const realDir = realOrNull(pkgDir) ?? resolve(pkgDir);
    // A declared target that is not on disk is a broken install, not a different bin:
    // report it as unresolvable rather than silently picking another package.
    const entry = npmTarget === undefined ? null : realOrNull(join(pkgDir, npmTarget));
    const gjsEntry = gjsTarget === undefined ? null : realOrNull(join(pkgDir, gjsTarget));
    if (entry === null && gjsEntry === null) return null;
    return {
        binName,
        pkgName: manifest.name,
        pkgVersion: manifest.version ?? '0.0.0',
        pkgDir: realDir,
        entry,
        gjsEntry,
        nodeModules,
        installed: isInsideNodeModules(realDir),
    };
}

/** Top-level package directories of a `node_modules` (scoped ones expanded). */
function listPackages(nodeModules: string): string[] {
    const out: string[] = [];
    let names: string[];
    try {
        names = readdirSync(nodeModules);
    } catch {
        return out;
    }
    for (const name of names) {
        if (name.startsWith('.')) continue;
        if (name.startsWith('@')) {
            let scoped: string[];
            try {
                scoped = readdirSync(join(nodeModules, name));
            } catch {
                continue;
            }
            for (const s of scoped) out.push(join(nodeModules, name, s));
        } else {
            out.push(join(nodeModules, name));
        }
    }
    return out;
}

/**
 * The package that owns the file `.bin/<name>` links to: the nearest ancestor with a
 * `package.json` that declares the bin. npm, pnpm and yarn all write a SYMLINK there
 * on POSIX, which makes this the cheap path.
 */
function ownerOfLinkedBin(linkTarget: string, binName: string, nodeModules: string): ResolvedBin | null {
    let dir = dirname(linkTarget);
    for (;;) {
        if (existsSync(join(dir, 'package.json'))) {
            const hit = binFromPackage(dir, binName, nodeModules);
            if (hit && (hit.entry === linkTarget || hit.gjsEntry === linkTarget)) return hit;
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Resolve `binName` the way `npx` does for an installed bin: the project's OWN
 * `package.json#bin` first, then every `node_modules` from `cwd` up to the root.
 *
 * `.bin/<name>` is only a HINT. Its shape depends on who wrote it — a symlink (npm,
 * pnpm), an `sh` launcher (`gjsify install` for a `gjsify.bin`), a `.cmd`/`.ps1` pair
 * (Windows) — and only the symlink names its target, so the other shapes fall back to
 * reading the package manifests of that `node_modules`. A package whose NAME is the
 * bin name wins that scan, as `npx <pkg>` would pick it.
 */
export function resolveExecBin(binName: string, cwd: string): ResolvedBin {
    const searched: string[] = [];

    let dir = resolve(cwd);
    for (;;) {
        if (existsSync(join(dir, 'package.json'))) {
            const own = binFromPackage(dir, binName, null);
            if (own) return own;
            break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    dir = resolve(cwd);
    for (;;) {
        const nodeModules = join(dir, 'node_modules');
        if (existsSync(nodeModules)) {
            searched.push(nodeModules);
            const binDir = join(nodeModules, '.bin');
            const hint = [binName, `${binName}.cmd`].some((n) => existsSync(join(binDir, n)));
            if (hint) {
                const link = join(binDir, binName);
                const isLink = (() => {
                    try {
                        return lstatSync(link).isSymbolicLink();
                    } catch {
                        return false;
                    }
                })();
                const linkTarget = isLink ? realOrNull(link) : null;
                const linked = linkTarget ? ownerOfLinkedBin(linkTarget, binName, nodeModules) : null;
                if (linked) return linked;
                const candidates = listPackages(nodeModules).sort(
                    (a, b) => Number(basename(b) === binName) - Number(basename(a) === binName),
                );
                for (const pkgDir of candidates) {
                    const hit = binFromPackage(pkgDir, binName, nodeModules);
                    if (hit) return hit;
                }
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new ExecBinNotFoundError(binName, searched);
}

/** What `gjsify exec` does with a resolved bin on a given runtime. */
export type ExecPlan =
    /** node/bun/deno: run the npm entry unchanged — nothing is built. */
    | { kind: 'direct'; runtime: Exclude<ExampleRuntime, 'gjs'>; file: string }
    /** gjs, and the package ships its own GJS bundle (`gjsify.bin`): run that. */
    | { kind: 'gjs-bundle'; file: string }
    /** gjs, Node-only package: rebuild the npm entry `--app gjs`, then run the bundle. */
    | { kind: 'rebuild'; entry: string };

/**
 * Pick the plan. `runtime` is the HOST runtime unless the caller passed an explicit
 * `--runtime`; there is no implicit fallback from gjs to node — a failed rebuild is
 * reported, never papered over by a runtime the user did not ask for.
 */
export function planExec(bin: ResolvedBin, runtime: ExampleRuntime): ExecPlan {
    if (runtime === 'gjs') {
        if (bin.gjsEntry) return { kind: 'gjs-bundle', file: bin.gjsEntry };
        if (bin.entry) return { kind: 'rebuild', entry: bin.entry };
    } else if (bin.entry) {
        return { kind: 'direct', runtime, file: bin.entry };
    } else {
        throw new ExecPlanError(
            `gjsify exec: "${bin.binName}" from ${bin.pkgName} is declared only as a GJS bundle (\`gjsify.bin\`), ` +
                `which ${runtime} cannot run. Run it on GJS: \`gjsify exec --runtime gjs ${bin.binName}\`.`,
        );
    }
    throw new ExecPlanError(`gjsify exec: "${bin.binName}" from ${bin.pkgName} names no file that exists.`);
}

/** Inputs that decide whether a cached rebuild still describes the bin. */
export interface ExecCacheKeyInput {
    pkgName: string;
    pkgVersion: string;
    /** The entry, relative to the package directory. */
    entry: string;
    /** The running CLI's version: a new bundler or polyfill set is a new artifact. */
    cliVersion: string;
    /** sha256 of the project's lockfile, or null when there is none. */
    lockfileHash: string | null;
}

/**
 * Content key of a rebuilt bin. The package version identifies the entry's own code;
 * the LOCKFILE identifies its dependencies, which a reinstall can move without the
 * version changing; the CLI version identifies the bundler and every polyfill that
 * went into the artifact. With no lockfile, dependency drift is invisible to the key,
 * which is why `--rebuild` exists.
 */
export function execCacheKey(input: ExecCacheKeyInput): string {
    const payload = JSON.stringify([
        'gjsify-exec/v1',
        input.pkgName,
        input.pkgVersion,
        input.entry.split(sep).join('/'),
        input.cliVersion,
        input.lockfileHash,
    ]);
    return createHash('sha256').update(payload).digest('hex');
}

/** Lockfiles that pin a dependency tree, `DEP_CHANGE_LOCKFILES` plus bun's. */
const EXEC_LOCKFILES = [...DEP_CHANGE_LOCKFILES, 'bun.lock', 'bun.lockb'] as const;

/** The nearest lockfile walking up from `start`, or null. */
export function findProjectLockfile(start: string): string | null {
    let dir = resolve(start);
    for (;;) {
        for (const name of EXEC_LOCKFILES) {
            const candidate = join(dir, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

export function hashFile(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Where rebuilt bins are written: `<node_modules>/.cache/gjsify/exec/`.
 *
 * NOT `$XDG_CACHE_HOME`, although the key is content-addressed and would allow it:
 * a bundled dependency that reads its own files (`package.json` for `--version`, a
 * template, a locale) has its `import.meta.url`/`__dirname` rewritten to resolve the
 * package AT RUNTIME from the bundle's location (`shims/module-resolve.ts`). From a
 * directory outside the project's `node_modules` that walk finds nothing and falls
 * back to the bundle's own directory, so the read misses.
 */
export function execCacheRoot(nodeModules: string): string {
    return join(nodeModules, '.cache', 'gjsify', 'exec');
}

/**
 * Directory + file name of a rebuilt bin. The hash goes in the DIRECTORY and the
 * file keeps the entry's basename: a bin that tests `process.argv[1]` against its
 * own name (the standard is-main guard) must still see it — the same lesson as
 * `bundleFileForGjsCached`'s layout.
 */
export function execArtifactPath(
    cacheRoot: string,
    bin: Pick<ResolvedBin, 'pkgName' | 'pkgVersion'>,
    entry: string,
    key: string,
): string {
    const safe = `${bin.pkgName}@${bin.pkgVersion}`.replace(/[^a-zA-Z0-9._@-]/g, '_');
    return join(cacheRoot, `${safe}-${key.slice(0, 16)}`, artifactFileName(entry));
}

/**
 * The entry's basename, except that `.cjs` becomes `.mjs`: the artifact is ESM, and
 * the bundler reads the output FORMAT off a `.cjs` file name — measured on prettier's
 * `bin/prettier.cjs`, whose rebuild came out as CommonJS with `require("gi://GLib")`
 * and died under gjs with `ReferenceError: require is not defined`.
 */
export function artifactFileName(entry: string): string {
    return basename(entry).replace(/\.cjs$/i, '.mjs');
}

/** The entry path relative to its package, for the key. */
export function entryWithinPackage(bin: Pick<ResolvedBin, 'pkgDir'>, entry: string): string {
    return relative(bin.pkgDir, entry);
}
