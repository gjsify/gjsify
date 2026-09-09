// The four kinds of pane a gallery window can hold, declared once.
//
// ONE MODULE because two components need the same union: `AdwWidget.astro` builds
// the list and `AdwWidgetWindow.astro` renders it, and the list is POSITIONAL — its
// order is the order the panes appear in and the order `data-impls` names them in.
// Declared twice, the two would be structurally compatible on the day they were
// written and free to drift after it.
//
// A pane carries its RENDERED content, not a way of getting it: a slot pane has been
// through Expressive Code already (Astro hands a slot back as HTML), a code pane has
// not and is rendered by Starlight's `<Code>`, and a refusal pane is prose. That
// difference is why `kind` exists at all rather than one `html` field.

/** The running widget. The component mounts it; no page provides it. */
export type LivePane = {
    id: string;
    kind: 'live';
    /** The markup to clone into the stage — the `preview` fence's own bytes. */
    markup: string;
};

/** A pane a PAGE filled, as one `<Fragment slot="…">` holding one fenced block. */
export type SlotPane = { id: string; kind: 'slot'; label: string; html: string };

/** A pane filled from a generated data file rather than from a page. */
export type CodePane = { id: string; kind: 'code'; label: string; lang: string; source: string };

/**
 * Why this block has no snippet in one group's dialect.
 *
 * A missing tab and a tab that cannot exist look identical, and only one of them is
 * a fact — which is why both refusal maps exist and why this is a pane rather than an
 * absence.
 */
export type RefusalPane = {
    id: string;
    kind: 'refusal';
    label: string;
    missing: string;
    note: string;
    reason: string;
};

export type WidgetPane = LivePane | SlotPane | CodePane | RefusalPane;

/**
 * Every kind a TAB BAR can show, which is every kind but the live preview.
 *
 * A running widget under a tab bar offers the reader a choice between the widget and
 * its own sources, as if the widget were one of them. So the window that runs it shows
 * it alone, and this type is how `AdwWidgetWindow` says so to a reader AND to `tsc`:
 * the tab loop reads a `label` off every pane it draws, and a live pane has none.
 */
export type TabbedPane = SlotPane | CodePane | RefusalPane;
