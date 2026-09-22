declare module '*.blp' {
    const content: string;
    export default content;
}

/**
 * The same file asked for as ADR 0051's authored-tree node — what `adwaita-web`'s
 * `mountSharedTree` and the NativeScript port's `build` consume.
 *
 * A SECOND MODULE PATTERN AND NOT A WIDER `*.blp`, because the two exits are two shapes and a
 * module has one: declaring `.blp` as `string | SharedNode` would make every existing consumer
 * narrow past a value it cannot receive. `@gjsify/vite-plugin-blueprint` § SHARED_TREE_QUERY
 * says why the exit is chosen by the specifier rather than by the build target.
 *
 * `SharedNode` is assignable to `@gjsify/adwaita-core`'s `SharedTreeNode` — the renderers'
 * parameter — which is the property that makes this import mountable without a cast.
 */
declare module '*.blp?shared-tree' {
    const tree: import('@gjsify/blueprint').SharedNode;
    export default tree;
}
