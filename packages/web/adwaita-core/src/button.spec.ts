// The button style-class table, against its own vectors.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_BUTTON_STYLE_CLASSES, buttonStyleClass, buttonStyleClasses } from './button.js';
import { BUTTON_STYLE_CLASS_VECTORS } from './conformance/button.js';

export default async () => {
    await describe('buttonStyleClasses', async () => {
        for (const { names, classes, rule } of BUTTON_STYLE_CLASS_VECTORS) {
            await it(`[${names.join(', ')}] → [${classes.join(', ')}] — ${rule}`, () => {
                expect(buttonStyleClasses(names)).toStrictEqual([...classes]);
            });
        }

        await it('drops a null or undefined name without throwing', () => {
            // Renderers hand in whatever their attribute reader returned, and an
            // absent attribute is `null` in the browser and `undefined` in NS.
            expect(buttonStyleClasses([null, undefined, 'pill'])).toStrictEqual(['pill']);
        });
    });

    await describe('buttonStyleClass', async () => {
        await it('answers null for a name that is not a button style', () => {
            expect(buttonStyleClass('not-a-style')).toBeNull();
            expect(buttonStyleClass('')).toBeNull();
            expect(buttonStyleClass(null)).toBeNull();
        });

        await it('every declared class resolves to itself', () => {
            // The long spellings are what the NativeScript variant hands in, so a
            // class that only resolved from its short alias would break that side.
            for (const cls of ADW_BUTTON_STYLE_CLASSES) expect(buttonStyleClass(cls)).toBe(cls);
        });
    });
};
