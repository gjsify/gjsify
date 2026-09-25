// `AppleAccentColor` → Adwaita accent. The values are macOS's; the one measured
// end to end is 5, which `defaults read -g AppleAccentColor` printed on macOS 27
// while libadwaita's own reader reported PURPLE for the same setting.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_ACCENT_COLOR_NAMES } from './accent.js';
import { APPLE_ACCENT_COLORS, APPLE_MULTICOLOR_ACCENT, adwAccentFromAppleAccentColor } from './apple-accent.js';

export default async () => {
    await describe('adwAccentFromAppleAccentColor', async () => {
        await it('maps every macOS accent to its Adwaita namesake, graphite to slate', () => {
            const cases: [string, string][] = [
                ['-1', 'slate'],
                ['0', 'red'],
                ['1', 'orange'],
                ['2', 'yellow'],
                ['3', 'green'],
                ['4', 'blue'],
                ['5', 'purple'],
                ['6', 'pink'],
            ];
            for (const [raw, name] of cases) expect(adwAccentFromAppleAccentColor(raw)).toBe(name);
        });

        await it('reads what `defaults read` prints, trailing newline included', () => {
            expect(adwAccentFromAppleAccentColor('5\n')).toBe('purple');
            expect(adwAccentFromAppleAccentColor('  -1 \n')).toBe('slate');
        });

        await it('takes the number itself', () => {
            expect(adwAccentFromAppleAccentColor(3)).toBe('green');
            expect(adwAccentFromAppleAccentColor(-1)).toBe('slate');
        });

        await it('gives blue for Multicolor, where the key is absent', () => {
            expect(adwAccentFromAppleAccentColor(null)).toBe('blue');
            expect(adwAccentFromAppleAccentColor(undefined)).toBe('blue');
            expect(APPLE_MULTICOLOR_ACCENT).toBe('blue');
        });

        await it('gives null for a value macOS does not define, never a guess', () => {
            for (const raw of ['7', '-2', '', '5.0', 'purple', '0x5', '1e0']) {
                expect(adwAccentFromAppleAccentColor(raw)).toBeNull();
            }
            expect(adwAccentFromAppleAccentColor(Number.NaN)).toBeNull();
        });

        await it('only ever names one of the nine Adwaita accents', () => {
            for (const name of Object.values(APPLE_ACCENT_COLORS)) {
                expect((ADW_ACCENT_COLOR_NAMES as readonly string[]).includes(name)).toBe(true);
            }
        });
    });
};
