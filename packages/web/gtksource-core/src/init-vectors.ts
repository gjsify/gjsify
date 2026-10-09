// `GtkSource.init()` as observable behaviour. The SAME vectors run on real `gi://GtkSource` (the
// ORACLE: a vector that fails there is wrong, never a port bug) and on this package's namespace door.

/** The part of `GtkSource` the vectors read. */
export interface GtkSourceInitLike {
    init(): unknown;
}

export interface GtkSourceInitVector {
    readonly rule: string;
    readonly observe: (GtkSource: GtkSourceInitLike) => unknown;
    readonly shows: unknown;
}

export const GTKSOURCE_INIT_VECTORS: readonly GtkSourceInitVector[] = [
    {
        rule: 'init is a function on the namespace',
        observe: (GtkSource) => typeof GtkSource.init,
        shows: 'function',
    },
    {
        rule: 'init() returns undefined',
        observe: (GtkSource) => GtkSource.init(),
        shows: undefined,
    },
    {
        rule: 'a second init() is harmless and also returns undefined',
        observe: (GtkSource) => {
            GtkSource.init();
            return GtkSource.init();
        },
        shows: undefined,
    },
];
