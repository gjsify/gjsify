/**
 * The shared substrate every conformance rule reads: which packages exist, what
 * their manifests say, and where they sit on disk.
 *
 * WHY THIS EXISTS
 *
 * The five scripts this package consolidates had THREE different answers to
 * "which packages am I checking":
 *   - `audit-runtimes.mjs` recursed `packages/**` and stopped at the first
 *     directory holding a `package.json`.
 *   - `verify-package-outputs.mjs` expanded the root manifest's `workspaces`
 *     globs, honouring `!negations`.
 *   - `verify-committed-bundles.mjs` asked git (`ls-tree HEAD`).
 * Three answers meant a package could be in scope for one guard and invisible to
 * another with nobody able to tell from the outside which. The globs are the
 * authoritative answer (they are what the package manager itself uses), so that
 * is the one kept; `packages/**` recursion survives as `packagesUnder()` for the
 * rules that genuinely want a directory subtree rather than the workspace set.
 *
 * SINGLE-PACKAGE MODE — the reason this module is in a published package at all
 *
 * A consumer running `gjsify manifest-check` has ONE package and no
 * `workspaces` field. Detection is on the manifest, not on a flag: a root with
 * `workspaces` is a workspace, anything else is a single package that is its own
 * only member. Every rule is written against `ctx.packages`, so the same rule
 * body serves both without a branch.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * @typedef {object} PackageRecord
 * @property {string} name `package.json#name`, or the relative dir when unnamed.
 * @property {string} dir Absolute path to the package directory.
 * @property {string} rel Path relative to the context root, POSIX-ish.
 * @property {Record<string, any>} manifest The parsed `package.json`.
 * @property {boolean} private Whether the package is `private: true`.
 * @property {Record<string, any>} gjsify The `gjsify` block, `{}` when absent.
 */

/**
 * @typedef {object} ConformanceContext
 * @property {string} root Absolute path the run is rooted at.
 * @property {'workspace'|'single'} mode How `packages` was derived.
 * @property {PackageRecord[]} packages Every workspace-glob package in scope.
 * @property {PackageRecord[]} allPackages `packages` PLUS every package found by
 *   recursively scanning `discoveryRoots`. See the note on `discoveryRoots`
 *   below — the difference is load-bearing, not cosmetic.
 * @property {Map<string, PackageRecord>} byName Lookup by `package.json#name`.
 * @property {(name: string) => PackageRecord|undefined} get
 * @property {(dir: string) => PackageRecord[]} packagesUnder Recursive scan of a
 *   subtree, independent of the workspace globs.
 * @property {string[]} only Package names the caller narrowed the run to.
 * @property {boolean} allowUnbuilt Degrade build post-conditions to notes.
 * @property {Record<string, unknown>} options Free-form per-run options.
 */

