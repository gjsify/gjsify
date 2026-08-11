// Native install backend — GJS-runnable replacement for `npm install`.
//
// Pipeline: parse specs → resolve deps via @gjsify/npm-registry packuments and
// @gjsify/semver → download tarballs in parallel → extract into node_modules/
// via @gjsify/tar. Output layout matches `npm install` so `runGjsBundle()`'s
// prebuild detection needs no branching. Hoisting is npm v3+: root placement
// unless the root holds an incompatible version, then nested under the requester.
//
// PLATFORM FILTERING (os/cpu/libc) — the tree is RESOLVED for every platform and
// INSTALLED for one. A node the host cannot run is marked `inert` (npm's word):
// not downloaded, not extracted, still in `gjsify-lock.json` with its
// `os`/`cpu`/`libc`. A lockfile recording only what ONE host can install is a
// machine snapshot — commit it and a colleague on another OS gets a tree missing
// its binaries with no drift reported. So DECLARATIONS are locked and the VERDICT
// is recomputed per host (`applyPlatformFilter`).
//
// Three invariants hold that up. Each is structural rather than documented,
// because the first draft broke the first two while reading as if it did not.
// The measured record is packages/infra/cli/AGENTS.md § `gjsify install`.
//
//   1. THE RESOLVE IS TARGET-BLIND — `resolveDeps` takes no target, so it cannot
//      record a target-dependent declaration. The draft gated `libc` escalation
//      on `target.os === 'linux'`, so a macOS-authored lockfile carried no `libc`
//      for anything and a Linux colleague's `--immutable` got no libc filtering
//      at all. The resolve now reads the FULL document for every package, as
//      arborist does (`#fetchManifest` sets `fullMetadata: true`).
//   2. `optional` IS DERIVED, NEVER TRUSTED — a fixpoint over the placed graph on
//      BOTH paths (`computeOptionalFlags`), before it is persisted and before the
//      platform verdict reads it. The draft promoted at the reuse site, one shot,
//      making the answer depend on BFS edge order: a genuinely required
//      transitive dep reached first through an optional edge stayed flagged
//      optional, was persisted that way, and was then silently skipped on every
//      machine instead of raising EBADPLATFORM. npm computes the same flags as a
//      fixpoint for the same reason (refs/npm-cli/workspaces/arborist/lib/
//      calc-dep-flags.js).
//   3. OPTIONALITY BELONGS TO THE EDGE, not to the block the name came from. A
//      name in BOTH `dependencies` and `optionalDependencies` is OPTIONAL (npm's
//      documented override) — hence {@link requiredDepEntries} in every dep walk.
//      `@parcel/rust@2.16.4` lists all eight of its napi platform packages in
//      both blocks, so a `dependencies`-only walk made `@parcel/rust-darwin-x64`
//      REQUIRED and every Linux install of a tree containing parcel died with
//      EBADPLATFORM where `npm install` exits 0. It hid because that napi shape
//      is overwhelmingly published in ONE block (`oxlint`, `esbuild`, `rollup`),
//      which is what every mock corpus reaches for too. Costs a lockfile field
//      (v4); without it the fresh-resolve and lockfile paths disagree about one
//      tree.
//
// Out of scope (still deferred): peerDependencies validation, lifecycle scripts,
// git/file specs.

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
    type PackumentVersion,
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
import { getCachedPackument, putCachedPackument, type PackumentShape } from './install-packument-cache.js';
import { assertNativeBackendNodeVersion } from './node-version.js';
import {
    buildCmdShim,
    buildLauncherShims,
    buildNativeEnvPreamble,
    buildShLauncher,
    isGjsBundlePath,
    parseShebang,
    pickBinMap,
} from './bin-shim.js';
import { detectNativePackages } from './detect-native-packages.js';
import {
    badPlatformError,
    checkPlatform,
    declaresPlatform,
    describePlatformTarget,
    readPlatformForce,
    resolveHostPlatform,
    type PlatformDeclaration,
    type PlatformTarget,
} from './platform-check.js';

// 16-wide download pool, matched to the shared Soup.Session's lifted
// `max-conns-per-host` (@gjsify/fetch `getSharedSession`) — without that lift
// libsoup's default of 2 caps real concurrency however wide the pool is. Same
// order of magnitude as npm (`maxsockets` 15) and pnpm (`network-concurrency` 16).
const DEFAULT_CONCURRENCY = Number(process.env.GJSIFY_INSTALL_CONCURRENCY ?? '16') || 16;

interface ParsedSpec {
    name: string;
    range: string;
}

/**
 * One placed package in the resolved tree. Exported as a TYPE only, so a spec can
 * hand {@link computeOptionalFlags} and {@link applyPlatformFilter} a graph
 * directly instead of driving a whole install; nothing outside this module
 * constructs one for real.
 */
export interface ResolvedNode {
    name: string;
    version: string;
    tarballUrl: string;
    integrity?: string;
    /** Relative to the install prefix. Always starts with `node_modules/`; nested
     *  entries look like `node_modules/<parent>/node_modules/<dep>`. */
    installPath: string;
    /** Ranges keyed by name, as published. */
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
    bin?: string | Record<string, string>;
    /**
     * The version's `os`/`cpu`/`libc` declaration, as published. Recorded here
     * (and in the lockfile) so the VERDICT can be recomputed for whichever host
     * runs the install — header note on portability.
     *
     * Read from the FULL packument, the only document carrying `libc`: the
     * abbreviated one can never PROVE a `libc` restriction is absent, so a
     * declaration built from it is silently incomplete for exactly the packages
     * the field exists for (nine of this repo's own — `@gjsify/{rolldown,
     * lightningcss,oxfmt}-native`, `webgl`, `napi`, `sab-native`,
     * `terminal-native`, `http2-native`, `http-soup-bridge` — declare
     * `libc: ["glibc"]` and NO `os`/`cpu`).
     */
    platform?: PlatformDeclaration;
    /**
     * Is this node reachable ONLY through optionalDependency edges? Decides what
     * an incompatible platform means: skip silently vs. fail the install. npm
     * calls the same set `optionalSet`.
     *
     * DERIVED, not an input — {@link computeOptionalFlags} recomputes it as a
     * fixpoint on both the fresh-resolve and the lockfile path before anything
     * reads it. What the BFS assigns at placement time is a forward guess, used
     * only to decide whether a resolve FAILURE under this node is tolerated.
     *
     * Absent must read as `false` (= required): callers also build nodes
     * structurally caring only about name/installPath, and the safe default for
     * an unknown edge kind is the loud one — a required incompatible dependency
     * fails the install instead of vanishing from the tree.
     */
    optional?: boolean;
    /**
     * Set by {@link applyPlatformFilter}: not runnable on the install target, so
     * not downloaded or extracted. Never persisted — a per-host verdict, not a
     * property of the resolution.
     */
    inert?: boolean;
}

const LOCKFILE_NAME = 'gjsify-lock.json';
/**
 * v3 adds the per-entry platform declaration (`os`/`cpu`/`libc`) plus `optional`,
 * which together let a foreign-platform package be recorded without being
 * installed. v4 adds the per-entry `optionalDependencies` map, without which the
 * optionality fixpoint cannot see WHICH of an entry's edges are optional and a
 * name declared in both blocks comes out required (header note, invariant 3).
 * Older lockfiles are still READ — see {@link readLockfile}.
 */
const LOCKFILE_VERSION = 4;
/**
 * Lockfile versions this CLI can read. A v2 file is a valid pin set that merely
 * predates the platform fields; rejecting it (the old `!== LOCKFILE_VERSION →
 * null` behaviour) discards the whole file and lets the following fresh resolve
 * bump every `^`-range to the newest in-range version — the silent churn lockfile
 * preservation exists to prevent, on every user's first install after a CLI
 * upgrade.
 *
 * READING an older file is not TRUSTING it for everything: only the current
 * version short-circuits the resolve (see the branch below), so a v2/v3 file
 * seeds version preservation and is then rewritten. `--immutable` must consume
 * what it was handed verbatim, so there alone a pre-v4 file keeps its pre-v4 edge
 * fidelity — a both-blocks optional dep is judged required, exactly as before
 * this fix, which is an unchanged outcome rather than a new failure, and one
 * plain `gjsify install` upgrades the file. Failing `--immutable` on an
 * old-but-readable lockfile would instead break every CI whose committed file
 * predates this CLI.
 */
const READABLE_LOCKFILE_VERSIONS = new Set([2, 3, LOCKFILE_VERSION]);

