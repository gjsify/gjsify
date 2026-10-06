// Keeps a `HighlightSink` painted to match a `Buffer`: tokenizes incrementally on every edit
// and repaints only the lines the highlighter reports, and re-tints (no re-tokenizing) when the
// scheme or the light/dark mode changes.

import type { Buffer, TextEdit } from './buffer.js';
import type { HighlightSink } from './editor-driver.js';
import { IncrementalHighlighter } from './highlighter.js';
import { paletteOf, StyleSchemeManager } from './style-scheme.js';
import type { ColorSchemeVariant, StyleScheme } from './style-scheme.js';
import { TokenStyler } from './token-styler.js';

export class HighlightController {
    private highlighter: IncrementalHighlighter | null = null;
    private styler: TokenStyler | null = null;
    private variant: ColorSchemeVariant;
    private readonly handlers: number[] = [];

    constructor(
        private readonly buffer: Buffer,
        private readonly sink: HighlightSink,
        private readonly schemes: StyleSchemeManager = StyleSchemeManager.getDefault(),
        variant: ColorSchemeVariant = 'light',
    ) {
        this.variant = variant;
        this.handlers.push(
            buffer.connect('changed', (_buffer, edit: TextEdit) => this.onChanged(edit)),
            buffer.connect('notify::language', () => this.rebuild()),
            buffer.connect('notify::style-scheme', () => this.rebuild()),
            buffer.connect('notify::highlight-syntax', () => this.rebuild()),
        );
        this.rebuild();
    }

    /** The scheme actually in force: the buffer's (its other-mode sibling when one exists), else the default. */
    get scheme(): StyleScheme | null {
        const chosen = this.buffer.styleScheme;
        return chosen ? this.schemes.variantOf(chosen, this.variant) : this.schemes.getDefaultFor(this.variant);
    }

    setColorScheme(variant: ColorSchemeVariant): void {
        if (variant === this.variant) return;
        this.variant = variant;
        this.rebuild(false);
    }

    dispose(): void {
        for (const id of this.handlers.splice(0)) this.buffer.disconnect(id);
    }

    /**
     * Full repaint. `retokenize` is false for a pure re-tint: the tokens did not change, only what they look like.
     */
    private rebuild(retokenize = true): void {
        const scheme = this.scheme;
        const language = this.buffer.language;
        if (scheme) this.sink.setPalette(paletteOf(scheme, this.variant));

        if (!language || !scheme || !this.buffer.highlightSyntax) {
            this.highlighter = null;
            this.styler = null;
            this.sink.clearAll();
            return;
        }
        if (retokenize || !this.highlighter || this.highlighter.tokenizer !== language.tokenizer) {
            this.highlighter = new IncrementalHighlighter(language.tokenizer);
            this.highlighter.reset(this.buffer.getLines());
        }
        this.styler = new TokenStyler(language.definition, scheme);
        this.paint(0, this.buffer.lineCount - 1);
    }

    private onChanged(edit: TextEdit): void {
        this.sink.spliceLines(edit.firstLine, edit.removedLines, edit.insertedLines);
        if (!this.highlighter) return;
        const range = this.highlighter.update(this.buffer.getLines(), {
            first: edit.firstLine,
            removed: edit.removedLines,
            inserted: edit.insertedLines,
        });
        this.paint(range.first, range.last);
    }

    private paint(first: number, last: number): void {
        const { highlighter, styler } = this;
        if (!highlighter || !styler) return;
        for (let line = first; line <= last; line++) {
            this.sink.paintLine(line, this.buffer.offsetOfLine(line), styler.runsOf(highlighter.tokensOf(line)));
        }
    }
}
