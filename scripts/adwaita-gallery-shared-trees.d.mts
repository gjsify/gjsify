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
//
// NOTHING CHECKS THIS FILE AGAINST THE `.mjs`, so it declares ONLY what a TypeScript spec
// imports — every name below is imported by at least one live spec, which makes a rename
// over there a build error over here. A declaration nobody imports has no such backstop: it is a
// claim about the module that can quietly stop being true, which is this file's own failure
// mode. The `.mjs`'s remaining export (`ADWAITA_GALLERY_TREE_DIVERGENCES`) has plain-`.mjs`
// consumers only and is deliberately absent; add one here when, and only when, a spec
// imports it.

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

/** `buttonLabel` -> `button-label` — an authored prop as the DOM attribute it becomes. */
export declare const attributeOf: (prop: string) => string;

/** The shared block in `gtk-host` tags. */
export declare const gtkHostTree: (widget: string) => SharedTree;

/**
 * The shared block as the NativeScript dialect needs it — the GIR class names unchanged.
 *
 * The identity today, and declared rather than assumed for exactly that reason: the port's
 * widget classes already carry the GIR names the corpus is authored in (ADR 0034 clause 1),
 * so this emitter has nothing to transform. Its tree driver reads it anyway, so the day that
 * stops being true the driver follows instead of quietly building the old spelling.
 */
export declare const nativeScriptTree: (widget: string) => SharedTree;
