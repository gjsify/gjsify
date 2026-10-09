// GtkSource.Buffer — the text model behind a `GtkSource.View`.
//
// Offsets count UTF-16 code units, the platform's own unit, not `Gtk.TextIter`'s characters:
// the native editor reports its edits in them and a conversion at the seam would be a bug
// magnet. Lines are separated by `\n` only. The buffer keeps the text as one string per
// line so the highlighter can re-tokenize just the lines an edit touched; every edit
// reports which lines it replaced (`firstLine`, `removedLines`, `insertedLines`).

import type { Language } from './language-manager.js';
import { SignalEmitter } from './signals.js';
import type { StyleScheme } from './style-scheme.js';
import { TextIter, TextMark } from './text-iter.js';

/** What `changed` carries: one contiguous replacement. */
export interface TextEdit {
    readonly start: number;
    readonly removedText: string;
    readonly insertedText: string;
    /** The lines `[firstLine, firstLine + removedLines)` of the old text became `insertedLines` lines. */
    readonly firstLine: number;
    readonly removedLines: number;
    readonly insertedLines: number;
}

/** What a `.blp` may construct a buffer with: `buffer: GtkSource.Buffer { text: "…"; }`. */
export interface BufferProps {
    text?: string;
    highlightSyntax?: boolean;
}

/** One undoable step: the edits of a user action, or a single edit made outside one. */
interface UndoGroup {
    readonly edits: TextEdit[];
    readonly before: number;
}

// What `connect` accepts; the rest of GtkSource.Buffer's signals are refused by name.
const BUFFER_SIGNALS: ReadonlySet<string> = new Set([
    'changed',
    'mark-set',
    'begin-user-action',
    'end-user-action',
    'undo',
    'redo',
    'cursor-moved',
    'notify::language',
    'notify::style-scheme',
    'notify::highlight-syntax',
    'notify::cursor-position',
    'notify::can-undo',
    'notify::can-redo',
]);

// Named by its GIR name, like `GtkSourceView`: the shared-tree builder refuses a barrel member
// whose class name is not the tag the `.blp` wrote. `Buffer` stays the name code imports.
export class GtkSourceBuffer extends SignalEmitter {
    private lines: string[] = [''];
    /** `lineStarts[i]` is the offset of line `i`; valid for `i < startsValidTo`. */
    private lineStarts: number[] = [0];
    private startsValidTo = 1;
    private cursor = 0;
    private bound = 0;
    private readonly insertMark = new TextMark('insert');
    private readonly boundMark = new TextMark('selection_bound');
    private undoStack: UndoGroup[] = [];
    private redoStack: UndoGroup[] = [];
    private open: UndoGroup | null = null;
    private depth = 0;
    private recording = true;
    private reportedUndo = false;
    private reportedRedo = false;
    private lang: Language | null = null;
    private scheme: StyleScheme | null = null;
    private highlight = true;

    constructor(init: string | BufferProps = '') {
        super();
        const { text = '', highlightSyntax = true } = typeof init === 'string' ? { text: init } : init;
        if (text !== '') this.lines = text.split('\n');
        this.highlight = highlightSyntax !== false && String(highlightSyntax) !== 'false';
    }

    get text(): string {
        return this.lines.join('\n');
    }

    /**
     * Replaces everything. Like `gtk_text_buffer_set_text` — a delete and an insert — the
     * insert mark ends after the new text, so the cursor lands at the end.
     */
    set text(value: string) {
        // Like `gtk_text_buffer_set_text` on a GtkSource.Buffer, it is not undoable and drops the history.
        this.recording = false;
        try {
            this.replace(0, this.length, value ?? '');
            this.placeCursor(this.length);
        } finally {
            this.recording = true;
        }
        this.undoStack = [];
        this.redoStack = [];
        if (this.open) this.open.edits.length = 0;
        this.syncUndoState();
    }

    get length(): number {
        return this.offsetOfLine(this.lines.length - 1) + this.lines[this.lines.length - 1].length;
    }

    get lineCount(): number {
        return this.lines.length;
    }

    /** Line `index` without its terminator. */
    getLine(index: number): string {
        const line = this.lines[index];
        if (line === undefined) throw new RangeError(`Buffer: line ${index} is outside 0..${this.lines.length - 1}`);
        return line;
    }

    /** A copy of every line. */
    getLines(): string[] {
        return [...this.lines];
    }

    offsetOfLine(index: number): number {
        if (index < 0 || index >= this.lines.length) {
            throw new RangeError(`Buffer: line ${index} is outside 0..${this.lines.length - 1}`);
        }
        while (this.startsValidTo <= index) {
            const previous = this.startsValidTo - 1;
            this.lineStarts[this.startsValidTo] = this.lineStarts[previous] + this.lines[previous].length + 1;
            this.startsValidTo++;
        }
        return this.lineStarts[index];
    }

