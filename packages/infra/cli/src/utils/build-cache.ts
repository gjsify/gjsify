// SPDX-License-Identifier: MIT
// Content-hash per-package build cache (ADR 0006 phase 1).
//
// `gjsify workspace <name> <script> --cached` / `gjsify foreach <script>
// --cached` skip re-running a build-ish script for a workspace package whose
// inputs are unchanged, restoring the previously stored outputs instead.
//
// Cache key per package = sha256 over:
//   - a layout version (bump BUILD_CACHE_LAYOUT_VERSION to invalidate all),
//   - the script name + forwarded args,
//   - a toolchain salt (workspace-resolved versions of @gjsify/cli,
//     @gjsify/tsc, rolldown, typescript — a bundler/compiler bump must
//     invalidate everything),
//   - the package's own input hash (every file under `src/**`, plus
//     `package.json`, plus the package's root `tsconfig*.json` — real file
//     contents, streamed sha256, sorted for determinism),
//   - the input hashes of EVERY workspace dependency in the package's
//     transitive dep closure (prod + dev + optional + peer `workspace:`
//     edges). Composing the closure's OWN hashes (instead of recursing into
//     dep KEYS) gives identical invalidation semantics — any change in any
//     transitive dep changes this package's key — while staying well-defined
//     on the cyclic dev-dependency graphs this monorepo actually has.
//
// Storage layout (per workspace root):
//   node_modules/.cache/gjsify/build/<pkg-name-sanitized>/<key>/
//     manifest.json          — { package, script, key, dirs, outputsHash, … }
//     outputs/<dir>/…        — copies of the output dirs the build MODIFIED
//
// Output contract: after a successful (miss) run, the candidate output dirs
// (`lib/`, `dist/`, `dist-templates/`) are expanded into OUTPUT UNITS — the
// candidate's immediate sub-directories when it holds only directories
// (`lib/esm`, `lib/types`), else the candidate itself — compared against a
// pre-run snapshot, and ONLY the units the script actually created/modified
// are stored. On a later hit, EXACTLY those units are replaced
// (delete-then-copy within the package). This is the safety rule from the
// v0.x CI incident where a raw YAML cache restored over a package whose
// committed `lib/` is tracked source: a unit the build never touches is never
// recorded, so it can never be restored over. The sub-directory granularity
// additionally keeps the two halves of the dual emit apart — `build:gjsify`
// (→ `lib/esm`) and `build:types` (→ `lib/types`) both write under `lib/`, and
// at whole-dir granularity a cache hit on one WIPED the other's output. See
// `outputUnits`. Packages that don't define the script at all are filtered out
// by the calling command and never reach the cache.
//
// Growth is bounded: at most MAX_KEYS_PER_PACKAGE entries per package,
// oldest (by last store/use) evicted.
//
// Every cache operation is fail-soft: an unreadable cache entry, a full disk
// or a permission error degrade to "run the script uncached" — a cache
// hiccup must never break a build.

import { createHash } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    existsSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    readSync,
    renameSync,
    rmSync,
    copyFileSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDependencyGraph, type DependencyGraph, type Workspace } from '@gjsify/workspace';
import { replicateLinkSync } from './dir-link.js';

/**
 * Bump to invalidate every existing cache entry (schema/semantic changes).
 *
 * v2: output ownership moved from the whole candidate dir to per-child
 * "output units" (`lib/esm` vs `lib/types`) — a v1 manifest recording `lib`
 * would restore over the sibling subtree a different script owns.
 *
 * v3: a `.tsbuildinfo` inside a candidate dir no longer counts as a loose file
 * (see {@link outputUnits}). The six packages that emit one into `lib/` were
 * still on v2's whole-dir ownership and could restore over a sibling unit; a v2
 * manifest for them records `lib`, so it must not be replayed against the
 * per-child units this version stores.
 */
export const BUILD_CACHE_LAYOUT_VERSION = 'v3';

/** Conventional per-package build output directories, checked in this order. */
export const OUTPUT_DIR_CANDIDATES = ['lib', 'dist', 'dist-templates'] as const;

