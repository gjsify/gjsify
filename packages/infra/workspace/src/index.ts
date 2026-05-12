// @gjsify/workspace — Yarn-workspaces-compatible monorepo discovery + resolution.
//
// Implements the parts of the yarn workspaces surface that `gjsify install`
// and `gjsify foreach` actually need (see AGENTS.md "yarn replacement"):
//   1. `discoverWorkspaces(root)` reads `<root>/package.json` `workspaces`,
//      expands the glob patterns (`packages/*`, `tests/integration/*`, …)
//      against the on-disk tree, parses each workspace's package.json,
//      returns the full Workspace[] list.
//   2. `resolveWorkspaceProtocol(spec, workspaces)` turns a `workspace:^`
//      or `workspace:*` descriptor into the resolved version of the
//      matching local workspace — that's the "intra-monorepo dep link"
//      yarn install does for every `workspace:^` in 60+ workspaces.
//   3. `buildDependencyGraph(workspaces)` returns adjacency lists for the
//      workspaces. Only inter-workspace edges are recorded (external
//      registry deps are out of scope for this graph).
//   4. `topologicalSort(graph)` returns the workspaces in build order —
//      `--topological` flag in `gjsify foreach`. Uses Kahn's algorithm.
//
// All four functions are pure Node-built-ins + JSON; works under Node and
// GJS without bindings. The CLI consumes this package via D.3-D.5.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';

export interface WorkspaceManifest {
    name?: string;
    version?: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[]; nohoist?: string[] };
    [key: string]: unknown;
}

export interface Workspace {
    /** Absolute path of the workspace directory. */
    location: string;
    /** Workspace-relative location (e.g. `packages/infra/cli`). */
    relativeLocation: string;
    /** `<name>` from package.json — required for resolving `workspace:^`. */
    name: string;
    /** `<version>` from package.json — used to substitute `workspace:^`. */
    version: string;
    /** Loaded package.json contents (manifest). */
    manifest: WorkspaceManifest;
    /** `private: true` packages are excluded by `--no-private`. */
    private: boolean;
}

