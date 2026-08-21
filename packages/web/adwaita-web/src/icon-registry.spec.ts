// What an icon actually DRAWS — the assertion `adw-icon.spec.ts` did not make.
//
// THE INCIDENT. `_icon.scss` set `background-color: currentColor` plus mask sizing and no
// `mask-image`, so a name outside the compiled `.adw-icon--<name>` set painted a solid 16px
// square in the widget's text colour. Every spec in this package agreed with it: they read
// `classList`, and the class WAS applied — correctly, and to nothing. Measured in Firefox
// before the fix, `<span class="adw-icon adw-icon--dialog-error">` reported
// `mask-image: none` with `background-color: rgb(0, 128, 0)` and a 16x16 box, next to a
// `go-next` control whose mask was an 825-character data URI. That is the whole defect, and
// the reason it survived is that no assertion anywhere read `maskImage`.
//
// So these tests go through `getComputedStyle`. Three states have to stay distinguishable:
// a compiled name draws its own glyph, an unknown name draws `image-missing`, and a name
// that was never given draws nothing at all.
import { describe, expect, it } from '@gjsify/unit';

import { isIconAvailable, registerIcon } from './icon-registry.js';
import type { AdwIcon } from './elements/adw-icon.js';

/** A name no compiled entry can collide with, for the "not shipped" arm. */
const ABSENT = 'gjsify-registry-probe';

/** An Adwaita symbolic SVG, small and distinctive — a filled 8px square in the 16px grid. */
const PROBE_SVG = `<svg height="16px" viewBox="0 0 16 16" width="16px" xmlns="http://www.w3.org/2000/svg">
    <path d="m 4 4 h 8 v 8 h -8 z m 0 0" fill="currentColor"/>
</svg>`;

function mount(iconName: string | null): { el: AdwIcon; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-icon') as AdwIcon;
    if (iconName !== null) el.iconName = iconName;
    host.appendChild(el);
    return { el, host };
}

const maskOf = (el: HTMLElement): string => getComputedStyle(el).maskImage;

/**
 * The `--icon-image-missing` the stylesheet compiles, as the cascade resolves it.
 *
 * Compared by EXACT equality against a computed `mask-image` throughout, which is sound
 * because Firefox serializes both identically — measured, 1336 characters each, byte for
 * byte. A substring test would not be sound: every icon's data URI opens with the same
 * `url("data:image/svg+xml,%3Csvg%20height…` prefix, so a leading slice matches ALL of
 * them, and the first version of this file passed that way while asserting nothing.
 */
function fallbackMask(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--icon-image-missing').trim();
}