interface LockfileEntry {
    version: string;
    resolved: string;
    integrity?: string;
    dependencies?: Record<string, string>;
    /**
     * The entry's `optionalDependencies`, as published, omitted when empty. Same
     * field name and meaning as in npm's `package-lock.json` v3 entries.
     *
     * PERSISTED BECAUSE THE FIXPOINT NEEDS IT (header note, invariant 3): which
     * edges are optional is a property of the published manifest, not of the host,
     * and {@link computeOptionalFlags} runs on the lockfile path too. Recording
     * only `dependencies` left that path unable to tell the two apart, so the
     * `@parcel/rust` shape came out required and its foreign-platform siblings
     * turned an install npm thins into an EBADPLATFORM.
     */
    optionalDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    /**
     * Platform declaration, omitted when the package declares none (the vast
     * majority — absence keeps the lockfile diff small). Field names match npm's
     * `package-lock.json` v3 so the two read side by side.
     */
    os?: string | string[];
    cpu?: string | string[];
    libc?: string | string[];
    /** `true` only for optional-only nodes; omitted otherwise (npm does the same). */
    optional?: true;
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

/**
 * {@link InstallOptions} plus what only the NATIVE backend can use.
 *
 * `optionalSpecs` exists because a spec is a flat `"<name>@<range>"` string by the
 * time it reaches here (`projectSpecsFromPackageJson` flattens `dependencies`,
 * `devDependencies` and `optionalDependencies` into one list), yet the KIND
 * decides what an incompatible `os`/`cpu`/`libc` means — skipped vs. fatal. The
 * live shape is `optionalDependencies: { fsevents }` in a project manifest: npm
 * leaves fsevents out on Linux and installs fine, so treating every top-level
 * spec as required turns that into a hard EBADPLATFORM for a package nothing on
 * the host would load.
 *
 * It rides the SAME options object `install-backend.ts` forwards wholesale here.
 * If that forwarding is ever changed to destructure, this field must be forwarded
 * with it, or top-level optional deps quietly become required again — the
 * `install-platform-filter` e2e is where that assumption is pinned.
 */
export interface NativeInstallOptions extends InstallOptions {
    /**
     * Names (not spec strings — the range differs per requester) of top-level
     * specs declared as `optionalDependencies`. Absent ⇒ every top-level spec is
     * required, the pre-platform-filter behaviour.
     */
    optionalSpecs?: Set<string>;
}

export async function installPackagesNative(opts: NativeInstallOptions): Promise<InstalledTopLevel[]> {
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
    // concurrent installs into the same node_modules used to interleave `rmSync` +
    // extract on shared destination dirs and tear the lockfile. Re-entrant within
    // the process (a workspace install already holds the root-prefix lock, so this
    // only bumps a refcount). Other prefixes proceed concurrently; the shared XDG
    // caches stay lock-free because their tmp+rename writes are atomic
    // (install-cache-fs.ts).
    const lock = await acquireInstallLock(opts.prefix, { signal: opts.signal });
    try {
        return await installPackagesNativeLocked(opts, npmrc, log);
    } finally {
        lock.release();
    }
}

/** Body of {@link installPackagesNative}, run while holding the prefix lock. */
async function installPackagesNativeLocked(
    opts: NativeInstallOptions,
    npmrc: NpmrcConfig,
    log: Logger,
): Promise<InstalledTopLevel[]> {
    const progress = opts.progress;
    const lockfilePath = path.join(opts.prefix, LOCKFILE_NAME);
    const existingLock = readLockfile(lockfilePath);

    // The triple this install materialises FOR. Normally the running host;
    // `--os/--cpu/--libc` (npm's config keys, read from the environment by
    // `resolveHostPlatform`) override it, which is what makes the darwin/win32/musl
    // branches reviewable from one machine.
    const target = resolveHostPlatform();
    const force = readPlatformForce(process.env);
    log('install: platform target %s%s', describePlatformTarget(target), force ? ' (--force: checks bypassed)' : '');

    let nodes: ResolvedNode[];
    /** Did a resolve actually run? Only then is there something new to persist. */
    let resolved = false;
    /**
     * Edges whose resolve FAILED and was tolerated because the edge looked optional
     * when visited; re-judged against the fixpoint optionality below (see
     * {@link assertRequiredEdgesResolved}). Empty on the lockfile paths, which
     * resolve nothing.
     */
    let skippedEdges = new Set<string>();
    if (opts.frozen) {
        // --immutable / --frozen: the lockfile is authoritative. Reject a missing,
        // version-mismatched or drifted file — silently honouring a stale lockfile
        // masks the real dep churn `--immutable` exists to catch.
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
        existingLock.lockfileVersion === LOCKFILE_VERSION &&
        lockfileMatchesRequest(existingLock, opts.specs)
    ) {
        log('install: using lockfile (%d package(s))', Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else {
        // A resolve has to run (new/changed/removed dep, or no lockfile yet).
        //
        // A pre-v4 lockfile lands here too even when it matches the request: each
        // bump added something the verdict is recomputed FROM, so a file lacking it
        // cannot be consumed verbatim — pre-v3 entries carry no platform
        // declaration (the foreign-platform tree would keep installing forever),
        // pre-v4 entries no `optionalDependencies` map (the `@parcel/rust` shape
        // fails the install; header note, invariant 3). One version-preserving
        // resolve upgrades the file, and that matters beyond tidiness: the lockfile
        // is written BEFORE the platform filter runs, so a failing install left a
        // v3 file behind that would otherwise reproduce its own EBADPLATFORM
        // forever without ever resolving again.
        //
        // Unless --refresh-lockfile was passed, seed from the versions already
        // pinned so unchanged deps keep them and only genuinely new/changed deps
        // move — the npm/yarn/pnpm `install` default. Without it every `^`-range
        // re-resolves to the newest registry version, churning the whole tree (and
        // silently bumping transitives) on a one-package add.
        const preferred = !opts.refreshLockfile && existingLock ? buildPreferredVersions(existingLock) : undefined;
        log(
            'install: resolving %d top-level spec(s) → %s%s',
            opts.specs.length,
            opts.prefix,
            preferred ? ` (preserving ${preferred.size} locked name(s))` : '',
        );
        // `target` is deliberately NOT passed: the resolve must produce the same
        // tree and the same recorded declarations on every machine (header note,
        // invariant 1), and giving it nothing target-shaped to read is what keeps
        // that true.
        const resolveResult = await resolveDeps(
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
            opts.optionalSpecs,
        );
        nodes = resolveResult.nodes;
        skippedEdges = resolveResult.skippedEdges;
        resolved = true;
    }

    // `optional` is DERIVED here on BOTH paths for the same reason
    // `applyPlatformFilter` is: the answer must not depend on how the tree arrived,
    // and a flag read back from a file is an INPUT nothing checked. Order matters —
    // before `writeLockfile` (so the persisted flag is final), before the platform
    // verdict (which reads it for fatal vs. inert), and before the workspace filter
    // below (which removes nodes and would truncate the walk).
    computeOptionalFlags(nodes, requiredTopLevelNames(opts.specs, opts.optionalSpecs), log);
    assertRequiredEdgesResolved(nodes, skippedEdges);

    if (resolved && opts.lockfile) {
        // The FULL resolved set, inert nodes included — see the header note:
        // the lockfile is the portable artifact, the platform verdict is not.
        writeLockfile(lockfilePath, opts.specs, nodes);
        log('install: wrote %s (%d entries)', LOCKFILE_NAME, nodes.length);
    }

    // A package named after one of the monorepo's own workspaces is provided by a
    // workspace symlink (wired by `workspaceInstall`), NOT by a registry tarball —
    // even when the lockfile or a transitive edge pins a same-named published
    // version. Dropping those nodes keeps `extractOne` from `rm`ing the workspace
    // source symlink (its data-loss guard would abort the whole install), and keeps
    // `--immutable` robust against a committed lockfile that still carries such
    // entries, since that path never runs `resolveDeps`.
    if (opts.workspaceNames && opts.workspaceNames.size > 0) {
        const before = nodes.length;
        nodes = nodes.filter((n) => !opts.workspaceNames!.has(n.name));
        const dropped = before - nodes.length;
        if (dropped > 0) {
            log('install: %d workspace-provided package(s) symlinked, not fetched', dropped);
        }
    }

    // os/cpu/libc: throws for an incompatible REQUIRED dep, marks incompatible
    // OPTIONAL ones inert. Runs on BOTH paths (fresh resolve and lockfile) —
    // that is what makes one committed lockfile install a per-host subset.
    const installable = applyPlatformFilter(nodes, target, force, log);

    log('install: downloading %d tarball(s)', installable.length);
    await downloadAndExtractAll(installable, opts.prefix, npmrc, log, opts.signal, progress);
    await linkBins(installable, opts.prefix, log);
    warnMissingNativeBuilds(installable, opts.prefix, log);
    log('install: done');

    // Top-level requested packages only, so callers can write the resolved version
    // back into package.json (`npm install --save`).
    return topLevelResolutions(opts.specs, nodes);
}

function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

/**
 * Split a resolved tree into what THIS target can install, marking the rest inert.
 * A post-pass rather than a filter during the walk (as in arborist's
 * `refs/npm-cli/workspaces/arborist/lib/arborist/build-ideal-tree.js`) for two
 * reasons: the verdict must be identical whether the tree came from a fresh
 * resolve or from `gjsify-lock.json`, and a node's optionality is only final once
 * every edge that could reach it has been visited.
 *
 * The two outcomes are npm's, including the asymmetry around `force`:
 *   - REQUIRED + incompatible → EBADPLATFORM. A required dep the host cannot run
 *     is a broken install, not a smaller one, so it fails loudly with
 *     `pkgid`/`current`/`required`. `--force` suppresses it (the user is asserting
 *     something about their own machine).
 *   - OPTIONAL + incompatible → inert: not downloaded, not extracted, still in the
 *     lockfile. `--force` does NOT lift this — npm says so in as many words ("We
 *     ignore the --force and --engine-strict flags"), and forcing an optional
 *     binary that cannot load buys a download and nothing else.
 *
 * The skip line carries npm's `current`/`required` payload so `--verbose` recovers
 * WHY a package is absent. Silence here is what made the original defect invisible
 * in the other direction: 3.67 GB arrived with no line saying it should not have.
 */
export function applyPlatformFilter(
    nodes: ResolvedNode[],
    target: PlatformTarget,
    force: boolean,
    log: Logger,
): ResolvedNode[] {
    const installable: ResolvedNode[] = [];
    let skipped = 0;
    for (const node of nodes) {
        const declaration = node.platform;
        if (!declaration || !declaresPlatform(declaration)) {
            installable.push(node);
            continue;
        }
        const verdict = checkPlatform(declaration, target);
        if (verdict.ok) {
            installable.push(node);
            continue;
        }
        const pkgid = `${node.name}@${node.version}`;
        if (!node.optional) {
            if (force) {
                log('platform-forced: %s (required, incompatible, installed anyway via --force)', pkgid);
                installable.push(node);
                continue;
            }
            throw badPlatformError(pkgid, verdict);
        }
        node.inert = true;
        skipped++;
        log(
            'platform-skip: %s (%s) current=%s required=%s',
            pkgid,
            node.installPath,
            JSON.stringify(verdict.current),
            JSON.stringify(verdict.required),
        );
    }
    if (skipped > 0) {
        // Verbose-only, like every other per-install summary here — and like npm,
        // which reports inert optional packages only through its final count.
        log('install: %d optional package(s) inert — not installable on %s', skipped, describePlatformTarget(target));
    }
    return installable;
}

/**
 * Warn about a native package that installed WITHOUT a usable binary.
 *
 * This install is node-free and does NOT run `install`/`postinstall` scripts —
 * `node-gyp rebuild` would need Node plus a C++ toolchain. Such a package works
 * only if it SHIPS a prebuild (`prebuilds/<platform>-<arch>/…`) or is built by
 * hand; with neither it silently loads no binary, as `@gjsify/node-gi 0.21.0` did
 * (installed, `node_gi.node` absent, consumer hit a runtime failure with no hint).
 * Pure detection — no script is run, so node-free-ness is preserved.
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
    // Top-level installs live at `node_modules/<name>`, never nested.
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
 * What one resolve hands back. TWO values rather than just the tree, because a
 * TOLERATED FAILURE cannot be judged while the walk is running: `resolveDeps`
 * rethrows based on `edge.required`, the BFS's forward guess (a later required edge
 * can still reach the same node), so every swallowed failure must survive the walk
 * to be re-judged against the final flags.
 *
 * npm carries the identical pair for the identical reason: a `#loadFailures` set
 * beside the ideal tree, re-judged by `#pruneFailedOptional()` only AFTER
 * `#fixDepFlags()` has run `calcDepFlags`
 * (refs/npm-cli/workspaces/arborist/lib/arborist/build-ideal-tree.js). That ORDER
 * is the contract, and this function's call site mirrors it: flags, then the
 * assertion.
 */
interface ResolveResult {
    /** Every placed package. Unique by `installPath`. */
    nodes: ResolvedNode[];
    /**
     * Edges whose resolve FAILED and was swallowed because the edge looked optional
     * when the walk reached it. Keyed by {@link edgeKey}; usually empty.
     */
    skippedEdges: Set<string>;
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
 * The walk is BFS over (requester, depName, depRange) edges. Top-level specs are
 * seeded with a synthetic `null` requester so they hoist to the root.
 *
 * TAKES NO PLATFORM TARGET, a load-bearing absence (header note, invariant 1): the
 * tree and the `os`/`cpu`/`libc` it records must be identical on every machine, so the
 * platform verdict is a separate post-pass this function cannot influence. Do not
 * reintroduce the parameter — reading the full document unconditionally needs neither
 * a target nor a heuristic.
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
     * Lockfile-preservation oracle: `name → versions already pinned`. A pinned
     * version satisfying the edge's range is reused instead of the newest registry
     * match. Undefined ⇒ always pick the newest in-range version (first install, or
     * `--refresh-lockfile`).
     */
    preferredVersions?: Map<string, Set<string>>,
    /**
     * The monorepo's own workspace packages. Such an edge is satisfied by the
     * workspace symlink, so it is skipped here — the published version and its
     * subtree never enter the resolved tree or the lockfile.
     */
    workspaceNames?: Set<string>,
    /**
     * Requester labels for top-level specs (`"<name>@<range>"` → workspace names),
     * see `InstallOptions.specOrigins`. Only attributes the conflict warning.
     */
    specOrigins?: Map<string, string[]>,
    /**
     * Names of top-level specs declared as `optionalDependencies` — see
     * {@link NativeInstallOptions.optionalSpecs}. Seeds the edge `required: false`,
     * so a resolve failure is skipped rather than fatal. The FINAL flag still comes
     * from {@link computeOptionalFlags}, not from this walk.
     */
    optionalSpecs?: Set<string>,
): Promise<ResolveResult> {
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
        // FULL document (`accept: application/json`), not the abbreviated "corgi"
        // install document — the same choice arborist makes for every dependency it
        // resolves (`#fetchManifest` sets `fullMetadata: true`,
        // refs/npm-cli/workspaces/arborist/lib/arborist/build-ideal-tree.js).
        //
        // WHY, and why no cheaper trigger exists: the registry omits `libc` from the
        // abbreviated body (measured — `@rollup/rollup-linux-x64-musl` returns
        // `{os,cpu}` under the corgi accept header and `{os,cpu,libc}` under
        // `application/json`), so that body can never PROVE a version has no libc
        // restriction, and every "escalate only where it can matter" rule has a
        // hole. The draft's rule — escalate when the corgi entry declares `os` or
        // `cpu` — had exactly the hole that matters: the nine `@gjsify/*` bridges
        // declare `libc: ["glibc"]` with NO `os`/`cpu`, so on Alpine the installer
        // would have handed a glibc-only prebuild to a musl host and failed at
        // `dlopen` instead of at install time.
        //
        // The trade is one authoritative document per package instead of two plus an
        // unsound heuristic; measured over 15 representative deps of this workspace,
        // the full document costs 1.26× the abbreviated one in transfer bytes and
        // ~11% FEWER round-trips than corgi-plus-escalate.
        const fresh = fetchPackumentWithDiskCache(name, npmrc, log, signal, 'full');
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
        /**
         * Whether failure to resolve should throw. `false` for an optionalDependency
         * edge and for any edge below a node that looked optional when placed — a
         * FORWARD GUESS, since a later required edge can still reach that node. Every
         * tolerated failure is recorded in `skippedEdges` and re-judged against the
         * final flags (see {@link assertRequiredEdgesResolved}).
         */
        required: boolean;
    }
    /** See {@link ResolveResult.skippedEdges}. Keyed by {@link edgeKey}. */
    const skippedEdges = new Set<string>();
    // Bookkeeping for the version-conflict warning: `name → (applied range →
    // requester labels)`. Only TOP-LEVEL specs participate — conflicting transitive
    // edges are resolved correctly by nesting, but conflicting top-level specs (what
    // `workspaceInstall` produces when two workspaces declare incompatible ranges of
    // the same external dep) all compete for the single root slot and the resolver
    // silently keeps one version for everyone. Per-workspace dedup is Phase D.8
    // (status/open-todos.md); until it lands the conflict is surfaced loudly after
    // the resolve (see emitTopLevelConflictWarnings).
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
            required: !optionalSpecs?.has(s.name),
        };
    });

    // Wave-based BFS: drain the current queue level, prefetch its not-yet-cached
    // packuments in bounded parallel, then place SERIALLY in FIFO order. Newly
    // discovered children always append, so "the current queue contents" is exactly
    // one BFS level and the serial pass visits edges in the same order a single-edge
    // loop would — which is what keeps `decidePlacement`'s order-dependent hoist/nest
    // decisions, and hence the lockfile, unchanged. Only the network moved: N
    // sequential ~RTT packument fetches per level collapse into one batch, the
    // dominant cold-install cost. `packumentCache` still guarantees ≤1 fetch per
    // unique name, so the same SET is fetched, just batched. Pointless before the
    // `max-conns-per-host` lift in `@gjsify/fetch` — libsoup's default of 2 would
    // have throttled it anyway.
    while (queue.length > 0) {
        const wave = queue.splice(0, queue.length);

        const toPrefetch: string[] = [];
        const queuedForFetch = new Set<string>();
        for (const edge of wave) {
            if (packumentCache.has(edge.name) || queuedForFetch.has(edge.name)) continue;
            queuedForFetch.add(edge.name);
            toPrefetch.push(edge.name);
        }
        await prefetchPackuments(toPrefetch, fetchPkg, signal);

        // Serial placement pass; every `fetchPkg` here resolves from the warmed cache
        // instead of blocking on a fresh round-trip.
        for (let wi = 0; wi < wave.length; wi++) {
            const edge = wave[wi];

            // A workspace member is satisfied by its symlink, never by a registry
            // tarball — skip so the published version and its subtree never enter the
            // resolved tree or the lockfile.
            if (workspaceNames?.has(edge.name)) continue;

            // Is a satisfying placement already visible from the requester's
            // `node_modules` lookup? npm's resolver does the same — each level of
            // nesting acts as a fallback.
            const visible = findVisible(edge.from, edge.name, byPath);
            if (visible && satisfiesRange(visible.version, edge.range)) {
                // Reuse; no new install. NOTHING IS PROMOTED HERE: setting
                // `visible.optional = false` on a required edge is the obvious move
                // and it is wrong, because the node's own dep edges were already
                // queued with the STALE flag, so its children stay optional and the
                // one-shot promotion answers by edge order (the reviewed defect).
                // {@link computeOptionalFlags} is the only writer of the final flag.
                continue;
            }

            // No compatible placement. Resolve a version, preferring one already
            // pinned when it satisfies the range so an add does not bump unchanged
            // deps.
            let version: string | null = null;
            try {
                const packument = await fetchPkg(edge.name);
                const preferred = preferredVersionFor(preferredVersions?.get(edge.name), edge.range);
                version = pickVersion(packument, edge.range, preferred);
                if (!version) {
                    // Throw even for an optional edge and let the catch below decide:
                    // ONE place knows what a tolerated failure costs (a log line and a
                    // `skippedEdges` entry). A bare `if (!edge.required) continue` here
                    // skipped silently and left nothing for the post-pass to re-judge.
                    throw new Error(`No version of ${edge.name} satisfies ${edge.range}`);
                }
                const v = packument.versions[version];
                if (!v) {
                    throw new Error(`Packument for ${edge.name} promised ${version} but no entry exists`);
                }

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
                    // Complete as published: `fetchPkg` reads the FULL document, so all
                    // three fields come from one body — no second fetch, no heuristic.
                    platform: platformDeclarationOf(v),
                    // Forward guess only; `computeOptionalFlags` overwrites it. Still
                    // worth setting, because the child edges queued below read it, which
                    // is what keeps a failure under a plainly-optional subtree non-fatal
                    // at the point of failure.
                    optional: !edge.required,
                };
                byPath.set(installPath, node);
                if (installPath === `node_modules/${edge.name}`) {
                    root.set(edge.name, node);
                }
                log('resolve: %s@%s ← %s (at %s)', edge.name, version, edge.range, installPath);
                // Moving soft-total: resolved so far + edges left in this wave +
                // children queued for the next. The converging estimate yarn/pnpm use.
                progress?.update({
                    phase: 'resolve',
                    current: byPath.size,
                    total: byPath.size + (wave.length - wi - 1) + queue.length,
                    name: `${edge.name}@${version}`,
                });

                if (!skipDeps) {
                    // REQUIRED edges only — a name this package also lists in
                    // `optionalDependencies` is queued once by the loop below, as
                    // optional (header note, invariant 3). Queuing it here too would
                    // place it with a `required: true` forward guess, making a resolve
                    // failure fatal and, via the fixpoint, its incompatible platform
                    // siblings fatal too.
                    for (const [depName, depRange] of requiredDepEntries(node)) {
                        queue.push({
                            from: installPath,
                            name: depName,
                            // A dependency of an OPTIONAL node inherits its optionality
                            // (npm's `optionalSet`). Load-bearing for the platform check:
                            // foreign-platform optional packages are resolved on purpose
                            // to keep the lockfile portable, so their own required deps
                            // get visited too. Treating darwin-only `fsevents`' subtree as
                            // required would fail every Linux install with EBADPLATFORM
                            // over a package nothing on the host will ever load.
                            range: applyOverride(depName, depRange),
                            required: !node.optional,
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
                // Optional deps that fail to resolve are skipped (yarn/npm behaviour);
                // required deps re-throw.
                if (!edge.required) {
                    // RECORDED, not merely logged: `edge.required` is the walk's forward
                    // guess and a later required edge can still make this node mandatory.
                    // `assertRequiredEdgesResolved` re-judges every entry against the
                    // fixpoint flags, so a genuinely required dependency cannot go missing
                    // just because BFS reached it through an optional edge first.
                    skippedEdges.add(edgeKey(edge.from, edge.name));
                    log('resolve: optional dep %s@%s skipped (%s)', edge.name, edge.range, errMsg(e));
                    continue;
                }
                throw e;
            }
        }
    }

    progress?.endPhase('resolve');
    emitTopLevelConflictWarnings(topLevelRanges, root);
    // NO declaration post-pass here, deliberately: `fetchPkg` read the FULL document for
    // every package, so each `platform` is complete as published. The draft's second
    // `libc`-only fetch sat at exactly this line and needed the platform target to
    // decide when to fire — reintroducing the pass reintroduces the one argument this
    // function must never have (header note, invariant 1).
    //
    // `optional` is likewise NOT finalised here; these flags are still the walk's
    // forward guess, overwritten by `computeOptionalFlags` at the call site.
    return { nodes: Array.from(byPath.values()), skippedEdges };
}

/**
 * The platform declaration a packument version carries, or undefined when it
 * declares none (the common case — undefined keeps the node and the lockfile entry
 * minimal).
 */
function platformDeclarationOf(version: PackumentVersion): PlatformDeclaration | undefined {
    const declaration: PlatformDeclaration = { os: version.os, cpu: version.cpu, libc: version.libc };
    return declaresPlatform(declaration) ? declaration : undefined;
}

/**
 * Identity of one dependency EDGE: the requester's `installPath` (empty string
 * for the project root) plus the dependency name.
 *
 * The PAIR is the identity, never the name alone: the same unresolvable name can be
 * legitimately absent below an optional subtree and a hard error below a required
 * one, and only the requester says which — a `skippedEdges` keyed by name would
 * collapse the two and answer whichever it saw last.
 *
 * `\n` separates because no npm package name and no install path can contain one
 * (npm rejects control characters in names, and every path here is built out of
 * names), so the key round-trips through {@link parseEdgeKey}
 * unambiguously. Deliberately NOT `\u0000`, the other obvious choice: the GJS
 * bundle minifier rewrites that escape into a raw NUL byte and GJS then refuses to
 * parse the bundle at all ("template literal not terminated").
 */
function edgeKey(from: string | null, name: string): string {
    return `${from ?? ''}\n${name}`;
}

/** Inverse of {@link edgeKey}; `from` is null for a top-level (project) edge. */
function parseEdgeKey(key: string): { from: string | null; name: string } {
    const sep = key.indexOf('\n');
    const from = key.slice(0, sep);
    return { from: from === '' ? null : from, name: key.slice(sep + 1) };
}

/**
 * Seed set for {@link computeOptionalFlags}: the NAMES of the top-level specs the
 * project did not declare optional. Everything else must EARN its required status
 * by being reachable from one of these.
 *
 * The parse is load-bearing. `specs` are flat `"<name>@<range>"` strings while
 * `optionalSpecs` holds bare NAMES (the range differs per requester — see
 * {@link NativeInstallOptions.optionalSpecs}), so testing a spec string against the
 * set is a lookup that can never hit: every top-level optionalDependency would be
 * seeded REQUIRED and the `optionalDependencies: { fsevents }` shape would fail
 * every Linux install with EBADPLATFORM instead of thinning. An earlier version
 * compared the two directly and did exactly that; pinned by the "incompatible
 * OPTIONAL top-level dep is skipped, not fatal" case in
 * `tests/e2e/install-platform-filter`.
 */
function requiredTopLevelNames(specs: string[], optionalSpecs?: Set<string>): Set<string> {
    const names = new Set<string>();
    for (const spec of specs) {
        const name = parseSpecName(spec);
        if (optionalSpecs?.has(name)) continue;
        names.add(name);
    }
    return names;
}

/**
 * A node's REQUIRED dependency edges: its `dependencies` minus every name its
 * `optionalDependencies` also lists. The ONE place that decides an edge's kind —
 * both the resolve walk and the optionality fixpoint read it, so they cannot drift.
 *
 * The subtraction is npm's rule, not ours: "entries in optionalDependencies will
 * override entries of the same name in dependencies" (npm's package.json docs).
 *
 * NOT MERELY A DEDUP: the kind decides what an incompatible `os`/`cpu`/`libc` MEANS
 * (fatal vs. inert in `applyPlatformFilter`) and whether a failed resolve is
 * tolerated. Reading `dependencies` alone does not just visit a name twice, it
 * promotes a foreign-platform binary to a required dependency and fails installs npm
 * completes — the header note's invariant 3.
 *
 * Deliberately NOT symmetric: a name in `optionalDependencies` alone is optional (no
 * `dependencies` entry to override), covered by {@link resolveDeps}'s second queue loop.
 */
export function requiredDepEntries(
    node: Pick<ResolvedNode, 'dependencies' | 'optionalDependencies'>,
): [string, string][] {
    const entries: [string, string][] = [];
    for (const [name, range] of Object.entries(node.dependencies)) {
        if (name in node.optionalDependencies) continue;
        entries.push([name, range]);
    }
    return entries;
}

/**
 * Recompute every node's `optional` flag as a FIXPOINT over the placed graph. The
 * only writer of the final flag; whatever the nodes arrive carrying is an input
 * nothing checked (a BFS forward guess on the resolve path, a value read out of a
 * file on the lockfile path) and is overwritten unconditionally.
 *
 * DEFINITION: a node is REQUIRED iff reachable from `requiredNames` through
 * REQUIRED edges alone ({@link requiredDepEntries}); every other node is optional.
 * Optionality is therefore INHERITED — a plain dependency OF an optional package is
 * still optional, which is what npm's `optionalSet` computes.
 *
 * WHY A FIXPOINT AND NOT A ONE-SHOT PROMOTION AT THE REUSE SITE (the reviewed
 * defect): the walk queues a node's dep edges when it is placed, carrying the
 * optionality it had THEN, so promoting the node later leaves its children behind and
 * the answer depends on which edge BFS traversed first. A required transitive dep
 * reached first through an optional edge stayed flagged optional, was persisted that
 * way, and was then silently skipped by the platform filter on every machine instead
 * of raising EBADPLATFORM. A monotone worklist over the FINISHED graph cannot have
 * that property: "required" only ever spreads, so the result is order-independent.
 * Same shape as refs/npm-cli/workspaces/arborist/lib/calc-dep-flags.js.
 *
 * PATH-INDEPENDENCE is the other requirement, and why the lockfile carries an
 * `optionalDependencies` map per entry (v4). This walk USED to read `dependencies`
 * only, because a lockfile entry recorded nothing else and consulting
 * `node.optionalDependencies` would have made the two paths compute different flags
 * for one tree. That premise was fixable and its consequence — a both-blocks name
 * coming out REQUIRED — was not (header note, invariant 3). A pre-v4 lockfile leaves
 * the map empty and reproduces the old behaviour for that file alone
 * (READABLE_LOCKFILE_VERSIONS).
 *
 * Exported so the unit spec can drive it with INJECTED graphs — the whole
 * fatal-vs-inert question is decided by this and `applyPlatformFilter` in
 * composition, worth pinning without a registry.
 */
export function computeOptionalFlags(nodes: ResolvedNode[], requiredNames: Set<string>, log: Logger): void {
    const byPath = new Map<string, ResolvedNode>();
    for (const node of nodes) byPath.set(node.installPath, node);

    /** `installPath`s proven reachable through required edges alone. */
    const required = new Set<string>();
    /** Nodes newly proven required and not yet expanded. */
    const worklist: string[] = [];
    const enter = (node: ResolvedNode): void => {
        if (required.has(node.installPath)) return;
        required.add(node.installPath);
        worklist.push(node.installPath);
    };

    // Top-level specs always hoist (`decidePlacement` returns the root slot for a
    // null requester), so the seed lookup is exact. A name with no placement is a
    // workspace member satisfied by its symlink — nothing to flag.
    for (const name of requiredNames) {
        const seed = byPath.get(`node_modules/${name}`);
        if (seed) enter(seed);
    }
    while (worklist.length > 0) {
        const installPath = worklist.pop();
        if (installPath === undefined) break;
        const node = byPath.get(installPath);
        if (!node) continue;
        for (const [depName] of requiredDepEntries(node)) {
            // Resolve the edge the way the REQUESTER will at runtime — through
            // the ancestor `node_modules` chain — so a nested copy is credited
            // to the requester that nested it and the hoisted one is not
            // accidentally kept alive by a dependent that cannot even see it.
            const resolvedTo = findVisible(installPath, depName, byPath);
            if (resolvedTo) enter(resolvedTo);
        }
    }

    // Count the disagreements, don't just apply them: a nonzero `corrected` is the
    // signal that the incoming flags (the walk's guess, or a lockfile from an older
    // CLI) were wrong for this tree. Otherwise invisible, because a corrected result
    // looks exactly like a correct one.
    let corrected = 0;
    for (const node of nodes) {
        const optional = !required.has(node.installPath);
        if ((node.optional ?? false) !== optional) corrected++;
        node.optional = optional;
    }
    log(
        'install: optionality fixpoint — %d of %d node(s) reachable only via optional edges%s',
        nodes.length - required.size,
        nodes.length,
        corrected > 0 ? `; corrected ${corrected} incoming flag(s)` : '',
    );
}

/**
 * Re-judge every failure the resolve swallowed against the FIXPOINT flags, and throw
 * if one turned out to be required after all.
 *
 * `resolveDeps` tolerates a failed edge on the strength of `edge.required`, a
 * forward guess made while the graph was incomplete. Without this second half of the
 * bargain a genuinely required dependency disappears from the tree for no better
 * reason than BFS reaching it through an optional edge first — an install that
 * "succeeded" and produced a tree that cannot run, explained only by a `--verbose`
 * line nobody read.
 *
 * Same shape and position as npm's `#pruneFailedOptional()` (after the flag pass).
 * The difference is what we hold: npm placed a real broken Node and still has the
 * original error, we recorded only the edge, so the message names the edge and points
 * at the verbose line carrying the cause.
 *
 * The three tolerated cases below are each a property of the EDGE, not of the tree.
 */
function assertRequiredEdgesResolved(nodes: ResolvedNode[], skippedEdges: Set<string>): void {
    if (skippedEdges.size === 0) return;
    const byPath = new Map<string, ResolvedNode>();
    for (const node of nodes) byPath.set(node.installPath, node);

    for (const key of skippedEdges) {
        const { from, name } = parseEdgeKey(key);
        // Top-level edge: tolerated only because the project's own manifest put the
        // spec in `optionalDependencies` (the ONLY way `requiredTopLevelNames` leaves
        // it out of the seed set), and no later edge can revise the manifest.
        if (from === null) continue;
        const requester = byPath.get(from);
        // Requester never made it into the tree, so nothing depends on this edge.
        if (!requester) continue;
        // The whole subtree is optional-only — npm's `optionalSet`, skipped silently.
        if (requester.optional) continue;
        // A REQUIRED package's own optionalDependency stays optional whatever the
        // package's flag says: optionality lives on the edge, not on its endpoints
        // (header note, invariant 3). This branch is what keeps a darwin-only
        // `fsevents` under a required `chokidar` from failing every Linux install.
        //
        // Membership, not `requiredDepEntries`: the failed edge may name something no
        // longer in `dependencies` at all, and the question is whether the requester
        // declared THIS name optional. Safe on both paths — `skippedEdges` is only
        // ever non-empty on the fresh-resolve path, where `optionalDependencies` is
        // populated.
        if (name in requester.optionalDependencies) continue;

        throw new Error(
            `install: required dependency ${name} of ${requester.name}@${requester.version} ` +
                `(${requester.installPath}) could not be resolved.\n` +
                `The failure was tolerated during the walk because ${requester.name} looked optional at that ` +
                `point, but the final dependency graph makes it required — so ${name} is required too and the ` +
                `tree would be incomplete.\n` +
                `Re-run with --verbose and look for the "resolve: optional dep ${name}@… skipped (…)" line for ` +
                `the underlying cause.`,
        );
    }
}

/**
 * Loud one-line-per-package warning for top-level version-range conflicts (ADR
 * 0001). Fires when two or more top-level specs requested DIFFERENT ranges of the
 * same package and the version hoisted to the root does not satisfy all of them, so
 * some requester silently got a version outside its declared range. Compatible
 * ranges (`^1.2` + `^1.4` both satisfied by `1.9.0`) stay silent; non-semver ranges
 * (dist-tags like `latest`) cannot be compared and are skipped.
 *
 * This makes the single-root-slot behaviour honest rather than silent; the real fix
 * is a per-workspace dedup pass, Phase D.8 (status/open-todos.md).
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
 * Fetch a packument with on-disk ETag revalidation: the cached
 * `{ etag, packument }` for `(registry, name)` goes out as `If-None-Match`, a `304`
 * returns the cached body, a `200` stores the fresh body + ETag. Keyed by the
 * registry the NAME resolves to, so scope-registry overrides never
 * cross-contaminate. Falls back to a plain fetch with no cached entry or no ETag
 * from the registry (the 304 fast-path then simply never fires).
 *
 * `shape` selects WHICH document — `'corgi'` (abbreviated) or `'full'`, the only one
 * this backend's resolve asks for because it is the only one carrying `libc`. It is
 * threaded through request `accept`, cache read AND cache write, because the two are
 * different bodies with independently-versioned ETags for one URL; mixing them
 * anywhere in that chain produces a `libc`-less body that looks like a hit.
 */
async function fetchPackumentWithDiskCache(
    name: string,
    npmrc: NpmrcConfig,
    log: Logger,
    signal?: AbortSignal,
    shape: PackumentShape = 'corgi',
): Promise<Packument> {
    const registry = registryFor(name, npmrc);
    const fullMetadata = shape === 'full';
    const disk = getCachedPackument(registry, name, shape);
    const onRetry = ({ attempt, error, delayMs }: { attempt: number; error: unknown; delayMs: number }) => {
        log('packument %s (%s): retry %d after %dms (%s)', name, shape, attempt, delayMs, errMsg(error));
    };
    const result = await fetchPackumentConditional(name, {
        npmrc,
        signal,
        ifNoneMatch: disk?.etag,
        fullMetadata,
        onRetry,
    });
    if (result.status === 'not-modified' && disk) {
        log('packument-cache-hit: %s (%s, 304, etag %s)', name, shape, disk.etag);
        return disk.packument;
    }
    if (result.status === 'fresh' && result.packument) {
        if (result.etag) putCachedPackument(registry, name, result.etag, result.packument, shape);
        return result.packument;
    }
    // 304 with no cached body to satisfy it — a stale `If-None-Match` raced a cache
    // eviction. Re-fetch unconditionally so a body is always returned.
    return fetchPackument(name, { npmrc, signal, fullMetadata, onRetry });
}

/**
 * Warm `packumentCache` for a batch of names with bounded parallelism (the download
 * pool's `DEFAULT_CONCURRENCY` width). Rejections — a 404 on an optional dep, say —
 * are swallowed: the promise stays cached in its rejected state and the caller's
 * per-edge `await fetchPkg(name)` re-surfaces it, so required deps still throw and
 * optional ones are skipped exactly as on the single-edge path. Swallowing also stops
 * one bad optional dependency from aborting the whole wave's batch.
 */
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
 * The placement of `name` that `requesterPath` would resolve through Node's
 * `node_modules` lookup — its own nested copy first (nested deps shadow ancestor
 * ones), then each ancestor, then the root. The first match is what the requester
 * actually sees at runtime.
 */
function findVisible(
    requesterPath: string | null,
    name: string,
    byPath: Map<string, ResolvedNode>,
): ResolvedNode | null {
    const candidates: string[] = [];
    if (requesterPath !== null) {
        candidates.push(`${requesterPath}/node_modules/${name}`);
        // Walk up by stripping the deepest `/node_modules/<pkg>` segment each time.
        let p = requesterPath;
        while (true) {
            const idx = p.lastIndexOf('/node_modules/');
            if (idx < 0) break;
            p = p.slice(0, idx);
            candidates.push(`${p}/node_modules/${name}`);
            if (p === '') break;
        }
    }
    // Also covers `requesterPath === null`.
    candidates.push(`node_modules/${name}`);

    for (const candidate of candidates) {
        const hit = byPath.get(candidate);
        if (hit) return hit;
    }
    return null;
}

/**
 * Where to install `name@version` for a request from `requesterPath`: hoist to
 * `node_modules/<name>` when the root slot is empty or already holds this version,
 * nest under the requester when the root holds a different one. Top-level requesters
 * (`requesterPath === null`) always hoist.
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
        // Defensive: the caller dedups top-level specs, so this only fires on a
        // duplicate top-level spec with conflicting versions.
        return `node_modules/${name}`;
    }
    return `${requesterPath}/node_modules/${name}`;
}

function satisfiesRange(version: string, range: string): boolean {
    // A dist-tag (`latest`) cannot be matched here; those are only meaningful at
    // fresh-resolve time.
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
        // Every readable version, not just the current one — READABLE_LOCKFILE_VERSIONS
        // has the reason. The caller decides what it may be used FOR.
        if (!READABLE_LOCKFILE_VERSIONS.has(parsed.lockfileVersion)) return null;
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
            // The EDGE KINDS, for the same reason the platform declaration is here:
            // `computeOptionalFlags` runs on the lockfile path too and cannot recompute
            // what the file does not carry (v4, header note invariant 3).
            optionalDependencies:
                Object.keys(node.optionalDependencies).length > 0 ? node.optionalDependencies : undefined,
            bin: node.bin,
            // The DECLARATION, never the verdict: `inert` is per-host and deliberately
            // absent from the file, since a lockfile recording which packages the
            // author's machine skipped installs a different tree for everyone else.
            os: node.platform?.os,
            cpu: node.platform?.cpu,
            libc: node.platform?.libc,
            optional: node.optional ? true : undefined,
        };
    }
    const lockfile: Lockfile = {
        lockfileVersion: LOCKFILE_VERSION,
        requested: [...specs],
        packages,
    };
    // Atomic tmp+rename so a crash mid-write, or a reader racing the writer, can never
    // observe a torn gjsify-lock.json — `--immutable` would otherwise hard-fail on the
    // corrupt file with a misleading error.
    atomicWriteStrict(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n');
}

/**
 * The lockfile-preservation oracle: `name → every version currently pinned` (a name
 * can appear at more than one path/version when the tree nested a conflicting copy).
 * Consulted during a resolve so unchanged deps keep their pinned version instead of
 * bumping to the newest in-range match.
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
    return Object.entries(lockfile.packages).map(([installPath, entry]) => {
        const platform: PlatformDeclaration = { os: entry.os, cpu: entry.cpu, libc: entry.libc };
        return {
            name: nameFromInstallPath(installPath),
            version: entry.version,
            tarballUrl: entry.resolved,
            integrity: entry.integrity,
            installPath,
            dependencies: entry.dependencies ?? {},
            // Empty for a pre-v4 entry, which is why such a file never short-circuits
            // the resolve: with no edge kinds recorded, a name the publisher put in both
            // blocks reads as required here. `--immutable` consumes it anyway — see
            // READABLE_LOCKFILE_VERSIONS.
            optionalDependencies: entry.optionalDependencies ?? {},
            bin: entry.bin,
            // Rebuilt from the recorded declaration so `applyPlatformFilter` reaches the
            // SAME verdict here as on the fresh-resolve path, for THIS host — generally
            // not the host that wrote the file. A v2 entry has none of these fields, so
            // nothing is filtered and the install behaves as it did pre-feature.
            platform: declaresPlatform(platform) ? platform : undefined,
            optional: entry.optional === true,
        };
    });
}

function nameFromInstallPath(installPath: string): string {
    // Everything after the last `node_modules/` boundary is the package name — one
    // segment unscoped, `@scope/pkg` scoped.
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
 * Human-readable diff between `lockfile.requested` and the live request, or null when
 * they are identical. `--immutable` uses it to name exactly which deps drifted, so a
 * CI failure does not force the user to diff lockfile JSON by hand.
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

// Internal API, exported for `install-backend-parse-spec.spec.ts`.
export function parseSpec(raw: string): ParsedSpec {
    // A bare name resolves to the `latest` DIST-TAG, matching `npm install foo`, and
    // that choice is what picks up prereleases the publisher tagged `latest`. Semver
    // `*` would silently exclude every version with a `-` suffix (semver §9: "Pre-
    // release versions have a lower precedence than the associated normal version");
    // ts-for-gir shipped only prereleases (`latest` = 4.0.0-rc.17, no stable 4.x) and
    // `*` selected the abandoned 3.3.0 instead.
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

// Internal API, exported for `install-backend-parse-spec.spec.ts`.
export function pickVersion(packument: Packument, range: string, preferred?: string): string | null {
    // Lockfile preservation: a pinned version that still satisfies the range and is
    // still published is reused rather than bumped. `preferred` is only ever a concrete
    // semver, never a dist-tag, so this cannot hijack a `latest`/`next` range.
    if (preferred && packument.versions[preferred] && satisfiesRange(preferred, range)) {
        return preferred;
    }

    // dist-tag fast path: `latest`, `next`, ...
    if (packument['dist-tags'][range]) return packument['dist-tags'][range];

    // Validate the range early so a typo fails loudly.
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
    // Depth ascending, so parents extract before children — extracting a parent on
    // top of an existing child wipes the child out.
    const queue = [...nodes].sort(
        (a, b) => depth(a.installPath) - depth(b.installPath) || (a.installPath < b.installPath ? -1 : 1),
    );
    const workers: Array<Promise<void>> = [];
    const concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, queue.length));
    progress?.beginPhase('download', queue.length);
    let completed = 0;
    // Nodes already correctly materialised on disk (npm's "unchanged" set). Surfaced in
    // the summary log so a warm install explains why the phase finished in seconds.
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
    // Depth-1 parents extract serially first, to avoid `rm -rf` + extract racing their
    // own children; depths ≥2 then run at full concurrency.
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
                    // Honour an aborted overall-install budget inside the pool. Without
                    // this a fired --timeout (or Ctrl-C) aborts only the NETWORK fetches,
                    // so a mostly-cached tree churns the extract loop to completion and
                    // the install never stops when asked — one contributor to the observed
                    // "it never completed; I killed it" hang.
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
 * Is `name@version` already correctly materialised at `dest`? The npm/yarn/pnpm
 * "unchanged node" check: an already-present, correct copy is skipped instead of being
 * `rm`-ed and re-extracted.
 *
 * Conservative by design — a missing/unreadable/unparseable package.json or ANY
 * name/version mismatch returns false, so the caller falls through to the full rm +
 * extract. Only the exact-match case is fast-pathed, which is the overwhelming
 * majority of nodes on a warm re-install, and that is what turns a warm `gjsify
 * install` on a 2000+-package workspace from a many-minute re-extract of every tarball
 * (each gunzip routed through GJS's Gio.ZlibDecompressor on the single GLib main loop)
 * into a near-instant no-op.
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
        // Name too, when present: a stale dir from a previous resolve can hold a
        // different package at the same path (a nested placement that moved), where the
        // version alone could coincidentally collide. A missing `name` is tolerated.
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
    // Defence-in-depth against the workspace-source-wipe data-loss bug: this can only
    // fail if a workspace package leaked into the fetch/extract queue (the root cause
    // fixed in `workspaceInstall`), and refusing here means a resolver regression can
    // never again `rmSync` a working-tree source dir.
    assertNodeModulesDest(dest, node);

    // Idempotent fast-path — skip the cache read + rm + re-extract for a node already
    // extracted at the resolved version. The npm/yarn/pnpm default (only added/changed
    // nodes are written) and the dominant cost on a warm re-install.
    // GJSIFY_INSTALL_FORCE_EXTRACT=1 forces a full re-extract for corrupted-tree recovery.
    if (process.env.GJSIFY_INSTALL_FORCE_EXTRACT !== '1' && isAlreadyExtracted(dest, node)) {
        log('up-to-date: %s@%s (already extracted at %s)', node.name, node.version, node.installPath);
        return true;
    }

    // Content-addressable cache before the network: tarballs are immutable per SRI
    // integrity, so a hash hit is byte-identical to what the registry would return and
    // needs no verifying re-download.
    let bytes = getCachedTarball(node.integrity);
    if (bytes) {
        log('cache-hit: %s@%s ← %s', node.name, node.version, node.integrity);
    } else if ((bytes = getForeignCachedTarball(node.integrity))) {
        // Second chance: npm's cacache content store, same SRI key — anyone who has run
        // `npm install` already has the tarball on disk. Written through to OUR store so
        // the next `gjsify install` hits first-class even if npm prunes its cache.
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
        // Best-effort: `putCachedTarball` swallows failures so a read-only HOME or an
        // out-of-disk cache volume does not break the install.
        putCachedTarball(node.integrity, bytes);
    }
    // `rmWithRetry`, not a bare rmSync: on Windows deleting a freshly extracted tree
    // fails EBUSY/EPERM while any handle is open and stays pending afterwards, so the
    // mkdirSync below would hit EPERM/ENOTEMPTY. No-op cost on POSIX.
    rmWithRetry(dest);
    fs.mkdirSync(dest, { recursive: true });
    await extractWithStallGuard(bytes, dest, node, signal);
    return false;
}

/**
 * Cap over `extractTarball`, which takes no AbortSignal and no timeout of its own. One
 * extract completes in well under a second even for large packages, so anything past
 * `EXTRACT_STALL_MS` means the decompress/write wedged — the classic dropped Gio stream
 * close-event under GJS, a never-settling await nothing downstream can break. Unlike a
 * network fetch (30s per-request budget in @gjsify/npm-registry) extraction has no
 * self-healing path, so one stuck package used to hang the whole install at 0% CPU
 * indefinitely. Racing the extract against a stall timer AND the overall-install abort
 * signal turns that into an actionable error.
 *
 * Rejecting the race does not tear down the leaked extract promise; the process exit
 * that follows reclaims it. `GJSIFY_EXTRACT_STALL_MS=0` disables the timer, leaving the
 * signal race in place.
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
    // Nothing to guard against: timer disabled and no signal.
    if (EXTRACT_STALL_MS === 0 && !signal) {
        await extractTarball(bytes, dest);
        return;
    }
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            // Test seam: simulate an extract that never settles, so a suite can prove
            // the stall timer + abort-signal race actually break the wedge.
            if (process.env.GJSIFY_TEST_HANG_EXTRACT !== '1') {
                // extractTarball keeps running if it loses the race; its settlement is
                // then a no-op on the already-settled promise.
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
 * Guard: a tarball may only be extracted into a `node_modules/` directory. Two checks,
 * both against ever wiping a working-tree source dir (the
 * install-deletes-workspace-sources data-loss bug):
 *
 *   1. The logical `installPath` must contain a `node_modules` segment. The resolver
 *      always produces such paths; a workspace package that slipped in would not.
 *   2. An existing `dest` whose REAL path (after symlinks) is not under a
 *      `node_modules/` segment is refused — that is `node_modules/<name>` symlinked to
 *      a workspace source tree, where `rmSync(dest, { recursive: true })` deletes the
 *      link's target contents.
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
        // `dest` does not exist yet (fresh install); the logical-path check suffices.
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
    // `node_modules/foo` = 1, `node_modules/foo/node_modules/bar` = 2, …
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
 * Exported and platform-injectable so the Windows branch is unit-tested from a Linux
 * host; only the `symlinkSync`/`CreateSymbolicLink` syscall itself is OS-bound.
 *
 * POSIX: a relative symlink, falling back to a copy (some filesystems and container
 * overlays reject symlinks).
 *
 * Windows: `.bin/<name>` is not on `PATHEXT` and Windows has no shebang handling, so a
 * symlink OR a copy of a `#!/usr/bin/env node` script is unrunnable — and a *file*
 * symlink additionally needs elevation or Developer Mode, so the previous code reliably
 * fell into its copy fallback and produced a dead entry. npm's answer is three sibling
 * files (`<name>` for git-bash/MSYS/WSL, `<name>.cmd` for cmd.exe, `<name>.ps1` for
 * pwsh); the same set is written from the same templates (`./bin-shim.ts`).
 */
export function writeBinEntry(opts: {
    binDir: string;
    binName: string;
    targetAbs: string;
    platform?: string;
    /**
     * Set when this entry is the package's GJS-runnable artifact (`gjsify.bin`), making
     * it a GENERATED launcher rather than a link to a file with a shebang — see
     * {@link buildShLauncher} for why, {@link pickBinMap} for why `gjsify.bin` wins.
     *
     * The preamble exports `GI_TYPELIB_PATH` / the loader path before `gjs` starts. It
     * cannot be done from inside the bundle: GI resolves the typelib while the runtime
     * boots, before the first line runs.
     */
    gjs?: { envPreamble: string; prebuildDirs: readonly string[] };
    /**
     * The package's npm `bin` target when it declares one ALONGSIDE `gjsify.bin`; the
     * launcher then picks a runtime per invocation instead of hard-coding `gjs` (see
     * {@link pickBinMap}). Absent for a package declaring only one of the two, which is
     * every package but `@gjsify/cli` today.
     */
    nodeFallbackAbs?: string;
}): void {
    const { binDir, binName, targetAbs, gjs, nodeFallbackAbs } = opts;
    const platform = opts.platform ?? process.platform;
    const linkPath = path.join(binDir, binName);

    if (gjs) {
        const isBundle = isGjsBundlePath(targetAbs);
        // Replace the whole sibling set — a previous install may have written a plain
        // symlink, or npm's three-file shim, under this very name.
        for (const stale of [linkPath, `${linkPath}.cmd`, `${linkPath}.ps1`]) rmWithRetry(stale);
        fs.writeFileSync(
            linkPath,
            buildShLauncher(targetAbs, { envPreamble: gjs.envPreamble, isGjsBundle: isBundle, nodeFallbackAbs }),
        );
        try {
            fs.chmodSync(linkPath, 0o755);
        } catch {
            /* inert on Windows; harmless under WSL/MSYS */
        }
        if (platform === 'win32' && isBundle) {
            // No dedicated DLL-search variable on Windows: LoadLibrary searches PATH, and
            // GLib's search-path separator is `;` there too, so both variables take the
            // same `;`-joined value.
            const joined = gjs.prebuildDirs.join(';');
            const prependEnv: Record<string, string> =
                gjs.prebuildDirs.length > 0 ? { GI_TYPELIB_PATH: joined, PATH: joined } : {};
            const shims = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: targetAbs,
                prependEnv,
                fallback: nodeFallbackAbs === undefined ? undefined : { interpreter: 'node', target: nodeFallbackAbs },
            });
            fs.writeFileSync(`${linkPath}.cmd`, shims.cmd);
            fs.writeFileSync(`${linkPath}.ps1`, shims.ps1);
        }
        return;
    }

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
    // Only root-level packages publish bins into the top-level `node_modules/.bin/`.
    // Nested-bin linking is omitted because no consumer of this backend needs it — a
    // nested package's bins are addressable by its direct dependents through the nested
    // .bin, which is what npm does too.
    const binDir = path.join(prefix, 'node_modules', '.bin');
    let created = 0;

    // Computed on first use: the scan walks the whole prefix, and most installs contain
    // no package declaring `gjsify.bin` at all.
    let gjsEnv: { envPreamble: string; prebuildDirs: readonly string[] } | undefined;
    const gjsEnvForPrefix = (): { envPreamble: string; prebuildDirs: readonly string[] } => {
        if (gjsEnv === undefined) {
            const prebuildDirs = detectNativePackages(prefix).map((p) => p.prebuildsDir);
            gjsEnv = { envPreamble: buildNativeEnvPreamble(prefix, prebuildDirs), prebuildDirs };
        }
        return gjsEnv;
    };

    for (const node of nodes) {
        if (depth(node.installPath) !== 1) continue;
        const pkgDir = path.join(prefix, node.installPath);
        // The INSTALLED manifest is the source of truth here, not the packument the
        // resolver carried: `gjsify.bin` is a gjsify-specific field npm's abbreviated
        // packument does not include, so a packument-only read structurally cannot see
        // it. Falls back to the resolved npm `bin` when the extracted manifest is
        // unreadable.
        const manifest = readInstalledManifest(pkgDir) ?? (node.bin === undefined ? null : { bin: node.bin });
        if (manifest === null) continue;
        const picked = pickBinMap(node.name, manifest);
        if (picked === null || picked.map.size === 0) continue;
        fs.mkdirSync(binDir, { recursive: true });
        for (const [binName, binTarget] of picked.map) {
            const targetAbs = path.join(pkgDir, binTarget);
            if (!fs.existsSync(targetAbs)) continue;
            try {
                fs.chmodSync(targetAbs, 0o755);
            } catch {
                /* best effort */
            }
            // Only a fallback that EXISTS is worth writing: a launcher naming a missing
            // Node entry trades exit 127 for a different exit 127.
            const fallbackRel = picked.nodeFallback?.get(binName);
            const fallbackAbs = fallbackRel === undefined ? undefined : path.join(pkgDir, fallbackRel);
            writeBinEntry({
                binDir,
                binName,
                targetAbs,
                gjs: picked.isGjsBin ? gjsEnvForPrefix() : undefined,
                nodeFallbackAbs: fallbackAbs !== undefined && fs.existsSync(fallbackAbs) ? fallbackAbs : undefined,
            });
            created++;
        }
    }
    if (created > 0) log('bin: linked %d entry(ies) under .bin/', created);
}

