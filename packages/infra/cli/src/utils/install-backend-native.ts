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

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
    Range,
    SemVer,
    maxSatisfying,
    satisfies,
} from "@gjsify/semver";
import {
    DEFAULT_REGISTRY,
    fetchPackument,
    fetchTarball,
    parseNpmrc,
    type NpmrcConfig,
    type Packument,
    type PackumentVersion,
} from "@gjsify/npm-registry";
import { extractTarball } from "@gjsify/tar";

import type { InstallOptions } from "./install-backend.ts";

const DEFAULT_CONCURRENCY = Number(process.env.GJSIFY_INSTALL_CONCURRENCY ?? "8") || 8;

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

const LOCKFILE_NAME = "gjsify-lock.json";
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
    if (opts.specs.length === 0) {
        throw new Error("installPackagesNative: empty specs list");
    }

    fs.mkdirSync(opts.prefix, { recursive: true });
    const npmrc = await loadNpmrc(opts);
    const log = makeLogger(opts.verbose ?? false);

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
        log("install: --immutable, using lockfile (%d package(s))", Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else if (existingLock && lockfileMatchesRequest(existingLock, opts.specs)) {
        log("install: using lockfile (%d package(s))", Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else {
        log("install: resolving %d top-level spec(s) → %s", opts.specs.length, opts.prefix);
        nodes = await resolveDeps(opts.specs, npmrc, log);
        if (opts.lockfile) {
            writeLockfile(lockfilePath, opts.specs, nodes);
            log("install: wrote %s (%d entries)", LOCKFILE_NAME, nodes.length);
        }
    }

    log("install: downloading %d tarball(s)", nodes.length);
    await downloadAndExtractAll(nodes, opts.prefix, npmrc, log);
    await linkBins(nodes, opts.prefix, log);
    log("install: done");

    // Surface the top-level requested packages so callers can update
    // package.json with the resolved version (mirrors `npm install --save`
    // behavior). Sub-deps are not included.
    return topLevelResolutions(opts.specs, nodes);
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
    if (spec.startsWith("@")) {
        const slash = spec.indexOf("/");
        if (slash === -1) return spec;
        const at = spec.indexOf("@", slash + 1);
        return at === -1 ? spec : spec.slice(0, at);
    }
    const at = spec.indexOf("@");
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
): Promise<ResolvedNode[]> {
    const packumentCache = new Map<string, Promise<Packument>>();
    const fetchPkg = (name: string): Promise<Packument> => {
        const cached = packumentCache.get(name);
        if (cached) return cached;
        const fresh = fetchPackument(name, { npmrc });
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
        range: s.range,
        required: true,
    }));

    while (queue.length > 0) {
        const edge = queue.shift() as Edge;

        // Walk the ancestor chain to see whether a satisfying placement is
        // already visible from the requester's `node_modules` lookup. npm's
        // resolver does this — each level of nesting acts as a fallback.
        const visible = findVisible(edge.from, edge.name, byPath);
        if (visible && satisfiesRange(visible.version, edge.range)) {
            // Compatible placement reachable; reuse, no new install.
            continue;
        }

        // No compatible existing placement. Resolve a fresh version.
        let version: string | null = null;
        try {
            const packument = await fetchPkg(edge.name);
            version = pickVersion(packument, edge.range);
            if (!version) {
                if (!edge.required) continue;
                throw new Error(
                    `No version of ${edge.name} satisfies ${edge.range}`,
                );
            }
            const v = packument.versions[version];
            if (!v) {
                throw new Error(
                    `Packument for ${edge.name} promised ${version} but no entry exists`,
                );
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
            log(
                "resolve: %s@%s ← %s (at %s)",
                edge.name,
                version,
                edge.range,
                installPath,
            );

            for (const [depName, depRange] of Object.entries(node.dependencies)) {
                queue.push({ from: installPath, name: depName, range: depRange, required: true });
            }
            for (const [depName, depRange] of Object.entries(node.optionalDependencies)) {
                queue.push({ from: installPath, name: depName, range: depRange, required: false });
            }
        } catch (e) {
            // Optional deps that fail to resolve are skipped — yarn/npm
            // behavior. Required deps re-throw.
            if (!edge.required) {
                log(
                    "resolve: optional dep %s@%s skipped (%s)",
                    edge.name,
                    edge.range,
                    (e as Error).message,
                );
                continue;
            }
            throw e;
        }
    }

    return Array.from(byPath.values());
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
            const idx = p.lastIndexOf("/node_modules/");
            if (idx < 0) break;
            p = p.slice(0, idx);
            candidates.push(`${p}/node_modules/${name}`);
            if (p === "") break;
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
        const parsed = JSON.parse(fs.readFileSync(lockfilePath, "utf-8")) as Lockfile;
        if (parsed.lockfileVersion !== LOCKFILE_VERSION) return null;
        if (!parsed.packages || typeof parsed.packages !== "object") return null;
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
            dependencies:
                Object.keys(node.dependencies).length > 0 ? node.dependencies : undefined,
            bin: node.bin,
        };
    }
    const lockfile: Lockfile = {
        lockfileVersion: LOCKFILE_VERSION,
        requested: [...specs],
        packages,
    };
    fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2) + "\n");
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
    const idx = installPath.lastIndexOf("/node_modules/");
    const after = idx < 0 ? installPath.replace(/^node_modules\//, "") : installPath.slice(idx + "/node_modules/".length);
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
    if (added.length > 0) lines.push(`  + ${added.sort().join("\n  + ")}`);
    if (removed.length > 0) lines.push(`  - ${removed.sort().join("\n  - ")}`);
    return lines.join("\n");
}

