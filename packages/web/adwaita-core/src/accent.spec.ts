// The accent palette and the OkLab standalone derivation against
// `ACCENT_COLOR_VECTORS` — a table measured against libadwaita 1.9.2 itself, so
// this asserts agreement with upstream rather than with a second reading of it.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_ACCENT_BG_COLORS,
    ADW_ACCENT_COLOR_NAMES,
    ADW_DEFAULT_ACCENT_COLOR,
    adwaitaAccent,
    adwaitaAccentBgColor,
    adwaitaAccentColor,
    adwaitaStandaloneColor,
    formatAdwRgb,
    isAdwAccentColorName,
    nearestAccent,
    onAdwaitaAccentChanged,
    parseAdwRgb,
    setAdwaitaAccent,
} from './accent.js';
import { ACCENT_COLOR_VECTORS, NEAREST_ACCENT_VECTORS } from './conformance/accent.js';

export default async () => {
    await describe('Adwaita accent palette (adw_accent_color_to_rgba)', async () => {
        for (const vector of ACCENT_COLOR_VECTORS) {
            await it(`${vector.name} has libadwaita's background colour`, () => {
                expect(adwaitaAccentBgColor(vector.name)).toBe(vector.background);
            });
        }

        await it('covers exactly the nine AdwAccentColor members, blue first', () => {
            // Blue first because it is `ADW_ACCENT_COLOR_BLUE`, the enum's zero and
            // the documented default — a UI that lists these follows the order.
            expect([...ADW_ACCENT_COLOR_NAMES]).toStrictEqual([
                'blue',
                'teal',
                'green',
                'yellow',
                'orange',
                'red',
                'pink',
                'purple',
                'slate',
            ]);
            expect(Object.keys(ADW_ACCENT_BG_COLORS).length).toBe(9);
            expect(ADW_DEFAULT_ACCENT_COLOR).toBe('blue');
        });
    });

    await describe('adwaitaStandaloneColor (adw_rgba_to_standalone)', async () => {
        for (const vector of ACCENT_COLOR_VECTORS) {
            await it(`${vector.name} darkens for a light surface — min(l, 0.5)`, () => {
                expect(adwaitaAccentColor(vector.name, false)).toBe(vector.standaloneLight);
            });

            await it(`${vector.name} lightens for a dark surface — max(l, 0.85)`, () => {
                expect(adwaitaAccentColor(vector.name, true)).toBe(vector.standaloneDark);
            });
        }

        await it('leaves a colour already past the clamp alone', () => {
            // The clamp is one-sided: `min(l, 0.5)` only ever DARKENS, so black
            // survives the light derivation unchanged. A two-sided implementation
            // would lighten it and pass every accent vector regardless, because
            // all nine accents sit on the clamped side.
            expect(adwaitaStandaloneColor('#000000', false)).toBe('#000000');
            expect(adwaitaStandaloneColor('#ffffff', true)).toBe('#ffffff');
        });

        await it('carries the hue through instead of washing towards grey', () => {
            // Only L is clamped; a and b pass through. Asserted as a property
            // rather than a value: a derivation that dropped a/b would return a
            // grey, and grey has equal channels.
            const derived = adwaitaStandaloneColor('#3584e4', false);
            const [red, green, blue] = [derived.slice(1, 3), derived.slice(3, 5), derived.slice(5, 7)];
            expect(red === green && green === blue).toBe(false);
        });

        await it('returns a malformed colour unchanged rather than guessing', () => {
            expect(adwaitaStandaloneColor('not-a-colour', false)).toBe('not-a-colour');
        });
    });

    await describe('nearestAccent (adw_accent_color_nearest_from_rgba)', async () => {
        await it('maps each of the nine palette colours back to itself', () => {
            // The first loop of libadwaita's own test: GNOME's portal publishes the
            // palette colour of the chosen name, so a round trip that lost one would
            // turn a user's "teal" into something else on every portal read.
            for (const vector of ACCENT_COLOR_VECTORS) {
                expect(nearestAccent(parseAdwRgb(vector.background)!)).toBe(vector.name);
            }
        });

        for (const vector of NEAREST_ACCENT_VECTORS) {
            await it(`${vector.source}: ${vector.color} → ${vector.expected}`, () => {
                expect(nearestAccent(parseAdwRgb(vector.color)!)).toBe(vector.expected);
            });
        }

        await it('treats every low-chroma colour as slate, whatever its lightness', () => {
            // The ladder starts with a chroma test, so a hue computed from noise
            // (atan2 of two near-zero numbers) never decides a grey.
            expect(nearestAccent({ red: 0.5, green: 0.5, blue: 0.5 })).toBe('slate');
            expect(nearestAccent({ red: 0.02, green: 0.02, blue: 0.021 })).toBe('slate');
        });
    });

    await describe('parseAdwRgb / formatAdwRgb', async () => {
        await it('reads the hex and rgb() spellings a system or getComputedStyle hands over', () => {
            expect(formatAdwRgb(parseAdwRgb('#3584e4')!)).toBe('#3584e4');
            expect(formatAdwRgb(parseAdwRgb('#FFF')!)).toBe('#ffffff');
            // What Firefox 156 on macOS serialises `AccentColor` to.
            expect(formatAdwRgb(parseAdwRgb('rgb(0, 122, 255)')!)).toBe('#007aff');
            expect(formatAdwRgb(parseAdwRgb('rgb(0 122 255 / 0.5)')!)).toBe('#007aff');
            expect(formatAdwRgb(parseAdwRgb('rgba(53, 132, 228, 1)')!)).toBe('#3584e4');
        });

        await it('refuses what it cannot read instead of guessing', () => {
            expect(parseAdwRgb('AccentColor')).toBe(null);
            expect(parseAdwRgb('rgb(300, 0, 0)')).toBe(null);
            expect(parseAdwRgb('#12345')).toBe(null);
        });
    });

    await describe('accent observable', async () => {
        await it('starts at the libadwaita default and notifies on change', () => {
            expect(adwaitaAccent()).toBe('blue');

            let notified = 0;
            const unsubscribe = onAdwaitaAccentChanged(() => notified++);

            setAdwaitaAccent('purple');
            expect(adwaitaAccent()).toBe('purple');
            expect(notified).toBe(1);

            // Setting the same value again is a no-op, so a renderer that rebuilds
            // its stylesheet on every notify is not asked to do it twice.
            setAdwaitaAccent('purple');
            expect(notified).toBe(1);

            unsubscribe();
            setAdwaitaAccent('blue');
            expect(notified).toBe(1);
            expect(adwaitaAccent()).toBe('blue');
        });

        await it('recognises exactly the nine names', () => {
            expect(isAdwAccentColorName('slate')).toBe(true);
            expect(isAdwAccentColorName('magenta')).toBe(false);
        });
    });
};
