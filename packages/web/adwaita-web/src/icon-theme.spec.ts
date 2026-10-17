// The colour half of the icon theme, measured through `getComputedStyle` like
// `icon-masks.spec.ts` measures the symbolic half: a class on the node proves nothing
// about what it paints.
//
// The order under test is GLib's (`g_themed_icon_update_names`, which `GtkImage`'s lookup
// goes through): `X` tries [X, X-symbolic], `X-symbolic` tries [X-symbolic, X], and a name
// neither answers draws `image-missing`. Over the names the order is gtkicontheme.c's: the
// current theme (the stylesheet's glyphs) before hicolor, where an app's resource files sit.
// Colour icons come from the shared GResource fixture, on the theme's resource path as
// `GtkApplication` adds `<resource-base-path>/icons/` (ADR 0116 § 4).
import { ICON_FIXTURE_PATH, gioResourceFixtures } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { COLOR_ICON_CLASS, type GtkImage } from './elements/gtk-image.js';
import { fallbackMask, maskOf } from './icon-masks.spec.js';
import { isIconAvailable } from './icon-theme.js';
import { Gio, Gtk } from './index.js';

const theme = Gtk.IconTheme.get_for_display(null);

/** Runs `body` with the fixture's icons on the theme's resource path. */
async function withIcons(body: () => void): Promise<void> {
    const resource = Gio.Resource.new_from_data(gioResourceFixtures().icons);
    Gio.resources_register(resource);
    const before = theme.get_resource_path();
    theme.add_resource_path(ICON_FIXTURE_PATH);
    // `changed` is deferred: let it drop the previous scan's URLs first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
        body();
    } finally {
        theme.set_resource_path(before);
        Gio.resources_unregister(resource);
    }
}

function mount(iconName: string): { el: GtkImage; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-image') as GtkImage;
    el.iconName = iconName;
    host.appendChild(el);
    return { el, host };
}

/** Every `.adw-icon--…` mask class on the node. */
function maskClasses(el: HTMLElement): string[] {
    return [...el.classList].filter((c) => c.startsWith('adw-icon--'));
}

/** True when `el` paints a resource image as-is and nothing masked. */
function drawsInColor(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return (
        el.classList.contains(COLOR_ICON_CLASS) &&
        maskClasses(el).length === 0 &&
        style.maskImage === 'none' &&
        style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        style.backgroundImage.startsWith('url("blob:')
    );
}

export const AdwIconThemeTest = async () => {
    await describe('a full-colour resource icon draws as-is', async () => {
        await it('draws its image, unmasked and unfilled', async () => {
            await withIcons(() => {
                const { el, host } = mount('flat');
                expect(drawsInColor(el)).toBe(true);
                expect(isIconAvailable('flat')).toBe(true);
                host.remove();
            });
        });

        await it("AdwAboutDialog's application-icon draws in colour", async () => {
            await withIcons(() => {
                const host = document.createElement('div');
                document.body.appendChild(host);
                const dialog = document.createElement('adw-about-dialog');
                dialog.setAttribute('application-icon', 'flat');
                host.appendChild(dialog);

                const icon = dialog.querySelector('.adw-about-dialog-icon') as HTMLElement;
                expect(drawsInColor(icon)).toBe(true);
                // The 96px box, and NOT a solid square under the image: the about dialog used to
                // force `background-color: currentColor` on it.
                expect(getComputedStyle(icon).width).toBe('96px');
                host.remove();
            });
        });
    });

    await describe('the lookup order is GThemedIcon’s', async () => {
        await it('a symbolic icon still masks — a compiled one with no resource', () => {
            const { el, host } = mount('go-next-symbolic');
            expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            expect(maskClasses(el)).toStrictEqual(['adw-icon--go-next']);
            expect(maskOf(el)).not.toBe(fallbackMask());
            expect(getComputedStyle(el).backgroundImage).toBe('none');
            host.remove();
        });

        await it("the theme's X-symbolic answers X before a resource's colour X, as on GTK", async () => {
            // The fixture ships a colour `16x16/actions/go-next.png`; gtkicontheme.c
            // `real_choose_icon` goes theme outer, name inner, and the file is hicolor's.
            await withIcons(() => {
                const { el, host } = mount('go-next');
                expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
                expect(maskClasses(el)).toStrictEqual(['adw-icon--go-next']);
                host.remove();
            });
        });

        await it('X-symbolic falls back to the colour X', async () => {
            await withIcons(() => {
                const { el, host } = mount('flat-symbolic');
                expect(drawsInColor(el)).toBe(true);
                expect(isIconAvailable('flat-symbolic')).toBe(true);
                host.remove();
            });
        });

        await it('an unknown name draws image-missing', () => {
            for (const unknown of ['org.gjsify.NeverShipped', 'gjsify-theme-never-shipped', 'flat']) {
                const { el, host } = mount(unknown);
                expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
                expect(maskOf(el)).toBe(fallbackMask());
                expect(isIconAvailable(unknown)).toBe(false);
                host.remove();
            }
        });
    });
};