/** Keep at most this many keys per package; evict the least recently stored/used. */
export const MAX_KEYS_PER_PACKAGE = 2;

/** Toolchain packages whose resolved versions salt every cache key. */
export const TOOLCHAIN_PACKAGES = ['@gjsify/cli', '@gjsify/tsc', 'rolldown', 'typescript'] as const;

export interface BuildCacheManifest {
    version: 1;
    layout: string;
    package: string;
    script: string;
    key: string;
    /** Output dirs (relative to the package dir) the build modified. */
    dirs: string[];
    /** Content hash of the stored output dirs (mtime-independent). */
    outputsHash: string;
    createdAt: string;
    usedAt: string;
}

/** `true` when GJSIFY_BUILD_CACHE is set to a non-empty, non-"0"/"false" value. */
export function buildCacheEnabledByEnv(env: Record<string, string | undefined> = process.env): boolean {
    const v = env['GJSIFY_BUILD_CACHE'];
    if (v === undefined) return false;
    return v !== '' && v !== '0' && v !== 'false';
}

/** Cache root for a workspace: `<root>/node_modules/.cache/gjsify/build`. */
export function buildCacheRoot(workspaceRoot: string): string {
    return join(workspaceRoot, 'node_modules', '.cache', 'gjsify', 'build');
}

/**
 * Directory-safe package name. Scoped names collapse (`@gjsify/cli` →
 * `gjsify-cli`); an 8-hex sha256 suffix of the exact name rules out
 * collisions between e.g. `@a/b-c` and `@a-b/c`.
 */
export function sanitizePackageDirName(name: string): string {
    const cleaned = name.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '-');
    const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
    return `${cleaned}-${suffix}`;
}

/** Streamed sha256 of one file (bounded memory, real contents). */
export function hashFileStream(path: string): string {
    const hash = createHash('sha256');
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(64 * 1024);
        for (;;) {
            const n = readSync(fd, buf, 0, buf.length, null);
            if (n <= 0) break;
            hash.update(buf.subarray(0, n));
        }
    } finally {
        closeSync(fd);
    }
    return hash.digest('hex');
}

// Recursive, sorted file walk. Yields workspace-relative paths (forward
// slashes). Directory symlinks are NOT followed (loop safety) — the link
// target string participates in the hash instead. `node_modules` and the
// output dirs never appear because callers only walk `src/` + explicit root
// files, but guard anyway for nested oddities.
function walkFiles(dir: string, prefix: string, out: { rel: string; abs: string; link?: string }[]): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    entries.sort();
    for (const entry of entries) {
        if (entry === 'node_modules') continue;
        const abs = join(dir, entry);
        const rel = prefix === '' ? entry : `${prefix}/${entry}`;
        let st: ReturnType<typeof lstatSync>;
        try {
            st = lstatSync(abs);
        } catch {
            continue;
        }
        if (st.isSymbolicLink()) {
            // File symlinks: hash the resolved content below if readable;
            // dir symlinks: record the target only.
            try {
                const target = readlinkSync(abs);
                out.push({ rel, abs, link: target });
            } catch {
                /* dropped mid-walk */
            }
        } else if (st.isDirectory()) {
            walkFiles(abs, rel, out);
        } else if (st.isFile()) {
            out.push({ rel, abs });
        }
    }
}

/**
 * Content hash of a package's build INPUTS: every file under `src/**`, plus
 * `package.json`, plus root `tsconfig*.json`. Sorted, content-streamed —
 * mtimes do not participate, so a `git checkout` with identical contents
 * hashes identically across machines.
 */