    lineOfOffset(offset: number): number {
        this.checkOffset(offset);
        let low = 0;
        let high = this.lines.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.offsetOfLine(mid) <= offset) low = mid;
            else high = mid - 1;
        }
        return low;
    }

    getText(start = 0, end = this.length): string {
        this.checkOffset(start);
        this.checkOffset(end);
        if (start > end) throw new RangeError(`Buffer: range ${start}..${end} is reversed`);
        return this.text.slice(start, end);
    }

    insert(offset: number, text: string): void {
        this.replace(offset, offset, text);
    }

    /** Offsets in UTF-16 units, or the two `TextIter`s of `gtk_text_buffer_delete` (any order). */
    delete(start: number | TextIter, end: number | TextIter): void {
        if (typeof start === 'number' && typeof end === 'number') {
            this.replace(start, end, '');
            return;
        }
        const a = typeof start === 'number' ? start : this.ownIter(start, 'delete');
        const b = typeof end === 'number' ? end : this.ownIter(end, 'delete');
        this.replace(Math.min(a, b), Math.max(a, b), '');
    }

    /** The one mutation every other one goes through. An edit that changes nothing emits nothing. */
    replace(start: number, end: number, text: string): void {
        this.checkOffset(start);
        this.checkOffset(end);
        if (start > end) throw new RangeError(`Buffer: range ${start}..${end} is reversed`);
        const first = this.lineOfOffset(start);
        const last = this.lineOfOffset(end);
        const firstStart = this.offsetOfLine(first);
        const lastStart = this.offsetOfLine(last);
        const removedText = this.lines
            .slice(first, last + 1)
            .join('\n')
            .slice(start - firstStart, end - firstStart);
        if (removedText === '' && text === '') return;

        const combined =
            this.lines[first].slice(0, start - firstStart) + text + this.lines[last].slice(end - lastStart);
        const replacement = combined.split('\n');
        this.lines.splice(first, last - first + 1, ...replacement);
        this.startsValidTo = Math.min(this.startsValidTo, first + 1);

        const oldCursor = this.cursor;
        const shift = (position: number): number =>
            position >= end
                ? position - removedText.length + text.length
                : position > start
                  ? start + text.length
                  : position;
        this.cursor = shift(this.cursor);
        this.bound = shift(this.bound);

        const edit: TextEdit = {
            start,
            removedText,
            insertedText: text,
            firstLine: first,
            removedLines: last - first + 1,
            insertedLines: replacement.length,
        };
        this.record(edit, oldCursor);
        this.emit('changed', edit);
        if (this.cursor !== oldCursor) this.emit('notify::cursor-position');
        this.emit('cursor-moved');
    }

    /** `GtkTextBuffer:cursor-position`. */
    get cursorPosition(): number {
        return this.cursor;
    }

    /** The GJS spelling of `GtkTextBuffer:cursor-position`, in characters like `TextIter.get_offset`. */
    get cursor_position(): number {
        return new TextIter(this, this.cursor).get_offset();
    }

    /** Where `selection_bound` is; equal to `cursorPosition` when nothing is selected. */
    get selectionBoundPosition(): number {
        return this.bound;
    }

    /** Moves both marks like `gtk_text_buffer_select_range`; a mark already there is left alone. */
    selectRange(cursor: number, bound: number): void {
        this.checkOffset(cursor);
        this.checkOffset(bound);
        if (cursor !== this.cursor) this.moveInsert(cursor);
        if (bound !== this.bound) this.moveBound(bound);
    }

    /** Collapses the selection onto `offset`. */
    placeCursor(offset: number): void {
        this.selectRange(offset, offset);
    }

    // `move_mark` always reports, even when the mark does not move; the edit-driven paths do not.
    private moveInsert(offset: number): void {
        this.cursor = offset;
        this.emit('mark-set', new TextIter(this, offset), this.insertMark);
    }

    private moveBound(offset: number): void {
        this.bound = offset;
        this.emit('mark-set', new TextIter(this, offset), this.boundMark);
    }

    // --- the GJS surface -----------------------------------------------------------------------

    get_insert(): TextMark {
        return this.insertMark;
    }

    get_selection_bound(): TextMark {
        return this.boundMark;
    }

    get_start_iter(): TextIter {
        return new TextIter(this, 0);
    }

    get_end_iter(): TextIter {
        return new TextIter(this, this.length);
    }

    /** `[has_selection, start, end]`, start before end whichever mark is which. */
    get_selection_bounds(): [boolean, TextIter, TextIter] {
        const low = Math.min(this.cursor, this.bound);
        const high = Math.max(this.cursor, this.bound);
        return [low !== high, new TextIter(this, low), new TextIter(this, high)];
    }

    /** The buffer has no tags, so no text is hidden and `include_hidden` changes nothing. */
    get_text(start: TextIter, end: TextIter, _includeHidden: boolean): string {
        const a = this.ownIter(start, 'get_text');
        const b = this.ownIter(end, 'get_text');
        return this.getText(Math.min(a, b), Math.max(a, b));
    }

    move_mark(mark: TextMark, where: TextIter): void {
        const offset = this.ownIter(where, 'move_mark');
        if (mark === this.insertMark) this.moveInsert(offset);
        else if (mark === this.boundMark) this.moveBound(offset);
        else throw new Error("GtkSource.Buffer.move_mark: only the 'insert' and 'selection_bound' marks exist");
    }

    /** Only `len` -1 (the whole string): GTK counts bytes there, and nothing here needs a prefix. */
    insert_at_cursor(text: string, len: number): void {
        if (len !== -1) throw new Error('GtkSource.Buffer.insert_at_cursor: only len -1 is implemented');
        this.insert(this.cursor, text);
    }

    set_language(language: Language | null): void {
        this.language = language;
    }

    set_style_scheme(scheme: StyleScheme | null): void {
        this.styleScheme = scheme;
    }

    // --- user actions and history --------------------------------------------------------------

    /** Edits between the outermost begin and its end are one undo step. */
    begin_user_action(): void {
        if (this.depth++ > 0) return;
        this.open = { edits: [], before: this.cursor };
        this.emit('begin-user-action');
    }

    end_user_action(): void {
        if (this.depth === 0) return;
        if (--this.depth > 0) return;
        const group = this.open;
        this.open = null;
        if (group && group.edits.length > 0) this.push(group);
        this.emit('end-user-action');
    }

    get can_undo(): boolean {
        return this.undoStack.length > 0;
    }

    get can_redo(): boolean {
        return this.redoStack.length > 0;
    }

    undo(): void {
        const group = this.depth === 0 ? this.undoStack.pop() : undefined;
        if (!group) return;
        this.emit('undo');
        this.applyHistory(() => {
            for (const edit of [...group.edits].reverse()) {
                this.replace(edit.start, edit.start + edit.insertedText.length, edit.removedText);
            }
        });
        this.moveInsert(group.before);
        this.moveBound(group.before);
        this.redoStack.push(group);
        this.syncUndoState();
    }

    redo(): void {
        const group = this.depth === 0 ? this.redoStack.pop() : undefined;
        if (!group) return;
        this.emit('redo');
        this.applyHistory(() => {
            for (const edit of group.edits)
                this.replace(edit.start, edit.start + edit.removedText.length, edit.insertedText);
        });
        const last = group.edits[group.edits.length - 1];
        const after = last.start + last.insertedText.length;
        this.moveInsert(after);
        this.moveBound(after);
        this.undoStack.push(group);
        this.syncUndoState();
    }

    private applyHistory(apply: () => void): void {
        this.recording = false;
        try {
            apply();
        } finally {
            this.recording = true;
        }
    }

    private record(edit: TextEdit, cursorBefore: number): void {
        if (!this.recording) return;
        this.redoStack = [];
        if (this.open) this.open.edits.push(edit);
        else this.push({ edits: [edit], before: cursorBefore });
    }

    private push(group: UndoGroup): void {
        this.undoStack.push(group);
        this.syncUndoState();
    }

    private syncUndoState(): void {
        const undo = this.can_undo;
        const redo = this.can_redo;
        const undoChanged = undo !== this.reportedUndo;
        const redoChanged = redo !== this.reportedRedo;
        this.reportedUndo = undo;
        this.reportedRedo = redo;
        if (undoChanged) this.emit('notify::can-undo');
        if (redoChanged) this.emit('notify::can-redo');
    }

    // `mark-set` is RUN_LAST: GtkSource's class handler (the buffer's own bookkeeping) announces the moved
    // cursor, so a handler that stops the emission keeps `cursor-moved` and the notify from everyone.
    protected override classHandler(name: string, args: readonly unknown[]): unknown {
        if (name === 'mark-set' && args[1] === this.insertMark) {
            this.emit('cursor-moved');
            this.emit('notify::cursor-position');
        }
        return undefined;
    }

    protected override checkSignal(name: string): void {
        if (!BUFFER_SIGNALS.has(name)) throw new Error(`GtkSource.Buffer: signal '${name}' is not implemented`);
    }

    private ownIter(iter: TextIter, verb: string): number {
        if (!(iter instanceof TextIter) || iter.source !== this) {
            throw new TypeError(`GtkSource.Buffer.${verb}: the iterator belongs to another buffer`);
        }
        return iter.utf16Offset;
    }

    /** `GtkSource.Buffer:language` — what to highlight with; `null` highlights nothing. */
    get language(): Language | null {
        return this.lang;
    }

    set language(value: Language | null) {
        if (value === this.lang) return;
        this.lang = value;
        this.emit('notify::language');
    }

    /** `GtkSource.Buffer:style-scheme`; `null` lets the view pick one for the light/dark mode. */
    get styleScheme(): StyleScheme | null {
        return this.scheme;
    }

    set styleScheme(value: StyleScheme | null) {
        if (value === this.scheme) return;
        this.scheme = value;
        this.emit('notify::style-scheme');
    }

    /** `GtkSource.Buffer:highlight-syntax`, on by default. */
    get highlightSyntax(): boolean {
        return this.highlight;
    }

    set highlightSyntax(value: boolean) {
        if (value === this.highlight) return;
        this.highlight = value;
        this.emit('notify::highlight-syntax');
    }

    private checkOffset(offset: number): void {
        if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
            throw new RangeError(`Buffer: offset ${offset} is outside 0..${this.length}`);
        }
    }
}

export { GtkSourceBuffer as Buffer };
export { TextIter, TextMark } from './text-iter.js';
