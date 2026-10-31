// The arithmetic `native-editor.ios.ts` does on text offsets and colours, kept free of UIKit so
// the specs run it on Node and GJS.
//
// UTF-16 code units throughout: a JS string index IS an `NSRange` location, so the iOS driver
// needs no index translation anywhere.
//
// The Android driver has no counterpart to most of this. `Editable` and `Layout` answer "which
// line is this offset on" and "where does this line start" from the platform, and spans move
// through edits by themselves; `NSTextStorage` has no span object to remove, so a repaint has to
// name the range it overwrites, and that range is computed here.

/** An `NSRange`, in the shape the ObjC bridge marshals. */
export interface TextRange {
    readonly location: number;
    readonly length: number;
}

/** `[start, end)` clamped into `[0, textLength]`; null when nothing is left to cover. */
export function clampRange(start: number, end: number, textLength: number): TextRange | null {
    const from = Math.min(Math.max(0, start), textLength);
    const to = Math.min(Math.max(from, end), textLength);
    return to > from ? { location: from, length: to - from } : null;
}

/**
 * The range of the line that starts at `lineStart`, without its newline.
 *
 * A repaint resets THIS range to the base attributes and then adds the new runs over it. Reading
 * the extent off the live text rather than remembering what the last pass painted is what keeps it
 * correct through an edit: an offset remembered before an insertion points somewhere else after
 * it, while the line a highlighter is repainting is always the line the text has now.
 */
export function lineExtent(text: string, lineStart: number): TextRange | null {
    if (lineStart >= text.length) return null;
    const newline = text.indexOf('\n', lineStart);
    return clampRange(lineStart, newline < 0 ? text.length : newline, text.length);
}

/** The offset every logical line starts at; `[0]` for the empty text. */
export function lineStartOffsets(text: string): number[] {
    const starts = [0];
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
    return starts;
}

/** The line `offset` falls on, by binary search over `starts`; the last line for anything past the end. */
export function lineAtOffset(starts: readonly number[], offset: number): number {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= offset) low = mid;
        else high = mid - 1;
    }
    return low;
}

/** The components `UIColor` takes, from the `0xAARRGGBB` integer a palette and a run style carry. */
export function argbComponents(argb: number): { red: number; green: number; blue: number; alpha: number } {
    return {
        red: ((argb >>> 16) & 0xff) / 255,
        green: ((argb >>> 8) & 0xff) / 255,
        blue: (argb & 0xff) / 255,
        alpha: ((argb >>> 24) & 0xff) / 255,
    };
}

/** One edit the platform made, as `EditorHost.onNativeEdit` takes it. */
export interface QueuedEdit {
    readonly start: number;
    readonly removed: number;
    readonly inserted: string;
}

/**
 * The edits the platform reported since the last flush, in order.
 *
 * Android queues in `onTextChanged` and flushes in `afterTextChanged`; iOS queues in
 * `textView:shouldChangeTextInRange:replacementText:` and flushes in `textViewDidChange:`. Both
 * platforms can report several edits before the after-callback (autocorrect replaces a word while
 * committing the next one), and the host may edit again from inside the flush — auto-indent does —
 * so the queue is TAKEN rather than iterated in place.
 */
export class EditQueue {
    private edits: QueuedEdit[] = [];

    get pending(): boolean {
        return this.edits.length > 0;
    }

    push(edit: QueuedEdit): void {
        this.edits.push(edit);
    }

    /** Empties the queue and returns what it held. */
    take(): readonly QueuedEdit[] {
        const taken = this.edits;
        this.edits = [];
        return taken;
    }

    clear(): void {
        this.edits = [];
    }
}
