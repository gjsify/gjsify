// What an icon actually DRAWS — the assertion `gtk-image.spec.ts` did not make.
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

import { isIconAvailable } from './icon-theme.js';
import type { GtkImage } from './elements/gtk-image.js';

/** A name no compiled entry can collide with, for the "not shipped" arm. */
const ABSENT = 'gjsify-registry-probe';

function mount(iconName: string | null): { el: GtkImage; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-image') as GtkImage;
    if (iconName !== null) el.iconName = iconName;
    host.appendChild(el);
    return { el, host };
}

/**
 * What an icon box actually draws. Exported because the vector-driven icon specs
 * (`adw-action-rows`, `adw-button-content`, `split-button`) need the same discriminator:
 * they used to read `classList` alone, which is green on a correctly-applied class over
 * a glyph nobody has.
 */
export const maskOf = (el: HTMLElement): string => getComputedStyle(el).maskImage;

/**
 * The `--icon-image-missing` the stylesheet compiles, as the cascade resolves it.
 *
 * Compared by EXACT equality against a computed `mask-image` throughout, which is sound
 * because Firefox serializes both identically — measured, 1336 characters each, byte for
 * byte. A substring test would not be sound: every icon's data URI opens with the same
 * `url("data:image/svg+xml,%3Csvg%20height…` prefix, so a leading slice matches ALL of
 * them, and the first version of this file passed that way while asserting nothing.
 */
export function fallbackMask(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--icon-image-missing').trim();
}

export const AdwIconMasksTest = async () => {
    await describe('<gtk-image> resolves a name to a real mask', async () => {
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

        await it('a name that is not one CSS token draws image-missing, not nothing', () => {
            // GTK has no third answer: `gtk_icon_theme_lookup_icon` never returns NULL, so
            // `org.gnome.Builder` on a machine without Builder paints the broken glyph.
            // The web used to paint an invisible hole instead — a VISIBLE 16px slot with
            // nothing in it, since `resolvedIconName === ''` was read as "no icon asked
            // for". Reachable through a first-class attribute: `application-icon` is the
            // application ID by convention (adw-about-dialog.c:1215).
            for (const unusable of ['a b', 'org.gnome.Builder']) {
                const { el, host } = mount(unusable);
                expect(el.resolvedIconName).toBe('');
                expect(maskOf(el)).toBe(fallbackMask());
                expect(getComputedStyle(el).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
                host.remove();
            }
        });
    });

    await describe('a name carried by STATE still resolves', async () => {
        await it("the password row's peek toggle draws both of its glyphs", () => {
            // These two reach `<gtk-image>.iconName` as `state.peekIconName`, a property of
            // the core's `PasswordEntryRowState`, so no literal spells them at the point of
            // use. `check-adwaita-icon-masks.mjs` reads their DECLARATIONS
            // (`PASSWORD_REVEAL_ICON_NAME`), which proves the map entry exists — never that
            // a glyph arrives on the element. That is this test, measured rather than
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

    await describe('isIconAvailable', async () => {
        await it('answers for the compiled set and nothing else', () => {
            expect(isIconAvailable(ABSENT)).toBe(false);
            // …and a compiled one as available, so the check is not answering `false` to
            // everything. `image-missing` is the case a fallback-comparison would get wrong.
            expect(isIconAvailable('go-next')).toBe(true);
            expect(isIconAvailable('image-missing')).toBe(true);
            expect(isIconAvailable('')).toBe(false);
        });
    });
};
