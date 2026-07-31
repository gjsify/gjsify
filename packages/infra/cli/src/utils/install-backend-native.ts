// Native install backend — GJS-runnable replacement for `npm install`.
//
// Pipeline: parse specs → resolve deps via @gjsify/npm-registry packuments and
// @gjsify/semver → download tarballs in parallel → extract into a flat
// node_modules/ via @gjsify/tar. Output layout matches `npm install` so the
// existing `runGjsBundle()` prebuild detection works without branching.
//
// Phase D.7b — version-conflict resolution via nested `node_modules`.
// The resolver tracks per-package placement: a dep is hoisted to the
// root when no conflict exists, nested under the requesting package
// when its required version is incompatible with what's already at
// the root. Mirrors npm v3+ behavior.
//
// Out of scope (still deferred): peerDependencies validation,
// lifecycle scripts, git/file specs.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { Range, SemVer, maxSatisfying, satisfies } from '@gjsify/semver';
import {
    DEFAULT_REGISTRY,
    fetchPackument,
    fetchPackumentConditional,
    fetchTarball,
    parseNpmrc,
    registryFor,
    type NpmrcConfig,
    type Packument,
} from '@gjsify/npm-registry';
import { extractTarball } from '@gjsify/tar';

import type { InstallOptions } from './install-backend.ts';
import { atomicWriteStrict } from './install-cache-fs.js';
import { acquireInstallLock } from './install-lock.js';
import {
    cacheRootForLogging,
    getCachedTarball,
    getForeignCachedTarball,
    isCacheHit,
    putCachedTarball,
} from './install-tarball-cache.js';
import { getCachedPackument, putCachedPackument } from './install-packument-cache.js';
import { assertNativeBackendNodeVersion } from './node-version.js';
import { buildCmdShim, parseShebang } from './bin-shim.js';
import { currentPlatformEnv, platformMatches, type PlatformList } from './platform-check.js';

// 16-wide download pool. Matched to the shared Soup.Session's lifted
// `max-conns-per-host` (see @gjsify/fetch `getSharedSession`) — a higher pool
// here only translates into real concurrency because that cap was raised from
// libsoup's default of 2. npm (`maxsockets` 15) and pnpm (`network-concurrency`
// 16) use the same order of magnitude. Override with GJSIFY_INSTALL_CONCURRENCY.
const DEFAULT_CONCURRENCY = Number(process.env.GJSIFY_INSTALL_CONCURRENCY ?? '16') || 16;

interface ParsedSpec {
    name: string;
    range: string;
}

interface ResolvedNode {
    /** Package name (e.g. `@gjsify/cli`, `lodash`). */
    name: string;
    version: string;
    tarballUrl: string;
    integrity?: string;
    /** Where this node lives relative to the install prefix. Always
     *  starts with `node_modules/`; nested entries look like
     *  `node_modules/<parent>/node_modules/<dep>`. */
    installPath: string;
    /** `dependencies` field from the packument (range strings keyed by name). */
    dependencies: Record<string, string>;
    /** `optionalDependencies` field from the packument. */
    optionalDependencies: Record<string, string>;
    bin?: string | Record<string, string>;
    /** Platform constraints from the packument version (npm manifest shape). */
    os?: PlatformList;
    cpu?: PlatformList;
    libc?: PlatformList;
    /**
     * True when the node is reachable ONLY through `optionalDependencies`
     * edges (npm's `node.optional` dep flag). Only optional nodes may be
     * skipped by the platform filter — a REQUIRED node with a foreign
     * platform declaration is still materialised (npm would hard-fail it
     * with EBADPLATFORM; we keep the historical permissive behavior).
     */
    optional?: boolean;
}

const LOCKFILE_NAME = 'gjsify-lock.json';
const LOCKFILE_VERSION = 2;

interface LockfileEntry {
    version: string;
    resolved: string;
    integrity?: string;
    dependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    /**
     * Platform constraints + optional flag, npm-lockfile-style. The lockfile
     * deliberately keeps EVERY resolved node — including foreign-platform
     * optional deps — so it stays cross-platform (two developers on different
     * OSes share one lockfile, `--immutable` included). Filtering happens at
     * MATERIALISATION time only, and these fields are what make that decision
     * recomputable per host without a packument fetch.
     */
    os?: PlatformList;
    cpu?: PlatformList;
    libc?: PlatformList;
    optional?: boolean;
}

interface Lockfile {
    lockfileVersion: number;
    /**
     * True when the entries carry platform metadata (`os`/`cpu`/`libc`/
     * `optional`). Written by every resolve since the platform filter landed.
     * Absent ⇒ the lockfile predates the metadata: per-entry field absence is
     * then indistinguishable from "no constraint declared", so the filter
     * stays inert and the next non-frozen install runs a one-time PRESERVING
     * re-resolve (versions seeded from this lockfile, so nothing bumps) purely
     * to backfill the metadata. Kept as a marker on lockfileVersion 2 instead
     * of a version bump: older CLIs read a marker-carrying lockfile just fine
     * (unknown fields are ignored), while a version bump would make them treat
     * it as MISSING — full re-resolve, version churn, `--immutable` hard fail.
     */
    platformMeta?: boolean;
    /** Top-level specs used to seed this lockfile (preserves user intent). */
    requested: string[];
    /** Pinned packages keyed by `installPath` (e.g. `node_modules/foo` or
     *  `node_modules/foo/node_modules/bar` for nested entries). */
    packages: Record<string, LockfileEntry>;
}

export interface InstalledTopLevel {
    name: string;
    version: string;
}

export async function installPackagesNative(opts: InstallOptions): Promise<InstalledTopLevel[]> {
    // Fail clearly on an unsupported Node major BEFORE touching the ABI-locked
    // native deps — otherwise they SIGSEGV mid-extract with no actionable message.
    assertNativeBackendNodeVersion();
    if (opts.specs.length === 0) {
        throw new Error('installPackagesNative: empty specs list');
    }

    fs.mkdirSync(opts.prefix, { recursive: true });
    const npmrc = await loadNpmrc(opts);
    const log = makeLogger(opts.verbose ?? false);

    // Serialize every mutation of THIS prefix across processes (ADR 0001):
    // concurrent installs into the same node_modules used to interleave
    // `rmSync` + extract on shared destination dirs and tear the lockfile.
    // Re-entrant within the process (workspace installs already hold the
    // root-prefix lock — this just bumps a refcount). Installs into other
    // prefixes proceed concurrently; the shared XDG caches stay lock-free
    // because their tmp+rename writes are atomic (install-cache-fs.ts).
    const lock = await acquireInstallLock(opts.prefix, { signal: opts.signal });
    try {
        return await installPackagesNativeLocked(opts, npmrc, log);
    } finally {
        lock.release();
    }
}

