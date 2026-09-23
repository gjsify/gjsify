// How an authored value becomes `Gtk.Box`'s property — the half both box renderers share,
// held to `conformance/box.ts`. The element half is adwaita-web's `gtk-box.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { DEFAULT_BOX_SPACING, normalizeBoxOrientation, normalizeBoxSpacing } from './box.js';
import { BOX_ORIENTATION_VECTORS, BOX_SPACING_VECTORS } from './conformance/box.js';

export default async () => {
    await describe('normalizeBoxSpacing', async () => {
        await it('defaults to 0, as `Gtk.Box:spacing` does', () => {
            expect(DEFAULT_BOX_SPACING).toBe(0);
        });

        for (const vector of BOX_SPACING_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeBoxSpacing(vector.value)).toBe(vector.spacing);
            });
        }
    });

    await describe('normalizeBoxOrientation', async () => {
        for (const vector of BOX_ORIENTATION_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeBoxOrientation(vector.value)).toBe(vector.orientation);
            });
        }
    });
};
