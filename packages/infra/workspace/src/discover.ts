// Workspace-set operations: discover the workspaces from the root manifest's
// `workspaces` globs, resolve `workspace:`-protocol descriptors against that
// set, and filter it by include/exclude globs.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expandPattern, globToRegex } from './glob.js';
import type { Workspace, WorkspaceManifest } from './types.js';

export interface DiscoverWorkspacesOptions {
    /**
     * Override the patterns read from the root package.json. Supplying them
     * also makes the root package.json OPTIONAL — the patterns are the package
     * set, so a repo with no root manifest at all is still discoverable.
     */
    patterns?: string[];
    /**
     * Include the root package as a workspace itself. Yarn does not do this
     * by default; we keep the same behavior unless the caller opts in.
     */
    includeRoot?: boolean;
}

/**
 * Read `<root>/package.json` and walk its `workspaces` glob patterns. Returns
 * the full set of workspaces with their parsed manifests. Throws if the root
 * package.json is missing or malformed; silently skips glob-matched dirs
 * that don't have a package.json (matches yarn's behavior).
 */
export function discoverWorkspaces(root: string, options: DiscoverWorkspacesOptions = {}): Workspace[] {
    const rootManifestPath = join(root, 'package.json');
    const hasRootManifest = existsSync(rootManifestPath);
    // Explicit `patterns` ARE the package set, so they make the root manifest
    // optional: a repo can be a monorepo without being an npm/yarn workspace.
    // `gjsify/types` is 703 package directories under a root whose only tracked
    // file is `.gitignore`, and it is exactly the repo a publish sweep has to
    // reach. Without patterns the manifest is the only source of a package set
    // there is, so its absence stays an error.
    if (!hasRootManifest && !options.patterns) {
        throw new Error(`@gjsify/workspace: no package.json at ${root}`);
    }
    const rootManifest: WorkspaceManifest = hasRootManifest
        ? (JSON.parse(readFileSync(rootManifestPath, 'utf-8')) as WorkspaceManifest)
        : {};
    const patterns = options.patterns ?? extractWorkspacePatterns(rootManifest);

    // `!`-prefixed patterns are exclusions (npm/yarn-compatible) — e.g.
    // `"!showcases/dom/foo"` drops a dir that an include glob (`showcases/dom/*`)
    // would otherwise match. Excludes are matched against the relative location.
    const includePatterns = patterns.filter((p) => !p.startsWith('!'));
    const excludeMatchers = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegex(p.slice(1)));

    const out: Workspace[] = [];
    // Dedupe by directory: overlapping patterns (e.g. `packages/*` plus an
    // explicit `packages/app-android`) match the same dir more than once. Yarn
    // collapses these to a single workspace; without dedup the duplicate flows
    // downstream into double symlink plans (a concurrent `rm`+`symlink` race
    // that throws EEXIST in `gjsify install`).
    const seenLocations = new Set<string>();
    if (options.includeRoot && rootManifest.name) {
        out.push({
            location: root,
            relativeLocation: '.',
            name: rootManifest.name,
            version: rootManifest.version ?? '0.0.0',
            manifest: rootManifest,
            private: rootManifest.private === true,
        });
        seenLocations.add(root);
    }

    for (const pattern of includePatterns) {
        for (const matchedDir of expandPattern(root, pattern)) {
            if (seenLocations.has(matchedDir)) continue;
            const relativeLocation = relative(root, matchedDir).split(sep).join('/');
            if (excludeMatchers.some((re) => re.test(relativeLocation))) continue;
            const pkgPath = join(matchedDir, 'package.json');
            if (!existsSync(pkgPath)) continue;
            let manifest: WorkspaceManifest;
            try {
                manifest = JSON.parse(readFileSync(pkgPath, 'utf-8')) as WorkspaceManifest;
            } catch {
                continue;
            }
            if (!manifest.name) continue;
            seenLocations.add(matchedDir);
            out.push({
                location: matchedDir,
                relativeLocation,
                name: manifest.name,
                version: manifest.version ?? '0.0.0',
                manifest,
                private: manifest.private === true,
            });
        }
    }

    // Deterministic order — yarn sorts by anchored locator hash; we sort by
    // relative location which is stable across machines and reproducible
    // for diffing.
    out.sort((a, b) => a.relativeLocation.localeCompare(b.relativeLocation));
    return out;
}

/**
 * Resolve a `workspace:`-protocol descriptor against the discovered
 * workspaces. Accepts the common shapes yarn 4 supports:
 *
 *   `workspace:^`     → caret-range of the workspace's current version
 *   `workspace:~`     → tilde-range
 *   `workspace:*`     → exact version (matches yarn's `workspace:*` semantics)
 *   `workspace:<ver>` → explicit range, returned as-is (yarn's `workspace:^1.2.3`)
 *
 * Returns the resolved spec (e.g. `^0.3.21`) — what would land in
 * `node_modules/<dep>/package.json` after `yarn install`. Returns `undefined`
 * when the spec isn't a workspace-protocol value (caller falls back to the
 * external resolver).
 */
export function resolveWorkspaceProtocol(
    spec: string,
    pkgName: string,
    workspaces: ReadonlyMap<string, Workspace> | readonly Workspace[],
): string | undefined {
    if (!spec.startsWith('workspace:')) return undefined;
    const value = spec.slice('workspace:'.length);
    const map: ReadonlyMap<string, Workspace> =
        workspaces instanceof Map ? workspaces : indexByName(workspaces as readonly Workspace[]);
    const target = map.get(pkgName);
    if (!target) {
        throw new Error(
            `@gjsify/workspace: workspace dep "${pkgName}" referenced as "${spec}" but no workspace ` +
                `with that name was discovered`,
        );
    }
    const version = target.version;
    if (value === '^') return `^${version}`;
    if (value === '~') return `~${version}`;
    if (value === '*') return version;
    // Explicit range: pass through.
    return value;
}

/**
 * Filter workspaces by glob-pattern include/exclude (mirrors
 * `yarn workspaces foreach --include '@gjsify/example-*' --exclude
 * '@gjsify/example-*-net'` shape). Uses a minimal glob: only `*` is
 * supported (matches any non-`/` segment). That covers every pattern the
 * gjsify monorepo + ts-for-gir actually use.
 */
export function filterWorkspaces(
    workspaces: readonly Workspace[],
    options: {
        include?: readonly string[];
        exclude?: readonly string[];
        noPrivate?: boolean;
    },
): Workspace[] {
    const include = options.include?.map(globToRegex);
    const exclude = options.exclude?.map(globToRegex);
    return workspaces.filter((ws) => {
        if (options.noPrivate && ws.private) return false;
        if (include && include.length > 0 && !include.some((re) => re.test(ws.name))) {
            return false;
        }
        if (exclude && exclude.some((re) => re.test(ws.name))) {
            return false;
        }
        return true;
    });
}

function extractWorkspacePatterns(manifest: WorkspaceManifest): string[] {
    const ws = manifest.workspaces;
    if (!ws) return [];
    if (Array.isArray(ws)) return ws;
    return ws.packages ?? [];
}

/** Index a workspace list by package name. Internal to the package. */
export function indexByName(workspaces: readonly Workspace[]): Map<string, Workspace> {
    const out = new Map<string, Workspace>();
    for (const ws of workspaces) out.set(ws.name, ws);
    return out;
}