/** Body of {@link installPackagesNative}, run while holding the prefix lock. */
async function installPackagesNativeLocked(
    opts: InstallOptions,
    npmrc: NpmrcConfig,
    log: Logger,
): Promise<InstalledTopLevel[]> {
    const progress = opts.progress;
    const lockfilePath = path.join(opts.prefix, LOCKFILE_NAME);
    const existingLock = readLockfile(lockfilePath);

    let nodes: ResolvedNode[];
    if (opts.frozen) {
        // --immutable / --frozen: lockfile is the authoritative source.
        // Reject if the file is missing, version-mismatched, or its
        // `requested` set has drifted from the live request — silently
        // honoring a stale lockfile would mask real dep churn (the original
        // bug --immutable exists to catch).
        if (!existingLock) {
            throw new Error(
                `install: --immutable requires ${LOCKFILE_NAME} at ${opts.prefix} — none found. ` +
                    `Run \`gjsify install\` (without --immutable) to generate one and commit it.`,
            );
        }
        const drift = describeLockfileDrift(existingLock, opts.specs);
        if (drift) {
            throw new Error(
                `install: --immutable but ${lockfilePath} is stale.\n${drift}\n` +
                    `Re-run \`gjsify install\` (without --immutable) to refresh the lockfile.`,
            );
        }
        log('install: --immutable, using lockfile (%d package(s))', Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else if (
        !opts.refreshLockfile &&
        existingLock &&
        existingLock.platformMeta === true &&
        lockfileMatchesRequest(existingLock, opts.specs)
    ) {
        log('install: using lockfile (%d package(s))', Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else {
        if (existingLock && existingLock.platformMeta !== true && lockfileMatchesRequest(existingLock, opts.specs)) {
            // One-time schema upgrade: the lockfile predates the per-entry
            // platform metadata. Re-resolve WITH version preservation (the
            // `preferred` seeding below keeps every pinned version) purely to
            // backfill `os`/`cpu`/`libc`/`optional` — after this write the
            // fast lockfile-reuse path above applies again.
            console.log(
                'gjsify install: upgrading gjsify-lock.json with platform metadata (one-time; pinned versions are preserved)',
            );
        }
        // A resolve has to run (new/changed/removed dep, or no lockfile yet).
        // Unless --refresh-lockfile was passed, seed it with the versions
        // already pinned in the existing lockfile so unchanged deps keep their
        // resolved version and only the genuinely new/changed deps move — the
        // npm/yarn/pnpm `install` default. Without this, every `^`-range would
        // re-resolve to the newest registry version, churning the whole tree
        // (and silently bumping transitive deps) on a one-package add.
        const preferred = !opts.refreshLockfile && existingLock ? buildPreferredVersions(existingLock) : undefined;
        log(
            'install: resolving %d top-level spec(s) → %s%s',
            opts.specs.length,
            opts.prefix,
            preferred ? ` (preserving ${preferred.size} locked name(s))` : '',
        );
        nodes = await resolveDeps(
            opts.specs,
            npmrc,
            log,
            opts.overrides,
            opts.skipDeps,
            opts.signal,
            progress,
            preferred,
            opts.workspaceNames,
            opts.specOrigins,
        );
        if (opts.lockfile) {
            writeLockfile(lockfilePath, opts.specs, nodes);
            log('install: wrote %s (%d entries)', LOCKFILE_NAME, nodes.length);
        }
    }

    // A package whose name is one of the monorepo's own workspaces is provided
    // by a workspace symlink (wired by `workspaceInstall`), NOT by a registry
    // tarball — even when the lockfile or a transitive edge pins a same-named
    // published version. Drop those nodes from the fetch/extract set so
    // `extractOne` never `rm`s + overwrites the workspace source symlink (its
    // data-loss guard would otherwise abort the whole install). This keeps
    // `--immutable` robust against a committed lockfile that still carries such
    // registry entries (it is built from the lockfile verbatim and never runs
    // `resolveDeps`); a fresh resolve additionally skips them at the source.
    if (opts.workspaceNames && opts.workspaceNames.size > 0) {
        const before = nodes.length;
        nodes = nodes.filter((n) => !opts.workspaceNames!.has(n.name));
        const dropped = before - nodes.length;
        if (dropped > 0) {
            log('install: %d workspace-provided package(s) symlinked, not fetched', dropped);
        }
    }

    // Platform filter (npm parity): an OPTIONAL node whose `os`/`cpu`/`libc`
    // declaration cannot match this host is dropped from the fetch/extract set
    // — npm prunes exactly this set from its ideal tree before reify
    // (arborist `#checkEngineAndPlatform` → `optionalSet` → inert). The node
    // STAYS in the lockfile (written above / consumed by `--immutable`), so
    // lockfiles remain cross-platform; only the materialisation is host-
    // specific. Skipping the FETCH too is safe: nothing downstream assumes
    // tarball-cache presence for a locked node — `extractOne` is the only
    // reader and it runs per kept node; `linkBins`/`warnMissingNativeBuilds`
    // iterate the same kept set. Escape hatch: `--no-platform-filter`
    // (`platformFilter: false`) installs every locked node, mirroring npm's
    // `--force` bypass of the platform check. A REQUIRED foreign-platform
    // node is never skipped (npm would EBADPLATFORM; we stay permissive).
    // Already-extracted foreign packages from a pre-filter install are left
    // on disk untouched (an install never deletes what it did not write —
    // ADR 0001); `gjsify run clear` + a fresh install drops them.
    if (opts.platformFilter !== false) {
        const env = currentPlatformEnv();
        const kept: ResolvedNode[] = [];
        let skippedForeign = 0;
        for (const n of nodes) {
            if (n.optional === true && !platformMatches(n, env)) {
                skippedForeign++;
                log(
                    'skip: %s@%s wants os=%s cpu=%s libc=%s — foreign-platform optional dep, locked but not materialised',
                    n.name,
                    n.version,
                    JSON.stringify(n.os ?? 'any'),
                    JSON.stringify(n.cpu ?? 'any'),
                    JSON.stringify(n.libc ?? 'any'),
                );
                continue;
            }
            kept.push(n);
        }
        if (skippedForeign > 0) {
            log(
                'install: %d foreign-platform optional package(s) kept in the lockfile but not fetched/extracted ' +
                    '(host %s-%s%s; --no-platform-filter installs them all)',
                skippedForeign,
                env.os,
                env.cpu,
                env.libc ? `-${env.libc}` : '',
            );
        }
        nodes = kept;
    }

    log('install: downloading %d tarball(s)', nodes.length);
    await downloadAndExtractAll(nodes, opts.prefix, npmrc, log, opts.signal, progress);
    await linkBins(nodes, opts.prefix, log);
    warnMissingNativeBuilds(nodes, opts.prefix, log);
    log('install: done');

    // Surface the top-level requested packages so callers can update
    // package.json with the resolved version (mirrors `npm install --save`
    // behavior). Sub-deps are not included.
    return topLevelResolutions(opts.specs, nodes);
}

function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

/**
 * Warn about a native package that installed WITHOUT a usable binary.
 *
 * gjsify install is node-free (it runs under GJS) and does NOT run a package's
 * `install`/`postinstall` lifecycle script — running e.g. `node-gyp rebuild` would
 * need Node + a C++ toolchain, breaking that property (see the header's "out of
 * scope"). Such a package works only if it SHIPS a prebuild for the platform (the
 * sanctioned path — `prebuilds/<platform>-<arch>/…`) or is later built by hand. When
 * neither is present the package silently loads no binary (the `@gjsify/node-gi
 * 0.21.0` case: installed, but `node_gi.node` absent → the consumer hit a runtime
 * failure with no hint). Surface it at install time with an actionable line. Pure
 * detection — no script is run, so node-free-ness is preserved.
 */
export function warnMissingNativeBuilds(nodes: ResolvedNode[], prefix: string, log: Logger): void {
    const plat = process.platform;
    const arch = process.arch;
    const buildScriptKeys = ['preinstall', 'install', 'postinstall'] as const;
    for (const n of nodes) {
        const pkgDir = path.join(prefix, n.installPath);
        let scripts: Record<string, unknown> | undefined;
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
            scripts = manifest?.scripts;
        } catch {
            continue; // no/unreadable manifest — nothing to assess
        }
        if (!scripts || typeof scripts !== 'object') continue;
        const scriptKey = buildScriptKeys.find((k) => typeof scripts![k] === 'string');
        if (scriptKey === undefined) continue; // no native build lifecycle script

        // Does it ship a prebuild for THIS platform (any prebuilds/<plat>-…/ with a
        // file), or carry a locally-built build/Release binary?
        let hasBinary = false;
        try {
            const prebuildsDir = path.join(pkgDir, 'prebuilds');
            for (const entry of fs.readdirSync(prebuildsDir)) {
                if (entry.startsWith(`${plat}-`) && fs.readdirSync(path.join(prebuildsDir, entry)).length > 0) {
                    hasBinary = true;
                    break;
                }
            }
        } catch {
            /* no prebuilds dir */
        }
        if (!hasBinary) {
            try {
                const releaseDir = path.join(pkgDir, 'build', 'Release');
                hasBinary = fs.readdirSync(releaseDir).some((f) => f.endsWith('.node') || f.endsWith('.so'));
            } catch {
                /* no build/Release */
            }
        }
        if (!hasBinary) {
            log(
                'install: WARNING — %s declares a native `%s` build script but ships no %s-%s prebuild, ' +
                    'and gjsify install does not run build scripts (node-free). It will not load until built: ' +
                    'run `node-gyp rebuild` in %s, or use a version that ships a %s-%s prebuild.',
                n.name,
                scriptKey,
                plat,
                arch,
                n.installPath,
                plat,
                arch,
            );
        }
    }
}

function topLevelResolutions(specs: string[], nodes: ResolvedNode[]): InstalledTopLevel[] {
    // Top-level installs live at `node_modules/<name>` (no nesting). Build
    // a name → root-node lookup limited to the top-level set.
    const byName = new Map<string, ResolvedNode>();
    for (const n of nodes) {
        if (n.installPath === `node_modules/${n.name}`) byName.set(n.name, n);
    }
    const out: InstalledTopLevel[] = [];
    for (const spec of specs) {
        const name = parseSpecName(spec);
        const node = byName.get(name);
        if (node) out.push({ name: node.name, version: node.version });
    }
    return out;
}

function parseSpecName(spec: string): string {
    if (spec.startsWith('@')) {
        const slash = spec.indexOf('/');
        if (slash === -1) return spec;
        const at = spec.indexOf('@', slash + 1);
        return at === -1 ? spec : spec.slice(0, at);
    }
    const at = spec.indexOf('@');
    return at === -1 ? spec : spec.slice(0, at);
}

/**
 * Tree-aware dependency resolution with npm v3+ hoisting semantics.
 *
 *   - A dep is HOISTED (placed at `node_modules/<dep>`) when no existing
 *     placement conflicts with its required range — either it's not
 *     placed yet, or it's already at the root with a satisfying version.
 *   - A dep is NESTED (placed at `<requester>/node_modules/<dep>`) when
 *     the root has an incompatible version. Subsequent dependents of the
 *     same conflicting version reuse the nested placement.
 *
 * The walk is BFS over (requester, depName, depRange) edges. Top-level
 * specs are seeded with a synthetic `null` requester so they hoist to
 * the root. Each placement returns a `ResolvedNode` whose `installPath`
 * captures where it lives in the tree.
 */
async function resolveDeps(
    specs: string[],
    npmrc: NpmrcConfig,
    log: Logger,
    overrides?: Record<string, string>,
    skipDeps?: boolean,
    signal?: AbortSignal,
    progress?: import('./install-progress.js').ProgressReporter,
    /**
     * Lockfile-preservation oracle: `name → versions already pinned in the
     * existing lockfile`. When an edge's range is satisfiable by a pinned
     * version, that version is reused instead of the newest registry match.
     * Undefined ⇒ a fresh resolve that always picks the newest in-range version
     * (first install, or an explicit `--refresh-lockfile`).
     */
    preferredVersions?: Map<string, Set<string>>,
    /**
     * Names of the monorepo's own workspace packages. An edge whose name is in
     * this set is satisfied by the workspace symlink, so it is skipped here —
     * the published version (and its subtree) never enters the resolved tree or
     * the lockfile.
     */
    workspaceNames?: Set<string>,
    /**
     * Requester labels for top-level specs (`"<name>@<range>"` → workspace
     * names) — see `InstallOptions.specOrigins`. Used only to attribute the
     * version-conflict warning.
     */
    specOrigins?: Map<string, string[]>,
): Promise<ResolvedNode[]> {
    progress?.beginPhase('resolve', specs.length);
    const applyOverride = (name: string, range: string): string => {
        if (!overrides) return range;
        const override = overrides[name];
        if (typeof override !== 'string' || override.length === 0) return range;
        if (override === range) return range;
        log('install: override %s %s → %s', name, range, override);
        return override;
    };
    const packumentCache = new Map<string, Promise<Packument>>();
    const fetchPkg = (name: string): Promise<Packument> => {
        const cached = packumentCache.get(name);
        if (cached) return cached;
        const fresh = fetchPackumentWithDiskCache(name, npmrc, log, signal);
        packumentCache.set(name, fresh);
        return fresh;
    };

    /** Every installed package keyed by `installPath`. */
    const byPath = new Map<string, ResolvedNode>();
    /** Root placements indexed by name for the hoist-vs-nest decision. */
    const root = new Map<string, ResolvedNode>();

    interface Edge {
        /** `installPath` of the requester. `null` means the project root
         *  (top-level specs). */
        from: string | null;
        name: string;
        range: string;
        /** Whether failure to resolve should throw (false for optionalDeps). */
        required: boolean;
    }
    // Resolved edge list (requester placement → target placement, with the
    // edge's optionalDependencies-ness). Feeds `applyOptionalFlags` after the
    // BFS — the dep-flag computation needs the full graph including the
    // reuse edges the placement loop `continue`s over.
    const resolvedEdges: ResolvedEdge[] = [];
    // Top-level range bookkeeping for the version-conflict warning:
    // `name → (applied range → requester labels)`. Only TOP-LEVEL specs
    // participate: conflicting transitive edges are resolved correctly by
    // nesting (Phase D.7b), but conflicting top-level specs — the shape
    // `workspaceInstall` produces when two workspaces declare incompatible
    // ranges of the same external dep — all compete for the single root
    // slot, and today the resolver silently keeps one version for everyone
    // (per-workspace dedup is Phase D.8). Until that lands, the conflict is
    // surfaced loudly after the resolve (see emitTopLevelConflictWarnings).
    const topLevelRanges = new Map<string, Map<string, Set<string>>>();
    const queue: Edge[] = specs.map(parseSpec).map((s) => {
        const range = applyOverride(s.name, s.range);
        let ranges = topLevelRanges.get(s.name);
        if (!ranges) {
            ranges = new Map<string, Set<string>>();
            topLevelRanges.set(s.name, ranges);
        }
        let requesters = ranges.get(range);
        if (!requesters) {
            requesters = new Set<string>();
            ranges.set(range, requesters);
        }
        for (const origin of specOrigins?.get(`${s.name}@${s.range}`) ?? []) requesters.add(origin);
        return {
            from: null,
            name: s.name,
            range,
            required: true,
        };
    });

    // Wave-based BFS. Each iteration drains the current queue level, prefetches
    // every not-yet-cached packument in that level IN PARALLEL (bounded), then
    // applies placement SERIALLY in the same FIFO order the single-edge loop
    // used. Because newly-discovered children always append to the end of the
    // queue, "the current queue contents" is exactly one BFS level — so the
    // serial pass visits edges in the identical order, and `decidePlacement`'s
    // order-dependent hoist/nest decisions (hence the lockfile) are byte-for-
    // byte unchanged. Only the network moved: N sequential ~RTT packument
    // fetches per level collapse into one bounded-parallel batch. This is the
    // dominant cold-install cost — at libsoup's old `max-conns-per-host=2` it
    // would have throttled anyway, so it lands alongside the connection-cap
    // lift in `@gjsify/fetch`. `packumentCache` still guarantees ≤1 fetch per
    // unique name across the whole resolve, so prefetching every wave name
    // fetches exactly the same SET as before, just batched.
    while (queue.length > 0) {
        const wave = queue.splice(0, queue.length);

        // Prefetch every not-yet-cached packument referenced in this level.
        // Names already in `packumentCache` (resolved in an earlier wave, or a
        // duplicate within this one) are skipped — the de-dup keeps the batch
        // to genuinely-new names.
        const toPrefetch: string[] = [];
        const queuedForFetch = new Set<string>();
        for (const edge of wave) {
            if (packumentCache.has(edge.name) || queuedForFetch.has(edge.name)) continue;
            queuedForFetch.add(edge.name);
            toPrefetch.push(edge.name);
        }
        await prefetchPackuments(toPrefetch, fetchPkg, signal);

        // Serial placement pass — identical decisions and order to the original
        // single-edge loop, but every `fetchPkg` now resolves from the warmed
        // cache instead of blocking on a fresh round-trip.
        for (let wi = 0; wi < wave.length; wi++) {
            const edge = wave[wi];

            // A workspace member is satisfied by its workspace symlink, never by
            // a registry tarball — skip the edge so the published version (and
            // its subtree) never enters the resolved tree or the lockfile.
            if (workspaceNames?.has(edge.name)) continue;

            // Walk the ancestor chain to see whether a satisfying placement is
            // already visible from the requester's `node_modules` lookup. npm's
            // resolver does this — each level of nesting acts as a fallback.
            const visible = findVisible(edge.from, edge.name, byPath);
            if (visible && satisfiesRange(visible.version, edge.range)) {
                // Compatible placement reachable; reuse, no new install. The
                // edge still counts for the dep-flag pass — a REQUIRED edge
                // reusing an optionally-placed node promotes it to required.
                resolvedEdges.push({ from: edge.from, to: visible.installPath, optional: !edge.required });
                continue;
            }

            // No compatible existing placement. Resolve a version — preferring a
            // version already pinned in the lockfile when it satisfies the range
            // (so an add doesn't gratuitously bump unchanged deps).
            let version: string | null = null;
            try {
                const packument = await fetchPkg(edge.name);
                const preferred = preferredVersionFor(preferredVersions?.get(edge.name), edge.range);
                version = pickVersion(packument, edge.range, preferred);
                if (!version) {
                    if (!edge.required) continue;
                    throw new Error(`No version of ${edge.name} satisfies ${edge.range}`);
                }
                const v = packument.versions[version];
                if (!v) {
                    throw new Error(`Packument for ${edge.name} promised ${version} but no entry exists`);
                }

                // Decision: hoist to root, or nest under the requester?
                //   - Hoist iff the root has no conflicting placement (i.e. the
                //     root slot for `name` is empty OR holds the same version).
                //   - Otherwise nest. Top-level specs (from === null) always
                //     hoist; the resolver guarantees they never conflict with
                //     each other because the input set is checked once.
                const installPath = decidePlacement(edge.from, edge.name, version, root);

                const node: ResolvedNode = {
                    name: edge.name,
                    version,
                    tarballUrl: v.dist.tarball,
                    integrity: v.dist.integrity,
                    installPath,
                    dependencies: v.dependencies ?? {},
                    optionalDependencies: v.optionalDependencies ?? {},
                    bin: v.bin,
                    os: normalizePlatformList(v.os),
                    cpu: normalizePlatformList(v.cpu),
                    libc: normalizePlatformList(v.libc),
                };
                byPath.set(installPath, node);
                resolvedEdges.push({ from: edge.from, to: installPath, optional: !edge.required });
                if (installPath === `node_modules/${edge.name}`) {
                    root.set(edge.name, node);
                }
                log('resolve: %s@%s ← %s (at %s)', edge.name, version, edge.range, installPath);
                // Moving soft-total: resolved so far + edges still to visit in
                // this wave + children already queued for the next wave. Same
                // converging-estimate pattern yarn/pnpm use.
                progress?.update({
                    phase: 'resolve',
                    current: byPath.size,
                    total: byPath.size + (wave.length - wi - 1) + queue.length,
                    name: `${edge.name}@${version}`,
                });

                if (!skipDeps) {
                    for (const [depName, depRange] of Object.entries(node.dependencies)) {
                        queue.push({
                            from: installPath,
                            name: depName,
                            range: applyOverride(depName, depRange),
                            required: true,
                        });
                    }
                    for (const [depName, depRange] of Object.entries(node.optionalDependencies)) {
                        queue.push({
                            from: installPath,
                            name: depName,
                            range: applyOverride(depName, depRange),
                            required: false,
                        });
                    }
                }
            } catch (e) {
                // Optional deps that fail to resolve are skipped — yarn/npm
                // behavior. Required deps re-throw.
                if (!edge.required) {
                    log('resolve: optional dep %s@%s skipped (%s)', edge.name, edge.range, (e as Error).message);
                    continue;
                }
                throw e;
            }
        }
    }

    progress?.endPhase('resolve');
    applyOptionalFlags(byPath, resolvedEdges);
    emitTopLevelConflictWarnings(topLevelRanges, root);
    return Array.from(byPath.values());
}

/**
 * Sanitize a packument version's `os`/`cpu`/`libc` field. Wire data is
 * untrusted: manifests in the wild carry an explicit `"os": null`, and a
 * malformed non-string/array value must neither leak into the lockfile nor
 * reach `checkList`. A string passes through; an array keeps only its string
 * entries; anything else means "no constraint".
 */
function normalizePlatformList(value: unknown): PlatformList | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
    return undefined;
}

/** One resolved requester→target edge, keyed by placement paths. */
export interface ResolvedEdge {
    /** Requester's `installPath`; `null` = the project root (top-level specs). */
    from: string | null;
    /** Target node's `installPath` (new placement OR reused visible one). */
    to: string;
    /** True when this edge came from `optionalDependencies`. */
    optional: boolean;
}

/**
 * npm's `calc-dep-flags` in miniature (`refs/npm-cli/workspaces/arborist/lib/
 * calc-dep-flags.js`): a node is OPTIONAL iff it is NOT reachable from the
 * project root through a chain of non-optional edges. Top-level specs are the
 * root's non-optional edges (`from === null`); an `optionalDependencies` edge
 * never confers requiredness, so a whole subtree that hangs off one optional
 * edge stays optional even where its INTERNAL edges are `dependencies`. The
 * flag is what licenses the platform filter to skip a node — npm prunes
 * exactly the optional set and hard-fails a required platform mismatch.
 *
 * Exported for unit-testing. Internal API.
 */
export function applyOptionalFlags(byPath: Map<string, ResolvedNode>, edges: ResolvedEdge[]): void {
    const outgoing = new Map<string | null, ResolvedEdge[]>();
    for (const e of edges) {
        let list = outgoing.get(e.from);
        if (!list) {
            list = [];
            outgoing.set(e.from, list);
        }
        list.push(e);
    }
    const required = new Set<string>();
    const stack: Array<string | null> = [null];
    while (stack.length > 0) {
        const from = stack.pop()!;
        for (const e of outgoing.get(from) ?? []) {
            if (e.optional || required.has(e.to)) continue;
            required.add(e.to);
            stack.push(e.to);
        }
    }
    for (const [installPath, node] of byPath) {
        node.optional = !required.has(installPath);
    }
}

/**
 * Loud, single-line-per-package warning for top-level version-range
 * conflicts (ADR 0001, step 3). Fires when two or more top-level specs
 * requested DIFFERENT ranges of the same package and the version that ended
 * up hoisted to the root does not satisfy all of them — i.e. some requester
 * silently got a version outside its declared range. Compatible ranges
 * (`^1.2` + `^1.4` both satisfied by `1.9.0`) stay silent; ranges that are
 * not semver (dist-tags like `latest`) cannot be compared and are skipped.
 *
 * This makes the current single-root-slot behavior honest instead of silent;
 * the real fix — a per-workspace dedup pass that gives each conflicting
 * requester its own nested copy — is Phase D.8 (see STATUS.md).
 */
function emitTopLevelConflictWarnings(
    topLevelRanges: Map<string, Map<string, Set<string>>>,
    root: Map<string, ResolvedNode>,
): void {
    for (const [name, ranges] of topLevelRanges) {
        if (ranges.size < 2) continue;
        const placed = root.get(name);
        if (!placed) continue; // workspace-provided or never placed — nothing installed to warn about
        const describe = (range: string, requesters: Set<string>): string =>
            requesters.size > 0 ? `${range} (requested by ${[...requesters].join(', ')})` : range;
        const satisfied: string[] = [];
        const unsatisfied: string[] = [];
        for (const [range, requesters] of ranges) {
            let ok: boolean;
            try {
                ok = satisfies(placed.version, new Range(range));
            } catch {
                continue; // dist-tag / non-semver range — not comparable
            }
            (ok ? satisfied : unsatisfied).push(describe(range, requesters));
        }
        if (unsatisfied.length === 0) continue;
        console.warn(
            `[gjsify] warning: version conflict for ${name}: installed ${placed.version} at ${placed.installPath} — ` +
                `does NOT satisfy ${unsatisfied.join(', ')}` +
                (satisfied.length > 0 ? `; satisfies ${satisfied.join(', ')}` : '') +
                `. One hoisted copy serves all requesters until the per-workspace dedup pass lands (Phase D.8).`,
        );
    }
}

/**
 * Warm `packumentCache` for a batch of package names with bounded parallelism
 * (same `DEFAULT_CONCURRENCY` width as the download pool). Rejections — e.g. a
 * 404 on an optional dep — are swallowed here: the promise stays cached in its
 * rejected state and the caller's per-edge `await fetchPkg(name)` re-surfaces
 * it, so required deps still throw and optional ones are skipped exactly as in
 * the single-edge path. Swallowing also stops one bad optional dependency from
 * aborting the whole wave's batch.
 */
/**
 * Fetch a packument with on-disk ETag revalidation. Reads the cached
 * `{ etag, packument }` for `(registry, name)`, sends it as `If-None-Match`,
 * and on a `304 Not Modified` returns the cached body without re-downloading
 * it; on a `200` it stores the fresh body + ETag and returns it. The cache is
 * keyed by the registry the name resolves to, so scope-registry overrides never
 * cross-contaminate. Falls back to a plain fetch when there's no cached entry
 * or the registry doesn't send an ETag (the 304 fast-path simply never fires).
 */
async function fetchPackumentWithDiskCache(
    name: string,
    npmrc: NpmrcConfig,
    log: Logger,
    signal?: AbortSignal,
): Promise<Packument> {
    const registry = registryFor(name, npmrc);
    const disk = getCachedPackument(registry, name);
    const onRetry = ({ attempt, error, delayMs }: { attempt: number; error: unknown; delayMs: number }) => {
        log('packument %s: retry %d after %dms (%s)', name, attempt, delayMs, errMsg(error));
    };
    const result = await fetchPackumentConditional(name, {
        npmrc,
        signal,
        ifNoneMatch: disk?.etag,
        onRetry,
    });
    if (result.status === 'not-modified' && disk) {
        log('packument-cache-hit: %s (304, etag %s)', name, disk.etag);
        return disk.packument;
    }
    if (result.status === 'fresh' && result.packument) {
        if (result.etag) putCachedPackument(registry, name, result.etag, result.packument);
        return result.packument;
    }
    // 304 with no cached body to satisfy it (a stale `If-None-Match` raced a
    // cache eviction). Re-fetch unconditionally so we always return a body.
    return fetchPackument(name, { npmrc, signal, onRetry });
}

async function prefetchPackuments(
    names: string[],
    fetchPkg: (name: string) => Promise<Packument>,
    signal?: AbortSignal,
): Promise<void> {
    if (names.length === 0) return;
    let cursor = 0;
    const concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, names.length));
    const worker = async (): Promise<void> => {
        while (cursor < names.length) {
            if (signal?.aborted) return;
            const name = names[cursor++];
            try {
                await fetchPkg(name);
            } catch {
                /* cached rejection — the serial placement pass handles it */
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

/**
 * Walk the ancestor `node_modules` chain from `requesterPath` upward,
 * looking for a placement of `name` that the requester would resolve
 * through Node's CommonJS lookup. Returns the first match — that's the
 * one the requester actually sees at runtime.
 */
function findVisible(
    requesterPath: string | null,
    name: string,
    byPath: Map<string, ResolvedNode>,
): ResolvedNode | null {
    // From the requester's directory, Node walks up node_modules dirs
    // looking for `<dir>/node_modules/<name>`. Translate that to lockfile
    // paths: any prefix of the requester's `installPath` that ends in a
    // package directory gives a candidate `<prefix>/node_modules/<name>`.
    //
    // The requester itself ALSO checks its OWN `node_modules` first
    // (i.e. `<requesterPath>/node_modules/<name>` — nested deps shadow
    // ancestor ones). Then it walks up.
    const candidates: string[] = [];
    if (requesterPath !== null) {
        candidates.push(`${requesterPath}/node_modules/${name}`);
        // Walk up: strip the last `/node_modules/<pkg>` segment and try again.
        let p = requesterPath;
        while (true) {
            // Find the deepest `/node_modules/<pkg>` in `p`, strip it.
            const idx = p.lastIndexOf('/node_modules/');
            if (idx < 0) break;
            p = p.slice(0, idx);
            candidates.push(`${p}/node_modules/${name}`);
            if (p === '') break;
        }
    }
    // The root `node_modules/<name>` is the final candidate (covers the
    // `requesterPath === null` case too).
    candidates.push(`node_modules/${name}`);

    for (const candidate of candidates) {
        const hit = byPath.get(candidate);
        if (hit) return hit;
    }
    return null;
}

/**
 * Decide where to install `name@version` for a request from `requesterPath`.
 *
 *   - Root is empty for `name`: hoist (return `node_modules/<name>`).
 *   - Root has the SAME version: reuse the root placement.
 *   - Root has a DIFFERENT version: nest under the requester.
 *
 * Top-level requesters (requesterPath === null) always hoist.
 */
function decidePlacement(
    requesterPath: string | null,
    name: string,
    version: string,
    root: Map<string, ResolvedNode>,
): string {
    const rootSlot = root.get(name);
    if (!rootSlot) return `node_modules/${name}`;
    if (rootSlot.version === version) return `node_modules/${name}`;
    if (requesterPath === null) {
        // Top-level specs are deduplicated by the caller before reaching
        // here; this branch is defensive (would only fire on a duplicate
        // top-level spec with conflicting versions).
        return `node_modules/${name}`;
    }
    return `${requesterPath}/node_modules/${name}`;
}

function satisfiesRange(version: string, range: string): boolean {
    // dist-tag (e.g. `latest`) cannot be matched here — caller passed a
    // raw range. Dist-tags only meaningful at fresh-resolve time.
    try {
        return satisfies(version, new Range(range));
    } catch {
        return false;
    }
}

function readLockfile(lockfilePath: string): Lockfile | null {
    if (!fs.existsSync(lockfilePath)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8')) as Lockfile;
        if (parsed.lockfileVersion !== LOCKFILE_VERSION) return null;
        if (!parsed.packages || typeof parsed.packages !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeLockfile(lockfilePath: string, specs: string[], nodes: ResolvedNode[]): void {
    const packages: Record<string, LockfileEntry> = {};
    // Sort by install path for deterministic, diff-friendly output.
    const sorted = [...nodes].sort((a, b) =>
        a.installPath < b.installPath ? -1 : a.installPath > b.installPath ? 1 : 0,
    );
    for (const node of sorted) {
        packages[node.installPath] = {
            version: node.version,
            resolved: node.tarballUrl,
            integrity: node.integrity,
            dependencies: Object.keys(node.dependencies).length > 0 ? node.dependencies : undefined,
            bin: node.bin,
            // Platform metadata (npm-lockfile-style): foreign-platform entries
            // are deliberately LOCKED — filtering happens at materialisation,
            // never at resolution-persistence, so the lockfile stays
            // cross-platform. `undefined` fields are dropped by JSON.stringify.
            os: node.os,
            cpu: node.cpu,
            libc: node.libc,
            optional: node.optional === true ? true : undefined,
        };
    }
    const lockfile: Lockfile = {
        lockfileVersion: LOCKFILE_VERSION,
        platformMeta: true,
        requested: [...specs],
        packages,
    };
    // Atomic tmp+rename so a crash mid-write (or a reader racing the writer)
    // can never observe a torn gjsify-lock.json — `--immutable` would
    // otherwise hard-fail on the corrupt file with a misleading error.
    atomicWriteStrict(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n');
}

/**
 * Build the lockfile-preservation oracle: `name → every version currently
 * pinned in the lockfile` (a name can appear at more than one install path /
 * version when the tree nested a conflicting copy). Consulted during a resolve
 * so unchanged deps keep their pinned version instead of bumping to the newest
 * in-range match.
 */
function buildPreferredVersions(lockfile: Lockfile): Map<string, Set<string>> {
    const byName = new Map<string, Set<string>>();
    for (const [installPath, entry] of Object.entries(lockfile.packages)) {
        const name = nameFromInstallPath(installPath);
        let set = byName.get(name);
        if (!set) {
            set = new Set<string>();
            byName.set(name, set);
        }
        set.add(entry.version);
    }
    return byName;
}

/**
 * Pick the pinned version to reuse for an edge: the highest lockfile version of
 * the name that still satisfies the edge's range, or undefined when none do
 * (range was tightened/changed, or the name is brand new) — in which case the
 * resolver falls back to the newest registry match.
 */
function preferredVersionFor(locked: Set<string> | undefined, range: string): string | undefined {
    if (!locked || locked.size === 0) return undefined;
    let best: string | undefined;
    for (const v of locked) {
        if (!satisfiesRange(v, range)) continue;
        if (best === undefined || new SemVer(v).compare(new SemVer(best)) > 0) best = v;
    }
    return best;
}

function lockfileToNodes(lockfile: Lockfile): ResolvedNode[] {
    return Object.entries(lockfile.packages).map(([installPath, entry]) => ({
        // Recover the package name from the path: the last segment is
        // either `<name>` (unscoped) or `@scope/<name>` (scoped).
        name: nameFromInstallPath(installPath),
        version: entry.version,
        tarballUrl: entry.resolved,
        integrity: entry.integrity,
        installPath,
        dependencies: entry.dependencies ?? {},
        optionalDependencies: {},
        bin: entry.bin,
        os: entry.os,
        cpu: entry.cpu,
        libc: entry.libc,
        optional: entry.optional,
    }));
}

function nameFromInstallPath(installPath: string): string {
    // Last `node_modules/` boundary, then the rest is the package name
    // (single segment unscoped, or `@scope/pkg` scoped).
    const idx = installPath.lastIndexOf('/node_modules/');
    const after =
        idx < 0 ? installPath.replace(/^node_modules\//, '') : installPath.slice(idx + '/node_modules/'.length);
    return after;
}

function lockfileMatchesRequest(lockfile: Lockfile, specs: string[]): boolean {
    if (lockfile.requested.length !== specs.length) return false;
    const a = [...lockfile.requested].sort();
    const b = [...specs].sort();
    return a.every((v, i) => v === b[i]);
}

/**
 * Human-readable diff between `lockfile.requested` and the live request.
 * Returns null when the two sets are identical (the lockfile is in sync).
 * Used by `--immutable` to surface exactly which deps drifted, so CI
 * failures don't force the user to diff lockfile JSON by hand.
 */
function describeLockfileDrift(lockfile: Lockfile, specs: string[]): string | null {
    const lockSet = new Set(lockfile.requested);
    const liveSet = new Set(specs);
    const added: string[] = [];
    const removed: string[] = [];
    for (const s of liveSet) if (!lockSet.has(s)) added.push(s);
    for (const s of lockSet) if (!liveSet.has(s)) removed.push(s);
    if (added.length === 0 && removed.length === 0) return null;
    const lines: string[] = [];
    if (added.length > 0) lines.push(`  + ${added.sort().join('\n  + ')}`);
    if (removed.length > 0) lines.push(`  - ${removed.sort().join('\n  - ')}`);
    return lines.join('\n');
}

// Exported for unit-testing — keep the function name + signature
// stable, the install-backend itself still calls it via the local
// binding below. Internal API.
export function parseSpec(raw: string): ParsedSpec {
    // Bare names without an explicit `@version` resolve to the `latest`
    // dist-tag. This matches npm CLI behaviour (`npm install foo` →
    // foo@latest) and — crucially — picks up prereleases when the
    // publisher has tagged them as `latest`. Using semver `*` here
    // would silently exclude any version with a `-` (rc, beta, alpha,
    // …) suffix per semver §9 ("Pre-release versions have a lower
    // precedence than the associated normal version"); ts-for-gir
    // shipped only prereleases (4.0.0-rc.17 is the `latest` tag, no
    // stable 4.x yet) and `*` was selecting the abandoned 3.3.0
    // instead.
    if (raw.startsWith('@')) {
        const slash = raw.indexOf('/');
        if (slash < 0) throw new Error(`Invalid spec (scoped name without slash): ${raw}`);
        const at = raw.indexOf('@', slash);
        if (at < 0) return { name: raw, range: 'latest' };
        return { name: raw.slice(0, at), range: raw.slice(at + 1) || 'latest' };
    }
    const at = raw.indexOf('@');
    if (at < 0) return { name: raw, range: 'latest' };
    return { name: raw.slice(0, at), range: raw.slice(at + 1) || 'latest' };
}

// Exported for unit-testing. Internal API.
export function pickVersion(packument: Packument, range: string, preferred?: string): string | null {
    // Lockfile preservation: if a version already pinned in the lockfile still
    // satisfies the range and is still published, reuse it instead of bumping to
    // the newest match. `preferred` is only ever a concrete semver (never a
    // dist-tag), so this never hijacks a `latest`/`next` range.
    if (preferred && packument.versions[preferred] && satisfiesRange(preferred, range)) {
        return preferred;
    }

    // dist-tag fast path: `latest`, `next`, ...
    if (packument['dist-tags'][range]) return packument['dist-tags'][range];

    // Validate range early so a typo fails loudly.
    let parsedRange: Range;
    try {
        parsedRange = new Range(range);
    } catch {
        throw new Error(`Invalid version range for ${packument.name}: ${range}`);
    }

    const versions = Object.keys(packument.versions).filter((v) => {
        try {
            new SemVer(v);
            return true;
        } catch {
            return false;
        }
    });
    return maxSatisfying(versions, parsedRange);
}

async function downloadAndExtractAll(
    nodes: ResolvedNode[],
    prefix: string,
    npmrc: NpmrcConfig,
    log: Logger,
    signal?: AbortSignal,
    progress?: import('./install-progress.js').ProgressReporter,
): Promise<void> {
    // Sort by install-path depth ascending so parents extract before
    // children. Extracting a parent on top of an existing child would
    // wipe out the child.
    const queue = [...nodes].sort(
        (a, b) => depth(a.installPath) - depth(b.installPath) || (a.installPath < b.installPath ? -1 : 1),
    );
    const workers: Array<Promise<void>> = [];
    const concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, queue.length));
    progress?.beginPhase('download', queue.length);
    let completed = 0;
    // Count how many nodes were already correctly materialised on disk and
    // skipped (the npm "unchanged" set). Surfaced in the summary log so a warm
    // install makes it obvious why the phase finished in seconds.
    let skipped = 0;
    const tickProgress = (node: ResolvedNode, wasSkipped: boolean) => {
        completed++;
        if (wasSkipped) skipped++;
        progress?.update({
            phase: 'download',
            current: completed,
            total: queue.length,
            name: `${node.name}@${node.version}`,
        });
    };
    // Parents (depth 1) are extracted serially first to avoid concurrent
    // `rm -rf` + extract races with their children. Once depth-1 is done,
    // depths >=2 run with full concurrency.
    let cursor = 0;
    const depth1End = queue.findIndex((n) => depth(n.installPath) > 1);
    const splitAt = depth1End < 0 ? queue.length : depth1End;

    // Serial root pass.
    while (cursor < splitAt) {
        if (signal?.aborted) throw abortError(signal);
        const node = queue[cursor++];
        if (!node) break;
        const wasSkipped = await extractOne(node, prefix, npmrc, log, signal);
        tickProgress(node, wasSkipped);
    }

    // Concurrent nested pass.
    for (let i = 0; i < concurrency; i++) {
        workers.push(
            (async () => {
                while (true) {
                    // Honour an aborted overall-install budget inside the pool.
                    // Without this, a fired --timeout (or Ctrl-C) only aborts
                    // the NETWORK fetches; a tree that is mostly cache-hits /
                    // already-extracted keeps churning the extract loop to
                    // completion, so the install never actually stops when
                    // asked to (a contributor to the observed "it never
                    // completed; I killed it" hang).
                    if (signal?.aborted) throw abortError(signal);
                    const idx = cursor++;
                    if (idx >= queue.length) return;
                    const node = queue[idx];
                    if (!node) return;
                    const wasSkipped = await extractOne(node, prefix, npmrc, log, signal);
                    tickProgress(node, wasSkipped);
                }
            })(),
        );
    }
    await Promise.all(workers);
    progress?.endPhase('download');
    if (skipped > 0) {
        log(
            'install: %d/%d package(s) already up to date — extracted %d',
            skipped,
            queue.length,
            queue.length - skipped,
        );
    }
}

/**
 * Is `name@version` already correctly materialised at `dest`? Reads
 * `<dest>/package.json` and returns true iff its `name` AND `version` match the
 * resolved node exactly. This is the npm/yarn/pnpm "unchanged node" check — an
 * already-present, correct copy is skipped instead of being `rm`-ed and
 * re-extracted.
 *
 * Conservative by design: a missing / unreadable / unparseable package.json, or
 * ANY name/version mismatch, returns false so the caller falls through to the
 * full rm + extract. The only thing this fast-paths is the exact-match case,
 * which is the overwhelming majority of nodes on a warm re-install (the whole
 * resolved tree minus the genuinely-new subtree). Skipping the re-extract is
 * what turns a warm `gjsify install` on a 2000+-package workspace from a
 * many-minute re-extract of every tarball (each gunzip routed through GJS's
 * Gio.ZlibDecompressor on the single GLib main loop) into a near-instant no-op.
 */
function isAlreadyExtracted(dest: string, node: ResolvedNode): boolean {
    const manifestPath = path.join(dest, 'package.json');
    let raw: string;
    try {
        raw = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
        return false;
    }
    try {
        const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
        // Match version exactly. Match name too when present — a stale dir from
        // a previous resolve could hold a different package at the same path
        // (e.g. a nested placement that moved), in which case the version alone
        // could coincidentally collide. A missing `name` (rare, malformed) is
        // tolerated as long as the version matches.
        if (parsed.version !== node.version) return false;
        if (typeof parsed.name === 'string' && parsed.name !== node.name) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * Download + extract one node, or skip it when an identical copy is already on
 * disk. Returns `true` when the node was skipped (already up to date), `false`
 * when it was (re-)extracted.
 */
async function extractOne(
    node: ResolvedNode,
    prefix: string,
    npmrc: NpmrcConfig,
    log: Logger,
    signal?: AbortSignal,
): Promise<boolean> {
    const dest = path.join(prefix, node.installPath);
    // Defense-in-depth against the workspace-source-wipe data-loss bug:
    // every extractable node MUST land inside a `node_modules/` directory.
    // The resolver only ever produces `installPath`s of that shape, so this
    // can only fail if a workspace package leaked into the fetch/extract
    // queue (the root cause fixed in `workspaceInstall`). Refusing here means
    // a regression in the resolver can never again `rmSync` a working-tree
    // source dir — the realpath check additionally rejects a `dest` that
    // resolves THROUGH a symlink into a directory outside node_modules.
    assertNodeModulesDest(dest, node);

    // Idempotent fast-path: the package is already extracted at the resolved
    // version. Skip the cache read + rm + re-extract entirely — this is the
    // npm/yarn/pnpm default (only added/changed nodes are written), and it is
    // the dominant cost on a warm re-install. Force a full re-extract with
    // GJSIFY_INSTALL_FORCE_EXTRACT=1 (debug / corrupted-tree recovery).
    if (process.env.GJSIFY_INSTALL_FORCE_EXTRACT !== '1' && isAlreadyExtracted(dest, node)) {
        log('up-to-date: %s@%s (already extracted at %s)', node.name, node.version, node.installPath);
        return true;
    }

    // Hit the content-addressable cache before touching the network.
    // Tarballs are immutable per SRI integrity, so a hash hit means the
    // cached bytes are byte-identical to whatever the registry would
    // return — no need to verify by re-download.
    let bytes = getCachedTarball(node.integrity);
    if (bytes) {
        log('cache-hit: %s@%s ← %s', node.name, node.version, node.integrity);
    } else if ((bytes = getForeignCachedTarball(node.integrity))) {
        // Second-chance: npm's cacache content store (same SRI key). A user
        // who has run `npm install` before already has the tarball on disk —
        // read it instead of the network. Write it through to OUR store so
        // the next `gjsify install` is a first-class hit even if npm later
        // prunes its cache.
        log('npm-cache-hit: %s@%s ← %s', node.name, node.version, node.integrity);
        putCachedTarball(node.integrity, bytes);
    } else {
        log('fetch: %s@%s ← %s (→ %s)', node.name, node.version, node.tarballUrl, node.installPath);
        bytes = await fetchTarball(node.tarballUrl, {
            npmrc,
            signal,
            integrity: node.integrity,
            onRetry: ({ attempt, error, delayMs }) => {
                log(
                    'tarball %s@%s: retry %d after %dms (%s)',
                    node.name,
                    node.version,
                    attempt,
                    delayMs,
                    errMsg(error),
                );
            },
        });
        // Best-effort cache write — failures are swallowed by `putCachedTarball`
        // so a read-only HOME / out-of-disk cache volume doesn't break the install.
        putCachedTarball(node.integrity, bytes);
    }
    // `rmWithRetry` (not a bare rmSync): on Windows the delete of a freshly
    // extracted tree fails with EBUSY/EPERM while any handle is still open, and
    // stays pending afterwards — so the mkdirSync on the next line would hit
    // EPERM/ENOTEMPTY. No-op cost on POSIX. This runs for EVERY package.
    rmWithRetry(dest);
    fs.mkdirSync(dest, { recursive: true });
    await extractWithStallGuard(bytes, dest, node, signal);
    return false;
}

/**
 * Cap over `extractTarball`, which takes no AbortSignal and no timeout of its
 * own. A single tarball extract completes in well under a second even for
 * large packages; anything past `EXTRACT_STALL_MS` means the decompress/write
 * wedged — the classic dropped Gio stream close-event under GJS, a
 * never-settling await that nothing downstream can break. Unlike a network
 * fetch (30s per-request budget in @gjsify/npm-registry), extraction has no
 * self-healing path, so one stuck package used to hang the whole install at
 * 0% CPU indefinitely. We race the extract against (a) a stall timer and (b)
 * the overall-install abort signal, so a wedge surfaces as an actionable
 * error and the install fails fast instead of hanging.
 *
 * Rejecting the race does not tear down the underlying (leaked) extract
 * promise — the process exit that follows reclaims its resources. Override /
 * disable the cap via `GJSIFY_EXTRACT_STALL_MS` (0 disables the timer; the
 * signal race still applies).
 */
const EXTRACT_STALL_MS = ((): number => {
    const raw = process.env.GJSIFY_EXTRACT_STALL_MS;
    if (raw === undefined) return 120_000;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 120_000;
})();

async function extractWithStallGuard(
    bytes: Uint8Array,
    dest: string,
    node: ResolvedNode,
    signal?: AbortSignal,
): Promise<void> {
    // Fast path: nothing to guard against (timer disabled + no signal).
    if (EXTRACT_STALL_MS === 0 && !signal) {
        await extractTarball(bytes, dest);
        return;
    }
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            // Test seam (matches GJSIFY_INSTALL_FORCE_EXTRACT precedent): simulate
            // an extract that never settles, so a suite can prove the stall timer
            // + abort-signal race actually break the wedge. Never call
            // extractTarball — leave the inner promise pending forever.
            if (process.env.GJSIFY_TEST_HANG_EXTRACT !== '1') {
                // extractTarball keeps running if we lose the race; its settlement
                // (resolve or reject) is a no-op on the already-settled promise.
                extractTarball(bytes, dest).then(() => resolve(), reject);
            }
            if (EXTRACT_STALL_MS > 0) {
                stallTimer = setTimeout(() => {
                    reject(
                        new Error(
                            `gjsify install: extract of ${node.name}@${node.version} stalled for ` +
                                `${Math.round(EXTRACT_STALL_MS / 1000)}s (${node.installPath}) — the tarball ` +
                                `decompress/write never completed. This is usually a dropped Gio stream event ` +
                                `under GJS; re-run the install. Override the cap with GJSIFY_EXTRACT_STALL_MS=<ms> ` +
                                `(0 disables it).`,
                        ),
                    );
                }, EXTRACT_STALL_MS);
                (stallTimer as { unref?: () => void }).unref?.();
            }
            if (signal) {
                if (signal.aborted) {
                    reject(abortError(signal));
                    return;
                }
                onAbort = () => reject(abortError(signal));
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    } finally {
        if (stallTimer) clearTimeout(stallTimer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
}

/**
 * Canonical AbortError carrying the signal's `reason` when it is an Error
 * (e.g. the overall-install timeout sentinel), so `isAbortedFromOverallTimeout`
 * in the install command recognises it and prints the actionable timeout
 * message instead of a raw stack.
 */
function abortError(signal: AbortSignal | undefined): Error {
    const reason = signal && 'reason' in signal ? (signal as { reason?: unknown }).reason : undefined;
    if (reason instanceof Error) return reason;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

/**
 * Guard: a tarball may only be extracted into a `node_modules/` directory.
 *
 * Two checks, both belt-and-suspenders against ever wiping a working-tree
 * source dir (the install-deletes-workspace-sources data-loss bug):
 *
 *   1. The logical `installPath` must contain a `node_modules` path segment.
 *      The resolver always produces such paths; a workspace package that
 *      slipped into the queue would not.
 *   2. If `dest` already exists and resolves (via symlink) to a directory
 *      whose REAL path is not under a `node_modules/` segment, refuse. This
 *      catches the case where `node_modules/<name>` is a symlink to a
 *      workspace's source tree — `rmSync(dest, { recursive: true })` would
 *      then delete the link's target contents.
 */
function assertNodeModulesDest(dest: string, node: ResolvedNode): void {
    const segments = dest.split(path.sep);
    if (!segments.includes('node_modules')) {
        throw new Error(
            `gjsify install: refusing to extract ${node.name}@${node.version} into ${dest} — ` +
                `target is not inside a node_modules/ directory. This would overwrite working-tree files. ` +
                `A workspace package likely leaked into the fetch queue (it must be symlinked, not fetched).`,
        );
    }
    let real: string;
    try {
        real = fs.realpathSync(dest);
    } catch {
        // `dest` doesn't exist yet (fresh install) — nothing to resolve, the
        // logical-path check above is sufficient.
        return;
    }
    const realSegments = real.split(path.sep);
    if (!realSegments.includes('node_modules')) {
        throw new Error(
            `gjsify install: refusing to extract ${node.name}@${node.version} — ${dest} resolves to ${real}, ` +
                `which is outside any node_modules/ directory (likely a symlink to a workspace source tree). ` +
                `Extracting here would delete working-tree source files.`,
        );
    }
}

function depth(installPath: string): number {
    // Count `node_modules/` segments to know nesting depth.
    // `node_modules/foo` = 1, `node_modules/foo/node_modules/bar` = 2, etc.
    return installPath.split('/node_modules/').length;
}

/**
 * Read a bin file's `#!` line, if it has one. Returns `null` for an
 * unreadable/empty file or a first line that is not a shebang — the same
 * fallbacks npm's cmd-shim applies (it then invokes the target directly).
 */
function readShebang(file: string): ReturnType<typeof parseShebang> {
    let head: string;
    try {
        head = fs.readFileSync(file, 'utf-8');
    } catch {
        return null;
    }
    const firstLine = head.trimStart().split(/\r*\n/, 1)[0] ?? '';
    return parseShebang(firstLine);
}

/**
 * Materialise ONE `node_modules/.bin/<name>` entry for `targetAbs`.
 *
 * Exported (and platform-injectable) so the Windows branch is unit-tested from
 * a Linux host — the file layout and shim contents are asserted there; only the
 * `symlinkSync`/`CreateSymbolicLink` syscall behaviour itself is OS-bound.
 *
 * POSIX: a relative symlink, with a copy as the fallback (some filesystems and
 * container overlays reject symlinks).
 *
 * Windows: `.bin/<name>` is not on `PATHEXT` and Windows has no shebang
 * handling, so a symlink OR a copy of a `#!/usr/bin/env node` script is
 * unrunnable — and a *file* symlink additionally needs elevation or Developer
 * Mode, so the previous code reliably fell into its copy fallback and produced
 * a dead entry. npm solves this with three sibling files (`<name>` for
 * git-bash/MSYS/WSL, `<name>.cmd` for cmd.exe, `<name>.ps1` for pwsh); we write
 * the same set from the same templates. See `./bin-shim.ts`.
 */
export function writeBinEntry(opts: { binDir: string; binName: string; targetAbs: string; platform?: string }): void {
    const { binDir, binName, targetAbs } = opts;
    const platform = opts.platform ?? process.platform;
    const linkPath = path.join(binDir, binName);

    if (platform === 'win32') {
        const relPosix = path.relative(binDir, targetAbs).split('\\').join('/');
        const { sh, cmd, ps1 } = buildCmdShim(relPosix, readShebang(targetAbs));
        for (const [file, contents] of [
            [linkPath, sh],
            [`${linkPath}.cmd`, cmd],
            [`${linkPath}.ps1`, ps1],
        ] as const) {
            rmWithRetry(file);
            fs.writeFileSync(file, contents);
            try {
                fs.chmodSync(file, 0o755);
            } catch {
                /* inert on Windows; harmless under WSL/MSYS */
            }
        }
        return;
    }

    rmWithRetry(linkPath);
    const rel = path.relative(binDir, targetAbs);
    try {
        fs.symlinkSync(rel, linkPath);
    } catch {
        fs.copyFileSync(targetAbs, linkPath);
        fs.chmodSync(linkPath, 0o755);
    }
}

async function linkBins(nodes: ResolvedNode[], prefix: string, log: Logger): Promise<void> {
    // Only root-level packages publish bins into the top-level
    // `node_modules/.bin/`. Nested-package bins are addressable by their
    // direct dependents through the nested .bin (npm matches this) — we
    // omit nested-bin linking for now since no consumer of the install
    // backend depends on it (gjsify's own use cases all hit root bins).
    const binDir = path.join(prefix, 'node_modules', '.bin');
    let created = 0;
    for (const node of nodes) {
        if (!node.bin) continue;
        if (depth(node.installPath) !== 1) continue;
        const map = normalizeBin(node.name, node.bin);
        if (map.size === 0) continue;
        fs.mkdirSync(binDir, { recursive: true });
        for (const [binName, binTarget] of map) {
            const targetAbs = path.join(prefix, node.installPath, binTarget);
            if (!fs.existsSync(targetAbs)) continue;
            try {
                fs.chmodSync(targetAbs, 0o755);
            } catch {
                /* best effort */
            }
            writeBinEntry({ binDir, binName, targetAbs });
            created++;
        }
    }
    if (created > 0) log('bin: linked %d entry(ies) under .bin/', created);
}

/**
 * `fs.rmSync(..., { force: true })` with the Windows retry npm/rimraf apply.
 *
 * On Windows a delete fails with `EBUSY`/`EPERM` while any process holds a
 * handle (antivirus scan, an editor, a still-terminating child), and the
 * deletion stays *pending* until the last handle closes — so an immediately
 * following create can hit `EPERM`/`ENOTEMPTY`. Node implements the retry loop
 * for us behind `maxRetries`; it is a no-op on POSIX, where the first attempt
 * always succeeds.
 */
function rmWithRetry(target: string): void {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function normalizeBin(pkgName: string, bin: string | Record<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    if (typeof bin === 'string') {
        // String form is shorthand for `{ <last-segment-of-pkgName>: <bin> }`.
        const baseName = pkgName.startsWith('@') ? pkgName.slice(pkgName.indexOf('/') + 1) : pkgName;
        out.set(baseName, bin);
        return out;
    }
    for (const [k, v] of Object.entries(bin)) out.set(k, v);
    return out;
}

async function loadNpmrc(opts: InstallOptions): Promise<NpmrcConfig> {
    const home = os.homedir();
    let parsed: NpmrcConfig = {
        registry: opts.registry ?? DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    // Layered .npmrc lookup (most-specific wins): home → project (cwd's
    // prefix). npm itself merges through `XDG_CONFIG_HOME/npm/npmrc` and a
    // workspace-root one too; the gjsify project-local case is what users
    // hit most often (mock-registry tests, scoped-registry overrides), so
    // we cover that explicitly.
    for (const candidate of [path.join(home, '.npmrc'), path.join(opts.prefix, '.npmrc')]) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const projectParsed = parseNpmrc(fs.readFileSync(candidate, 'utf-8'));
            parsed = { ...parsed, ...projectParsed, scopes: { ...parsed.scopes, ...projectParsed.scopes } };
        } catch (e) {
            console.warn(`gjsify install: ignoring malformed ${candidate}: ${(e as Error).message}`);
        }
    }
    // env-var override (npm convention: `npm_config_registry`).
    const envRegistry = process.env.npm_config_registry;
    if (envRegistry) parsed.registry = envRegistry;
    // Explicit caller-provided registry trumps everything else.
    if (opts.registry) parsed.registry = opts.registry;
    return parsed;
}

type Logger = (fmt: string, ...args: unknown[]) => void;

function makeLogger(verbose: boolean): Logger {
    if (!verbose) {
        return () => {
            /* silent unless verbose */
        };
    }
    return (fmt, ...args) => {
        const msg = fmt.replace(/%s|%d/g, () => String(args.shift()));
        process.stderr.write(`gjsify install: ${msg}\n`);
    };
}
