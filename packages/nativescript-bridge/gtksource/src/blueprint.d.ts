// The `?shared-tree` exit of `@gjsify/vite-plugin-blueprint`, typed for this package's tree
// specs. The build plugin is part of every `gjsify build` app target, so the import resolves
// without this package depending on it; only the module PATTERN has to be declared, and it is
// declared as the node shape `build()` consumes rather than through the plugin's own types,
// which would make the plugin a dependency of a package that never runs it.
declare module '*.blp?shared-tree' {
    import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

    const tree: SharedTreeNode;
    export default tree;
}
