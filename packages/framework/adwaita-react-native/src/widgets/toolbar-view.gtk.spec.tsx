/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of `AdwToolbarView`, against the libadwaita that is installed.
//
// A SLOT CANNOT BE ASSERTED BY PRESENCE, and that is measured rather than assumed:
// `add_top_bar` and `add_bottom_bar` are write-only, the two height getters read 0 until
// the widget is allocated, and gtk-host's own conformance vectors record that every
// presence-based assertion passed with a bar authored into the WRONG slot. What separates
// them is the style class libadwaita puts on the `GtkRevealer` it wraps each bar in —
// `top-bar` / `bottom-bar`, `_toolbars.scss` — so `insideClass` walks to it.
//
// THE ALLOCATION IS ASSERTED AS ARITHMETIC, NOT AS A PIXEL COUNT. A header bar is 46
// points high on this theme and that number belongs to the theme, but the RELATION
// between the three slot heights is `adw_toolbar_view_size_allocate` and belongs to
// libadwaita: the content starts at `top-bar-height` and is exactly
// `height - top-bar-height - bottom-bar-height` tall, and setting
// `extend-content-to-top-edge` moves the first to 0 and adds the bar's height back to the
// second while the bar KEEPS its height. That is `toolbarViewAllocate`'s `contentOffset`
// and `contentHeight`, read off the real widget.
//
// AND THE CORE'S CLASS DERIVATION IS MEASURED AGAINST THE C, which is the one place in
// this package where a `@gjsify/adwaita-core` port is checked against libadwaita directly
// rather than against the other renderer. `toolbarViewClasses` decides `undershoot-top` /
// `undershoot-bottom` from the two styles, the two extend flags and the ALLOCATED bar
// heights; libadwaita decides the same thing in `update_undershoots`, and this suite
// hands the core the heights it reads off the widget and compares the two answers.
//
// The harness (window, pump, tree search, diagnostics gate) is `../testing/gtk.spec.tsx`.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { gtkChildren } from '@gjsify/gtk-host/conformance';

import { ADW_TOOLBAR_BAR_CLASSES, ADW_TOOLBAR_VIEW_CLASSES, toolbarViewClasses } from '@gjsify/adwaita-core';

import { find, insideClass, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwHeaderBar } from './header-bar.gtk.js';
import { AdwToolbarView } from './toolbar-view.gtk.js';

/** `Adw.ToolbarView`, with the read-only heights the allocation is asserted against. */
type ToolbarView = Gtk.Widget & {
    topBarHeight: number;
    bottomBarHeight: number;
    topBarStyle: number;
    bottomBarStyle: number;
    extendContentToTopEdge: boolean;
    get_content: () => Gtk.Widget | null;
};

/** The managed classes a node carries, in the fixed order the core lists them. */
const managed = (widget: Gtk.Widget, owned: readonly string[]): string[] =>
    owned.filter((name) => widget.get_css_classes().includes(name));

/** The `GtkLabel` carrying this text, anywhere under `root` — a slot holds a subtree. */
function labelled(root: Gtk.Widget, text: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel' && (widget as Gtk.Label).label === text) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no GtkLabel reading ${JSON.stringify(text)}`);
}

