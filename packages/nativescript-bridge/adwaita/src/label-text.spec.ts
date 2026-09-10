// What a `Gtk.Label` SHOWS — the markup reduction and the mnemonic, off-device.
//
// `gtk-label.ts` cannot be imported here (`extends Label` evaluates the bare
// `@nativescript/core` specifier at module eval), so this drives `widgets/label-text.ts`,
// the shipping pure half the widget's `_render` calls.
//
// THE EXPECTATIONS ARE GTK'S, measured under gjs 1.88.1 / gtk 4.22.4 with
// `Gtk.Label.get_text()` read back after each write:
//
//   label 'a < b', use-markup FALSE     'a < b'          literal, and this is the default
//   label '<b>Bold</b>', markup TRUE    'Bold'           GTK RENDERS it bold; this port
//                                                        cannot, so it shows the plain text
//   label 'a < b', markup TRUE          'a < b'          GTK warns and keeps the raw string
//   label '_Open', use-underline TRUE   'Open'           the marker is not shown
//   label '_Open', use-underline FALSE  '_Open'          an underscore is literal by default
//
// The second row is the DECLARED divergence and the reason this file exists: GTK draws
// bold, NativeScript's `Label.text` is literal and there is no parser to hand markup to,
// so the port reduces rather than passing through. The third row is the C fallback.

import { describe, expect, it } from '@gjsify/unit';

import { labelDisplayText, labelMarkupIsUnparseable } from './widgets/label-text.js';

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
};
