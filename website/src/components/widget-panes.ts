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

/** One file of a {@link FilesPane}. `role` is what the file is within its tab and keys a reader's pick. */
export type PaneFile = {
    role: string;
    label: string;
    lang: string;
    source: string;
};

/** Several FILES of one program, shown as a row of file names over one code view per file. */
export type FilesPane = { id: string; kind: 'files'; label: string; files: PaneFile[] };

/**
 * Why this block has no snippet in one group's dialect. A missing snippet and one that
 * cannot exist look identical, and only one of them is a fact.
 */
export type RefusalPane = {
    id: string;
    kind: 'refusal';
    label: string;
    missing: string;
    note: string;
    reason: string;
};

export type WidgetPane = SlotPane | CodePane | FilesPane | RefusalPane;
