// Types for `adwaita-gallery-shared-trees.mjs`, so the TREE DRIVERS can read the corpus
// itself rather than a transcription of it (ADR 0051).
//
// WHY A DECLARATION FILE AND NOT A MOVE. The corpus is authored here because its two
// consumers are plain-Node generators that run in CI jobs with no `node_modules` — a bare
// specifier would not resolve for them. The drivers are TypeScript specs in two packages.
// A declaration beside the source lets both read the SAME file: `tsc` resolves the types
// here and never puts the `.mjs` in its program, so `rootDir` is not crossed, and the test
// bundlers inline the module like any other relative import.
//
// A second transcript of the tree — generated or hand-copied — is the defect ADR 0051
// exists to prevent, so there is deliberately no way to get one.

/** One node of an authored tree, spelled in GIR class names. */
export interface SharedNode {
    tag: string;
    slot?: string;
    props?: Record<string, string | number | boolean>;
    children?: SharedNode[];
}

/** One gallery block whose widget tree is authored once. */
export interface SharedTree {
    /** The `<AdwWidget title="…">` this belongs to, e.g. `Adw.Banner`. */
    widget: string;
    /** The gallery page it sits on. */
    page: string;
    root: SharedNode;
}

export declare const ADWAITA_GALLERY_SHARED_TREES: readonly SharedTree[];

/** `AdwPreferencesGroup` -> `adw-preferences-group` — `gtk-host`'s own `tagOf`, restated. */
export declare const hostTagOf: (gtype: string) => string;

/** The shared block in `gtk-host` tags. */
export declare const gtkHostTree: (widget: string) => SharedTree;

/** The shared block in GIR class names — no transform, see the source. */
export declare const nativeScriptTree: (widget: string) => SharedTree;

/** Every gallery block that has a tree on both renderers and is still authored twice. */
export declare const ADWAITA_GALLERY_TREE_DIVERGENCES: Record<string, string>;
