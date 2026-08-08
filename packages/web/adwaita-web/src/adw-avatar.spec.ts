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

import { AVATAR_MODE_VECTORS } from '@gjsify/adwaita-core/conformance';

import { AVATAR_COLORS, avatarMaxFontSize } from '@gjsify/adwaita-core';
import {
    AVATAR_COLOR_VECTORS,
    AVATAR_FONT_SIZE_VECTORS,
    AVATAR_INITIALS_VECTORS,
} from '@gjsify/adwaita-core/conformance';

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
            // Only a genuinely EMPTY name drops to icon mode; a whitespace-only
            // one stays in initials mode (blank label) and is still painted, so
            // it belongs in this loop.
            if (text.length === 0) continue;

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
    await describe('adw-avatar font size (Adw.Avatar update_font_size)', async () => {
        for (const { size, maxFontSize } of AVATAR_FONT_SIZE_VECTORS) {
            await it(`size ${size} never exceeds the ${maxFontSize}px cap`, () => {
                const { avatar, host } = mountAvatar('Ada Lovelace');
                avatar.setAttribute('size', String(size));
                const label = avatar.querySelector('.adw-avatar-text') as HTMLElement;
                const applied = Number.parseFloat(label.style.fontSize);
                // The measured aspect ratio decides the exact value; what the
                // element must never do is overflow the circle.
                expect(applied <= avatarMaxFontSize(size) + 0.001).toBe(true);
                expect(applied > 0).toBe(true);
                host.remove();
            });
        }

        await it('grows monotonically across the old 31px/32px discontinuity', () => {
            const { avatar, host } = mountAvatar('Ada Lovelace');
            const label = avatar.querySelector('.adw-avatar-text') as HTMLElement;
            const at = (size: number) => {
                avatar.setAttribute('size', String(size));
                return Number.parseFloat(label.style.fontSize);
            };
            // The old heuristic returned 16px at 31 and 13px at 32.
            expect(at(32) >= at(31)).toBe(true);
            expect(at(64) >= at(48)).toBe(true);
            host.remove();
        });
    });

    await describe('adw-avatar mode (Adw.Avatar update_visibility)', async () => {
        await it('keeps a whitespace-only name in initials mode with a blank label', () => {
            const { avatar, host } = mountAvatar('   ');
            const label = avatar.querySelector('.adw-avatar-text') as HTMLElement;
            const icon = avatar.querySelector('.adw-avatar-icon') as HTMLElement;
            // libadwaita gates on strlen(text), not on the derived initials.
            expect(label.hidden).toBe(false);
            expect(label.textContent).toBe('');
            expect(icon.hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-avatar> mode (update_visibility, adw-avatar.c:117)', async () => {
        // The `hasCustomImage` rows are not reachable through this element: it
        // passes `hasCustomImage: false` unconditionally, because it has no
        // custom-image support at all — `Adw.Avatar:custom-image` is unported.
        // Named below rather than silently filtered.
        for (const { hasCustomImage, showInitials, text, mode, rule } of AVATAR_MODE_VECTORS) {
            if (hasCustomImage) continue;
            await it(`initials=${showInitials} "${text}" → ${mode} — ${rule}`, () => {
                const host = document.createElement('div');
                document.body.appendChild(host);
                const avatar = document.createElement('adw-avatar');
                if (showInitials) avatar.setAttribute('show-initials', '');
                if (text) avatar.setAttribute('text', text);
                host.appendChild(avatar);

                // Exactly ONE of the two reachable modes is drawn — the point of
                // the table is the precedence, and "both visible at once" is the
                // failure it guards against.
                const initials = (avatar.querySelector('.adw-avatar-text') as HTMLElement).hidden === false;
                const icon = (avatar.querySelector('.adw-avatar-icon') as HTMLElement).hidden === false;
                expect(initials).toBe(mode === 'initials');
                expect(icon).toBe(mode === 'icon');
                host.remove();
            });
        }

        await it('leaves out only the custom-image rows, which this element cannot reach', () => {
            const unreachable = AVATAR_MODE_VECTORS.filter((vector) => vector.hasCustomImage);
            expect(unreachable.length).toBeGreaterThan(0);
            // Every one of them is an `image` outcome, i.e. the whole mode is
            // missing rather than a corner of it.
            for (const vector of unreachable) expect(vector.mode).toBe('image');
        });
    });
};
