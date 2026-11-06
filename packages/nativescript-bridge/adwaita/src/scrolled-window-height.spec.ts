// `height-request` ON A SCROLLED WINDOW IS ITS HEIGHT, NOT A FLOOR.
//
// MEASURED on a Galaxy S9: Learn6502's example cards are `SourceView { height: 150 }`, which
// sets `height-request` on the `ScrolledWindow` around the editor. The base class maps the
// request to `minHeight`, a floor, and the `ScrollView` measures its content unbounded, so
// every card took the full height of its code. GTK scrolls inside the request instead.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';

/** The `ScrollView` the window wraps — the first child of its one-cell grid. */
function scrollViewOf(window: Gtk.ScrolledWindow): { height: number | string } {
    return (window as unknown as { _scroll: { height: number | string } })._scroll;
}

export const GtkScrolledWindowHeightNsTest = async () => {
    await describe('Gtk.ScrolledWindow height-request', async () => {
        await it('leaves the scroll view to its content when no height is requested', () => {
            const window = new Gtk.ScrolledWindow();
            expect(scrollViewOf(window).height).toBe('auto');
        });

        await it('pins the scroll view to the request, so the content scrolls inside', () => {
            const window = new Gtk.ScrolledWindow();
            window.heightRequest = 150;
            expect(window.heightRequest).toBe(150);
            expect(scrollViewOf(window).height).toBe(150);
        });

        await it('lets the content set the height once the vertical policy is never', () => {
            const window = new Gtk.ScrolledWindow();
            window.heightRequest = 150;
            window.vscrollbarPolicy = 'never';
            expect(scrollViewOf(window).height).toBe('auto');
            window.vscrollbarPolicy = 'automatic';
            expect(scrollViewOf(window).height).toBe(150);
        });

        await it('takes the GJS spelling height_request too', () => {
            const window = new Gtk.ScrolledWindow();
            window.height_request = 150;
            expect(window.heightRequest).toBe(150);
            expect(scrollViewOf(window).height).toBe(150);
        });

        await it('drops the pin when the request is cleared', () => {
            const window = new Gtk.ScrolledWindow();
            window.heightRequest = 150;
            window.heightRequest = -1;
            expect(scrollViewOf(window).height).toBe('auto');
        });
    });
};
