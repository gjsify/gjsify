// The three decoding contexts, driven with the SAME input where they disagree —
// a context that is not load-bearing would pass this file by accident, so every
// contrast is asserted as a pair.

import { describe, expect, it } from '@gjsify/unit';

import { NAMED_REFERENCES } from './entities/data.js';
import { decodeAttributeValue, decodeText, decodeXml } from './entities/decode.js';

const REPLACEMENT = '�';
// Spelled by code point: both are invisible in a source file, and an editor that
// helpfully normalises one into the other would silently rewrite the assertion.
const NBSP = String.fromCharCode(0xa0);
const C1_EURO = String.fromCharCode(0x80);

export default async () => {
    await describe('entity table', async () => {
        await it('carries the whole spec table, not a popular subset', async () => {
            // The discriminator for every other case in this file: an empty table
            // would make each single lookup pass the input through unchanged, and
            // nothing below would redden.
            expect(Object.keys(NAMED_REFERENCES).length).toBeGreaterThan(2000);
            expect(NAMED_REFERENCES['hellip;']).toBe('…');
            expect(NAMED_REFERENCES['nbsp;']).toBe(NBSP);
        });
    });

    await describe('decodeText', async () => {
        await it('decodes the numeric forms measured on a real page', async () => {
            expect(decodeText('28&#034; Reifen')).toBe('28" Reifen');
            expect(decodeText('&#x2F;')).toBe('/');
            expect(decodeText('3.550&nbsp;&euro; VB')).toBe('3.550' + NBSP + '€ VB');
            expect(decodeText('Gr&uuml;&szlig;e &hellip;')).toBe('Grüße …');
        });

        await it('remaps the C1 range to what authors meant', async () => {
            // `&#128;` is U+0080 by the numbers and `€` in every browser, because
            // a decade of Windows-1252 in the wild outvoted the code point.
            expect(decodeText('&#128;')).toBe('€');
            expect(decodeText('&#149;')).toBe('•');
        });

        await it('replaces the code points that are not characters', async () => {
            expect(decodeText('&#xD800;')).toBe(REPLACEMENT);
            expect(decodeText('&#x110000;')).toBe(REPLACEMENT);
            expect(decodeText('&#0;')).toBe(REPLACEMENT);
            expect(decodeText('&#99999999999999999999;')).toBe(REPLACEMENT);
        });

        await it('accepts a legacy reference without its semicolon', async () => {
            expect(decodeText('AT&amp T')).toBe('AT& T');
            expect(decodeText('a &lt b')).toBe('a < b');
        });

        await it('leaves a lone ampersand alone', async () => {
            expect(decodeText('a & b')).toBe('a & b');
            expect(decodeText('&notareference;')).toBe('¬areference;');
            expect(decodeText('&')).toBe('&');
        });
    });

    await describe('decodeAttributeValue', async () => {
        await it('refuses a semicolon-less name that a query string continues', async () => {
            // The live scraping trap: with the text rule this becomes `?a=1©=2`,
            // a URL that looks parsed and points nowhere.
            expect(decodeAttributeValue('?a=1&copy=2')).toBe('?a=1&copy=2');
            expect(decodeAttributeValue('?a=1&ampere=2')).toBe('?a=1&ampere=2');
        });

        await it('decodes the very same names when they are terminated', async () => {
            expect(decodeAttributeValue('?a=1&copy;=2')).toBe('?a=1©=2');
            expect(decodeText('?a=1&copy=2')).toBe('?a=1©=2');
        });

        await it('decodes numeric references in attributes too', async () => {
            expect(decodeAttributeValue('a&#38;b')).toBe('a&b');
            expect(decodeAttributeValue('&#x20AC;9')).toBe('€9');
        });
    });

    await describe('decodeXml', async () => {
        await it('decodes the five predefined names', async () => {
            expect(decodeXml('a &amp; b')).toBe('a & b');
            expect(decodeXml('start &gt; here')).toBe('start > here');
            expect(decodeXml('&lt;tag&gt;')).toBe('<tag>');
            expect(decodeXml('&quot;q&quot; &apos;a&apos;')).toBe('"q" \'a\'');
        });

        await it('knows no HTML name — the same input, the opposite answer', async () => {
            expect(decodeXml('3.550&nbsp;&euro;')).toBe('3.550&nbsp;&euro;');
            expect(decodeText('3.550&nbsp;&euro;')).toBe('3.550' + NBSP + '€');
        });

        await it('requires the semicolon', async () => {
            expect(decodeXml('AT&amp T')).toBe('AT&amp T');
            expect(decodeXml('&#34')).toBe('&#34');
            expect(decodeXml('&#34;')).toBe('"');
        });

        await it('does not remap the C1 range — XML never did', async () => {
            expect(decodeXml('&#128;')).toBe(C1_EURO);
            expect(decodeText('&#128;')).toBe('€');
        });
    });
};
