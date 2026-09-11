// Inter-workspace dependency graph: forward edges (build order via Kahn's
// algorithm) and reverse edges (affected-closure for the CI test classifier).

import { satisfies, validRange } from '@gjsify/semver';

import { indexByName } from './discover.js';
import type { Workspace } from './types.js';

export interface DependencyGraph {
    /** Adjacency list: workspace name → set of workspace names it depends on. */
    edges: Map<string, Set<string>>;
    /** Workspaces indexed by name for fast lookup by callers. */
    byName: Map<string, Workspace>;
    /** Name-matched dependencies that are NOT edges — see {@link UnlinkedDependency}. */
    unlinked: UnlinkedDependency[];
}

/**
 * A dependency that names a workspace member but does not link to it, because the
 * member's version does not satisfy the declared range.
 *
 * This is not an error — the installer resolves that dependency from the REGISTRY, so
 * excluding it from the graph is correct. It is reported because it is the one case a
 * caller cannot tell from "no local dependency at all", and the difference is the whole
 * of #1587: a closure that comes back empty for this reason looks exactly like a closure
 * that is empty because nothing local was needed.
 */
export interface UnlinkedDependency {
    /** The workspace that declares the dependency. */
    from: string;
    /** The workspace member sharing the dependency's name. */
    to: string;
    /** The range as declared. */
    spec: string;
    /** The local member's version, which `spec` does not admit. */
    version: string;
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
 * The "any version" spellings npm accepts. `""` is one of them: an empty spec in a
 * dependency block means `*`.
 */
const ANY_RANGE = new Set(['', '*', 'x', 'X']);

/**
 * The registry RANGE a dependency spec states, or `null` when it states something a
 * local workspace cannot answer.
 *
 * Rejected, each for its own reason:
 *  - anything carrying a protocol or a path (`npm:`, `file:`, `link:`, `git+ssh:`, a
 *    URL) — it names a specific source, and that source is not this member;
 *  - a dist-tag (`latest`, `next`, `beta`) — only the registry can say which version a
 *    tag points at, so no local version satisfies it. Every real range carries a digit,
 *    which is what separates the two. (The check is needed rather than left to
 *    `validRange`: `@gjsify/semver` deliberately parses `latest` as `>=0.0.0` so
 *    registry packuments resolve, and that leniency is right there and wrong here.)
 */
function registryRangeOf(spec: string): string | null {
    const trimmed = spec.trim();
    if (ANY_RANGE.has(trimmed)) return '*';
    if (/[:/\\]/.test(trimmed)) return null;
    if (!/\d/.test(trimmed)) return null;
    return validRange(trimmed) === null ? null : trimmed;
}

/**
 * Build the inter-workspace dependency graph. Each edge `A → B` means "A depends on the
 * local workspace B". External deps (registry packages) are not represented — this graph
 * is the input for `topologicalSort` (build order) and `--topological` in
 * `gjsify foreach`.
 *
 * ## What counts as an edge, and why it is not only `workspace:`
 *
 * Two spellings make an edge, and they are the two a package manager itself links:
 *
 *  1. the **`workspace:` protocol** — explicit, unambiguous, linked whatever the versions
 *     say, because the protocol IS the statement that the local package is meant;
 *  2. a **plain registry range** whose local member's version SATISFIES it — which is
 *     exactly the rule npm and yarn apply when deciding to link a workspace instead of
 *     fetching from the registry.
 *
 * The second was missing, and its absence was read as "this package has no local
 * dependencies" (#1587). A monorepo whose packages depend on each other by plain semver
 * range is legal and deliberate — measured in `JumpLink/Learn6502`, where
 * `gjsify workspace <pkg> build --with-dependencies` matched nothing, built nothing and
 * **exited 0**, producing an `app-gnome` without `@learn6502/core` that surfaced much
 * later as a missing module at runtime.
 *
 * A name that matches a member whose version does NOT satisfy the range is deliberately
 * NOT an edge — `@x/core@2.0.0` against `^1.0.0` is not the package the consumer asked
 * for, and substituting it would be a second silent defect. It goes into
 * {@link DependencyGraph.unlinked} instead, because it is the one case a caller cannot
 * otherwise tell from having no local dependency at all.
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
    const unlinked: UnlinkedDependency[] = [];

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
                const member = byName.get(depName);
                if (!member) continue;
                if (spec.startsWith('workspace:')) {
                    deps.add(depName);
                    continue;
                }
                const range = registryRangeOf(spec);
                if (range === null) continue;
                if (satisfies(member.version, range)) deps.add(depName);
                else unlinked.push({ from: ws.name, to: depName, spec, version: member.version });
            }
        }
        edges.set(ws.name, deps);
    }

    return { edges, byName, unlinked };
}

/**
 * Kahn's algorithm: returns workspaces in topological build order, so each
 * workspace appears after all of its inter-workspace dependencies. Throws
 * on cycle — yarn's `workspaces foreach --topological` does the same.
 */
export function topologicalSort(graph: DependencyGraph): Workspace[] {
    // `edges` records "A depends on B", but build order needs "B before A" —
    // so Kahn's algorithm runs on the INVERTED graph: `reverse` maps each
    // workspace to the workspaces that depend on it (who becomes runnable
    // once it is emitted), and `inDegree` counts how many dependencies each
    // workspace is still waiting on. Only edges whose endpoints are both in
    // the graph count — already guaranteed by `buildDependencyGraph`.
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
        throw new Error(`@gjsify/workspace: dependency cycle detected involving ${remaining.join(', ')}`);
    }
    return out;
}

