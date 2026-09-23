// What a `Gtk.Label` SHOWS — the markup reduction and the mnemonic — and how an authored
// `xalign`/`justify` becomes the property. Both label renderers (`<gtk-label>` on the web,
// `GtkLabel` on NativeScript) draw through `label.ts`, so it is asserted once, here.
//
// The rows GTK was measured against are `conformance/label.ts`; the hand-written cases
// are the reduction's edges the table does not need to carry.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_LABEL_ELLIPSIZE,
    DEFAULT_LABEL_LINES,
    DEFAULT_LABEL_MAX_WIDTH_CHARS,
    DEFAULT_LABEL_WIDTH_CHARS,
    DEFAULT_LABEL_WRAP_MODE,
    DEFAULT_LABEL_XALIGN,
    DEFAULT_LABEL_YALIGN,
    labelDisplayText,
    labelEffectiveLines,
    labelEllipsizeOverflowValue,
    labelMarkupIsUnparseable,
    labelWidthCharsExtent,
    normalizeLabelEllipsize,
    normalizeLabelJustify,
    normalizeLabelLines,
    normalizeLabelMaxWidthChars,
    normalizeLabelWidthChars,
    normalizeLabelWrapMode,
    normalizeLabelXalign,
    normalizeLabelYalign,
} from './label.js';
import {
    LABEL_CHAR_COUNT_VECTORS,
    LABEL_DISPLAY_TEXT_VECTORS,
    LABEL_EFFECTIVE_LINES_VECTORS,
    LABEL_ELLIPSIZE_OVERFLOW_VECTORS,
    LABEL_ELLIPSIZE_VECTORS,
    LABEL_JUSTIFY_VECTORS,
    LABEL_WIDTH_CHARS_EXTENT_VECTORS,
    LABEL_WRAP_MODE_VECTORS,
    LABEL_XALIGN_VECTORS,
    LABEL_YALIGN_VECTORS,
} from './conformance/label.js';

