// DOM-level conformance tests for <adw-avatar>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent copies of the initials + colour
// derivation, and the copies had drifted apart AND away from libadwaita:
// this element rendered "AD" for `text="Ada"` where GTK and NS render "A", and
// both hashed UTF-16 code units where GLib hashes UTF-8 bytes, so every accented
// name was painted the wrong colour. Nothing failed, because nothing compared
// them. This suite is that comparison.
import { describe, expect, it } from '@gjsify/unit';

import { AVATAR_COLORS } from '@gjsify/adwaita-core';
import { AVATAR_COLOR_VECTORS, AVATAR_INITIALS_VECTORS } from '@gjsify/adwaita-core/conformance';

/**
 * Mount an avatar and set `text` through `setAttribute`, never through parsed
 * HTML — several vectors hinge on exact whitespace (a tab, a run of spaces),
 * which an attribute value in markup is not a reliable carrier for.
 */
function mountAvatar(text: string, showInitials = true): { avatar: HTMLElement; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const avatar = document.createElement('adw-avatar');
    if (showInitials) avatar.setAttribute('show-initials', '');
    host.appendChild(avatar);
    avatar.setAttribute('text', text);
    return { avatar, host };
}

/** The rendered initials, i.e. what a user actually sees in the circle. */
function renderedInitials(avatar: HTMLElement): string {
    const text = avatar.querySelector('.adw-avatar-text') as HTMLElement | null;
    if (!text || text.hidden) return '';
    return text.textContent ?? '';
}

/** `#rrggbb` in the `rgb(r, g, b)` form the CSSOM serialises inline styles to. */
function asRgb(hex: string): string {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

export const AdwAvatarTest = async () => {
    await describe('adw-avatar initials (libadwaita conformance vectors)', async () => {
        for (const { text, initials, rule } of AVATAR_INITIALS_VECTORS) {
            await it(`${JSON.stringify(text)} renders ${JSON.stringify(initials)} — ${rule}`, () => {
                const { avatar, host } = mountAvatar(text);
                expect(renderedInitials(avatar)).toBe(initials);
                host.remove();
            });
        }

        await it('falls back to the icon when there are no initials', () => {
            const { avatar, host } = mountAvatar('');
            expect(renderedInitials(avatar)).toBe('');
            const icon = avatar.querySelector('.adw-avatar-icon') as HTMLElement;
            expect(icon.hidden).toBe(false);
            host.remove();
        });

        await it('shows the icon when show-initials is absent, even with a name', () => {
            const { avatar, host } = mountAvatar('Ada Lovelace', false);
            expect(renderedInitials(avatar)).toBe('');
            host.remove();
        });
    });

    await describe('adw-avatar colour (libadwaita conformance vectors)', async () => {
        for (const { text, colorClass } of AVATAR_COLOR_VECTORS) {
            // A blank name renders no initials, so no colour is painted either —
            // those rows are covered by the core suite instead.
            if (text.trim().length === 0) continue;

            await it(`${JSON.stringify(text)} paints color${colorClass}`, () => {
                const { avatar, host } = mountAvatar(text);
                const palette = AVATAR_COLORS[colorClass - 1]!;
                expect(avatar.style.backgroundImage).toBe(
                    `linear-gradient(${asRgb(palette.start)}, ${asRgb(palette.stop)})`,
                );
                expect(avatar.style.color).toBe(asRgb(palette.fg));
                host.remove();
            });
        }

        await it('drops the gradient again when the avatar falls back to its icon', () => {
            const { avatar, host } = mountAvatar('Ada Lovelace');
            expect(avatar.style.backgroundImage).not.toBe('');
            avatar.removeAttribute('show-initials');
            expect(avatar.style.backgroundImage).toBe('');
            host.remove();
        });
    });
};
