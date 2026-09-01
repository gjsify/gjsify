/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of `AdwHeaderBar`, against the libadwaita that is installed.
//
// THE START AND END SLOTS ARE ASSERTED BY THE CLASS libadwaita PUTS ON THEM, for the same
// reason `toolbar-view.gtk.spec.tsx` does it: `pack_start` and `pack_end` have no getter,
// so a presence assertion passes with everything in one slot — and `start` is this
// widget's DEFAULT slot, so that is exactly the mistake to catch. Measured on libadwaita
// 1.9.3, the bar packs into two `GtkBox`es carrying `horizontal start` and
// `horizontal end`.
//
// THE DERIVED CENTRE IS THE INTERESTING HALF, and it has three states rather than two:
//
//   titleWidget authored  → the caller's widget holds the centre.
//   title/subtitle only   → an `AdwWindowTitle` holds it, which is the DIVERGENCE both
//                           other renderers carry and this one keeps.
//   neither               → NO title widget at all, and libadwaita's own `update_title`
//                           (adw-header-bar.c:475) resolves the ROOT WINDOW's title into
//                           a plain `GtkLabel` with the `title` class.
//
// The third is the one this half has and the React Native half cannot: a phone has no
// navigation page, dialog or window to walk. It is asserted here against a window title
// set on the harness's window, which is why `laidOut` takes one.
//
// The harness (window, pump, tree search, diagnostics gate) is `../testing/gtk.spec.tsx`.

import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { gtkChildren } from '@gjsify/gtk-host/conformance';

import { find, insideClass, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwHeaderBar } from './header-bar.gtk.js';

/** `Adw.HeaderBar`, through the one getter this suite reads. */
type HeaderBar = Gtk.Widget & { get_title_widget: () => Gtk.Widget | null };

/** The `GtkLabel` carrying this text, anywhere under `root`. */
function labelled(root: Gtk.Widget, text: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel' && (widget as Gtk.Label).label === text) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no GtkLabel reading ${JSON.stringify(text)}`);
}

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('the two ends are two ends', async () => {
            await it('packs start into the start box and end into the end box', async () => {
                laidOut(
                    <AdwHeaderBar
                        title="Files"
                        start={<gtk-label label="leading" />}
                        end={<gtk-label label="trailing" />}
                    />,
                    (container) => {
                        const bar = find(container, 'AdwHeaderBar');
                        const leading = labelled(bar, 'leading');
                        const trailing = labelled(bar, 'trailing');
                        expect(insideClass(leading, bar, 'start')).toBe(true);
                        expect(insideClass(leading, bar, 'end')).toBe(false);
                        expect(insideClass(trailing, bar, 'end')).toBe(true);
                        expect(insideClass(trailing, bar, 'start')).toBe(false);
                    },
                );
            });

            await it('keeps the order the prop was written in', async () => {
                // A prop is already DRAW order, which is what makes `pack_end`'s prepend
                // (adw-header-bar.c:1106) a non-issue on this surface — the rule
                // `HeaderBarState` exists to get right imperatively. Asserted as x
                // positions off the live tree rather than as list order, because the list
                // is not readable and the picture is what the rule is about.
                laidOut(
                    <AdwHeaderBar
                        title="Files"
                        end={
                            <>
                                <gtk-label label="first" />
                                <gtk-label label="second" />
                            </>
                        }
                    />,
                    (container) => {
                        const bar = find(container, 'AdwHeaderBar');
                        const first = labelled(bar, 'first').compute_bounds(bar);
                        const second = labelled(bar, 'second').compute_bounds(bar);
                        expect(first[0] && second[0]).toBe(true);
                        expect(second[1].get_x() > first[1].get_x()).toBe(true);
                    },
                );
            });
        });

        await gated('the centre has three states, not two', async () => {
            await it('gives the centre to a titleWidget when one is authored', async () => {
                laidOut(<AdwHeaderBar titleWidget={<gtk-label label="a search entry" />} />, (container) => {
                    const bar = find(container, 'AdwHeaderBar') as HeaderBar;
                    const centre = bar.get_title_widget();
                    expect(centre === null).toBe(false);
                    // The caller's node arrives inside the `AdwBin` this half wraps every
                    // slot prop in — `header-bar.gtk.tsx` says why a `ReactNode` cannot
                    // carry a `slot` itself.
                    expect(typeOf(centre as Gtk.Widget)).toBe('AdwBin');
                    expect(typeOf(labelled(centre as Gtk.Widget, 'a search entry'))).toBe('GtkLabel');
                });
            });

            await it('installs an AdwWindowTitle for title/subtitle — the named divergence', async () => {
                laidOut(<AdwHeaderBar title="Files" subtitle="3 selected" />, (container) => {
                    const bar = find(container, 'AdwHeaderBar') as HeaderBar;
                    const centre = bar.get_title_widget() as unknown as {
                        title: string;
                        subtitle: string;
                    } | null;
                    expect(centre === null).toBe(false);
                    expect(typeOf(bar.get_title_widget() as Gtk.Widget)).toBe('AdwWindowTitle');
                    expect(centre?.title).toBe('Files');
                    expect(centre?.subtitle).toBe('3 selected');
                });
            });

            await it('leaves the centre to update_title when NOTHING is authored', async () => {
                // The state neither other renderer has, and the reason this half does not
                // install an empty window title unconditionally: doing so would replace a
                // resolved title with a blank centre. `update_title` walks to the root
                // window and puts its title in a `GtkLabel` with the `title` class.
                laidOut(
                    <AdwHeaderBar start={<gtk-label label="leading" />} />,
                    (container) => {
                        const bar = find(container, 'AdwHeaderBar') as HeaderBar;
                        expect(bar.get_title_widget()).toBe(null);
                        const derived = labelled(bar, 'Reachable From The Window');
                        expect(derived.get_css_classes().includes('title')).toBe(true);
                    },
                    { title: 'Reachable From The Window' },
                );
            });
        });
    });
};
