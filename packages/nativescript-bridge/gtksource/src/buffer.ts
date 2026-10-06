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

export class Buffer extends SignalEmitter {
    private lines: string[] = [''];
    /** `lineStarts[i]` is the offset of line `i`; valid for `i < startsValidTo`. */
    private lineStarts: number[] = [0];
    private startsValidTo = 1;
    private cursor = 0;
    private lang: Language | null = null;
    private scheme: StyleScheme | null = null;
    private highlight = true;

    constructor(text = '') {
        super();
        if (text !== '') this.lines = text.split('\n');
    }

    get text(): string {
        return this.lines.join('\n');
    }

    /**
     * Replaces everything. Like `gtk_text_buffer_set_text` — a delete and an insert — the
     * insert mark ends after the new text, so the cursor lands at the end.
     */
    set text(value: string) {
        this.replace(0, this.length, value ?? '');
        this.placeCursor(this.length);
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

    delete(start: number, end: number): void {
        this.replace(start, end, '');
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
        if (oldCursor >= end) this.cursor = oldCursor - removedText.length + text.length;
        else if (oldCursor > start) this.cursor = start + text.length;

        this.emit('changed', {
            start,
            removedText,
            insertedText: text,
            firstLine: first,
            removedLines: last - first + 1,
            insertedLines: replacement.length,
        } satisfies TextEdit);
        if (this.cursor !== oldCursor) this.emitCursor();
    }

    /** `GtkTextBuffer:cursor-position`. */
    get cursorPosition(): number {
        return this.cursor;
    }

    /** Moves the insert mark; emits `mark-set` and `notify::cursor-position` when it moved. */
    placeCursor(offset: number): void {
        this.checkOffset(offset);
        if (offset === this.cursor) return;
        this.cursor = offset;
        this.emitCursor();
    }

    private emitCursor(): void {
        this.emit('mark-set', this.cursor, 'insert');
        this.emit('notify::cursor-position');
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
