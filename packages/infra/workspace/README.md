# @gjsify/workspace

Yarn-workspaces-compatible monorepo engine behind `gjsify foreach`, `gjsify workspace`, and `gjsify run`. Discovers workspace packages from `package.json#workspaces` globs, resolves `workspace:^` protocol references to local versions, builds an inter-package dependency graph, and produces a topological build order — the Node-free replacement for `yarn workspaces` that runs on both Node.js and GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/workspace
```

## Usage

```typescript
import {
    discoverWorkspaces,
    buildDependencyGraph,
    topologicalSort,
    filterWorkspaces,
} from '@gjsify/workspace';

// Discover all workspace packages defined in the root package.json
const workspaces = discoverWorkspaces('/path/to/monorepo');

// Build inter-workspace dependency graph and get topological build order
const graph = buildDependencyGraph(workspaces);
const ordered = topologicalSort(graph);
console.log(ordered.map(ws => ws.name));
// → ['@scope/a', '@scope/b', '@scope/c']  (deps before dependents)

// Filter to a subset (mirrors --include / --exclude)
const published = filterWorkspaces(workspaces, { noPrivate: true });
```

## License

MIT
