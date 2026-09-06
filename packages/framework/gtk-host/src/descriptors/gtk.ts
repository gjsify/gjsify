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
        gtype: 'GtkOverlay',
        ctor: () => Gtk.Overlay,
        // TWO slots that are not interchangeable, which is why this is `slotted`
        // and not `single`: `set_child` holds the widget the overlay SIZES ITSELF
        // TO, `add_overlay` stacks widgets on top of it. Measured on gtk 4.22.4 —
        // `set_child`, `get_child`, `add_overlay`, `remove_overlay` present, no
        // `remove` at all, so the overlay slot removes with `remove_overlay` and
        // the child slot with `set_child(null)`, which is what `detachChild`
        // already does for every `set_`-prefixed slot.
        //
        // Curated for ADR 0032 § 6: a React Native `View` whose CHILD is
        // absolutely positioned becomes this widget. As an `uncurated` row it
        // refused the insertion by name — correct, and useless to the layer that
        // has to build it.
        children: {
            kind: 'slotted',
            slots: { child: 'set_child', overlay: 'add_overlay' },
            defaultSlot: 'child',
            remove: 'remove_overlay',
        },
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
        // `perLineCap` is the one declaration here that exists for a COST rather
        // than for a correctness rule — see `ChildPolicy`'s docblock for the
        // measurement. Without it the class is still laid out correctly and still
        // takes a second and a half to measure two children.
        children: {
            kind: 'indexed',
            insert: 'insert',
            remove: 'remove',
            wrap: 'flow-box-child',
            perLineCap: 'max-children-per-line',
        },
    },
    {
        gtype: 'GtkListBoxRow',
        ctor: () => Gtk.ListBoxRow,
        children: { kind: 'single', set: 'set_child' },
    },
    // The three GTK list-item carriers, and they are the first curated entries that
    // are NOT `Gtk.Widget` subclasses — measured: `GObject.type_is_a(Gtk.ListItem,
    // Gtk.Widget)` is FALSE for all three.
    //
    // They ARE in the generated table, and getting them there is what ADR 0028's
    // 2026-08-28 amendment decided: a child-holder rule beside the concrete-widget
    // one, so the criterion is no longer "concrete GtkWidget descendant" alone. Both
    // rules now run in ts-for-gir and arrive as `DECLS` and `CHILD_HOLDERS`; the
    // functions that used to compute them here are gone with the GIR reader. An earlier draft of this work curated them WITHOUT
    // generating them, on the strength of `gate1`'s "an abstract or non-widget class
    // can still be curated as a MOUNT container" — and `generated.spec.ts`'s
    // `every curated widget is one the generator also found` refused it. The gate
    // permits the shape; the invariant above it does not. Both are right, and the
    // criterion was the thing that had to move.
    //
    // WHY they are wanted: a `Gtk.ListView` installs no child-insertion method at
    // all — no `append`, `add`, `insert`, `prepend`, `remove` or `set_child`,
    // measured against its prototype — so it stays `uncurated` and its refusal is
    // correct. What GTK gives a renderer instead is a factory that hands back one of
    // these carriers, whose `child` is where a row's subtree goes. Curating them is
    // what lets that subtree be placed through the host's own `single` policy rather
    // than through a `set_child` call inside one framework's list controller.
    //
    // In PRACTICE these are adopted rather than created: GTK's factory makes the
    // carrier and hands it over. They are ordinary creatable tags all the same —
    // they construct bare (measured, `child` is null) and `constructsEveryDescriptor`
    // constructs them on every run — so nothing here is a special case in
    // `materialize`.
    //
    // `Gtk.ColumnViewRow` is deliberately ABSENT, and that is a measurement rather
    // than an omission: unlike its three siblings it installs neither `set_child` nor
    // `get_child`, so a `single` policy naming them would be a claim
    // `descriptorProblems()` is right to reject.
    {
        gtype: 'GtkListItem',
        ctor: () => Gtk.ListItem,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkListHeader',
        ctor: () => Gtk.ListHeader,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkColumnViewCell',
        ctor: () => Gtk.ColumnViewCell,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkStack',
        ctor: () => Gtk.Stack,
        children: { kind: 'keyed', add: 'add_titled', remove: 'remove', nameFrom: 'name', titled: true },
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
