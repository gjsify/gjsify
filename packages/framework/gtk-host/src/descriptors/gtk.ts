// Curated GTK4 descriptors.
//
// Curated, not generated — for now. The generator (ADR 0028) fills in gtype,
// ctor, property and signal data for every class in the GIR; what stays by hand
// is exactly what the GIR does not know: which method adopts a child, whether
// the container can reorder in place, where text goes. Those live here so the
// generator may only ever ADD to a descriptor, never contradict one.

import Gtk from 'gi://Gtk?version=4.0';

import type { NodePlacement, WidgetDescriptor } from '../types.js';

/**
 * The placement every `Gtk.Root` shares — ADR 0054.
 *
 * `present` and `destroy` are measured on GTK 4.22.4; the measurements that pick
 * `destroy` over `close` (a vetoed `close-request` leaves the window up) and that
 * make the retraction terminal are on `NodePlacement`'s toplevel arm in `types.ts`.
 *
 * SHARED WITH `adw.ts`, which imports it: a toplevel is a fact about the TYPE, and
 * `Gtk.Root`'s presentable implementations are split across the two libraries by
 * nothing but who owns the class (measured with `GObject.type_is_a`). They are
 * NAMED rather than inherited for the reason the dialog family is: registration is
 * exact, so `lookupWidget('GtkMessageDialog')` answers the GENERATED row and an
 * inherited placement would never be looked up. `is declared by every registered
 * Gtk.Root` in `placement.spec.ts` is what keeps the list complete, and it holds
 * the count so no comment has to.
 *
 * `GtkDragIcon` is the one `Gtk.Root` deliberately absent: measured, it has no
 * `present`, no `close` and no `destroy` — GTK creates one for a drag operation and
 * nothing else ever shows one. It is refused at the insert by `refuseUnparentable`
 * instead, which is the honest answer for a root that cannot present itself, and
 * the spec NAMES it so a second such class is a decision rather than a bumped
 * number.
 *
 * CHILDREN STAY UNCURATED on every row that had no policy before this. A window
 * takes `set_child`, but `GtkDialog` and its five chooser subclasses put children
 * into a content area (`get_content_area`) that `set_child` would REPLACE, and
 * `GtkAssistant` addresses pages by index — the `AdwAlertDialog` trap one axis
 * over. Guessing here buys a warning at exit 0; the tags are creatable,
 * propertyable and presentable, and a child in one is a named refusal.
 */