function parseSpec(raw: string): ParsedSpec {
    if (raw.startsWith("@")) {
        const slash = raw.indexOf("/");
        if (slash < 0) throw new Error(`Invalid spec (scoped name without slash): ${raw}`);
        const at = raw.indexOf("@", slash);
        if (at < 0) return { name: raw, range: "*" };
        return { name: raw.slice(0, at), range: raw.slice(at + 1) || "*" };
    }
    const at = raw.indexOf("@");
    if (at < 0) return { name: raw, range: "*" };
    return { name: raw.slice(0, at), range: raw.slice(at + 1) || "*" };
}

function pickVersion(packument: Packument, range: string): string | null {
    // dist-tag fast path: `latest`, `next`, ...
    if (packument["dist-tags"][range]) return packument["dist-tags"][range];

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
): Promise<void> {
    // Sort by install-path depth ascending so parents extract before
    // children. Extracting a parent on top of an existing child would
    // wipe out the child.
    const queue = [...nodes].sort((a, b) =>
        depth(a.installPath) - depth(b.installPath) ||
        (a.installPath < b.installPath ? -1 : 1),
    );
    const workers: Array<Promise<void>> = [];
    const concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, queue.length));
    // Parents (depth 1) are extracted serially first to avoid concurrent
    // `rm -rf` + extract races with their children. Once depth-1 is done,
    // depths >=2 run with full concurrency.
    let cursor = 0;
    const depth1End = queue.findIndex((n) => depth(n.installPath) > 1);
    const splitAt = depth1End < 0 ? queue.length : depth1End;

    // Serial root pass.
    while (cursor < splitAt) {
        const node = queue[cursor++];
        if (!node) break;
        await extractOne(node, prefix, npmrc, log);
    }

    // Concurrent nested pass.
    for (let i = 0; i < concurrency; i++) {
        workers.push((async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= queue.length) return;
                const node = queue[idx];
                if (!node) return;
                await extractOne(node, prefix, npmrc, log);
            }
        })());
    }
    await Promise.all(workers);
}

async function extractOne(
    node: ResolvedNode,
    prefix: string,
    npmrc: NpmrcConfig,
    log: Logger,
): Promise<void> {
    const dest = path.join(prefix, node.installPath);
    log("fetch: %s@%s ← %s (→ %s)", node.name, node.version, node.tarballUrl, node.installPath);
    const bytes = await fetchTarball(node.tarballUrl, {
        npmrc,
        integrity: node.integrity,
    });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await extractTarball(bytes, dest);
}

function depth(installPath: string): number {
    // Count `node_modules/` segments to know nesting depth.
    // `node_modules/foo` = 1, `node_modules/foo/node_modules/bar` = 2, etc.
    return installPath.split("/node_modules/").length;
}

async function linkBins(nodes: ResolvedNode[], prefix: string, log: Logger): Promise<void> {
    // Only root-level packages publish bins into the top-level
    // `node_modules/.bin/`. Nested-package bins are addressable by their
    // direct dependents through the nested .bin (npm matches this) — we
    // omit nested-bin linking for now since no consumer of the install
    // backend depends on it (gjsify's own use cases all hit root bins).
    const binDir = path.join(prefix, "node_modules", ".bin");
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
    if (created > 0) log("bin: linked %d entry(ies) under .bin/", created);
}

function normalizeBin(pkgName: string, bin: string | Record<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    if (typeof bin === "string") {
        // String form is shorthand for `{ <last-segment-of-pkgName>: <bin> }`.
        const baseName = pkgName.startsWith("@")
            ? pkgName.slice(pkgName.indexOf("/") + 1)
            : pkgName;
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
    for (const candidate of [path.join(home, ".npmrc"), path.join(opts.prefix, ".npmrc")]) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const projectParsed = parseNpmrc(fs.readFileSync(candidate, "utf-8"));
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
