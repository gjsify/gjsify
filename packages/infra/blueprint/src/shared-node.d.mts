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
    /**
     * `tag` is a class the application registers (`$SourceView`), in no GIR (ADR 0093). The tag is
     * spelled as the XML spells it, and a renderer resolves it in its own template-class registry.
     */
    extern?: true;
    /** The parent property this child was written at, or the bracket it was written under. */
    slot?: string;
    props?: Record<string, string | number | boolean>;
    /** The child as a page of a `Gtk.Notebook` or `Gtk.Stack`: tab text or title, and a stack page's name. */
    page?: { label?: string; name?: string };
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
    /**
     * The `layout { }` block: properties of the child's PLACEMENT in a layout manager
     * (`GtkGridLayoutChild`'s `row`, `column`, `row-span`, `column-span`), as the source wrote
     * them (ADR 0092). Never typed against the widget, so an identifier stays its spelling.
     */
    layout?: Record<string, string | number | boolean>;
    /**
     * The signal handlers (`clicked => $onClicked()`), in source order and as the source wrote
     * them (ADR 0093). `handler` is a NAME the renderer resolves against a scope object, never
     * code; `name` and `detail` are the two halves of `notify::sensitive`.
     */
    signals?: {
        name: string;
        detail?: string;
        handler: string;
        object?: string;
        flags?: ('swapped' | 'after' | 'not-swapped')[];
    }[];
    /**
     * The simple `bind`s, keyed by the target property (ADR 0093): one source, one property, the
     * flags as written. `source` is an object id, or `template` for the component itself.
     */
    bindings?: Record<
        string,
        {
            source: string;
            property: string;
            flags?: ('bidirectional' | 'inverted' | 'no-sync-create')[];
        }
    >;
    breakpoints?: {
        condition: string;
        setters: {
            object: string;
            property: string;
            value: string | number | boolean;
            translatable?: { context?: string };
        }[];
    }[];
    /**
     * Root only: the OBJECT roots the file declares beside this one — `Adw.AlertDialog dialog { }`
     * or `$Learn learn { }` after the template — each a tree of its own (ADR 0093). They share the
     * root's id scope, so a setter or a reference may name one, and a renderer hands the built
     * object back to the code beside the file; none of them is a child of the root.
     */
    siblings?: SharedNode[];
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

/**
 * One occurrence of a construct the tree CARRIES, by kind and line (ADR 0093 § 2).
 *
 * `kind` is a plain `string` for the reason `ProjectedLoss.kind` is: this package cannot import
 * the renderers' `ConstructKind` (tier), and a plugin intersects it with a capability table.
 */
export interface ProjectedUse {
    kind: string;
    /** 1-based line in the `.blp`. */
    line: number;
}

/** What `projectToSharedNode` returns: the tree, every loss, and every carried construct, beside it. */
export interface SharedNodeProjection {
    node: SharedNode;
    lost: ProjectedLoss[];
    uses: ProjectedUse[];
}