export function hashPackageInputs(location: string): string {
    const files: { rel: string; abs: string; link?: string }[] = [];
    const pkgJson = join(location, 'package.json');
    if (existsSync(pkgJson)) files.push({ rel: 'package.json', abs: pkgJson });
    let rootEntries: string[] = [];
    try {
        rootEntries = readdirSync(location);
    } catch {
        /* unreadable package dir — hash degenerates to the empty set */
    }
    for (const entry of rootEntries.sort()) {
        if (/^tsconfig.*\.json$/.test(entry)) {
            files.push({ rel: entry, abs: join(location, entry) });
        }
    }
    const srcDir = join(location, 'src');
    if (existsSync(srcDir)) walkFiles(srcDir, 'src', files);

    const hash = createHash('sha256');
    hash.update(`gjsify-build-cache-inputs/${BUILD_CACHE_LAYOUT_VERSION}\n`);
    for (const f of files) {
        if (f.link !== undefined) {
            // Symlink: try content (file links), fall back to the target path.
            let content: string;
            try {
                content = hashFileStream(f.abs);
            } catch {
                content = `link:${f.link}`;
            }
            hash.update(`${f.rel} ${content}\n`);
            continue;
        }
        try {
            hash.update(`${f.rel} ${hashFileStream(f.abs)}\n`);
        } catch {
            // Vanished mid-hash (concurrent edit) — record the absence so the
            // key still changes vs. the file being present.
            hash.update(`${f.rel} unreadable\n`);
        }
    }
    return hash.digest('hex');
}

/**
 * Mtime-independent content hash of a set of output dirs — used to skip the
 * restore copy when the on-disk outputs already match the cached entry, and
 * as an integrity stamp of what was stored.
 */
export function hashOutputDirs(location: string, dirs: readonly string[]): string {
    const hash = createHash('sha256');
    hash.update(`gjsify-build-cache-outputs/${BUILD_CACHE_LAYOUT_VERSION}\n`);
    for (const dir of [...dirs].sort()) {
        const abs = join(location, dir);
        if (!existsSync(abs)) {
            hash.update(`${dir} absent\n`);
            continue;
        }
        const files: { rel: string; abs: string; link?: string }[] = [];
        walkFiles(abs, dir, files);
        for (const f of files) {
            if (f.link !== undefined) {
                hash.update(`${f.rel} link:${f.link}\n`);
                continue;
            }
            try {
                hash.update(`${f.rel} ${hashFileStream(f.abs)}\n`);
            } catch {
                hash.update(`${f.rel} unreadable\n`);
            }
        }
    }
    return hash.digest('hex');
}

/**
 * The cacheable output units of a package — the granularity at which a cache
 * entry claims ownership.
 *
 * A candidate dir (`lib/`) is NOT automatically one unit, because the package
 * convention splits it between two DIFFERENT scripts: `build:gjsify` writes
 * `lib/esm/**` (bundler output) and `build:types` writes `lib/types/**` (the
 * `gjsify tsc` declaration emit). At whole-`lib/` granularity both scripts
 * claim the same unit, so a cache HIT on either one does its delete-then-copy
 * over the WHOLE tree and silently destroys the other's output — measured:
 * `build:gjsify` hitting the cache after `build:types` ran left the package
 * with no `lib/types/` at all, and since the script never ran, nothing
 * regenerated them. That ships a tarball whose `types` entry point does not
 * exist (the failure `assertTypeDeclarationsShipped` exists to catch).
 *
 * So: when a candidate dir contains ONLY sub-directories, each child is its
 * own unit (`lib/esm`, `lib/types`) and the two scripts stop overlapping. A
 * candidate holding loose files degrades to the whole dir — a build writing
 * directly into `lib/` genuinely owns it, and the coarse unit is still
 * correct, just less precise.
 *
 * The safety rule is unchanged and in fact tightened: a unit the build never
 * modifies is never recorded, so it can never be restored over (`@gjsify/tsc`'s
 * committed, no-build `lib/lib*.d.ts` are loose files → one `lib` unit → never
 * touched by any build → never captured).
 *
 * A `.tsbuildinfo` does NOT count as a loose file, and that exemption is
 * load-bearing rather than cosmetic. It is incremental-compiler STATE, not a
 * build output — nothing ships it — yet six packages point `tsBuildInfoFile`
 * inside their emit dir, and its mere presence flipped `lib/` back to whole-dir
 * ownership, re-creating for those packages exactly the clobber the per-child
 * split above was introduced to fix. Measured on `@gjsify/semver`: `lib/`
 * held `esm/`, `types/` and `tsconfig.build.tsbuildinfo`, so a `build:types`
 * cache hit restored the whole `lib` and DELETED the `lib/esm` a previous step
 * had just produced — leaving the Node CLI entry unloadable
 * (`ERR_MODULE_NOT_FOUND: @gjsify/semver/lib/esm/index.js`) on a cold macOS
 * tree, where that entry is the only usable one.
 *
 * Excluding it also keeps it OUT of every stored unit, which is the right
 * outcome independently: a restored `.tsbuildinfo` describes an emit that did
 * not happen in this tree, and tsc then treats the project as up to date,
 * writes nothing and exits 0 — the silent no-op `verify-package-outputs.mjs`
 * exists to catch.
 */