/** The node the core's `topBar`/`bottomBar` classes land on — libadwaita's own revealer. */
function revealerOf(bar: Gtk.Widget, view: Gtk.Widget): Gtk.Widget {
    for (let node: Gtk.Widget | null = bar; node !== null && node !== view; node = node.get_parent()) {
        if (typeOf(node) === 'GtkRevealer') return node;
    }
    throw new Error('no GtkRevealer between the bar and the toolbar view');
}

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('the three slots are the three slots', async () => {
            await it('puts topBar under top-bar and bottomBar under bottom-bar', async () => {
                laidOut(
                    <AdwToolbarView topBar={<AdwHeaderBar title="Files" />} bottomBar={<gtk-label label="status" />}>
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView');
                        const bar = find(view, 'AdwHeaderBar');
                        expect(insideClass(bar, view, 'top-bar')).toBe(true);
                        expect(insideClass(bar, view, 'bottom-bar')).toBe(false);

                        // By TEXT, not by position: the top bar has labels of its own,
                        // so "the first GtkLabel" would be the header bar's title.
                        const status = labelled(view, 'status');
                        expect(insideClass(status, view, 'bottom-bar')).toBe(true);
                        expect(insideClass(status, view, 'top-bar')).toBe(false);
                    },
                );
            });

            await it('puts children in content, which is a one-widget property', async () => {
                laidOut(
                    <AdwToolbarView topBar={<AdwHeaderBar title="Files" />}>
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView') as ToolbarView;
                        const content = view.get_content();
                        expect(content === null).toBe(false);
                        expect(typeOf(content as Gtk.Widget)).toBe('GtkLabel');
                        expect((content as Gtk.Label).label).toBe('content');
                    },
                );
            });

            await it('carries the two styles and the two extend flags onto the widget', async () => {
                laidOut(
                    <AdwToolbarView
                        topBarStyle="raised"
                        bottomBarStyle="raised-border"
                        extendContentToTopEdge={true}
                        topBar={<AdwHeaderBar title="Files" />}
                    >
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView') as ToolbarView;
                        expect(view.topBarStyle).toBe(Adw.ToolbarStyle.RAISED);
                        expect(view.bottomBarStyle).toBe(Adw.ToolbarStyle.RAISED_BORDER);
                        expect(view.extendContentToTopEdge).toBe(true);
                    },
                );
            });
        });

        await gated('the allocation, as arithmetic rather than as a pixel count', async () => {
            await it('starts the content at top-bar-height and ends it at the bottom bar', async () => {
                laidOut(
                    <AdwToolbarView topBar={<AdwHeaderBar title="Files" />} bottomBar={<gtk-label label="status" />}>
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView') as ToolbarView;
                        const content = view.get_content() as Gtk.Widget;
                        const bounds = content.compute_bounds(view);
                        expect(bounds[0]).toBe(true);

                        // Both bars were allocated something, or the two identities below
                        // would hold vacuously at 0.
                        expect(view.topBarHeight).toBeGreaterThan(0);
                        expect(view.bottomBarHeight).toBeGreaterThan(0);
                        expect(Math.round(bounds[1].get_y())).toBe(view.topBarHeight);
                        expect(Math.round(bounds[1].get_height())).toBe(
                            view.get_height() - view.topBarHeight - view.bottomBarHeight,
                        );
                    },
                );
            });

            await it('gives the extended edge back to the content, and not to the bar', async () => {
                laidOut(
                    <AdwToolbarView
                        extendContentToTopEdge={true}
                        topBar={<AdwHeaderBar title="Files" />}
                        bottomBar={<gtk-label label="status" />}
                    >
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView') as ToolbarView;
                        const content = view.get_content() as Gtk.Widget;
                        const bounds = content.compute_bounds(view);
                        expect(bounds[0]).toBe(true);
                        // The bar keeps its height — it is drawn OVER the content, not
                        // collapsed — and the content gets that height back.
                        expect(view.topBarHeight).toBeGreaterThan(0);
                        expect(Math.round(bounds[1].get_y())).toBe(0);
                        expect(Math.round(bounds[1].get_height())).toBe(view.get_height() - view.bottomBarHeight);
                    },
                );
            });
        });

        await gated('the core’s class derivation against libadwaita’s own', async () => {
            await it('agrees on undershoot-top, undershoot-bottom, raised and border', async () => {
                laidOut(
                    <AdwToolbarView
                        topBarStyle="raised"
                        topBar={<AdwHeaderBar title="Files" />}
                        bottomBar={<gtk-label label="status" />}
                    >
                        <gtk-label label="content" vexpand={true} />
                    </AdwToolbarView>,
                    (container) => {
                        const view = find(container, 'AdwToolbarView') as ToolbarView;
                        const bar = find(view, 'AdwHeaderBar');
                        const derived = toolbarViewClasses({
                            topBarStyle: 'raised',
                            bottomBarStyle: 'flat',
                            extendContentToTopEdge: false,
                            extendContentToBottomEdge: false,
                            topBarHeight: view.topBarHeight,
                            bottomBarHeight: view.bottomBarHeight,
                        });
                        // A raised top bar brings its own shadow, so only the FLAT bottom
                        // one fades — the answer the core computes, and the one C wrote
                        // onto the widget.
                        expect(derived.view).toStrictEqual(['undershoot-bottom']);
                        expect(managed(view, ADW_TOOLBAR_VIEW_CLASSES)).toStrictEqual(derived.view);
                        expect(managed(revealerOf(bar, view), ADW_TOOLBAR_BAR_CLASSES)).toStrictEqual(derived.topBar);
                    },
                );
            });
        });
    });
};