/**
 * Read an extracted package's `package.json`, returning `null` rather than throwing: a
 * node can legitimately have no manifest on disk (an optional dependency skipped for
 * this platform), and bin linking is not the place to fail an otherwise-complete
 * install. The caller falls back to the resolved npm `bin`.
 */
function readInstalledManifest(
    pkgDir: string,
): { bin?: string | Record<string, string>; gjsify?: { bin?: string | Record<string, string> } } | null {
    try {
        const raw = fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8');
        return JSON.parse(raw) as { bin?: string | Record<string, string>; gjsify?: { bin?: string } };
    } catch {
        return null;
    }
}

/**
 * `fs.rmSync(..., { force: true })` with the Windows retry npm/rimraf apply: there a
 * delete fails `EBUSY`/`EPERM` while any process holds a handle (antivirus scan, an
 * editor, a still-terminating child) and stays *pending* until the last handle closes,
 * so an immediately following create can hit `EPERM`/`ENOTEMPTY`. Node implements the
 * retry loop behind `maxRetries`; a no-op on POSIX, where the first attempt succeeds.
 */
function rmWithRetry(target: string): void {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function loadNpmrc(opts: InstallOptions): Promise<NpmrcConfig> {
    const home = os.homedir();
    let parsed: NpmrcConfig = {
        registry: opts.registry ?? DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    // Layered .npmrc lookup, most-specific wins: home → project (the prefix). npm also
    // merges `XDG_CONFIG_HOME/npm/npmrc` and a workspace-root file; the project-local
    // case is the one users hit (mock-registry tests, scoped-registry overrides).
    for (const candidate of [path.join(home, '.npmrc'), path.join(opts.prefix, '.npmrc')]) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const projectParsed = parseNpmrc(fs.readFileSync(candidate, 'utf-8'));
            parsed = { ...parsed, ...projectParsed, scopes: { ...parsed.scopes, ...projectParsed.scopes } };
        } catch (e) {
            console.warn(`gjsify install: ignoring malformed ${candidate}: ${(e as Error).message}`);
        }
    }
    // npm convention.
    const envRegistry = process.env.npm_config_registry;
    if (envRegistry) parsed.registry = envRegistry;
    // An explicit caller-provided registry trumps everything else.
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
