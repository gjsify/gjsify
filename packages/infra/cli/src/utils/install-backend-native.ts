// Native install backend — GJS-runnable replacement for `npm install`.
//
// Pipeline: parse specs → resolve deps via @gjsify/npm-registry packuments and
// @gjsify/semver → download tarballs in parallel → extract into a flat
// node_modules/ via @gjsify/tar. Output layout matches `npm install` so the
// existing `runGjsBundle()` prebuild detection works without branching.
//
// Out of scope (deferred to Phase 4): lockfile, peerDependencies validation,
// lifecycle scripts, git/file specs.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
    Range,
    SemVer,
    maxSatisfying,
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
    name: string;
    version: string;
    tarballUrl: string;
    integrity?: string;
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
    bin?: string | Record<string, string>;
}

const LOCKFILE_NAME = "gjsify-lock.json";
const LOCKFILE_VERSION = 1;

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
    /** Pinned packages keyed by name. */
    packages: Record<string, LockfileEntry>;
}

export async function installPackagesNative(opts: InstallOptions): Promise<void> {
    if (opts.specs.length === 0) {
        throw new Error("installPackagesNative: empty specs list");
    }

    fs.mkdirSync(opts.prefix, { recursive: true });
    const npmrc = await loadNpmrc(opts);
    const log = makeLogger(opts.verbose ?? false);

    const lockfilePath = path.join(opts.prefix, LOCKFILE_NAME);
    const existingLock = readLockfile(lockfilePath);

    let nodes: ResolvedNode[];
    if (existingLock && (opts.frozen || lockfileMatchesRequest(existingLock, opts.specs))) {
        log("install: using lockfile (%d package(s))", Object.keys(existingLock.packages).length);
        nodes = lockfileToNodes(existingLock);
    } else {
        if (opts.frozen) {
            throw new Error(
                `install: --frozen requested but ${lockfilePath} is missing or stale (specs differ)`,
            );
        }
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
}

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

    const resolved = new Map<string, ResolvedNode>();
    const queue: ParsedSpec[] = specs.map(parseSpec);

    while (queue.length > 0) {
        const spec = queue.shift() as ParsedSpec;
        if (resolved.has(spec.name)) {
            // Single-version-per-name policy (npm v6 semantics). Phase 4 v2
            // (when peer-dep validation lands) revisits this for duplication.
            continue;
        }
        const packument = await fetchPkg(spec.name);
        const version = pickVersion(packument, spec.range);
        if (!version) {
            throw new Error(`No version of ${spec.name} satisfies ${spec.range}`);
        }
        const v = packument.versions[version];
        if (!v) {
            throw new Error(
                `Packument for ${spec.name} promised ${version} but no entry exists`,
            );
        }
        const node: ResolvedNode = {
            name: spec.name,
            version,
            tarballUrl: v.dist.tarball,
            integrity: v.dist.integrity,
            dependencies: v.dependencies ?? {},
            optionalDependencies: v.optionalDependencies ?? {},
            bin: v.bin,
        };
        resolved.set(spec.name, node);
        log("resolve: %s@%s ← %s", spec.name, version, spec.range);

        for (const [depName, depRange] of Object.entries(node.dependencies)) {
            if (!resolved.has(depName)) queue.push({ name: depName, range: depRange });
        }
        for (const [depName, depRange] of Object.entries(node.optionalDependencies)) {
            if (!resolved.has(depName)) queue.push({ name: depName, range: depRange });
        }
    }
    return Array.from(resolved.values());
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
    // Sort for deterministic output (diff-friendly).
    const sorted = [...nodes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const node of sorted) {
        packages[node.name] = {
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
    return Object.entries(lockfile.packages).map(([name, entry]) => ({
        name,
        version: entry.version,
        tarballUrl: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies ?? {},
        optionalDependencies: {},
        bin: entry.bin,
    }));
}

function lockfileMatchesRequest(lockfile: Lockfile, specs: string[]): boolean {
    if (lockfile.requested.length !== specs.length) return false;
    const a = [...lockfile.requested].sort();
    const b = [...specs].sort();
    return a.every((v, i) => v === b[i]);
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
    const queue = [...nodes];
    const workers: Array<Promise<void>> = [];
    const concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, queue.length));
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    async function worker(): Promise<void> {
        while (queue.length > 0) {
            const node = queue.shift();
            if (!node) return;
            const dest = path.join(prefix, "node_modules", node.name);
            log("fetch: %s@%s ← %s", node.name, node.version, node.tarballUrl);
            const bytes = await fetchTarball(node.tarballUrl, {
                npmrc,
                integrity: node.integrity,
            });
            fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(dest, { recursive: true });
            await extractTarball(bytes, dest);
        }
    }
}

async function linkBins(nodes: ResolvedNode[], prefix: string, log: Logger): Promise<void> {
    const binDir = path.join(prefix, "node_modules", ".bin");
    let created = 0;
    for (const node of nodes) {
        if (!node.bin) continue;
        const map = normalizeBin(node.name, node.bin);
        if (map.size === 0) continue;
        fs.mkdirSync(binDir, { recursive: true });
        for (const [binName, binTarget] of map) {
            const targetAbs = path.join(prefix, "node_modules", node.name, binTarget);
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
    const homeRc = path.join(home, ".npmrc");
    let parsed: NpmrcConfig = {
        registry: opts.registry ?? DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    if (fs.existsSync(homeRc)) {
        try {
            parsed = parseNpmrc(fs.readFileSync(homeRc, "utf-8"));
        } catch (e) {
            // Don't let a busted .npmrc prevent installs from anonymous registries.
            console.warn(`gjsify install: ignoring malformed ${homeRc}: ${(e as Error).message}`);
        }
    }
    if (opts.registry) {
        parsed.registry = opts.registry;
    }
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
