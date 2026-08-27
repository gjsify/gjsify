// Curated libadwaita descriptors. Same rule as gtk.ts: what the GIR cannot say.

import Adw from 'gi://Adw?version=1';

import type { WidgetDescriptor } from '../types.js';

export const ADW_DESCRIPTORS: readonly WidgetDescriptor[] = [
    {
        gtype: 'AdwApplicationWindow',
        ctor: () => Adw.ApplicationWindow,
        children: { kind: 'single', set: 'set_content' },
    },
    {
        gtype: 'AdwWindow',
        ctor: () => Adw.Window,
        children: { kind: 'single', set: 'set_content' },
    },
    {
        gtype: 'AdwBin',
        ctor: () => Adw.Bin,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwToolbarView',
        ctor: () => Adw.ToolbarView,
        children: {
            kind: 'slotted',
            slots: { top: 'add_top_bar', bottom: 'add_bottom_bar', content: 'set_content' },
            defaultSlot: 'content',
            remove: 'remove',
        },
    },
    {
        gtype: 'AdwHeaderBar',
        ctor: () => Adw.HeaderBar,
        children: {
            kind: 'slotted',
            slots: { start: 'pack_start', end: 'pack_end', title: 'set_title_widget' },
            defaultSlot: 'start',
            remove: 'remove',
        },
    },
    {
        gtype: 'AdwPreferencesGroup',
        ctor: () => Adw.PreferencesGroup,
        // Measured on libadwaita 1.x: `add` and `remove` exist, `insert` and
        // `insert_child_after` do NOT. Reordering therefore costs a full
        // detach/re-append of the tail. Declared here so the conformance vector
        // asserts the degradation instead of a renderer discovering it in an app.
        children: { kind: 'ordered', append: 'add', remove: 'remove', reorder: 'remove-all' },
    },
    {
        gtype: 'AdwPreferencesPage',
        ctor: () => Adw.PreferencesPage,
        // NOT the group's degradation, despite the near-identical API: measured on
        // libadwaita 1.x, `Adw.PreferencesPage.insert(group, index)` exists and
        // places correctly, while `Adw.PreferencesGroup.insert` is `undefined`.
        // Copying the parent's policy across would have paid a full tail
        // re-append on every reorder for nothing — and `descriptorProblems()`
        // cannot catch that, because it only asserts the methods a policy NAMES.
        children: { kind: 'indexed', insert: 'insert', remove: 'remove', wrap: null },
    },
    {
        gtype: 'AdwActionRow',
        ctor: () => Adw.ActionRow,
        children: {
            kind: 'slotted',
            slots: { prefix: 'add_prefix', suffix: 'add_suffix' },
            defaultSlot: 'suffix',
            remove: 'remove',
        },
    },
    {
        gtype: 'AdwStatusPage',
        ctor: () => Adw.StatusPage,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwNavigationView',
        ctor: () => Adw.NavigationView,
        // `keyed` with `titled: false` — the arity that policy's own doc anticipated.
        // MEASURED on libadwaita 1.9.3: `add` and `remove` exist, `insert` does not,
        // and `add(page)` takes ONE argument, so calling it with a name and a title
        // would be the "At least 3 arguments required" throw `titled` exists to stop.
        //
        // THE TAG IS NOT AN ARGUMENT HERE, which is why `nameFrom` names a property
        // the CHILD carries rather than a key this policy passes: a page's identity
        // lives in `Adw.NavigationPage:tag`, and the view addresses it afterwards
        // through `push_by_tag` / `pop_to_tag` / `replace_with_tags`. That is the
        // whole mechanism behind ADR 0032 § 10's "a route key is the widget's join
        // key".
        //
        // AND `reorder: 'remove-all'` IS A DECLARED HAZARD, not only a cost. The tail
        // rotation it pays calls `remove()` on siblings, and on this widget `remove()`
        // also takes the page OUT OF THE NAVIGATION STACK — which no other container
        // in this table does. A renderer that reorders these children therefore
        // disturbs navigation, not just paint order. `@gjsify/react-native`'s Stack
        // keeps its page list append-only for exactly this reason and says so.
        children: { kind: 'keyed', add: 'add', remove: 'remove', nameFrom: 'tag', titled: false },
    },
    {
        gtype: 'AdwNavigationPage',
        ctor: () => Adw.NavigationPage,
        // MEASURED: `set_child` / `get_child`, one child. Without this rule the
        // generated table knows the tag and refuses every child by name — correct,
        // and useless to a layer that has to put a screen inside a page.
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwViewStack',
        ctor: () => Adw.ViewStack,
        // `Gtk.Stack`'s rule at the same arity: MEASURED, `add_titled(child, name,
        // title)` and `remove(child)` both exist. `add_titled_with_icon` exists too
        // and is NOT used — it is a fourth argument this policy has no field for, and
        // an icon belongs to the `Adw.ViewStackPage` the add RETURNS. Reaching that
        // page is a `get_page(child)` call, one layer up.
        children: { kind: 'keyed', add: 'add_titled', remove: 'remove', nameFrom: 'name', titled: true },
    },
];
