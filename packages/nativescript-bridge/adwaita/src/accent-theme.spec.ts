// The NativeScript accent override generator.
//
// IMPORTANT: this file must NOT import `./widgets/adw-accent.js`. That module
// imports `Application` from `@nativescript/core`, which is unresolvable off-device;
// the generator it calls is the pure `accent-theme.js` exercised here.

import { describe, expect, it } from '@gjsify/unit';

import { ACCENT_COLOR_VECTORS } from '@gjsify/adwaita-core/conformance';
import { adwaitaAccentBgColor, adwaitaAccentColor } from '@gjsify/adwaita-core';
import { ADWAITA_NS_ACCENT_RULES, adwaitaNsAccentColor, adwaitaNsAccentCss } from './widgets/accent-theme.js';

export default async () => {
    await describe('NativeScript accent roles', async () => {
        for (const vector of ACCENT_COLOR_VECTORS) {
            await it(`${vector.name} fills with the palette colour and shades with the derivation`, () => {
                expect(adwaitaNsAccentColor(vector.name, 'fill')).toBe(vector.background);
                // The shade is `min(l, 0.5)` — libadwaita's "this colour, darker".
                // It is NOT the dark-scheme standalone: every shade site in the theme
                // is already scheme-specific through its own selector.
                expect(adwaitaNsAccentColor(vector.name, 'shade')).toBe(vector.standaloneLight);
                expect(adwaitaNsAccentColor(vector.name, 'shade')).not.toBe(vector.standaloneDark);
                // And the third role is that other branch, `max(l, 0.85)`: accent TEXT
                // on a dark page has to go LIGHTER, the opposite of a press fill.
                // Collapsing the two is what left four dark rules unreachable (#1154).
                expect(adwaitaNsAccentColor(vector.name, 'standalone-dark')).toBe(vector.standaloneDark);
            });
        }
    });

    await describe('adwaitaNsAccentCss', async () => {
        await it('emits one rule per accent declaration in the theme', () => {
            const css = adwaitaNsAccentCss('purple');
            const rules = css.split('\n').filter((line) => line.trim().length > 0);
            expect(rules.length).toBe(ADWAITA_NS_ACCENT_RULES.length);
        });

        await it('reproduces each selector VERBATIM', () => {
            // Appended CSS only wins at equal specificity, so a shortened or merged
            // selector would lose to the rule it is meant to replace and the widget
            // would stay blue. Asserted per selector rather than by counting.
            const css = adwaitaNsAccentCss('red');
            for (const rule of ADWAITA_NS_ACCENT_RULES) {
                expect(css.includes(`${rule.selector} {`)).toBe(true);
            }
        });

        await it('paints the chosen accent and nothing of the default', () => {
            const css = adwaitaNsAccentCss('green');
            expect(css.includes(adwaitaAccentBgColor('green'))).toBe(true);
            expect(css.includes(adwaitaAccentColor('green', false))).toBe(true);
            // The literals the theme hardcodes must be gone, or the override is a
            // no-op that looks like a change. `#78aeed` is here because it was the
            // one that WAS a no-op: unclassified, so four dark accent-text rules kept
            // painting blue under every accent (#1154).
            expect(css.includes('#3584e4')).toBe(false);
            expect(css.includes('#1c71d8')).toBe(false);
            expect(css.includes('#78aeed')).toBe(false);
        });

        await it('keeps the dark-scheme selectors scoped', () => {
            // `.ns-dark` prefixed rules must stay prefixed: dropping the scope would
            // repaint the light theme with the dark theme's shade.
            const dark = ADWAITA_NS_ACCENT_RULES.filter((rule) => rule.selector.startsWith('.ns-dark '));
            expect(dark.length).toBeGreaterThan(0);
            const css = adwaitaNsAccentCss('teal');
            for (const rule of dark) expect(css.includes(`${rule.selector} {`)).toBe(true);
        });

        await it('uses every role, so no site is left behind', () => {
            const roles = new Set(ADWAITA_NS_ACCENT_RULES.map((rule) => rule.role));
            expect([...roles].sort()).toStrictEqual(['fill', 'shade', 'standalone-dark']);
        });

        await it('gives the three roles three DIFFERENT colours', () => {
            // A role that resolves to the same colour as another is a role in name
            // only: it would look covered in the table and repaint nothing new. Worth
            // asserting because `shade` and `standalone-dark` are the two branches of
            // one derivation, and passing the wrong boolean silently merges them.
            for (const accent of ['blue', 'orange', 'slate'] as const) {
                const colours = (['fill', 'shade', 'standalone-dark'] as const).map((role) =>
                    adwaitaNsAccentColor(accent, role),
                );
                expect(new Set(colours).size).toBe(3);
            }
        });
    });
};
