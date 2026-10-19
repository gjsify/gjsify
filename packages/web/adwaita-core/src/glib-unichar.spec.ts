// The GLib unichar helper of the core against the shared vectors.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_UNICHAR_VECTORS, driveGLibUnicharVectors } from './conformance/glib-unichar.js';
import { unicharIsalpha } from './glib-unichar.js';

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
    });
};