export const TOPLEVEL: NodePlacement = { kind: 'toplevel', present: 'present', close: 'destroy' };

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
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkApplicationWindow',
        ctor: () => Gtk.ApplicationWindow,
        children: { kind: 'single', set: 'set_child' },
        placement: TOPLEVEL,
    },
    // The remaining GTK toplevels. `uncurated` children, per the constant above.
    { gtype: 'GtkDialog', ctor: () => Gtk.Dialog, children: { kind: 'uncurated' }, placement: TOPLEVEL },
    { gtype: 'GtkAboutDialog', ctor: () => Gtk.AboutDialog, children: { kind: 'uncurated' }, placement: TOPLEVEL },
    { gtype: 'GtkMessageDialog', ctor: () => Gtk.MessageDialog, children: { kind: 'uncurated' }, placement: TOPLEVEL },
    { gtype: 'GtkAssistant', ctor: () => Gtk.Assistant, children: { kind: 'uncurated' }, placement: TOPLEVEL },
    {
        gtype: 'GtkAppChooserDialog',
        ctor: () => Gtk.AppChooserDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkColorChooserDialog',
        ctor: () => Gtk.ColorChooserDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkFileChooserDialog',
        ctor: () => Gtk.FileChooserDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkFontChooserDialog',
        ctor: () => Gtk.FontChooserDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkShortcutsWindow',
        ctor: () => Gtk.ShortcutsWindow,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    // The two Unix-only ones. `ctor()` answers `undefined` where the typelib has no
    // such class, and `descriptorProblems()` skips a row it cannot resolve — which
    // is why declaring them costs nothing off Linux and refusing to declare them
    // would cost an abort-adjacent silence on it.
    {
        gtype: 'GtkPageSetupUnixDialog',
        ctor: () => Gtk.PageSetupUnixDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        gtype: 'GtkPrintUnixDialog',
        ctor: () => Gtk.PrintUnixDialog,
        children: { kind: 'uncurated' },
        placement: TOPLEVEL,
    },
    {
        // HOW AN APPLICATION SPELLS "as tall as it is wide" ON THIS HOST, and that is
        // the whole of it: nothing here maps React Native's `aspectRatio`, and this
        // descriptor does not start doing so. `@gjsify/react-native`'s own
        // `src/primitives/style.ts` lists that property among the ones it does not
        // route and its partition refuses it by name; a consumer that wants the shape
        // renders this widget. What it got instead was a refusal — without a curated
        // placement the host declines the child as an uncurated one — so the shape was
        // unreachable rather than merely unsugared.
        //
        // MEASURED on GTK 4.22.4: it is a height-for-width request and not merely an
        // alignment, which is what makes it usable for this at all. WITH `obey-child`
        // FALSE, which is the condition the whole paragraph rests on,
        // `measure(VERTICAL, 116)` answers 116 at `ratio: 1` and 65 at 16/9, with a
        // `Gtk.Picture` inside as with a box. At the default the same call answers 116
        // for both, measured, which is the next paragraph.
        //
        // `obey-child` DEFAULTS TO TRUE, AND THAT IS A TRAP THIS DESCRIPTOR CANNOT
        // CLOSE. Both measurements above hold with it written false; at its default the
        // frame takes its ratio from the CHILD and the declared one is ignored in
        // silence — measured, `ratio: 1` over a 32x16 child answers 58 rather than 116.
        // A rule here can say which method adopts the child and nothing about a
        // property the consumer writes, so this is the sentence rather than a check:
        // a `ratio` is inert until `obey-child` is false. The vector in `host.spec.ts`
        // is written at 16/9 for the same reason — at ratio 1 over a square-ish child
        // the two answers coincide, and it asserted nothing.
        gtype: 'GtkAspectFrame',
        ctor: () => Gtk.AspectFrame,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkScrolledWindow',
        ctor: () => Gtk.ScrolledWindow,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        // The two halves of the scrolling trio, both measured from the GIR rather than
        // inferred: each declares `GtkBuildable` with a `child` property whose setter is
        // `set_child` (gtkviewport.c:347-349 installs the property;
        // `gtk_window_handle_buildable_add_child` and
        // `gtk_viewport_buildable_add_child` are what route it), and `GtkViewport` is
        // `single` in the same sense the frame above is — ONE child, addressed by
        // replacing it.
        gtype: 'GtkViewport',
        ctor: () => Gtk.Viewport,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        // A `GtkBinLayout` (gtkwindowhandle.c:553) with the one child a titlebar has, which
        // is the whole widget: libadwaita styles nothing on the `windowhandle` node
        // (gtkwindowhandle.c:554), so the child is what the reader sees.
        gtype: 'GtkWindowHandle',
        ctor: () => Gtk.WindowHandle,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        // `GtkScrollbar` takes NO child: its content is a `GtkRange` the widget builds itself
        // and parents to itself (gtkscrollbar.c:269-273), and
        // `gtk_widget_class_set_layout_manager_type` is a `GtkBoxLayout` over that one
        // internal node (gtkscrollbar.c:258). Declared `none` so a tree that tries to
        // put anything in a scrollbar is refused by name instead of mounting silently wrong.
        gtype: 'GtkScrollbar',
        ctor: () => Gtk.Scrollbar,
        children: { kind: 'none' },
    },
    {
        gtype: 'GtkFrame',
        ctor: () => Gtk.Frame,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'GtkGraphicsOffload',
        ctor: () => Gtk.GraphicsOffload,
        // A BIN with one `set_child`, the same shape as `GtkFrame` above and for the same
        // reason: `GTK_TYPE_BIN_LAYOUT` (gtkgraphicsoffload.c:290) and a `child` property
        // whose setter unparents the old widget and parents the new one (:317-336). It is
        // `single` rather than `uncurated` because the ONE thing an application does with
        // this wrapper is give it something to offload.
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
        // `perLineCap` is a CORRECTNESS rule that happens to also be the cheap one.
        // Without it a `Gtk.FlowBox` sits at GTK's default of 7 and a wrap caps a
        // line at seven children however much room is left. Holding it at the child
        // count costs nothing — MEASURED, 0.098 ms per height-for-width measure of
        // two children at the default and 0.024 ms at their count — while the
        // G_MAXUINT that used to carry this rule cost 1393 ms. See `ChildPolicy`.
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
    {
        // The SAME shape as the row above, and curated for the same reason: `GtkFlowBox`
        // names it as its `wrap` (the descriptor above), so a template that writes the
        // wrapper needs the wrapper's own child policy to place anything inside it. Without
        // this entry a `<gtk-flow-box-child>` raises `uncurated-placement` for a `<gtk-label>`
        // that `GtkFlowBoxChild` accepts in C — `gtk_flow_box_child_set_child` is the setter
        // this names — which is the false refusal arm 5b of
        // `check-generated-website-data.mjs` exists to catch. `GtkListBoxRow` and
        // `GtkFlowBoxChild` are the same Bin wrapper written twice upstream (gtklistbox.c:
        // 3954, gtkflowbox.c:571), and curating one and not the other is how a pair drifts.
        gtype: 'GtkFlowBoxChild',
        ctor: () => Gtk.FlowBoxChild,
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
        // THE REVEALER IS A BIN, and that is the whole of its placement. `GtkBuildable`
        // routes a widget child to exactly one place — `gtk_revealer_buildable_add_child`
        // has no `type` arm at all, so every child it takes goes to
        // `gtk_revealer_set_child` (gtkrevealer.c:666-679) — and the `child` property is
        // installed with that setter (gtkrevealer.c:747-749, `GTK_TYPE_WIDGET`). `single`
        // rather than `uncurated` for the reason `GtkFrame` above is: the ONE thing an
        // application does with a revealer is give it something to hide.
        //
        // The four `transition-*`/`reveal-*` properties beside it are PROPERTIES, not
        // placement — `policyProblems()` holds the methods a row names and nothing else,
        // so their presence or absence in this comment changes nothing GTK does.
        gtype: 'GtkRevealer',
        ctor: () => Gtk.Revealer,
        children: { kind: 'single', set: 'set_child' },
    },
    {
        // TWO SLOTS, and `slotted` rather than `single` because they are not
        // interchangeable: `gtk_expander_buildable_add_child` reads a `type`, and
        // `"label"` goes to `gtk_expander_set_label_widget` while a bare widget child
        // goes to `gtk_expander_set_child` (gtkexpander.c:449-465). Both properties are
        // widget-typed (`label-widget` at :351, `child` at :370), so a descriptor that
        // declared only the `child` would refuse a placement GTK accepts.
        //
        // NO `remove`, and the absence is the measurement rather than an oversight: every
        // slot here is a `set_`-prefixed setter, which `detachChild` empties by writing
        // `null` back through itself. MEASURED: this class has no `remove` method of its
        // own, every `remove*` on it being `GtkWidget`'s. `Adw.NavigationSplitView` in
        // `adw.ts` is the row that states the same rule for the same reason.
        gtype: 'GtkExpander',
        ctor: () => Gtk.Expander,
        children: {
            kind: 'slotted',
            slots: { child: 'set_child', label: 'set_label_widget' },
            defaultSlot: 'child',
        },
    },
    {
        // TWO SLOTS, NAMED, and the setters GTK's own buildable routes to:
        // `gtk_paned_buildable_add_child` reads `"start"` and `"end"` and calls
        // `gtk_paned_set_start_child` / `gtk_paned_set_end_child` (gtkpaned.c:793-834);
        // the properties are installed right beside the four resize/shrink flags the same
        // function writes (:501-534 for the flags, :544 and :554 for the two children).
        //
        // `defaultSlot: 'start'` is the branch a typeless child takes FIRST (gtkpaned.c:
        // :814-822), so a `<gtk-label>` with no slot lands where GtkBuilder would put it.
        // That branch then FILLS the second untyped child into `end`, which one
        // `defaultSlot` cannot spell — an unslotted tree gets `start` for every child, so
        // the SECOND one replaces the first. Declared rather than papered over, because
        // the alternative is a silent replacement at exit 0; the answer in a tree is two
        // `slot` attributes.
        //
        // AND THE RESIZE/SHRINK FLAGS ARE NOT PLACEMENT. `gtk_paned_buildable_add_child`
        // sets `resize-start-child: false` and `shrink-start-child: true` beside the
        // start child (gtkpaned.c:803-805) — that is GtkBuilder's per-slot DEFAULT, not
        // an adoption rule, and the pspecs (:501-534) still default both flags to TRUE for
        // everybody. They are props a tree writes and nothing here claims them.
        gtype: 'GtkPaned',
        ctor: () => Gtk.Paned,
        children: {
            kind: 'slotted',
            slots: { start: 'set_start_child', end: 'set_end_child' },
            defaultSlot: 'start',
        },
    },
    {
        // THREE NAMED SLOTS. GTK's buildable reads three type names — `"start"`,
        // `"center"`, `"end"` — and each routes to its own setter (gtkcenterbox.c:113-135);
        // the three properties are `start-widget`, `center-widget` and `end-widget`
        // (:285, :297, :313), over a `GTK_TYPE_CENTER_LAYOUT` (:344) rather than a bin
        // layout. This is the THREE-slot member of the family `GtkOverlay` above already
        // curates: named attachment points that are not interchangeable, so `slotted` and
        // not `ordered`.
        //
        // `defaultSlot: 'center'` because the CENTRE is the one the widget is named for
        // and the one an unslotted author means — and it is the one a header bar's own
        // uses, since libadwaita builds a `GtkCenterBox` inside every `Adw.HeaderBar`
        // (MEASURED by `slotHonoured` in `scripts/generate-adwaita-framework-snippets.mjs`,
        // which reads `get_start_widget()`/`get_end_widget()` off it to tell two slots
        // apart; there the centre holds the title widget). `Gtk.Paned`'s default is
        // `start`, for the branch a typeless child takes first there.
        //
        // `remove` is absent for the same reason `Gtk.Expander`'s is above: all three slots
        // are setters, and MEASURED this class has no `remove` method of its own (every
        // `remove*` on it being `GtkWidget`'s), so `detachChild` empties each by writing
        // `null` back through its own setter.
        gtype: 'GtkCenterBox',
        ctor: () => Gtk.CenterBox,
        children: {
            kind: 'slotted',
            slots: {
                start: 'set_start_widget',
                center: 'set_center_widget',
                end: 'set_end_widget',
            },
            defaultSlot: 'center',
        },
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
