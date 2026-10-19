// The GLib unichar helper of the core against the shared vectors.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_UNICHAR_VECTORS, driveGLibUnicharVectors } from './conformance/glib-unichar.js';
import { unicharIsalpha, unicharIsprint } from './glib-unichar.js';

export default async () => {
    await driveGLibUnicharVectors(
        { name: 'adwaita-core', isOracle: false, GLib: { unichar_isalpha: unicharIsalpha } },
        { describe, it, expect },
        GLIB_UNICHAR_VECTORS,
    );

    await describe('adwaita-core: GLib unichar', async () => {
        await it('reads the first code point and answers false for the empty string', () => {
            expect(unicharIsalpha('a1')).toBe(true);
            expect(unicharIsalpha('1a')).toBe(false);
            expect(unicharIsalpha('')).toBe(false);
        });
        await it('answers the table edges', () => {
            expect(unicharIsalpha('\u{0}')).toBe(false);
            expect(unicharIsalpha('@')).toBe(false);
            expect(unicharIsalpha('[')).toBe(false);
            expect(unicharIsalpha('\u{10FFFF}')).toBe(false);
        });
        await it('answers g_unichar_isprint from the second table', () => {
            expect(unicharIsprint('a')).toBe(true);
            expect(unicharIsprint(' ')).toBe(true);
            expect(unicharIsprint('\u00a0')).toBe(true);
            expect(unicharIsprint('\ue000')).toBe(true);
            expect(unicharIsprint('\u0000')).toBe(false);
            expect(unicharIsprint('\u00ad')).toBe(false);
            expect(unicharIsprint('\u0378')).toBe(false);
            expect(unicharIsprint('\ufdd0')).toBe(false);
            expect(unicharIsprint('\ud800')).toBe(false);
            expect(unicharIsprint('\u{10ffff}')).toBe(false);
            expect(unicharIsprint('')).toBe(false);
        });
    });
};