export default async () => {
    await describe('labelDisplayText — markup off, which is the default', async () => {
        await it('shows the string literally, so a `<` in ordinary prose survives', () => {
            expect(labelDisplayText('a < b', false, false)).toBe('a < b');
            expect(labelDisplayText('<b>Bold</b>', false, false)).toBe('<b>Bold</b>');
        });

        await it('treats an underscore as a literal character', () => {
            expect(labelDisplayText('_Open', false, false)).toBe('_Open');
        });

        await it('takes an absent label as the empty string rather than showing "undefined"', () => {
            expect(labelDisplayText(undefined as unknown as string, false, false)).toBe('');
        });
    });

    await describe('labelDisplayText — markup on: REDUCED to its plain text, never rendered', async () => {
        await it('drops the tags GTK would have drawn', () => {
            expect(labelDisplayText('<b>Bold</b> and <i>italic</i>', true, false)).toBe('Bold and italic');
        });

        await it('resolves the entities, so `&amp;` is one character and not five', () => {
            expect(labelDisplayText('Tea &amp; cake', true, false)).toBe('Tea & cake');
        });

        await it('reduces a span with attributes, the one tag Pango lets carry them', () => {
            expect(labelDisplayText('<span foreground="red">Hot</span>', true, false)).toBe('Hot');
        });

        await it('keeps the RAW string when the markup does not parse, which is the C fallback', () => {
            expect(labelDisplayText('a < b', true, false)).toBe('a < b');
            expect(labelDisplayText('<b>unclosed', true, false)).toBe('<b>unclosed');
            expect(labelDisplayText('<blink>no such tag</blink>', true, false)).toBe('<blink>no such tag</blink>');
        });
    });

    await describe('labelDisplayText — the mnemonic marker is removed, not underlined', async () => {
        await it('takes the underscore out of the shown text', () => {
            expect(labelDisplayText('_Open', false, true)).toBe('Open');
            expect(labelDisplayText('Save _As', false, true)).toBe('Save As');
        });

        await it('reduces the markup FIRST, so an underscore inside a tag is not a mnemonic', () => {
            // `<span font_desc="Sans 12">` parses only while its attribute keeps the
            // underscore. Stripping the mnemonic first would break the tag, and the
            // label would fall back to the raw string — one order renders `Big`, the
            // other renders the whole span source.
            expect(labelDisplayText('<span font_desc="Sans 12">Big</span>', true, true)).toBe('Big');
        });

        await it('leaves a label with no marker alone', () => {
            expect(labelDisplayText('Open', false, true)).toBe('Open');
        });
    });

    await describe('labelMarkupIsUnparseable — the raw-string fallback, reportable', async () => {
        await it('is true exactly when markup is asked for and cannot be reduced', () => {
            expect(labelMarkupIsUnparseable('a < b', true)).toBe(true);
            expect(labelMarkupIsUnparseable('<b>Bold</b>', true)).toBe(false);
        });

        await it('is false whenever markup was not asked for, however the string looks', () => {
            expect(labelMarkupIsUnparseable('a < b', false)).toBe(false);
        });
    });

    await describe('LABEL_DISPLAY_TEXT_VECTORS', async () => {
        for (const vector of LABEL_DISPLAY_TEXT_VECTORS) {
            await it(vector.rule, () => {
                expect(labelDisplayText(vector.label, vector.useMarkup, vector.useUnderline)).toBe(vector.text);
            });
        }
    });

    await describe('normalizeLabelXalign', async () => {
        await it('defaults to 0.5, the pspec default', () => {
            expect(DEFAULT_LABEL_XALIGN).toBe(0.5);
        });

        for (const vector of LABEL_XALIGN_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeLabelXalign(vector.value)).toBe(vector.xalign);
            });
        }
    });

    await describe('normalizeLabelJustify', async () => {
        for (const vector of LABEL_JUSTIFY_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeLabelJustify(vector.value)).toBe(vector.justify);
            });
        }
    });

    await describe('normalizeLabelYalign', async () => {
        await it('defaults to 0.5, the pspec default — same shape as xalign', () => {
            expect(DEFAULT_LABEL_YALIGN).toBe(0.5);
        });

        for (const vector of LABEL_YALIGN_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeLabelYalign(vector.value)).toBe(vector.yalign);
            });
        }
    });

    await describe('normalizeLabelEllipsize', async () => {
        await it('defaults to none, the pspec default', () => {
            expect(DEFAULT_LABEL_ELLIPSIZE).toBe('none');
        });

        for (const vector of LABEL_ELLIPSIZE_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeLabelEllipsize(vector.value)).toBe(vector.ellipsize);
            });
        }
    });

    await describe('labelEllipsizeOverflowValue — the declared divergence both renderers draw', async () => {
        for (const vector of LABEL_ELLIPSIZE_OVERFLOW_VECTORS) {
            await it(vector.rule, () => {
                expect(labelEllipsizeOverflowValue(vector.ellipsize)).toBe(vector.overflow);
            });
        }
    });

    await describe('normalizeLabelWrapMode', async () => {
        await it('defaults to word, the pspec default', () => {
            expect(DEFAULT_LABEL_WRAP_MODE).toBe('word');
        });

        for (const vector of LABEL_WRAP_MODE_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeLabelWrapMode(vector.value)).toBe(vector.wrapMode);
            });
        }
    });

    await describe('normalizeLabelWidthChars / normalizeLabelMaxWidthChars / normalizeLabelLines', async () => {
        await it('all three default to -1, the pspec default ("auto"/unlimited)', () => {
            expect(DEFAULT_LABEL_WIDTH_CHARS).toBe(-1);
            expect(DEFAULT_LABEL_MAX_WIDTH_CHARS).toBe(-1);
            expect(DEFAULT_LABEL_LINES).toBe(-1);
        });

        for (const vector of LABEL_CHAR_COUNT_VECTORS) {
            await it(`width-chars: ${vector.rule}`, () => {
                expect(normalizeLabelWidthChars(vector.value)).toBe(vector.count);
            });
            await it(`max-width-chars: ${vector.rule}`, () => {
                expect(normalizeLabelMaxWidthChars(vector.value)).toBe(vector.count);
            });
            await it(`lines: ${vector.rule}`, () => {
                expect(normalizeLabelLines(vector.value)).toBe(vector.count);
            });
        }
    });

    await describe('labelEffectiveLines — "no effect if not wrapping or ellipsized"', async () => {
        for (const vector of LABEL_EFFECTIVE_LINES_VECTORS) {
            await it(vector.rule, () => {
                expect(labelEffectiveLines(vector.lines, vector.wrap, vector.ellipsize)).toBe(vector.effective);
            });
        }
    });

    await describe('labelWidthCharsExtent', async () => {
        for (const vector of LABEL_WIDTH_CHARS_EXTENT_VECTORS) {
            await it(vector.rule, () => {
                // `toEqual` is `==`, which only ever compares object REFERENCES — the
                // deep-equality matcher here is `toStrictEqual`.
                expect(labelWidthCharsExtent(vector.widthChars, vector.maxWidthChars)).toStrictEqual({
                    minCh: vector.minCh,
                    maxCh: vector.maxCh,
                });
            });
        }
    });
};
