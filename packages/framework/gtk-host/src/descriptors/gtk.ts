// Curated GTK4 descriptors.
//
// Curated, not generated — for now. The generator (ADR 0028) fills in gtype,
// ctor, property and signal data for every class in the GIR; what stays by hand
// is exactly what the GIR does not know: which method adopts a child, whether
// the container can reorder in place, where text goes. Those live here so the
// generator may only ever ADD to a descriptor, never contradict one.

import Gtk from 'gi://Gtk?version=4.0';

import type { WidgetDescriptor } from '../types.js';

export const GTK_DESCRIPTORS: readonly WidgetDescriptor[] = [
    {
        gtype: 'GtkBox',
        ctor: () => Gtk.Box,
        // `insert_child_after` is the O(1) reorder path — measured present on GtkBox.
        children: {
            kind: 'ordered',
            append: 'append',
            after: 'insert_child_after',
            remove: 'remove',
            reorder: 'native',
        },
    },
    {
        gtype: 'GtkWindow',
        ctor: () => Gtk.Window,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkApplicationWindow',
        ctor: () => Gtk.ApplicationWindow,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkScrolledWindow',
        ctor: () => Gtk.ScrolledWindow,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkFrame',
        ctor: () => Gtk.Frame,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkLabel',
        ctor: () => Gtk.Label,
        children: { kind: 'none' },
        textSink: 'label',
    },
    {
        gtype: 'GtkButton',
        ctor: () => Gtk.Button,
        // A Button is `single` AND has a text sink: <GtkButton>Go</GtkButton> sets
        // the label, <GtkButton><GtkImage/></GtkButton> sets the child.
        children: { kind: 'single', set: 'set_child' },
        textSink: 'label',
    },
    {
        gtype: 'GtkToggleButton',
        ctor: () => Gtk.ToggleButton,
        children: { kind: 'single', set: 'set_child' },
        textSink: 'label',
    },
    {
        gtype: 'GtkImage',
        ctor: () => Gtk.Image,
        children: { kind: 'none' },
    },
    {
        gtype: 'GtkSwitch',
        ctor: () => Gtk.Switch,
        children: { kind: 'none' },
    },
    {
        gtype: 'GtkEntry',
        ctor: () => Gtk.Entry,
        children: { kind: 'none' },
        textSink: 'text',
    },
    {
        gtype: 'GtkListBox',
        ctor: () => Gtk.ListBox,
        // The parent addresses the ROW, not the child: a generic `insert_before`
        // here bypasses the wrap, `get_row_at_index` keeps returning the old row,
        // and teardown floods `Gtk-WARNING: Tried to remove non-child` at exit 0.
        children: { kind: 'indexed', insert: 'insert', remove: 'remove', wrap: 'list-box-row' },
    },
    {
        gtype: 'GtkFlowBox',
        ctor: () => Gtk.FlowBox,
        children: { kind: 'indexed', insert: 'insert', remove: 'remove', wrap: 'flow-box-child' },
    },
    {
        gtype: 'GtkListBoxRow',
        ctor: () => Gtk.ListBoxRow,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkStack',
        ctor: () => Gtk.Stack,
        children: { kind: 'keyed', add: 'add_titled', remove: 'remove', nameFrom: 'name' },
    },
    {
        gtype: 'GtkGrid',
        ctor: () => Gtk.Grid,
        children: { kind: 'coords', attach: 'attach', remove: 'remove' },
    },
    {
        gtype: 'GtkHeaderBar',
        ctor: () => Gtk.HeaderBar,
        children: {
            kind: 'slotted',
            slots: { start: 'pack_start', end: 'pack_end', title: 'set_title_widget' },
            defaultSlot: 'start',
            remove: 'remove',
        },
    },
];
