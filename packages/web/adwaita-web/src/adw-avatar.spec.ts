// DOM-level conformance tests for <adw-avatar>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// Two rules independent copies of the initials + colour derivation drifted from: GTK
// takes ONE initial from a single-word `text`, and the colour hash runs over UTF-8 BYTES
// as GLib's does — hashing UTF-16 code units paints every accented name the wrong
// colour.
import { describe, expect, it } from '@gjsify/unit';

import { AVATAR_MODE_VECTORS } from '@gjsify/adwaita-core/conformance';

import { AVATAR_COLORS, avatarMaxFontSize } from '@gjsify/adwaita-core';
import {
    AVATAR_COLOR_VECTORS,
    AVATAR_FONT_SIZE_VECTORS,
    AVATAR_ICON_SIZE_VECTORS,
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

    await describe('adw-avatar fallback glyph size (adw-avatar.c:756)', async () => {
        for (const { size, iconSize } of AVATAR_ICON_SIZE_VECTORS) {
            await it(`size ${size} draws the glyph at ${iconSize}`, () => {
                // Through the ELEMENT, not the helper: the box was hand-typed here as
                // `round(size * 0.55)` and drew ~10% larger than GTK at every size,
                // with nothing in a position to say so.
                const { avatar, host } = mountAvatar('Ada Lovelace', false);
                avatar.setAttribute('size', String(size));
                const icon = avatar.querySelector('.adw-avatar-icon') as HTMLElement;
                expect(icon.hidden).toBe(false);
                expect(icon.getAttribute('size')).toBe(String(iconSize));
                host.remove();
            });
        }
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
        // A 1x1 transparent GIF: a real, decodable image, so `custom-image` is
        // exercised through the same path a photo would take — and no network.
        const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        for (const { hasCustomImage, showInitials, text, mode, rule } of AVATAR_MODE_VECTORS) {
            await it(`image=${hasCustomImage} initials=${showInitials} "${text}" → ${mode} — ${rule}`, () => {
                const host = document.createElement('div');
                document.body.appendChild(host);
                const avatar = document.createElement('adw-avatar');
                if (showInitials) avatar.setAttribute('show-initials', '');
                if (text) avatar.setAttribute('text', text);
                if (hasCustomImage) avatar.setAttribute('custom-image', PIXEL);
                host.appendChild(avatar);

                // Exactly ONE of the three modes is drawn — the point of the
                // table is the precedence, and "two visible at once" is the
                // failure it guards against.
                const initials = (avatar.querySelector('.adw-avatar-text') as HTMLElement).hidden === false;
                const icon = (avatar.querySelector('.adw-avatar-icon') as HTMLElement).hidden === false;
                const image = (avatar.querySelector('.adw-avatar-custom-image') as HTMLElement).hidden === false;
                expect(initials).toBe(mode === 'initials');
                expect(icon).toBe(mode === 'icon');
                expect(image).toBe(mode === 'image');
                host.remove();
            });
        }

        await it('drops the custom image again when the attribute goes away', () => {
            // The mode is re-derived on every attribute change, so removing the
            // image has to fall back to whichever mode the remaining state picks
            // — this is where a port that only ever ADDS the image node fails.
            const host = document.createElement('div');
            document.body.appendChild(host);
            const avatar = document.createElement('adw-avatar');
            avatar.setAttribute('show-initials', '');
            avatar.setAttribute('text', 'Ada Lovelace');
            avatar.setAttribute('custom-image', PIXEL);
            host.appendChild(avatar);

            expect((avatar.querySelector('.adw-avatar-custom-image') as HTMLElement).hidden).toBe(false);

            avatar.removeAttribute('custom-image');
            expect((avatar.querySelector('.adw-avatar-custom-image') as HTMLElement).hidden).toBe(true);
            expect((avatar.querySelector('.adw-avatar-text') as HTMLElement).hidden).toBe(false);

            host.remove();
        });

        await it('fills the circle with the image rather than letterboxing it', () => {
            // `object-fit` is the whole reason the image looks like an avatar and
            // not like a photo in a round frame — a class-name assertion cannot
            // see it, and it is one word away from being wrong.
            const host = document.createElement('div');
            document.body.appendChild(host);
            const avatar = document.createElement('adw-avatar');
            avatar.setAttribute('custom-image', PIXEL);
            avatar.setAttribute('size', '64');
            host.appendChild(avatar);

            const image = avatar.querySelector('.adw-avatar-custom-image') as HTMLElement;
            expect(getComputedStyle(image).objectFit).toBe('cover');
            expect(Math.round(image.getBoundingClientRect().width)).toBe(64);

            host.remove();
        });
    });
};
