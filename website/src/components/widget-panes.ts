// The kinds of pane a gallery block can hold. `AdwWidget.astro` builds them and
// `AdwWidgetWindow.astro` renders them, so the union lives in one module.
//
// A pane carries its RENDERED content: a slot pane has been through Expressive Code
// already, a code pane has not and is rendered by Starlight's `<Code>`.

/** The running widget: the markup to clone into the stage, or a Blueprint's `?shared-tree` as JSON. */
export type LivePane = { markup: string; tree?: undefined } | { tree: string; markup?: undefined };

/** A pane a PAGE filled, as one `<Fragment slot="…">` holding one fenced block. */
export type SlotPane = { id: string; kind: 'slot'; label: string; html: string };

/** A pane whose code the component supplies: a generated data file's snippet, or the `.blp`. */
export type CodePane = { id: string; kind: 'code'; label: string; lang: string; source: string };

/** One file of a {@link FilesPane}. `role` is what the file is within its binding and keys a reader's pick. */
export type PaneFile = {
    role: string;
    label: string;
    lang: string;
    source: string;
};

/**
 * Several FILES of one program — a port binding whose program is more than one file. The pane
 * holds a code view per file and shows the picked one; the More menu draws it as a SECTION with
 * one row per file, so the choice is made there rather than on a row under the header bar.
 */
export type FilesPane = { id: string; kind: 'files'; label: string; files: PaneFile[] };

export type WidgetPane = SlotPane | CodePane | FilesPane;