const isBuildInfo = (name: string): boolean => name.endsWith('.tsbuildinfo');

export function outputUnits(location: string): string[] {
    const units: string[] = [];
    for (const dir of OUTPUT_DIR_CANDIDATES) {
        const abs = join(location, dir);
        if (!existsSync(abs)) continue;
        let entries: string[];
        try {
            entries = readdirSync(abs).filter((name) => name !== 'node_modules' && !isBuildInfo(name));
        } catch {
            continue;
        }
        // `lstatSync` rather than `withFileTypes` — the CLI also runs from the
        // GJS bundle, where `@gjsify/fs` is the readdir implementation.
        const allDirs = entries.every((name) => {
            try {
                return lstatSync(join(abs, name)).isDirectory();
            } catch {
                return false;
            }
        });
        if (entries.length === 0 || !allDirs) {
            units.push(dir);
            continue;
        }
        for (const child of [...entries].sort()) units.push(`${dir}/${child}`);
    }
    return units;
}

/** Cheap change signature for ONE unit (file list + sizes + mtimes). */
function signatureOf(location: string, unit: string): string {
    const files: { rel: string; abs: string; link?: string }[] = [];
    walkFiles(join(location, unit), unit, files);
    const hash = createHash('sha256');
    for (const f of files) {
        let stamp = 'link';
        if (f.link === undefined) {
            try {
                const st = lstatSync(f.abs);
                stamp = `${st.size}:${st.mtimeMs}`;
            } catch {
                stamp = 'gone';
            }
        }
        hash.update(`${f.rel} ${stamp}\n`);
    }
    return hash.digest('hex');
}

/**
 * Cheap per-unit change signature (existence + file list + sizes + mtimes).
 * Taken BEFORE running the script and compared AFTER, to detect which output
 * units the build actually modified. Content hashing is deliberately avoided
 * here — a build that rewrites identical bytes still bumps mtimes, and that
 * is exactly the "this unit belongs to the build" signal we want.
 *
 * Units absent before the run are recorded as `null` so a freshly created
 * `lib/esm` still reads as "modified".
 */
export function snapshotOutputDirs(location: string): Record<string, string | null> {
    const snapshot: Record<string, string | null> = {};
    for (const dir of OUTPUT_DIR_CANDIDATES) snapshot[dir] = null;
    for (const unit of outputUnits(location)) snapshot[unit] = signatureOf(location, unit);
    return snapshot;
}

/** Output units whose signature changed (or that newly appeared) since `before`. */
export function modifiedOutputDirs(location: string, before: Record<string, string | null>): string[] {
    const modified: string[] = [];
    for (const unit of outputUnits(location)) {
        // Newly created or changed — both mean "the build owns this unit".
        // A unit that is now ABSENT cannot be stored and is simply not listed.
        if (signatureOf(location, unit) !== (before[unit] ?? null)) modified.push(unit);
    }
    return modified.sort();
}

export interface ComposeCacheKeyInput {
    script: string;
    /** Extra args forwarded to the script invocation (affect the outputs). */
    args?: readonly string[];
    /** Toolchain package → resolved version (or 'none'). */
    toolchain: Record<string, string>;
    /** The package's own input hash. */
    ownHash: string;
    /** dep name → input hash for the FULL transitive workspace-dep closure. */
    depHashes: ReadonlyMap<string, string> | Record<string, string>;
}

