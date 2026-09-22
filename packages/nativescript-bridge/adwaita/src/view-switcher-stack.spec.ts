// A VIEW SWITCHER BOUND TO A VIEW STACK — the two-widget form libadwaita has and this
// port did not.
//
// WHAT WAS MISSING. `Adw.ViewSwitcher` on GTK is a BAR: the pages live in an
// `Adw.ViewStack` that fills the window body, the bar goes in a header bar, and one
// property joins them. This surface only had the bundled form — `setViews()` with each
// page's title, icon and content in one record — so the same UI had to be written a
// second way, which is exactly what the gallery's pane distance measures.
//
// WHAT THIS SPEC HOLDS, and why each one can fail on its own:
//
//   1. Binding reads the stack's pages, so the bar has a button per page without the
//      caller restating them.
//   2. The stack KEEPS its page views. A switcher that re-parented them would empty the
//      stack the consumer just put in the window — the one failure that looks like
//      "nothing renders" and has no exception to follow.
//   3. The selection travels BOTH ways: writing `selected` moves the stack, and moving
//      the stack moves `selected`. The round trip is guarded, so neither direction may
//      re-enter the other.
//   4. `setViews()` on a bound switcher UNBINDS it. Without that rule a switcher takes
//      its buttons from the argument and sends its selection to a stack that no longer
//      describes them — green, and wrong at the first tap.
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one: it builds the
// port's real widget classes, which evaluate `@nativescript/core` at module scope and are
// reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

/** A stack with three named, titled, icon-carrying pages — the gallery's own shape. */
function threePageStack(): Adw.ViewStack {
    const stack = new Adw.ViewStack();
    stack.add_titled_with_icon(new Gtk.Box(), 'inbox', 'Inbox', 'mail-unread-symbolic');
    stack.add_titled_with_icon(new Gtk.Box(), 'starred', 'Starred', 'starred-symbolic');
    stack.add_titled_with_icon(new Gtk.Box(), 'archive', 'Archive', 'folder-symbolic');
    return stack;
}

export const AdwViewSwitcherStackNsTest = async () => {
    await describe('Adw.ViewSwitcher bound to an Adw.ViewStack', async () => {
        await it('takes its pages from the stack, in stack order', () => {
            const stack = threePageStack();
            const switcher = new Adw.ViewSwitcher({ stack });

            expect(switcher.stack).toBe(stack);
            expect(switcher.views.length).toBe(3);
            expect(switcher.views[0]?.title).toBe('Inbox');
            expect(switcher.views[2]?.name).toBe('archive');
        });

        await it('leaves the page views parented to the stack', () => {
            const stack = threePageStack();
            const first = stack.pages[0]?.content;
            new Adw.ViewSwitcher({ stack });

            // Three pages, still the stack's own children — a switcher that took them
            // would leave the window body blank with nothing thrown.
            expect(stack.getChildrenCount()).toBe(3);
            expect(stack.getChildAt(0)).toBe(first);
        });

        await it('drives the stack when its selection is written', () => {
            const stack = threePageStack();
            const switcher = new Adw.ViewSwitcher({ stack });

            switcher.selected = 2;

            expect(stack.visibleChildName).toBe('archive');
            expect(stack.visibleChildIndex).toBe(2);
        });

        await it('follows the stack when the stack selects a page', () => {
            const stack = threePageStack();
            const switcher = new Adw.ViewSwitcher({ stack });

            stack.visibleChildName = 'starred';

            expect(switcher.selected).toBe(1);
            expect(switcher.selectedName).toBe('starred');
        });

        await it('starts on whatever the stack already shows', () => {
            const stack = threePageStack();
            stack.visibleChildName = 'archive';

            const switcher = new Adw.ViewSwitcher({ stack });

            expect(switcher.selected).toBe(2);
        });

        await it('unbinds when the caller hands it pages of its own', () => {
            const stack = threePageStack();
            const switcher = new Adw.ViewSwitcher({ stack });
            stack.visibleChildName = 'archive';

            switcher.setViews([{ title: 'Own', content: new Gtk.Box() }]);

            expect(switcher.stack).toBe(null);
            expect(switcher.views.length).toBe(1);
            // The stack keeps every page it had: unbinding hands nothing back, because
            // nothing was ever taken.
            expect(stack.getChildrenCount()).toBe(3);

            // And the stack no longer hears about the switcher's selection: index 0 is
            // `inbox`, so a still-bound switcher would have moved it off `archive`.
            switcher.selected = 0;
            expect(stack.visibleChildName).toBe('archive');
        });

        await it('stops following a stack it has been unbound from', () => {
            const stack = threePageStack();
            const switcher = new Adw.ViewSwitcher({ stack });
            switcher.set_stack(null);

            stack.visibleChildName = 'archive';

            expect(switcher.stack).toBe(null);
            expect(switcher.views.length).toBe(0);
        });
    });

    await describe('Adw.InlineViewSwitcher bound to an Adw.ViewStack', async () => {
        await it('binds through the same base, display mode and all', () => {
            const stack = threePageStack();
            const switcher = new Adw.InlineViewSwitcher({ stack, displayMode: 'both' });

            expect(switcher.views.length).toBe(3);
            expect(switcher.displayMode).toBe('both');

            switcher.selected = 1;
            expect(stack.visibleChildName).toBe('starred');
        });
    });
};
