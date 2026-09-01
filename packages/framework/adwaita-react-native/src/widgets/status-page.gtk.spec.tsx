/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of `AdwStatusPage`, against the libadwaita that is installed.
//
// THE THREE `visible` BINDINGS ARE THE WIDGET, and they are read off the live tree here
// rather than derived a second time: `has_image` (adw-status-page.c:88, bound from
// adw-status-page.ui:27-31) and `string_is_not_empty` on the title and the description.
// `status-page.native.spec.tsx` asserts the same three decisions on the half where
// `@gjsify/adwaita-core` has to make them — and one row this side cannot have, because it
// is the icon the React Native half does not draw at all.
//
// `has_image` IS ASSERTED WITH A NAME THE THEME CANNOT RESOLVE, on purpose. C is
// `paintable || (icon_name && icon_name[0])`: a name that was GIVEN shows the image
// whether or not the theme has it, and GTK draws `image-missing` in it. `adwaita-web`
// once read a RESOLVED name instead and hid the slot for every name that is not one CSS
// token — a branch the C does not have.
//
// The harness (window, pump, tree search, diagnostics gate) is `../testing/gtk.spec.tsx`.

import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { gtkChildren } from '@gjsify/gtk-host/conformance';

import { find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwStatusPage } from './status-page.gtk.js';

/** Every descendant of a GType, in tree order. */
function all(root: Gtk.Widget, gtype: string): Gtk.Widget[] {
    const found: Gtk.Widget[] = [];
    for (const child of gtkChildren(root)) {
        if (typeOf(child) === gtype) found.push(child);
        found.push(...all(child, gtype));
    }
    return found;
}

/** The status page's own two labels, in template order: title, then description. */
const texts = (page: Gtk.Widget): Gtk.Label[] => all(page, 'GtkLabel') as Gtk.Label[];

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('AdwStatusPage is the real widget, carrying its three properties', async () => {
            await it('writes icon-name, title and description onto an Adw.StatusPage', async () => {
                laidOut(
                    <AdwStatusPage iconName="folder-symbolic" title="Nothing here" description="Add a file" />,
                    (container) => {
                        const page = find(container, 'AdwStatusPage') as unknown as {
                            iconName: string | null;
                            title: string;
                            description: string;
                        };
                        expect(page.iconName).toBe('folder-symbolic');
                        expect(page.title).toBe('Nothing here');
                        expect(page.description).toBe('Add a file');
                    },
                );
            });

            await it('puts children in the child slot, as Adw.StatusPage:child', async () => {
                laidOut(
                    <AdwStatusPage title="Nothing here">
                        <gtk-label label="action" />
                    </AdwStatusPage>,
                    (container) => {
                        const page = find(container, 'AdwStatusPage') as unknown as {
                            get_child: () => Gtk.Widget | null;
                        };
                        const child = page.get_child();
                        expect(child === null).toBe(false);
                        expect(typeOf(child as Gtk.Widget)).toBe('GtkLabel');
                        expect((child as Gtk.Label).label).toBe('action');
                    },
                );
            });
        });

        await gated('the visibility bindings, read off the live tree', async () => {
            await it('shows the image for a name the theme cannot resolve', async () => {
                laidOut(<AdwStatusPage iconName="definitely-not-an-icon" title="x" />, (container) => {
                    const images = all(find(container, 'AdwStatusPage'), 'GtkImage');
                    expect(images.length).toBe(1);
                    expect(images[0]?.get_visible()).toBe(true);
                });
            });

            await it('hides the image when no icon-name was given at all', async () => {
                laidOut(<AdwStatusPage title="x" />, (container) => {
                    const images = all(find(container, 'AdwStatusPage'), 'GtkImage');
                    expect(images.length).toBe(1);
                    expect(images[0]?.get_visible()).toBe(false);
                });
            });

            await it('hides the description label when the description is empty', async () => {
                laidOut(<AdwStatusPage title="Nothing here" description="" />, (container) => {
                    const labels = texts(find(container, 'AdwStatusPage'));
                    expect(labels.map((label) => label.label)).toStrictEqual(['Nothing here', '']);
                    expect(labels.map((label) => label.get_visible())).toStrictEqual([true, false]);
                });
            });

            await it('hides the TITLE label when the title is empty, and keeps three spaces', async () => {
                // Both rows of `string_is_not_empty` in one test, because they are one
                // closure: `''` is not a title and `'   '` is. The React Native half
                // asserts the same pair.
                laidOut(<AdwStatusPage title="" description="Add a file" />, (container) => {
                    const labels = texts(find(container, 'AdwStatusPage'));
                    expect(labels.map((label) => label.get_visible())).toStrictEqual([false, true]);
                });
                laidOut(<AdwStatusPage title="   " description="" />, (container) => {
                    const labels = texts(find(container, 'AdwStatusPage'));
                    expect(labels.map((label) => label.get_visible())).toStrictEqual([true, false]);
                });
            });
        });
    });
};