/** Deterministic cache key (32 hex chars) from all invalidation ingredients. */
export function composeCacheKey(input: ComposeCacheKeyInput): string {
    const hash = createHash('sha256');
    hash.update(`gjsify-build-cache/${BUILD_CACHE_LAYOUT_VERSION}\n`);
    hash.update(`script:${input.script}\n`);
    for (const arg of input.args ?? []) hash.update(`arg:${arg}\n`);
    for (const name of Object.keys(input.toolchain).sort()) {
        hash.update(`tool:${name}@${input.toolchain[name]}\n`);
    }
    hash.update(`self:${input.ownHash}\n`);
    const deps = input.depHashes instanceof Map ? input.depHashes : new Map(Object.entries(input.depHashes));
    for (const name of [...deps.keys()].sort()) {
        hash.update(`dep:${name} ${deps.get(name)}\n`);
    }
    return hash.digest('hex').slice(0, 32);
}

/**
 * Resolve the toolchain versions that salt every key from the workspace's
 * OWN resolution (`<root>/node_modules/<pkg>/package.json`). In the gjsify
 * monorepo these are symlinks into the workspace itself, so a CLI/tsc bump
 * invalidates immediately. A package that isn't resolvable maps to 'none'
 * (deterministic). `@gjsify/cli` additionally falls back to the RUNNING
 * CLI's own version so globally-installed CLIs still salt correctly.
 */
export function resolveToolchainVersions(workspaceRoot: string): Record<string, string> {
    const toolchain: Record<string, string> = {};
    for (const name of TOOLCHAIN_PACKAGES) {
        let version = 'none';
        try {
            const raw = readFileSync(join(workspaceRoot, 'node_modules', ...name.split('/'), 'package.json'), 'utf-8');
            const parsed = JSON.parse(raw) as { version?: unknown };
            if (typeof parsed.version === 'string') version = parsed.version;
        } catch {
            /* not resolvable in this workspace */
        }
        if (name === '@gjsify/cli' && version === 'none') {
            version = readOwnCliVersion() ?? 'none';
        }
        toolchain[name] = version;
    }
    return toolchain;
}

// Walk up from this module (lib/utils/… in the package build, dist/… in the
// GJS bundle) to the CLI's own package.json. Mirrors cli-app's
// readBundleVersion but tolerates both directory depths.
function readOwnCliVersion(): string | null {
    try {
        let dir = dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 4; i++) {
            const candidate = join(dir, 'package.json');
            if (existsSync(candidate)) {
                const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: unknown; version?: unknown };
                if (pkg.name === '@gjsify/cli' && typeof pkg.version === 'string') return pkg.version;
            }
            dir = dirname(dir);
        }
    } catch {
        /* fall through */
    }
    return null;
}

// Recursive copy preserving file modes (the CLI's own `lib/index.js` carries
// an exec bit) and symlinks. Primitive fs ops only, so it behaves the same
// under Node and the GJS facade.
function copyDirRecursive(from: string, to: string): void {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from).sort()) {
        const src = join(from, entry);
        const dst = join(to, entry);
        const st = lstatSync(src);
        if (st.isSymbolicLink()) {
            // Not `symlinkSync(readlinkSync(src), dst)`: replicating a link to a
            // DIRECTORY verbatim needs a junction on Windows, and the target has
            // to be resolved for it. See `dir-link.ts` — the one definition of
            // that rule, added after the same mistake shipped in `dlx-cache.ts`.
            replicateLinkSync(src, dst);
        } else if (st.isDirectory()) {
            copyDirRecursive(src, dst);
        } else if (st.isFile()) {
            copyFileSync(src, dst);
            try {
                chmodSync(dst, st.mode & 0o777);
            } catch {
                /* mode best-effort */
            }
        }
    }
}

/** Directory of one cache entry: `<cacheRoot>/<pkg-sanitized>/<key>`. */
export function buildCacheEntryDir(cacheRoot: string, pkgName: string, key: string): string {
    return join(cacheRoot, sanitizePackageDirName(pkgName), key);
}

const entryDir = buildCacheEntryDir;

