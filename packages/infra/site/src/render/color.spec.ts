import { describe, expect, it } from '@gjsify/unit';

import { contrastRatio, parseHex, readableText, relativeLuminance } from './color.js';

export default async () => {
    await describe('brand colour', async () => {
        await it('reads every hex notation AppStream allows, and nothing else', async () => {
            expect(parseHex('#3584e4')).toStrictEqual([0x35, 0x84, 0xe4]);
            expect(parseHex('3584e4')).toStrictEqual([0x35, 0x84, 0xe4]);
            expect(parseHex('#F0C')).toStrictEqual([0xff, 0x00, 0xcc]);
            // The alpha channel is dropped: the masthead is opaque either way.
            expect(parseHex('#3584e480')).toStrictEqual([0x35, 0x84, 0xe4]);
            expect(parseHex('#f0c8')).toStrictEqual([0xff, 0x00, 0xcc]);
            expect(parseHex('#12345')).toBeUndefined();
            expect(parseHex('rebeccapurple')).toBeUndefined();
            expect(parseHex('#12345g')).toBeUndefined();
        });

        await it('measures the WCAG reference pair', async () => {
            expect(relativeLuminance([0, 0, 0])).toBe(0);
            expect(relativeLuminance([255, 255, 255])).toBe(1);
            expect(contrastRatio(1, 0)).toBe(21);
            expect(contrastRatio(0, 1)).toBe(21);
            expect(contrastRatio(0.5, 0.5)).toBe(1);
        });

        await it('picks the text colour the eye can read on the app colour', async () => {
            // Learn6502's yellow and a pale blue want dark text; a deep blue wants white.
            expect(readableText('#f6d32d')).toBe('#10233b');
            expect(readableText('#84bbfd')).toBe('#10233b');
            expect(readableText('#1a5fb4')).toBe('#ffffff');
            expect(readableText('#000000')).toBe('#ffffff');
            expect(readableText('#ffffff')).toBe('#10233b');
        });

        await it('answers white for a colour it cannot read, which is what the page assumed before', async () => {
            expect(readableText('not-a-colour')).toBe('#ffffff');
        });
    });
};
