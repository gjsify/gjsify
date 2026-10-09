// The seam between the platform-free editor logic and a native text widget.
//
// `EditorSession` talks to a driver and knows nothing of Android; `native-editor.android.ts`
// implements it over an `EditText`, and the specs implement it with a recorder. A driver is
// told what to show (text, spans, palette, layout) and reports what the user did (edits,
// selection) through the `EditorHost` it is bound to.

import type { EditorPalette } from './style-scheme.js';
import type { StyledRun } from './token-styler.js';

/** What the driver reports back. Offsets are UTF-16 code units, valid AFTER the edit. */
export interface EditorHost {
    /** The user replaced `removedLength` characters at `start` with `inserted`. */
    onNativeEdit(start: number, removedLength: number, inserted: string): void;
    onNativeSelection(start: number, end: number): void;
}

export interface EditorLayout {
    readonly showLineNumbers: boolean;
    readonly monospace: boolean;
    readonly editable: boolean;
    readonly highlightCurrentLine: boolean;
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
    bind(host: EditorHost): void;
    /** Replaces the whole text and forgets every span: the buffer was swapped. */
    setText(text: string): void;
    /** Mirrors a programmatic edit into the widget's text. */
    replaceRange(start: number, end: number, text: string): void;
    setSelection(start: number, end: number): void;
    setLineCount(count: number): void;
    setLayout(layout: EditorLayout): void;
}
