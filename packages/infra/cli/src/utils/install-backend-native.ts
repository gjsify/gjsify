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

export async function installPackagesNative(opts: InstallOptions): Promise<void> {
    if (opts.specs.length === 0) {
        throw new Error("installPackagesNative: empty specs list");
    }

    fs.mkdirSync(opts.prefix, { recursive: true });
    const npmrc = await loadNpmrc(opts);

    const log = makeLogger(opts.verbose ?? false);
    log("install: resolving %d top-level spec(s) → %s", opts.specs.length, opts.prefix);

    const packumentCache = new Map<string, Promise<Packument>>();
    const fetchPkg = (name: string): Promise<Packument> => {
        const cached = packumentCache.get(name);
        if (cached) return cached;
        const fresh = fetchPackument(name, { npmrc });
        packumentCache.set(name, fresh);
        return fresh;
    };

    const resolved = new Map<string, ResolvedNode>();
    const queue: ParsedSpec[] = opts.specs.map(parseSpec);

    while (queue.length > 0) {
        const spec = queue.shift() as ParsedSpec;
        if (resolved.has(spec.name)) {
            // Single-version-per-name policy (npm v6 semantics — good enough
            // for v1; v7+ duplication lands with the lockfile in Phase 4).
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
            if (!resolved.has(depName)) {
                queue.push({ name: depName, range: depRange });
            }
        }
        // Optional deps: queue them, but tolerate failures during install.
        for (const [depName, depRange] of Object.entries(node.optionalDependencies)) {
            if (!resolved.has(depName)) {
                queue.push({ name: depName, range: depRange });
            }
        }
    }

    log("install: %d package(s) resolved, downloading tarballs", resolved.size);
    await downloadAndExtractAll(Array.from(resolved.values()), opts.prefix, npmrc, log);
    await linkBins(Array.from(resolved.values()), opts.prefix, log);
    log("install: done");
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