/**
 * Build the REVERSE inter-workspace dependency graph. Each edge `B → A`
 * means "A depends on B" — i.e. when B changes, A is affected and may
 * need re-test / re-build. Same option semantics as
 * `buildDependencyGraph`; the result feeds `affectedClosure`.
 *
 * Implementation note: we share the forward graph's filtering rules
 * (workspace:* protocol, only edges where both endpoints are workspaces
 * in this monorepo) so the two graphs stay consistent — `topologicalSort`
 * order is the reverse of `affectedClosure` traversal order on any
 * acyclic DAG.
 */
export function buildReverseDependencyGraph(
    workspaces: readonly Workspace[],
    options: BuildGraphOptions = {},
): DependencyGraph {
    const forward = buildDependencyGraph(workspaces, options);
    const edges = new Map<string, Set<string>>();
    for (const name of forward.edges.keys()) edges.set(name, new Set());
    for (const [from, deps] of forward.edges) {
        for (const dep of deps) {
            // `from` depends on `dep`. Reverse edge: `dep` → `from`.
            const slot = edges.get(dep);
            if (slot) slot.add(from);
        }
    }
    return { edges, byName: forward.byName, unlinked: forward.unlinked };
}

/**
 * BFS over a reverse-dep graph starting from `seeds`. Returns
 * `seeds ∪ all transitive dependents` as a `Set<string>` of workspace
 * names. Idempotent on duplicate seeds; unknown seed names are silently
 * skipped (a renamed-then-deleted workspace, a file in a not-yet-discovered
 * directory, etc. — those signal "we can't be precise here" and the
 * caller is expected to fall back to a conservative full run, not crash).
 *
 * @param reverse The reverse-dep graph from `buildReverseDependencyGraph`.
 * @param seeds Workspace names to start from.
 */
export function affectedClosure(reverse: DependencyGraph, seeds: readonly string[]): Set<string> {
    const out = new Set<string>();
    const queue: string[] = [];
    for (const seed of seeds) {
        if (!reverse.byName.has(seed)) continue;
        if (out.has(seed)) continue;
        out.add(seed);
        queue.push(seed);
    }
    while (queue.length > 0) {
        const name = queue.shift() as string;
        const dependents = reverse.edges.get(name);
        if (!dependents) continue;
        for (const next of dependents) {
            if (out.has(next)) continue;
            out.add(next);
            queue.push(next);
        }
    }
    return out;
}
