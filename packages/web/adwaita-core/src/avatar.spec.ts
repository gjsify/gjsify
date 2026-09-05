// Avatar derivation specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import {
    AVATAR_COLOR_COUNT,
    AVATAR_COLORS,
    avatarColor,
    avatarColorClass,
    avatarFontSize,
    avatarIconSize,
    avatarInitials,
    avatarMaxFontSize,
    avatarMode,
    flattenAvatarGradient,
    gStrHash,
    randomAvatarColorClass,
} from './avatar.js';
import { glibClamp } from './glib.js';
import {
    AVATAR_COLOR_VECTORS,
    AVATAR_FONT_SIZE_VECTORS,
    AVATAR_ICON_SIZE_VECTORS,
    AVATAR_INITIALS_VECTORS,
    AVATAR_MODE_VECTORS,
} from './conformance/avatar.js';

export default async () => {
    await describe('avatarInitials (Adw.Avatar extract_initials_from_text)', async () => {
        for (const { text, initials, rule } of AVATAR_INITIALS_VECTORS) {
            await it(`${JSON.stringify(text)} → ${JSON.stringify(initials)} — ${rule}`, () => {
                expect(avatarInitials(text)).toBe(initials);
            });
        }

        await it('takes a whole code point, not a UTF-16 unit', () => {
            // U+1D49C MATHEMATICAL SCRIPT CAPITAL A is a surrogate pair and has
            // no case mapping; a charAt(0)-based port returns half of it.
            expect(avatarInitials('\u{1D49C}da')).toBe('\u{1D49C}');
            expect([...avatarInitials('\u{1D49C}da')]).toHaveLength(1);
        });

        await it('leaves NBSP alone — g_strstrip trims ASCII space only', () => {
            // String.trim() would strip the U+00A0 and yield 'A'.
            expect(avatarInitials('\u00A0Ada')).toBe('\u00A0');
        });
    });

    await describe('gStrHash + avatarColorClass (Adw.Avatar set_class_color)', async () => {
        for (const { text, hash, colorClass } of AVATAR_COLOR_VECTORS) {
            await it(`${JSON.stringify(text)} → hash ${hash}, color${colorClass}`, () => {
                expect(gStrHash(text)).toBe(hash);
                expect(avatarColorClass(text)).toBe(colorClass);
            });
        }

        await it('hashes UTF-8 bytes as signed char, not UTF-16 units', () => {
            // The regression that motivated the lift: reading code units gave
            // 'Müller' a different hash, hence a different avatar colour.
            const utf16Units = (() => {
                let h = 5381;
                for (let i = 0; i < 'Müller'.length; i++) h = (Math.imul(h, 33) + 'Müller'.charCodeAt(i)) >>> 0;
                return h;
            })();
            expect(gStrHash('Müller')).not.toBe(utf16Units);
        });

        await it('stops at an embedded NUL like the C loop does', () => {
            expect(gStrHash('Ada\0Lovelace')).toBe(gStrHash('Ada'));
        });

        await it('returns null for a blank name (libadwaita randomises there)', () => {
            expect(avatarColorClass('')).toBe(null);
        });

        await it('keeps every class inside the palette', () => {
            for (const { text } of AVATAR_COLOR_VECTORS) {
                const cls = avatarColorClass(text)!;
                expect(cls >= 1 && cls <= AVATAR_COLOR_COUNT).toBe(true);
            }
            expect(AVATAR_COLORS).toHaveLength(AVATAR_COLOR_COUNT);
        });
    });

    await describe('avatarMaxFontSize / avatarFontSize (Adw.Avatar update_font_size)', async () => {
        for (const { size, maxFontSize, legacyWebGuess } of AVATAR_FONT_SIZE_VECTORS) {
            await it(`size ${size} caps the initials at ${maxFontSize}px`, () => {
                expect(avatarMaxFontSize(size)).toBeCloseTo(maxFontSize, 2);
            });

            await it(`size ${size}: the old browser guess (${legacyWebGuess}px) is judged by the cap`, () => {
                // Records which sizes the pre-lift heuristic overflowed at, so a
                // future "simplification" back to it fails right here.
                const overflows = legacyWebGuess > avatarMaxFontSize(size);
                expect(overflows).toBe([28, 31, 64, 128].includes(size));
            });
        }

        await it('is monotonic — a bigger circle never gets smaller initials', () => {
            // One assertion, not 300: report every regression at once and name
            // the sizes. The old heuristic broke exactly here (31px -> 32px).
            const regressions: number[] = [];
            let previous = -1;
            for (let size = 1; size <= 300; size++) {
                const cap = avatarMaxFontSize(size);
                if (cap < previous) regressions.push(size);
                previous = cap;
            }
            expect(regressions).toStrictEqual([]);
        });

        await it('scales by the measured aspect ratio, clamped to the cap', () => {
            const cap = avatarMaxFontSize(48);
            expect(avatarFontSize(48, { width: 20, height: 20 })).toBeCloseTo(cap, 6);
            expect(avatarFontSize(48, { width: 40, height: 20 })).toBeCloseTo(cap / 2, 6);
            // Tall text would exceed the cap, so CLAMP holds it there.
            expect(avatarFontSize(48, { width: 10, height: 40 })).toBeCloseTo(cap, 6);
        });

        await it('falls back to the cap when nothing has been measured yet', () => {
            expect(avatarFontSize(48, { width: 0, height: 0 })).toBeCloseTo(avatarMaxFontSize(48), 6);
        });
    });

    await describe('avatarIconSize (adw_avatar_set_size, adw-avatar.c:756)', async () => {
        for (const { size, iconSize } of AVATAR_ICON_SIZE_VECTORS) {
            await it(`size ${size} -> ${iconSize} — gtk_image_set_pixel_size(icon, size / 2)`, () => {
                expect(avatarIconSize(size)).toBe(iconSize);
            });
        }

        await it('never draws the glyph outside the circle it sits in', () => {
            // A box larger than the inscribed square `size / 1.4142` sticks out of a
            // round avatar. The C's half-size clears it; the `round(size * 0.55)` this
            // replaced also did, which is why the bound alone never noticed the drift.
            const outside: number[] = [];
            for (let size = 16; size <= 256; size++) {
                if (avatarIconSize(size) > size / 1.4142) outside.push(size);
            }
            expect(outside).toStrictEqual([]);
        });

        await it('is monotonic and integral', () => {
            const regressions: number[] = [];
            let previous = -1;
            for (let size = 16; size <= 256; size++) {
                const box = avatarIconSize(size);
                if (box < previous || !Number.isInteger(box)) regressions.push(size);
                previous = box;
            }
            expect(regressions).toStrictEqual([]);
        });
    });

    await describe('avatarMode (Adw.Avatar update_visibility)', async () => {
        for (const { hasCustomImage, showInitials, text, mode, rule } of AVATAR_MODE_VECTORS) {
            await it(`${JSON.stringify({ hasCustomImage, showInitials, text })} -> ${mode} — ${rule}`, () => {
                expect(avatarMode({ hasCustomImage, showInitials, text })).toBe(mode);
            });
        }
    });

    await describe('glibClamp', async () => {
        await it('matches Math.min/max while the bounds are sane', () => {
            expect(glibClamp(5, 0, 10)).toBe(5);
            expect(glibClamp(-1, 0, 10)).toBe(0);
            expect(glibClamp(11, 0, 10)).toBe(10);
        });

        await it('tests the HIGH bound first, so inverted bounds differ', () => {
            // GLib returns the LOW bound here; Math.min(high, Math.max(low, x))
            // returns the high one. Adwaita reaches inverted bounds for real.
            const [x, low, high] = [5, 10, 8];
            expect(glibClamp(x, low, high)).toBe(10);
            expect(Math.min(high, Math.max(low, x))).toBe(8);
        });
    });

    await describe('avatarColor / randomAvatarColorClass / flattenAvatarGradient', async () => {
        await it('maps the 1-based class onto the 0-based palette', () => {
            for (const { text, colorClass } of AVATAR_COLOR_VECTORS) {
                expect(avatarColor(text)).toBe(AVATAR_COLORS[colorClass - 1]!);
            }
        });

        await it('reproduces g_rand_int_range(1, 14) — never reaching color14', () => {
            expect(randomAvatarColorClass(() => 0)).toBe(1);
            // 0.999… is the highest value a random source returns.
            expect(randomAvatarColorClass(() => 0.999999)).toBe(AVATAR_COLOR_COUNT - 1);
        });

        await it('blends a gradient to its midpoint for gradient-less renderers', () => {
            expect(flattenAvatarGradient({ fg: '#ffffff', start: '#000000', stop: '#ffffff' })).toBe('#808080');
            expect(flattenAvatarGradient(AVATAR_COLORS[0]!)).toBe('#5b9be4');
        });
    });
};
