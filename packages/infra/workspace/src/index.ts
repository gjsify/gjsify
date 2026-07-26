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
//
// Barrel — re-exports only. Implementation lives in the sibling modules:
//   types.ts          Workspace / WorkspaceManifest shapes
//   glob.ts           the minimal `*` glob dialect + on-disk pattern expansion
//   discover.ts       discoverWorkspaces, resolveWorkspaceProtocol, filterWorkspaces
//   graph.ts          buildDependencyGraph, topologicalSort, reverse graph, affectedClosure
//   changed-files.ts  workspacesForChangedFiles

export type { Workspace, WorkspaceManifest } from './types.js';
export {
    type DiscoverWorkspacesOptions,
    discoverWorkspaces,
    filterWorkspaces,
    resolveWorkspaceProtocol,
} from './discover.js';
export {
    affectedClosure,
    type BuildGraphOptions,
    buildDependencyGraph,
    buildReverseDependencyGraph,
    type DependencyGraph,
    topologicalSort,
} from './graph.js';
export { workspacesForChangedFiles } from './changed-files.js';

// Re-export commonly used path helpers so consumers don't need a separate
// `node:path` import alongside `@gjsify/workspace`.
export { dirname as dirnamePath, join as joinPath } from 'node:path';
