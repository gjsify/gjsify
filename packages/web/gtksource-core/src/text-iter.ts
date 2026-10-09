// `Gtk.TextIter` and `Gtk.TextMark`, the part a `GtkSource.Buffer` hands to its callers: an iterator is
// a value (moving one never moves a mark) and counts CHARACTERS, as GTK does, while the buffer
// itself counts UTF-16 units; the conversion lives here, at the seam GJS code can see.

/** What an iterator needs of its buffer. */
export interface TextIterSource {
    readonly length: number;
    getText(start?: number, end?: number): string;
}

export class TextIter {
    private offset: number;

    /** Made by a buffer, never by a caller: GTK hands iterators out, it does not take them in. `source` is the owning buffer. */
    constructor(
        readonly source: TextIterSource,
        utf16Offset: number,
    ) {
        this.offset = utf16Offset;
    }

    /** The offset in UTF-16 units, the buffer's own measure; not part of the `Gtk.TextIter` surface. */
    get utf16Offset(): number {
        return this.offset;
    }

    get_offset(): number {
        let count = 0;
        const text = this.source.getText(0, this.offset);
        for (let index = 0; index < text.length; index++) {
            const unit = text.charCodeAt(index);
            // A high surrogate followed by its low one is one character.
            if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
                const next = text.charCodeAt(index + 1);
                if (next >= 0xdc00 && next <= 0xdfff) index++;
            }
            count++;
        }
        return count;
    }

    /** Like `gtk_text_iter_set_offset`: a negative offset, or one past the end, is the end. */
    set_offset(charOffset: number): void {
        if (!Number.isInteger(charOffset)) throw new TypeError(`TextIter.set_offset: ${charOffset} is not an integer`);
        const text = this.source.getText();
        let units = 0;
        for (let count = 0; charOffset >= 0 && count < charOffset && units < text.length; count++) {
            units += text.codePointAt(units)! > 0xffff ? 2 : 1;
        }
        this.offset = charOffset < 0 || units >= text.length ? this.source.length : units;
    }
}

/** One of the two marks every buffer has, `insert` and `selection_bound`. */
export class TextMark {
    constructor(readonly name: string | null) {}
}