/** Read + validate a cache entry's manifest; any mismatch is a MISS (null). */
export function readCacheEntry(cacheRoot: string, pkgName: string, key: string): BuildCacheManifest | null {
    const manifestPath = join(entryDir(cacheRoot, pkgName, key), 'manifest.json');
    try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BuildCacheManifest;
        if (parsed.version !== 1) return null;
        if (parsed.layout !== BUILD_CACHE_LAYOUT_VERSION) return null;
        if (parsed.package !== pkgName || parsed.key !== key) return null;
        if (!Array.isArray(parsed.dirs)) return null;
        // Every stored dir must actually exist in the entry — a half-written
        // entry (crash mid-store before the atomic rename could never produce
        // this, but a manually truncated one could) is a MISS.
        for (const dir of parsed.dirs) {
            if (!existsSync(join(entryDir(cacheRoot, pkgName, key), 'outputs', dir))) return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Store the given output dirs of a package under `key`. Atomic: builds a
 * `.tmp-<pid>` sibling then renames into place, so concurrent readers never
 * observe a partial entry. Best-effort — failures are swallowed (the build
 * itself already succeeded).
 */
export function storeCacheEntry(
    cacheRoot: string,
    pkg: { name: string; location: string },
    key: string,
    script: string,
    dirs: readonly string[],
): BuildCacheManifest | null {
    const finalDir = entryDir(cacheRoot, pkg.name, key);
    const tmpDir = `${finalDir}.tmp-${process.pid}`;
    try {
        rmSync(tmpDir, { recursive: true, force: true });
        mkdirSync(join(tmpDir, 'outputs'), { recursive: true });
        for (const dir of dirs) {
            copyDirRecursive(join(pkg.location, dir), join(tmpDir, 'outputs', dir));
        }
        const now = new Date().toISOString();
        const manifest: BuildCacheManifest = {
            version: 1,
            layout: BUILD_CACHE_LAYOUT_VERSION,
            package: pkg.name,
            script,
            key,
            dirs: [...dirs],
            outputsHash: hashOutputDirs(pkg.location, dirs),
            createdAt: now,
            usedAt: now,
        };
        writeFileSync(join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        rmSync(finalDir, { recursive: true, force: true });
        renameSync(tmpDir, finalDir);
        pruneCacheEntries(cacheRoot, pkg.name);
        return manifest;
    } catch {
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* best-effort cleanup */
        }
        return null;
    }
}

/**
 * Restore a validated entry into the package. Replaces EXACTLY the dirs the
 * manifest records (delete-then-copy within the package); skips the copy
 * when the on-disk outputs already content-match the entry. Returns how the
 * hit was satisfied, or null when restoration failed (treat as MISS).
 */
export function restoreCacheEntry(
    cacheRoot: string,
    pkg: { name: string; location: string },
    manifest: BuildCacheManifest,
): 'restored' | 'up-to-date' | null {
    const dir = entryDir(cacheRoot, pkg.name, manifest.key);
    try {
        if (manifest.dirs.length > 0 && hashOutputDirs(pkg.location, manifest.dirs) === manifest.outputsHash) {
            touchManifestUsed(dir, manifest);
            return 'up-to-date';
        }
        for (const outDir of manifest.dirs) {
            const target = join(pkg.location, outDir);
            rmSync(target, { recursive: true, force: true });
            copyDirRecursive(join(dir, 'outputs', outDir), target);
        }
        touchManifestUsed(dir, manifest);
        return manifest.dirs.length > 0 ? 'restored' : 'up-to-date';
    } catch {
        return null;
    }
}

function touchManifestUsed(dir: string, manifest: BuildCacheManifest): void {
    try {
        manifest.usedAt = new Date().toISOString();
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
        /* recency bump is best-effort */
    }
}

/** Evict the oldest entries (by last store/use) beyond `keep` per package. */
export function pruneCacheEntries(cacheRoot: string, pkgName: string, keep: number = MAX_KEYS_PER_PACKAGE): void {
    const pkgDir = join(cacheRoot, sanitizePackageDirName(pkgName));
    let entries: string[];
    try {
        entries = readdirSync(pkgDir);
    } catch {
        return;
    }
    const dated: { name: string; stamp: string }[] = [];
    for (const entry of entries) {
        // Leftover tmp dirs from crashed stores are always eligible.
        if (entry.includes('.tmp-')) {
            try {
                rmSync(join(pkgDir, entry), { recursive: true, force: true });
            } catch {
                /* ignore */
            }
            continue;
        }
        let stamp = '';
        try {
            const manifest = JSON.parse(readFileSync(join(pkgDir, entry, 'manifest.json'), 'utf-8')) as {
                usedAt?: string;
                createdAt?: string;
            };
            stamp = manifest.usedAt ?? manifest.createdAt ?? '';
        } catch {
            /* unreadable → oldest */
        }
        dated.push({ name: entry, stamp });
    }
    if (dated.length <= keep) return;
    dated.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
    for (const evict of dated.slice(keep)) {
        try {
            rmSync(join(pkgDir, evict.name), { recursive: true, force: true });
        } catch {
            /* best-effort */
        }
    }
}

export interface BuildCacheRunnerOptions {
    /** Workspace (monorepo) root — owns node_modules/.cache. */
    root: string;
    /** ALL discovered workspaces (not just the selected set) for dep closure. */
    workspaces: readonly Workspace[];
    /** Script name being run (part of every key). */
    script: string;
    /** Extra args forwarded to every invocation (part of every key). */
    args?: readonly string[];
    /**
     * Workspace names that will be run. Their input hashes (plus their
     * closures') are computed EAGERLY at construction so every key reflects
     * the tree state at RUN START — a build that mutates its own `src/`
     * (adwaita-web's generated stylesheet module) must not make a sibling's
     * key depend on scheduling order within the same run.
     */
    targets?: readonly string[];
    /** Log sink (default: stderr, keeping stdout clean for script output). */
    log?: (line: string) => void;
}

// Per-package opt-out: `package.json#gjsify.buildCache: false`. For packages
// whose build writes outside the conventional output dirs (e.g.
// `@gjsify/adwaita-web` generates `src/styles.generated.ts` plus per-file JS
// output inside `src/` that consumers resolve from SOURCE) — a cached skip
// would leave those generated files missing, so such packages always run
// uncached.
export function buildCacheOptedOut(ws: Workspace): boolean {
    const gjsify = ws.manifest['gjsify'] as { buildCache?: unknown } | undefined;
    return gjsify?.buildCache === false;
}

/**
 * Per-run orchestrator used by `gjsify workspace` / `gjsify foreach`:
 * memoizes input hashes + keys across packages, restores on hit, snapshots +
 * stores on miss. All entry points are fail-soft — any internal error logs a
 * warning and reports a MISS so the script runs normally.
 */
export class BuildCacheRunner {
    private readonly cacheRoot: string;
    private readonly graph: DependencyGraph;
    private readonly toolchain: Record<string, string>;
    private readonly ownHashes = new Map<string, string>();
    private readonly closures = new Map<string, readonly string[]>();
    private readonly keys = new Map<string, string>();
    private readonly log: (line: string) => void;

    constructor(private readonly options: BuildCacheRunnerOptions) {
        this.cacheRoot = buildCacheRoot(options.root);
        // Broadest edge set for KEY correctness: builds consume prod deps'
        // outputs, type-check against dev deps, and may link optional/peer
        // workspace siblings. The dev graph is cyclic in this monorepo —
        // fine, the closure below is a BFS, not a topological sort.
        this.graph = buildDependencyGraph(options.workspaces, {
            includeDev: true,
            includePeer: true,
            includeOptional: true,
        });
        this.toolchain = resolveToolchainVersions(options.root);
        this.log = options.log ?? ((line) => console.error(line));
        // Pin every relevant input hash to the run-start tree state (see
        // `targets` docs above). Keys derived later stay consistent even if
        // an earlier build in this run mutates a package's src.
        for (const target of options.targets ?? []) {
            if (!this.graph.byName.has(target)) continue;
            this.ownHashOf(target);
            for (const dep of this.closureOf(target)) this.ownHashOf(dep);
        }
    }

    private ownHashOf(name: string): string {
        let hash = this.ownHashes.get(name);
        if (hash === undefined) {
            const ws = this.graph.byName.get(name);
            hash = ws ? hashPackageInputs(ws.location) : 'unknown-workspace';
            this.ownHashes.set(name, hash);
        }
        return hash;
    }

    /** BFS transitive workspace-dep closure (cycle-safe), excluding `name` itself. */
    private closureOf(name: string): readonly string[] {
        let closure = this.closures.get(name);
        if (closure === undefined) {
            const seen = new Set<string>();
            const queue = [...(this.graph.edges.get(name) ?? [])];
            while (queue.length > 0) {
                const dep = queue.shift()!;
                if (dep === name || seen.has(dep)) continue;
                seen.add(dep);
                for (const next of this.graph.edges.get(dep) ?? []) {
                    if (!seen.has(next) && next !== name) queue.push(next);
                }
            }
            closure = [...seen].sort();
            this.closures.set(name, closure);
        }
        return closure;
    }

    /** Content-hash cache key for one workspace (memoized per run). */
    keyFor(ws: Workspace): string {
        let key = this.keys.get(ws.name);
        if (key === undefined) {
            const depHashes = new Map<string, string>();
            for (const dep of this.closureOf(ws.name)) depHashes.set(dep, this.ownHashOf(dep));
            key = composeCacheKey({
                script: this.options.script,
                args: this.options.args,
                toolchain: this.toolchain,
                ownHash: this.ownHashOf(ws.name),
                depHashes,
            });
            this.keys.set(ws.name, key);
        }
        return key;
    }

    /**
     * Try to satisfy the script from the cache. Returns `true` on a hit
     * (outputs restored / already current — the caller SKIPS the script).
     */
    tryRestore(ws: Workspace): boolean {
        try {
            if (buildCacheOptedOut(ws)) {
                this.log(`[gjsify build-cache] ${ws.name}: opted out (gjsify.buildCache=false) — running uncached`);
                return false;
            }
            const key = this.keyFor(ws);
            const manifest = readCacheEntry(this.cacheRoot, ws.name, key);
            if (!manifest || manifest.script !== this.options.script) {
                this.log(`[gjsify build-cache] ${ws.name}: miss ${key} — running "${this.options.script}"`);
                return false;
            }
            const how = restoreCacheEntry(this.cacheRoot, ws, manifest);
            if (how === null) {
                this.log(
                    `[gjsify build-cache] ${ws.name}: entry ${key} unrestorable — running "${this.options.script}"`,
                );
                return false;
            }
            const what = manifest.dirs.length > 0 ? manifest.dirs.join(', ') : 'no output dirs';
            this.log(
                `[gjsify build-cache] ${ws.name}: hit ${key} — ${how === 'restored' ? `restored ${what}` : `${what} up to date`} (skipped "${this.options.script}")`,
            );
            return true;
        } catch (err) {
            this.log(`[gjsify build-cache] ${ws.name}: cache error (${(err as Error).message}) — running uncached`);
            return false;
        }
    }

    /** Snapshot the candidate output dirs BEFORE running the script. */
    snapshotOutputs(ws: Workspace): Record<string, string | null> {
        try {
            return snapshotOutputDirs(ws.location);
        } catch {
            return {};
        }
    }

    /** After a SUCCESSFUL script run: store the dirs the build modified. */
    storeAfterSuccess(ws: Workspace, before: Record<string, string | null>): void {
        try {
            if (buildCacheOptedOut(ws)) return;
            const key = this.keyFor(ws);
            const dirs = modifiedOutputDirs(ws.location, before);
            const manifest = storeCacheEntry(this.cacheRoot, ws, key, this.options.script, dirs);
            if (manifest) {
                const what = dirs.length > 0 ? dirs.join(', ') : 'no output dirs modified';
                this.log(`[gjsify build-cache] ${ws.name}: stored ${key} (${what})`);
            }
        } catch (err) {
            this.log(`[gjsify build-cache] ${ws.name}: store failed (${(err as Error).message}) — continuing`);
        }
    }
}
