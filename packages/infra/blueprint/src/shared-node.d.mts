// What `project.mjs` hands back — the node shape of ADR 0051, RESTATED here, and held to
// the original by a gate.
//
// WHERE THE ORIGINAL IS. `SharedTreeNode` in
// `packages/web/adwaita-core/src/conformance/shared-trees.ts` is the one authored-tree node
// shape this repository has: renderer-free, published, and read by all three ADR 0051 tree
// drivers. Everything below is a second spelling of it, never a second decision about it. A
// question about what the shape MEANS — why `slot` carries both `[start]` and `content:`,
// what `props` may hold — is answered there and in `corpus/expectations.mjs`, not here.
//
// WHY THIS FILE IS NOT AN IMPORT OF THAT ONE. Two reasons, and neither is a preference:
//
//   · TIER. `@gjsify/blueprint` is tier 1 and `@gjsify/adwaita-core` is tier 2, so a
//     `dependencies` edge from here to there is refused by ADR 0003's tier rule —
//     `scripts/manifest-conformance/rules/tier.mjs`, through `audit-runtimes --check`. The
//     direction is the point: a parser may not acquire a dependency on a widget package.
//   · NO BUILD STEP. A `devDependencies` edge would pass that rule and still not resolve.
//     `src/index.mjs` § There is no build step records why this package has none:
//     `tree-checks` installs the workspace and does NOT build it, and that is the job the
//     corpus gate runs in. `@gjsify/adwaita-core` publishes its types from `lib/types/**`,
//     which is build OUTPUT — absent in exactly that job, so the specifier would resolve to
//     nothing where it has to work.
//
// `scripts/adwaita-gallery-shared-trees.d.mts` restates the same shape for a third reason of
// its own (its consumers are plain-Node generators with no `node_modules`), written in its
// own header.
//
// SO THE COPY IS DECLARED AND MACHINE-HELD. `scripts/check-shared-tree-shape.mjs` compares
// every restatement against the original field by field — comments stripped, `readonly` and
// `Readonly<>` normalised away, members sorted — and fails naming the field that moved. It
// also SWEEPS the tree for an undeclared fourth spelling, because the failure this whole
// arrangement exists to prevent is not a drifted copy, it is a copy nobody knew was one.

/**
 * One node of an authored tree, spelled in GIR class names.
 *
 * Mutable where the original is `readonly`, because the projection BUILDS one of these:
 * `projectBody` accumulates `props` and `children` before it returns. The gate normalises
 * the modifier away, so the two spellings are one shape and a real field change still fails.
 */
export interface SharedNode {
    /** A GIR class name, e.g. `AdwPreferencesGroup` — what a renderer looks up. */
    tag: string;
    /** The object id the `.blp` declared: `Gtk.Box canvasContainer { }` is `id: 'canvasContainer'`. */
    id?: string;
    /**
     * Root only: the class a `template` defines, spelled as `<template class="…">` writes it —
     * the `$Name` verbatim, or the GType where the file named a type (`template ListItem`).
     */
    template?: string;
    /** The parent property this child was written at, or the bracket it was written under. */
    slot?: string;
    props?: Record<string, string | number | boolean>;
    /**
     * The `_()` / `C_()` markings on this node's `props`, keyed by the prop name it marks.
     *
     * One entry per marked property, `context` where the source wrote `C_("noun", …)`. It is
     * `StringValue['translatable']` from `./ast.d.mts` per key, so the projection COPIES what
     * the parser read rather than inventing a second value language for it.
     */
    translatable?: Record<string, { context?: string }>;
    /**
     * The style classes the source wrote, as a list and in source order.
     *
     * Filled from BOTH Blueprint spellings of one GTK property — the `styles [ ]` block and a
     * `css-classes: [ ]` property value — because `GtkWidget:css-classes` is what each of them
     * sets. A list and not a joined string: the oracle joins them differently per spelling,
     * `<class name=…/>` per element against a NEWLINE-separated `<property>` text, so a string
     * would have to pick one join and stop being comparable where the oracle picked the other
     * (ADR 0068 § 2).
     */
    styleClasses?: string[];
    /**
     * The extension blocks that carry plain values: `strings [ ]` on a `Gtk.StringList` and
     * `responses [ ]` on an `Adw.AlertDialog`, in source order, each string with its `_()`
     * marking beside it (ADR 0072). A response's flags become `appearance` and `enabled`, the
     * two attributes GtkBuilder writes for them. Every other extension stays a named loss.
     */
    extensions?: {
        strings?: { value: string; translatable?: { context?: string } }[];
        responses?: {
            id: string;
            label: string;
            translatable?: { context?: string };
            appearance?: 'suggested' | 'destructive';
            enabled?: boolean;
        }[];
    };
    children?: SharedNode[];
}

/**
 * One thing the projection dropped, by kind and by the line it was dropped from.
 *
 * `kind` is a plain `string` and not the closed `LossKind` of `corpus/expectations.mjs`,
 * because the projection emits a block extension and an extension LIST under their own
 * names — `layout`, `accessibility`, `marks` — and that set is open by construction. The
 * corpus narrows it for the files it declares; this exit cannot.
 */
export interface ProjectedLoss {
    kind: string;
    /** 1-based line in the `.blp`, so a divergence names a place a reader can open. */
    line: number;
}

/** What `projectToSharedNode` returns: the tree, and every loss named beside it. */
export interface SharedNodeProjection {
    node: SharedNode;
    lost: ProjectedLoss[];
}