/** Directories never worth descending into when scanning a subtree. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git']);

/** Read + parse a `package.json`, or `null` when absent/unreadable. */
export function readManifest(dir) {
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Expand ONE `workspaces` glob (`a/b/*`, `a/b`) to package dirs, absolute.
 * Only the trailing-`*` shape npm/yarn workspaces actually use is supported —
 * a real glob engine would be a dependency, and this package has none by design
 * (it must be importable from a CI script with no `node_modules` at all).
 */
function expandWorkspaceGlob(root, pattern) {
    const segments = pattern.split('/');
    let dirs = [root];
    for (const segment of segments) {
        const next = [];
        for (const dir of dirs) {
            if (segment === '*') {
                let entries;
                try {
                    entries = readdirSync(dir, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const entry of entries) if (entry.isDirectory()) next.push(join(dir, entry.name));
            } else {
                const candidate = join(dir, segment);
                if (existsSync(candidate) && statSync(candidate).isDirectory()) next.push(candidate);
            }
        }
        dirs = next;
    }
    return dirs.filter((d) => existsSync(join(d, 'package.json')));
}

/** Every workspace package dir, honouring the `!negation` entries. */
function workspaceDirs(root, patterns) {
    const included = new Set();
    const excluded = new Set();
    for (const pattern of patterns) {
        const negated = pattern.startsWith('!');
        const target = negated ? excluded : included;
        for (const dir of expandWorkspaceGlob(root, negated ? pattern.slice(1) : pattern)) target.add(dir);
    }
    return [...included].filter((d) => !excluded.has(d)).sort();
}

/**
 * Recursively find every package directory under `dir`.
 *
 * A directory holding a `package.json` IS a package and is not descended into —
 * a nested `package.json` inside a package's own fixtures is not a workspace
 * member, and treating it as one is how a fixture manifest ends up audited.
 */
export function packagesUnder(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
        out.push(dir);
        return out;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
        packagesUnder(join(dir, entry.name), out);
    }
    return out;
}

/**
 * @param {string} dir @param {string} root @returns {PackageRecord|null}
 *
 * `rel` is normalised to forward slashes. Rules use it to ADDRESS a package —
 * in failure messages a reader is meant to paste, and in comparisons against
 * the `workspaces` globs, which are forward-slash by npm's own definition. Left
 * in the host spelling it read `packages\node-gi\node-gi` on Windows, so the
 * same tree produced different rule output on different platforms.
 */
function toRecord(dir, root) {
    const manifest = readManifest(dir);
    if (!manifest) return null;
    const rel = (relative(root, dir) || '.').split(sep).join('/');
    return {
        name: typeof manifest.name === 'string' ? manifest.name : rel,
        dir,
        rel,
        manifest,
        private: manifest.private === true,
        gjsify: manifest.gjsify && typeof manifest.gjsify === 'object' ? manifest.gjsify : {},
    };
}

/**
 * Build the context a run reads.
 *
 * @param {object} [options]
 * @param {string} [options.root] Defaults to `process.cwd()`.
 * @param {string[]} [options.only] Narrow to these package names.
 * @param {boolean} [options.allowUnbuilt] Degrade build post-conditions.
 * @param {string[]} [options.discoveryRoots] Directory subtrees to scan for
 *   packages IN ADDITION to the `workspaces` globs, contributing `allPackages`.
 *
 *   This is not a convenience. In this repository `packages/node-gi/*` and
 *   `packages/napi/*` are deliberately NOT workspace members (they carry their
 *   own CI and are carve-outs in the affected classifier) — yet `@gjsify/napi`
 *   declares `gjsify.platforms` + `gjsify.platformsUncommitted` and is audited.
 *   The prebuild and headless rules therefore have to see a directory SUBTREE,
 *   not the workspace set, and quietly narrowing them to the globs would drop
 *   that coverage with nothing to notice it. `package-outputs` keeps the globs,
 *   because a non-member package is not something this workspace builds.
 * @param {Record<string, unknown>} [options.extra] Per-run options for rules.
 * @returns {ConformanceContext}
 */
export function createContext({
    root = process.cwd(),
    only = [],
    allowUnbuilt = false,
    discoveryRoots = [],
    extra = {},
} = {}) {
    const absRoot = resolve(root);
    const rootManifest = readManifest(absRoot);
    const patterns = Array.isArray(rootManifest?.workspaces)
        ? rootManifest.workspaces
        : Array.isArray(rootManifest?.workspaces?.packages)
          ? rootManifest.workspaces.packages
          : null;

    /** @type {'workspace'|'single'} */
    const mode = patterns ? 'workspace' : 'single';
    const dirs = patterns ? workspaceDirs(absRoot, patterns) : rootManifest ? [absRoot] : [];

    /** @type {PackageRecord[]} */
    const packages = [];
    for (const dir of dirs) {
        const rec = toRecord(dir, absRoot);
        if (rec) packages.push(rec);
    }
    packages.sort((a, b) => a.rel.localeCompare(b.rel));

    const filtered = only.length > 0 ? packages.filter((p) => only.includes(p.name)) : packages;
    const byName = new Map(filtered.map((p) => [p.name, p]));

    const seenDirs = new Set(packages.map((p) => p.dir));
    /** @type {PackageRecord[]} */
    const discovered = [];
    for (const subtree of discoveryRoots) {
        const abs = resolve(absRoot, subtree);
        if (!existsSync(abs)) continue;
        for (const dir of packagesUnder(abs)) {
            if (seenDirs.has(dir)) continue;
            seenDirs.add(dir);
            const rec = toRecord(dir, absRoot);
            if (rec) discovered.push(rec);
        }
    }
    const allPackages = [...packages, ...discovered].sort((a, b) => a.rel.localeCompare(b.rel));
    const allFiltered = only.length > 0 ? allPackages.filter((p) => only.includes(p.name)) : allPackages;

    return {
        root: absRoot,
        mode,
        packages: filtered,
        allPackages: allFiltered,
        byName,
        get: (name) => byName.get(name),
        packagesUnder: (dir) =>
            packagesUnder(resolve(absRoot, dir))
                .map((d) => toRecord(d, absRoot))
                .filter(Boolean)
                .sort((a, b) => a.rel.localeCompare(b.rel)),
        only,
        allowUnbuilt,
        options: extra,
    };
}