export interface DiscoverWorkspacesOptions {
    /** Override the patterns read from the root package.json. */
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
export function discoverWorkspaces(
    root: string,
    options: DiscoverWorkspacesOptions = {},
): Workspace[] {
    const rootManifestPath = join(root, 'package.json');
    if (!existsSync(rootManifestPath)) {
        throw new Error(`@gjsify/workspace: no package.json at ${root}`);
    }
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf-8')) as WorkspaceManifest;
    const patterns = options.patterns ?? extractWorkspacePatterns(rootManifest);

    const out: Workspace[] = [];
    if (options.includeRoot && rootManifest.name) {
        out.push({
            location: root,
            relativeLocation: '.',
            name: rootManifest.name,
            version: rootManifest.version ?? '0.0.0',
            manifest: rootManifest,
            private: rootManifest.private === true,
        });
    }

    for (const pattern of patterns) {
        for (const matchedDir of expandPattern(root, pattern)) {
            const pkgPath = join(matchedDir, 'package.json');
            if (!existsSync(pkgPath)) continue;
            let manifest: WorkspaceManifest;
            try {
                manifest = JSON.parse(readFileSync(pkgPath, 'utf-8')) as WorkspaceManifest;
            } catch {
                continue;
            }
            if (!manifest.name) continue;
            out.push({
                location: matchedDir,
                relativeLocation: relative(root, matchedDir).split(sep).join('/'),
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
    const map: ReadonlyMap<string, Workspace> = workspaces instanceof Map
        ? workspaces
        : indexByName(workspaces as readonly Workspace[]);
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

export interface DependencyGraph {
    /** Adjacency list: workspace name → set of workspace names it depends on. */
    edges: Map<string, Set<string>>;
    /** Workspaces indexed by name for fast lookup by callers. */
    byName: Map<string, Workspace>;
}

export interface BuildGraphOptions {
    /**
     * Include `devDependencies` in the edge set. Default `false` — matches
     * yarn's `--topological` flag (which only counts production deps).
     * `yarn workspaces foreach --topological-dev` is the opt-in for the
     * dev-graph (which is often cyclic in real monorepos, including
     * gjsify itself — `@gjsify/utils` devDep on `@gjsify/cli` creates a
     * cycle when traced through `@gjsify/cli`'s prod deps).
     */
    includeDev?: boolean;
    /** Include peerDependencies. Default `false` — yarn treats peers as constraint-only. */
    includePeer?: boolean;
    /** Include optionalDependencies. Default `true`. */
    includeOptional?: boolean;
}

/**
 * Build the inter-workspace dependency graph. Each edge `A → B` means "A
 * declares a `workspace:`-protocol entry pointing at B". External deps
 * (registry packages) are not represented — this graph is the input for
 * `topologicalSort` (build order) and `--topological` in `gjsify foreach`.
 */
export function buildDependencyGraph(
    workspaces: readonly Workspace[],
    options: BuildGraphOptions = {},
): DependencyGraph {
    const includeDev = options.includeDev ?? false;
    const includePeer = options.includePeer ?? false;
    const includeOptional = options.includeOptional ?? true;
    const byName = indexByName(workspaces);
    const edges = new Map<string, Set<string>>();

    for (const ws of workspaces) {
        const deps = new Set<string>();
        const m = ws.manifest;
        for (const block of [
            m.dependencies,
            includeDev ? m.devDependencies : undefined,
            includePeer ? m.peerDependencies : undefined,
            includeOptional ? m.optionalDependencies : undefined,
        ]) {
            if (!block) continue;
            for (const [depName, spec] of Object.entries(block)) {
                if (typeof spec !== 'string') continue;
                // Only inter-workspace edges. External deps go via the
                // resolver, not the graph.
                if (!spec.startsWith('workspace:')) continue;
                if (!byName.has(depName)) continue;
                deps.add(depName);
            }
        }
        edges.set(ws.name, deps);
    }

    return { edges, byName };
}

/**
 * Kahn's algorithm: returns workspaces in topological build order, so each
 * workspace appears after all of its inter-workspace dependencies. Throws
 * on cycle — yarn's `workspaces foreach --topological` does the same.
 */
export function topologicalSort(graph: DependencyGraph): Workspace[] {
    const incoming = new Map<string, number>();
    for (const name of graph.edges.keys()) incoming.set(name, 0);
    for (const deps of graph.edges.values()) {
        for (const dep of deps) {
            // Only count edges where both endpoints are workspaces in the
            // graph (already filtered in `buildDependencyGraph`).
            if (incoming.has(dep)) incoming.set(dep, (incoming.get(dep) ?? 0) + 1);
        }
    }
    // `edges` records "A depends on B". Build orderings need "B before A"
    // — so we work on the REVERSED edges. `incoming` above counts the
    // number of workspaces that depend on a given target (reverse-fanout).
    // A node with 0 reverse-fanout has no dependents → can be emitted last.
    // Easier: invert the dependency direction up front.
    const reverse = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    for (const name of graph.edges.keys()) {
        reverse.set(name, new Set());
        inDegree.set(name, 0);
    }
    for (const [from, deps] of graph.edges) {
        for (const dep of deps) {
            if (!reverse.has(dep)) continue;
            reverse.get(dep)!.add(from);
            inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
        }
    }

    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
        if (deg === 0) queue.push(name);
    }
    queue.sort();

    const out: Workspace[] = [];
    while (queue.length > 0) {
        const name = queue.shift()!;
        const ws = graph.byName.get(name);
        if (ws) out.push(ws);
        const dependents = reverse.get(name);
        if (dependents) {
            const newlyFree: string[] = [];
            for (const d of dependents) {
                const next = (inDegree.get(d) ?? 1) - 1;
                inDegree.set(d, next);
                if (next === 0) newlyFree.push(d);
            }
            newlyFree.sort();
            queue.push(...newlyFree);
        }
    }

    if (out.length !== inDegree.size) {
        const remaining = [...inDegree.entries()].filter(([, d]) => d > 0).map(([n]) => n);
        throw new Error(
            `@gjsify/workspace: dependency cycle detected involving ${remaining.join(', ')}`,
        );
    }
    return out;
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
        if (exclude && exclude.length > 0 && exclude.some((re) => re.test(ws.name))) {
            return false;
        }
        return true;
    });
}

// --- internals -------------------------------------------------------------

function extractWorkspacePatterns(manifest: WorkspaceManifest): string[] {
    const ws = manifest.workspaces;
    if (!ws) return [];
    if (Array.isArray(ws)) return ws;
    return ws.packages ?? [];
}

function expandPattern(root: string, pattern: string): string[] {
    // Only the limited form yarn projects use in practice:
    //   `<segment>/*`           → all immediate children of segment
    //   `<segment>`             → single literal path
    //   `<segment>/*/*`         → two levels (`packages/infra/*`)
    // Any deeper nesting is rejected — there's no recursive `**` in our
    // monorepo or ts-for-gir's, so we don't accept it.
    const segments = pattern.split('/').filter(Boolean);
    let current: string[] = [resolve(root)];
    for (const seg of segments) {
        const next: string[] = [];
        for (const dir of current) {
            if (seg === '*') {
                let entries: string[] = [];
                try { entries = readdirSync(dir); } catch { continue; }
                for (const entry of entries) {
                    if (entry.startsWith('.')) continue;
                    const candidate = join(dir, entry);
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch { /* dead symlink etc. */ }
                }
            } else if (seg.includes('*')) {
                // `pkg-*` style pattern: glob within a single segment.
                const re = globToRegex(seg);
                let entries: string[] = [];
                try { entries = readdirSync(dir); } catch { continue; }
                for (const entry of entries) {
                    if (entry.startsWith('.')) continue;
                    if (!re.test(entry)) continue;
                    const candidate = join(dir, entry);
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch { /* skip */ }
                }
            } else {
                const candidate = join(dir, seg);
                if (existsSync(candidate)) {
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch { /* skip */ }
                }
            }
        }
        current = next;
    }
    return current;
}

function globToRegex(pattern: string): RegExp {
    // Escape regex specials EXCEPT `*`, then map `*` → `[^/]*`.
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}

function indexByName(workspaces: readonly Workspace[]): Map<string, Workspace> {
    const out = new Map<string, Workspace>();
    for (const ws of workspaces) out.set(ws.name, ws);
    return out;
}

// Re-export commonly used path helpers so consumers don't need a separate
// `node:path` import alongside `@gjsify/workspace`.
export { join as joinPath, dirname as dirnamePath };
