// Avatar derivation specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import {
    AVATAR_COLOR_COUNT,
    AVATAR_COLORS,
    avatarColor,
    avatarColorClass,
    avatarInitials,
    flattenAvatarGradient,
    gStrHash,
    randomAvatarColorClass,
} from './avatar.js';
import { AVATAR_COLOR_VECTORS, AVATAR_INITIALS_VECTORS } from './conformance/avatar.js';

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