export const AdwIconRegistryTest = async () => {
    await describe('<adw-icon> resolves a name to a real mask', async () => {
        await it('a compiled name draws its OWN glyph, not the fallback', () => {
            const { el, host } = mount('go-next');
            const mask = maskOf(el);
            expect(mask.startsWith('url(')).toBe(true);
            // The discriminator. After the fix EVERY icon box has a non-`none` mask, so
            // "has a mask" no longer separates a drawn glyph from a fallen-back one.
            expect(mask).not.toBe(fallbackMask());
            expect(getComputedStyle(el).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
            host.remove();
        });

        await it('an unknown name draws image-missing rather than a solid square', () => {
            const { el, host } = mount(ABSENT);
            // The class IS applied — that was never the bug.
            expect(el.classList.contains(`adw-icon--${ABSENT}`)).toBe(true);
            expect(maskOf(el)).not.toBe('none');
            // …and what it draws is libadwaita's own placeholder, the same glyph GTK's icon
            // theme substitutes for a name it cannot find.
            expect(maskOf(el)).toBe(fallbackMask());
            // Still painted: the fill is what makes the mask visible.
            expect(getComputedStyle(el).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
            host.remove();
        });

        await it('no name at all draws NOTHING — the box is transparent', () => {
            const { el, host } = mount(null);
            expect(el.resolvedIconName).toBe('');
            // `Gtk.Image` with a NULL icon-name renders empty; only a name that was given
            // and could not be resolved earns the broken glyph.
            expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)');
            // The box still occupies its slot, as the GTK image does.
            expect(getComputedStyle(el).width).toBe('16px');
            host.remove();
        });

        await it('a name that is not one CSS token is the nameless case, not the unknown one', () => {
            const { el, host } = mount('a b');
            expect(el.resolvedIconName).toBe('');
            expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)');
            host.remove();
        });
    });

    await describe('a name carried by STATE still resolves', async () => {
        await it("the password row's peek toggle draws both of its glyphs", () => {
            // `check-adwaita-icon-masks.mjs` cannot see these two: they reach
            // `<adw-icon>.iconName` as `state.peekIconName`, a property of the core's
            // `PasswordEntryRowState`, so no literal in the tree spells them at the point
            // of use. The gate says so and this covers what it cannot — measured, not
            // asserted against the same constant the widget writes, which is how
            // `entry-rows.spec.ts` reads `dataset.iconName` and agrees with itself.
            const host = document.createElement('div');
            document.body.appendChild(host);
            const row = document.createElement('adw-password-entry-row') as HTMLElement & { revealed: boolean };
            host.appendChild(row);

            const toggleIcon = row.querySelector('.adw-password-entry-row-toggle .adw-icon') as HTMLElement;
            const masked = maskOf(toggleIcon);
            expect(masked).not.toBe(fallbackMask());

            row.revealed = true;
            const revealed = maskOf(toggleIcon);
            expect(revealed).not.toBe(fallbackMask());
            // …and the two are DIFFERENT glyphs, or one of them is drawing the other's.
            expect(revealed).not.toBe(masked);
            host.remove();
        });
    });

    await describe('registerIcon — the documented way out of the compiled set', async () => {
        await it('reports an unshipped name as unavailable before registration', () => {
            expect(isIconAvailable(ABSENT)).toBe(false);
            // …and a compiled one as available, so the check is not answering `false` to
            // everything. `image-missing` is the case a fallback-comparison would get wrong.
            expect(isIconAvailable('go-next')).toBe(true);
            expect(isIconAvailable('image-missing')).toBe(true);
            expect(isIconAvailable('')).toBe(false);
        });

        await it('makes the name resolve, on an element that is ALREADY mounted', () => {
            const { el, host } = mount(ABSENT);
            const before = maskOf(el);
            expect(before).toBe(fallbackMask());

            registerIcon(ABSENT, PROBE_SVG);

            const after = maskOf(el);
            expect(after).not.toBe(before);
            expect(after).not.toBe(fallbackMask());
            // The glyph really is the SVG that was handed over: `toDataUri` percent-encodes
            // it, so the path data survives as `m%204%204`.
            expect(after.includes('m%204%204')).toBe(true);
            expect(isIconAvailable(ABSENT)).toBe(true);
            host.remove();
        });

        await it('serves an element mounted AFTER the registration too', () => {
            const { el, host } = mount(`${ABSENT}-symbolic`);
            // The `-symbolic` suffix is stripped on both sides, so a consumer may spell the
            // name either way at either end.
            expect(el.resolvedIconName).toBe(ABSENT);
            expect(maskOf(el).includes('m%204%204')).toBe(true);
            host.remove();
        });

        await it('re-registering REPLACES the glyph without a second rule', () => {
            const sheet = (document.getElementById('adwaita-web-icon-registry') as HTMLStyleElement).sheet;
            const rulesBefore = (sheet as CSSStyleSheet).cssRules.length;

            registerIcon(ABSENT, PROBE_SVG.replace('m 4 4 h 8 v 8 h -8 z', 'm 2 2 h 12 v 12 h -12 z'));

            const { el, host } = mount(ABSENT);
            expect(maskOf(el).includes('m%202%202')).toBe(true);
            expect((sheet as CSSStyleSheet).cssRules.length).toBe(rulesBefore);
            host.remove();
        });

        await it('throws on a name that could never be one CSS class', () => {
            // Silently registering nothing is the exact failure this area exists to end, and
            // unlike a render this is an explicit call with a wrong argument.
            expect(() => registerIcon('org.gnome.Builder', PROBE_SVG)).toThrow();
            expect(() => registerIcon('a b', PROBE_SVG)).toThrow();
            expect(() => registerIcon('', PROBE_SVG)).toThrow();
        });
    });
};
