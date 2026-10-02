/**
 * The FALLBACK, and only the fallback, since ADR 0088.
 *
 * A `.blp` with an `x.d.blp.ts` sidecar beside it is typed by that sidecar instead — measured on
 * TypeScript 6.0.3, a sidecar read under `allowArbitraryExtensions` wins over this wildcard. This
 * stays because the migration is per-file and must be: a `.blp` with no sidecar keeps typing as
 * the XML string it has always been, so nothing had to move when the named exports landed.
 *
 * It is also what makes the missing-sidecar case LOUD rather than silent. A consumer writing
 * `import { build } from './x.blp'` against a file with no sidecar lands here, where only
 * `default` exists, and `tsc` reports TS2614 naming each missing member — which is why
 * `scripts/check-blueprint-sidecars.mjs` does not check for that case itself.
 */
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
