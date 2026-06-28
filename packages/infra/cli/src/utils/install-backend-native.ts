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
import {
    cacheRootForLogging,
    getCachedTarball,
    getForeignCachedTarball,
    isCacheHit,
    putCachedTarball,
} from './install-tarball-cache.js';
import { getCachedPackument, putCachedPackument } from './install-packument-cache.js';
import { assertNativeBackendNodeVersion } from './node-version.js';

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
}

const LOCKFILE_NAME = 'gjsify-lock.json';
const LOCKFILE_VERSION = 2;

interface LockfileEntry {
    version: string;
    resolved: string;
    integrity?: string;
    dependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
}

interface Lockfile {
    lockfileVersion: number;
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
    } else if (!opts.refreshLockfile && existingLock && lockfileMatchesRequest(existingLock, opts.specs)) {
        log('install: using lockfile (%d package(s))', Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else {
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
        );
        if (opts.lockfile) {
            writeLockfile(lockfilePath, opts.specs, nodes);
            log('install: wrote %s (%d entries)', LOCKFILE_NAME, nodes.length);
        }
    }

    log('install: downloading %d tarball(s)', nodes.length);
    await downloadAndExtractAll(nodes, opts.prefix, npmrc, log, opts.signal, progress);
    await linkBins(nodes, opts.prefix, log);
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
    const queue: Edge[] = specs.map(parseSpec).map((s) => ({
        from: null,
        name: s.name,
        range: applyOverride(s.name, s.range),
        required: true,
    }));

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

            // Walk the ancestor chain to see whether a satisfying placement is
            // already visible from the requester's `node_modules` lookup. npm's
            // resolver does this — each level of nesting acts as a fallback.
            const visible = findVisible(edge.from, edge.name, byPath);
            if (visible && satisfiesRange(visible.version, edge.range)) {
                // Compatible placement reachable; reuse, no new install.
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
                };
                byPath.set(installPath, node);
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
    return Array.from(byPath.values());
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
        // eslint-disable-next-line no-constant-condition
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
        };
    }
    const lockfile: Lockfile = {
        lockfileVersion: LOCKFILE_VERSION,
        requested: [...specs],
        packages,
    };
    fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n');
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
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await extractTarball(bytes, dest);
    return false;
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
            const linkPath = path.join(binDir, binName);
            fs.rmSync(linkPath, { force: true });
            const rel = path.relative(binDir, targetAbs);
            try {
                fs.symlinkSync(rel, linkPath);
                created++;
            } catch {
                fs.copyFileSync(targetAbs, linkPath);
                fs.chmodSync(linkPath, 0o755);
                created++;
            }
        }
    }
    if (created > 0) log('bin: linked %d entry(ies) under .bin/', created);
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
