// The five kinds of pane a gallery window can hold, declared once.
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
} & (
    | {
          /** The markup to clone into the stage — the `preview` fence's own bytes. */
          markup: string;
          tree?: undefined;
      }
    | {
          /** A one-Blueprint block's `?shared-tree` projection, as JSON, built in the stage. */
          tree: string;
          markup?: undefined;
      }
);

/** A pane a PAGE filled, as one `<Fragment slot="…">` holding one fenced block. */
export type SlotPane = { id: string; kind: 'slot'; label: string; html: string };

/** A pane whose code the component supplies: a generated data file's snippet, or the `.blp`. */
export type CodePane = { id: string; kind: 'code'; label: string; lang: string; source: string };

/** One file of a {@link FilesPane}. */
export type PaneFile = {
    /**
     * What the file IS within its tab (`markup`, `code`, `blueprint`), which stays the same from
     * block to block while its name does not. A reader's pick of a file is kept by it.
     */
    role: string;
    /** The file name as the file row shows it, e.g. `views/clamp.xml` or `main.js (Blueprint)`. */
    label: string;
    lang: string;
    source: string;
};

/**
 * A tab that is several FILES of one program: a one-Blueprint block's port tabs, where the
 * generated markup, the code that loads it and the Blueprint route are each a file of their own.
 * Rendered as a row of file names over one code view per file.
 */
export type FilesPane = { id: string; kind: 'files'; label: string; files: PaneFile[] };

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

export type WidgetPane = LivePane | SlotPane | CodePane | FilesPane | RefusalPane;

/**
 * Every kind a TAB BAR can show, which is every kind but the live preview.
 *
 * A running widget under a tab bar offers the reader a choice between the widget and
 * its own sources, as if the widget were one of them. So the window that runs it shows
 * it alone, and this type is how `AdwWidgetWindow` says so to a reader AND to `tsc`:
 * the tab loop reads a `label` off every pane it draws, and a live pane has none.
 */
export type TabbedPane = SlotPane | CodePane | FilesPane | RefusalPane;
