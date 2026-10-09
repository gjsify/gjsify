// From a token's `style-ref` to the attributes a renderer paints: language style → `map-to`
// → scheme style (walking `parent-scheme`) → ARGB colours and flags.

import { schemeStyleName } from './tokenizer.js';
import type { Token } from './tokenizer.js';
import type { LanguageDefinition } from './types.js';

import { parseColor } from './color.js';
import type { StyleScheme } from './style-scheme.js';

/** What one run of text looks like. Colours are signed ARGB ints. */
export interface RunStyle {
    readonly foreground?: number;
    readonly background?: number;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strikethrough: boolean;
}

/** `[start, end)` within one line. */
export interface StyledRun {
    readonly start: number;
    readonly end: number;
    readonly style: RunStyle;
}

export class TokenStyler {
    private readonly cache = new Map<string, RunStyle | undefined>();

    constructor(
        private readonly language: LanguageDefinition,
        private readonly scheme: StyleScheme,
    ) {}

    /** `undefined` when the scheme gives the style nothing to paint: the run keeps the text colour. */
    styleFor(tokenStyle: string): RunStyle | undefined {
        if (this.cache.has(tokenStyle)) return this.cache.get(tokenStyle);
        const resolved = this.scheme.getStyle(schemeStyleName(this.language, tokenStyle));
        let style: RunStyle | undefined;
        if (resolved) {
            const foreground = resolved.foreground === undefined ? undefined : parseColor(resolved.foreground);
            const background = resolved.background === undefined ? undefined : parseColor(resolved.background);
            const underline = resolved.underline !== undefined && resolved.underline !== 'none';
            const bold = resolved.bold === true;
            const italic = resolved.italic === true;
            const strikethrough = resolved.strikethrough === true;
            if (foreground !== undefined || background !== undefined || bold || italic || underline || strikethrough) {
                style = { foreground, background, bold, italic, underline, strikethrough };
            }
        }
        this.cache.set(tokenStyle, style);
        return style;
    }

    runsOf(tokens: readonly Token[]): StyledRun[] {
        const runs: StyledRun[] = [];
        for (const token of tokens) {
            const style = this.styleFor(token.style);
            if (style && token.end > token.start) runs.push({ start: token.start, end: token.end, style });
        }
        return runs;
    }
}
