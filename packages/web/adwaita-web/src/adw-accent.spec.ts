// Accent application against `ACCENT_COLOR_VECTORS` — the same table the core
// suite drives, here through the REAL computed style of a real element.
//
// This is what makes the table renderer-driven rather than a derivation asserted
// against itself: the browser resolves the custom properties and the assertions
// read them back with `getComputedStyle`, so a value that never reaches the
// cascade fails a test naming the accent.
import { describe, expect, it } from '@gjsify/unit';
import { ACCENT_COLOR_VECTORS } from '@gjsify/adwaita-core/conformance';

import '@gjsify/adwaita-web';
import {
    ACCENT_BG_PROPERTY,
    ACCENT_PROPERTY,
    applyAdwaitaAccent,
    clearAdwaitaAccent,
    isAdwaitaDark,
} from './accent.js';

/** A custom property's resolved value, whitespace trimmed. */
const property = (element: HTMLElement, name: string): string =>
    getComputedStyle(element).getPropertyValue(name).trim();

export const AdwAccentTest = async () => {
    await describe('applyAdwaitaAccent (conformance vectors)', async () => {
        for (const vector of ACCENT_COLOR_VECTORS) {
            await it(`${vector.name} — the fill and the light standalone colour reach the cascade`, async () => {
                const host = document.createElement('div');
                host.className = 'theme-light';
                document.body.append(host);

                applyAdwaitaAccent(vector.name, { target: host });

                expect(property(host, ACCENT_BG_PROPERTY)).toBe(vector.background);
                expect(property(host, ACCENT_PROPERTY)).toBe(vector.standaloneLight);

                host.remove();
            });

            await it(`${vector.name} — the DARK standalone colour differs and is the table's`, async () => {
                // Asserted as a pair: a renderer that ignored `dark` would pass
                // every light row above and still be wrong in half its uses.
                const host = document.createElement('div');
                host.className = 'theme-dark';
                document.body.append(host);

                applyAdwaitaAccent(vector.name, { target: host });

                expect(property(host, ACCENT_PROPERTY)).toBe(vector.standaloneDark);
                expect(vector.standaloneDark).not.toBe(vector.standaloneLight);

                host.remove();
            });
        }
    });

    await describe('accent application', async () => {
        await it('reads the resolved scheme from the element rather than assuming light', async () => {
            const dark = document.createElement('div');
            dark.className = 'theme-dark';
            const light = document.createElement('div');
            light.className = 'theme-light';
            document.body.append(dark, light);

            expect(isAdwaitaDark(dark)).toBe(true);
            expect(isAdwaitaDark(light)).toBe(false);

            // A nested element inherits the ancestor's scheme — `closest`, not a
            // class check on the element itself, which is how the stylesheet's
            // `.theme-dark` scope actually behaves.
            const nested = document.createElement('span');
            dark.append(nested);
            expect(isAdwaitaDark(nested)).toBe(true);

            dark.remove();
            light.remove();
        });

        await it('an explicit dark option overrides what the element resolves to', async () => {
            const host = document.createElement('div');
            host.className = 'theme-light';
            document.body.append(host);

            applyAdwaitaAccent('blue', { target: host, dark: true });
            expect(property(host, ACCENT_PROPERTY)).toBe(ACCENT_COLOR_VECTORS[0].standaloneDark);

            host.remove();
        });

        await it('clearing restores the stylesheet value instead of leaving the override', async () => {
            const host = document.createElement('div');
            host.className = 'theme-light';
            document.body.append(host);

            applyAdwaitaAccent('red', { target: host });
            expect(property(host, ACCENT_BG_PROPERTY)).toBe(ACCENT_COLOR_VECTORS[5].background);

            clearAdwaitaAccent(host);
            // Back to whatever the cascade says — which is NOT red.
            expect(property(host, ACCENT_BG_PROPERTY)).not.toBe(ACCENT_COLOR_VECTORS[5].background);

            host.remove();
        });
    });
};
