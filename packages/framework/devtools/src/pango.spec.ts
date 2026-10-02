// @gjsify/devtools — the markup-trap check, pinned against the cases that decide it.
//
// Both halves matter and pull in opposite directions: a bare `&` in a German title has to be
// reported (it renders blank, measured in a consumer app), and markup a caller WROTE — an entity,
// a `<b>` tag — has to pass untouched, because a check that reports those gets switched off.

import { describe, expect, it } from '@gjsify/unit';

import { hasRawPangoMarkup, isPangoMarkupSink, rawPangoMarkupIn } from './pango.js';

export default async () => {
    await describe('hasRawPangoMarkup — what aborts a Pango parse', async () => {
        await it('reports the bare ampersand of a translated title', async () => {
            expect(hasRawPangoMarkup('Kosten & Förderung')).toBe(true);
        });

        await it('reports a bare < and a "<" that opens no tag', async () => {
            expect(hasRawPangoMarkup('a < b')).toBe(true);
            expect(hasRawPangoMarkup('3<4')).toBe(true);
        });

        await it('accepts an entity, in all three spellings Pango knows', async () => {
            expect(hasRawPangoMarkup('Kosten &amp; Förderung')).toBe(false);
            expect(hasRawPangoMarkup('&#38;')).toBe(false);
            expect(hasRawPangoMarkup('&#x26;')).toBe(false);
            // Not one of the five XML entities — Pango takes any named entity.
            expect(hasRawPangoMarkup('a&nbsp;b')).toBe(false);
        });

        await it('accepts markup the author wrote on purpose', async () => {
            expect(hasRawPangoMarkup('<b>Kosten</b> &amp; Ertrag')).toBe(false);
            expect(hasRawPangoMarkup('<span foreground="red">x</span>')).toBe(false);
            expect(hasRawPangoMarkup('<!-- note -->text')).toBe(false);
        });

        await it('leaves ordinary prose alone', async () => {
            expect(hasRawPangoMarkup('Sanierungsplan 2026')).toBe(false);
            expect(hasRawPangoMarkup('')).toBe(false);
            // A single character is a deliberate choice, not an escape accident.
            expect(hasRawPangoMarkup('&')).toBe(false);
        });

        await it('names the raw characters it found, once each', async () => {
            // `toStrictEqual`, not `toEqual`: that one is `==` in this dialect, which an array
            // literal can never satisfy — the elements match, the references do not.
            expect(rawPangoMarkupIn('a & b & c')).toStrictEqual(['&']);
            expect(rawPangoMarkupIn('a & b < c')).toStrictEqual(['&', '<']);
            expect(rawPangoMarkupIn('clean')).toStrictEqual([]);
        });
    });

    await describe('isPangoMarkupSink — the properties that actually parse markup', async () => {
        await it('knows the row family from AdwPreferencesRow:use-markup', async () => {
            for (const row of ['AdwActionRow', 'AdwExpanderRow', 'AdwComboRow', 'AdwSwitchRow']) {
                expect(isPangoMarkupSink(row, 'title')).toBe(true);
                expect(isPangoMarkupSink(row, 'subtitle')).toBe(true);
            }
        });

        await it('knows banner and toast titles, both @default true in the GIR', async () => {
            expect(isPangoMarkupSink('AdwBanner', 'title')).toBe(true);
            expect(isPangoMarkupSink('AdwToast', 'title')).toBe(true);
        });

        await it('does NOT know AdwAlertDialog headings — plain text by default', async () => {
            // The correction that costs a sink list its credibility if it is missing: the GIR says
            // `heading-use-markup` and `body-use-markup` are both @default FALSE.
            expect(isPangoMarkupSink('AdwAlertDialog', 'heading')).toBe(false);
            expect(isPangoMarkupSink('AdwAlertDialog', 'body')).toBe(false);
        });

        await it('does not claim plain-text properties, which is what keeps it usable', async () => {
            expect(isPangoMarkupSink('AdwWindowTitle', 'title')).toBe(false);
            expect(isPangoMarkupSink('AdwEntryRow', 'text')).toBe(false);
            expect(isPangoMarkupSink('AdwActionRow', 'icon-name')).toBe(false);
            expect(isPangoMarkupSink('AdwPreferencesGroup', 'title')).toBe(true);
            expect(isPangoMarkupSink('AdwPreferencesGroup', 'description')).toBe(true);
        });

        await it('knows the about-dialog prose the GIR documents', async () => {
            expect(isPangoMarkupSink('AdwAboutWindow', 'comments')).toBe(true);
            expect(isPangoMarkupSink('AdwAboutWindow', 'license')).toBe(true);
            // Same class, documented as NOT accepting markup.
            expect(isPangoMarkupSink('AdwAboutWindow', 'debug-info')).toBe(false);
            expect(isPangoMarkupSink('AdwAboutWindow', 'website')).toBe(false);
            expect(isPangoMarkupSink('AdwBanner', 'use_markup')).toBe(false);
            expect(isPangoMarkupSink('Unknown', 'title')).toBe(false);
        });
    });
};
