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
        children: { kind: 'ordered', append: 'add', remove: 'remove', reorder: 'remove-all' },
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
];
