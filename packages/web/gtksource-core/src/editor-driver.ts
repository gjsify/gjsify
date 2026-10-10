// The seam between the platform-free editor logic and a native text widget.
//
// `EditorSession` talks to a driver and knows nothing of Android; `native-editor.android.ts`
// implements it over an `EditText`, and the specs implement it with a recorder. A driver is
// told what to show (text, spans, palette, layout) and reports what the user did (edits,
// selection) through the `EditorHost` it is bound to.

import type { MarkupRun } from './gutter-renderer.js';
import type { EditorPalette } from './style-scheme.js';
import type { StyledRun } from './token-styler.js';

/** The size a gutter renderer asks for, in device-independent pixels. */
export interface GutterMetrics {
    /** The insert position: below 0 the column sits left of the line numbers, otherwise right of them. */
    readonly position: number;
    readonly widthRequest: number;
    readonly marginStart: number;
    readonly marginEnd: number;
}

/** What a renderer showed for one line: plain `text`, and `runs` when it was set as `markup`. */
export interface GutterCell {
    readonly text: string;
    readonly runs: readonly MarkupRun[] | null;
}

/** One renderer's column for the lines `first..last`: `cells[i]` is line `first + i`. */
export interface GutterColumn extends GutterMetrics {
    readonly cells: readonly GutterCell[];
}

/** What the driver reports back. Offsets are UTF-16 code units, valid AFTER the edit. */
export interface EditorHost {
    /** The user replaced `removedLength` characters at `start` with `inserted`. */
    onNativeEdit(start: number, removedLength: number, inserted: string): void;
    onNativeSelection(start: number, end: number): void;
    /**
     * A double or triple click at `location` (UTF-16): `granularity` is `Gtk.TextExtendSelection`. It answers
     * the range to select, or null when the platform may apply its own word or line selection. A handler of
     * `extend-selection` that stops the emission makes it the collapsed range at `location`, as in GTK.
     */
    onNativeExtendSelection(granularity: number, location: number): readonly [number, number] | null;
    /** The user asked to copy the selection; false when a handler of `copy-clipboard` stopped it, so the platform must not. */
    onNativeCopy(): boolean;
    /** The renderers of the gutter on `side` (`Gtk.TextWindowType` LEFT or RIGHT), left to right, without cells. */
    gutterColumns(side?: number): readonly GutterMetrics[];
    /**
     * Asks every renderer of the gutter on `side` (LEFT unless given) to fill its cell for each line of
     * `first..last` (inclusive) with `vfunc_query_data`, the lines the driver is about to paint. Call it
     * once per paint pass and side.
     */
    queryGutter(first: number, last: number, side?: number): readonly GutterColumn[];
}

export interface EditorLayout {
    readonly showLineNumbers: boolean;
    readonly monospace: boolean;
    readonly editable: boolean;
    readonly highlightCurrentLine: boolean;
    /** `GtkTextView:cursor-visible`: whether the insertion cursor is drawn. */
    readonly cursorVisible: boolean;
    /** The `left-margin` … `bottom-margin` of `Gtk.TextView`, in device-independent pixels. */
    readonly leftMargin: number;
    readonly rightMargin: number;
    readonly topMargin: number;
    readonly bottomMargin: number;
}

/** Where highlighted runs go. Spans live on the text, so they follow lines through edits. */
export interface HighlightSink {
    /** Lines `[first, first + removed)` were replaced by `inserted` lines; drop what they carried. */
    spliceLines(first: number, removed: number, inserted: number): void;
    /** Replace everything painted on `line` (which starts at `lineStart`) with `runs`. */
    paintLine(line: number, lineStart: number, runs: readonly StyledRun[]): void;
    clearAll(): void;
    setPalette(palette: EditorPalette): void;
}

export interface EditorDriver extends HighlightSink {
    /**
     * The `Gtk.TextWindowType` sides this driver paints; LEFT when absent. A renderer inserted into a gutter
     * on any other side is refused by name (ADR 0103), never drawn wrongly.
     */
    readonly gutterSides?: readonly number[];
    bind(host: EditorHost): void;
    /** Replaces the whole text and forgets every span: the buffer was swapped. */
    setText(text: string): void;
    /** Mirrors a programmatic edit into the widget's text. */
    replaceRange(start: number, end: number, text: string): void;
    setSelection(start: number, end: number): void;
    setLineCount(count: number): void;
    setLayout(layout: EditorLayout): void;
    /**
     * A gutter renderer was added, moved, resized or asked to repaint. Idempotent and cheap: a
     * burst of calls costs one repaint per task, as `queue_draw` does in GTK.
     */
    invalidateGutter(): void;
    /**
     * Copies the selection the platform's own way. Only a driver whose platform copies BEFORE the
     * handlers of `copy-clipboard` run needs it: the class handler of the emission calls it, so a
     * `connect_after` handler that puts its own text on the clipboard replaces the default, as in GTK.
     * The web has none: its default runs after the `copy` event and is cancelled instead.
     */
    copySelection?(): void;
}
