// Inter-workspace dependency graph: forward edges (build order via Kahn's
// algorithm) and reverse edges (affected-closure for the CI test classifier).

import { indexByName } from './discover.js';
import type { Workspace } from './types.js';

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
    return { edges, byName: forward.byName };
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
