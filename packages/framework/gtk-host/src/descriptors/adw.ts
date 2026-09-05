// Curated libadwaita descriptors. Same rule as gtk.ts: what the GIR cannot say.

import Adw from 'gi://Adw?version=1';

import type { NodePlacement, WidgetDescriptor } from '../types.js';

/**
 * The placement every `Adw.Dialog` shares — ADR 0045, and the whole of the seam's
 * shipped membership.
 *
 * `present` and `force_close` are measured on libadwaita 1.9.3; the three
 * measurements that pick those two names, rather than `close`, are on
 * `NodePlacement`'s portal arm in `types.ts`.
 *
 * ONE CONSTANT AND FIVE ROWS, because a portal is a fact about the TYPE and
 * libadwaita has five of them (measured with `GObject.type_is_a`:
 * `AdwDialog`, `AdwAboutDialog`, `AdwAlertDialog`, `AdwPreferencesDialog`,
 * `AdwShortcutsDialog`; `AdwMessageDialog` is NOT one — it is a `GtkWindow`).
 * They are named rather than derived because registration is exact: the generated
 * table registers each subclass under its own GType with `children:
 * { kind: 'uncurated' }`, so an inherited placement would never be looked up and
 * `<adw-alert-dialog>` under a rooted box would abort the process. `portal
 * placement is inherited by every Adw.Dialog subclass` in `portal.spec.ts` is what
 * keeps the list complete when libadwaita adds the sixth.
 */
const DIALOG_PORTAL: NodePlacement = { kind: 'portal', present: 'present', close: 'force_close' };

export const ADW_DESCRIPTORS: readonly WidgetDescriptor[] = [
    {
        gtype: 'AdwDialog',
        ctor: () => Adw.Dialog,
        // ONE CHILD, and the ordinary `AdwBin` rule: MEASURED on libadwaita 1.9.3,
        // `set_child`/`get_child` are the only child-taking pair on the class. The
        // interesting half of this descriptor is `placement`, not `children` — the
        // dialog adopts its content exactly like every other bin and reaches the
        // screen like nothing else in the table.
        children: { kind: 'single', set: 'set_child' },
        placement: DIALOG_PORTAL,
    },
    // The four subclasses. `uncurated` CHILDREN is the honest state and not an
    // oversight: each builds its own template out of its own API (`add_response`
    // on the alert, `add` on the preferences dialog), and every one of them
    // INHERITS `set_child` from `AdwDialog`, where writing through it would
    // replace that template — the `AdwExpanderRow` trap one class up. So the tag
    // can be created, propertied, presented and closed, and a child in it is a
    // named `uncurated-placement` refusal rather than a silent replacement.
    {
        gtype: 'AdwAlertDialog',
        ctor: () => Adw.AlertDialog,
        children: { kind: 'uncurated' },
        placement: DIALOG_PORTAL,
    },
    {
        gtype: 'AdwAboutDialog',
        ctor: () => Adw.AboutDialog,
        children: { kind: 'uncurated' },
        placement: DIALOG_PORTAL,
    },
    {
        gtype: 'AdwPreferencesDialog',
        ctor: () => Adw.PreferencesDialog,
        children: { kind: 'uncurated' },
        placement: DIALOG_PORTAL,
    },
    {
        gtype: 'AdwShortcutsDialog',
        ctor: () => Adw.ShortcutsDialog,
        children: { kind: 'uncurated' },
        placement: DIALOG_PORTAL,
    },
    // A child holder like GTK's three, and it arrives here for the same reason: the
    // rule selects a concrete non-widget that declares both halves of a one-child slot
    // whose child is a widget, and this is the fourth and only Adw member of that set.
    // The rule runs in ts-for-gir now and arrives as `CHILD_HOLDERS`. It
    // was NOT on the hand-written list that preceded the rule — which is the argument
    // for having a rule.
    {
        gtype: 'AdwToggle',
        ctor: () => Adw.Toggle,
        children: { kind: 'single', set: 'set_child' },
    },
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
        gtype: 'AdwExpanderRow',
        ctor: () => Adw.ExpanderRow,
        // THREE slots, and the default is the one the action row does not have.
        // MEASURED on libadwaita 1.9.3: `add_row`, `add_prefix`, `add_suffix` and
        // `remove` exist; `insert` and `add` do not. `set_child` DOES exist — inherited
        // from `GtkListBoxRow` — and is the trap this entry closes: writing through it
        // replaces the widget's own template, taking the header, the disclosure and the
        // chevron with it, at exit 0. Only a descriptor can say which of the two a child
        // means here.
        //
        // `defaultSlot: 'row'` because an unslotted child of an expander is a DISCLOSED
        // row — the placement the widget exists for, and the one `AdwActionRow`'s policy
        // has no counterpart of. Measured, the three land in different trees: `add_row`
        // puts the child under `GtkListBox < GtkRevealer < AdwExpanderRow`, `add_suffix`
        // inside the header `AdwActionRow`, so the choice is observable rather than
        // cosmetic.
        //
        // `wrapSlots` ON THE `row` SLOT, AND IT IS THE WRAP OR A LEAK. `add_row` hands
        // the child to an inner `Gtk.ListBox`, which puts a non-row child inside an
        // implicit `GtkListBoxRow` — and `gtk_list_box_remove` does NOT unwrap:
        // MEASURED on GTK 4.22.4, removing the original child answers `Gtk-WARNING **:
        // Tried to remove non-child 0x…` and leaves it parented, for a `Gtk.Label` and a
        // `Gtk.Button` alike, while an `Adw.ActionRow` (which IS a `GtkListBoxRow`)
        // round-trips to a null parent. Unmount is where it surfaces, so untreated it is
        // a leaked widget behind one warning line at exit 0 — the class
        // `installDiagnosticsGate` exists for, and the class the host's own
        // "every slotted descriptor survives a round trip through every slot" mechanism
        // caught this descriptor with before it shipped. So the host makes the row
        // itself, exactly as it does for `GtkListBox`, and addresses that.
        children: {
            kind: 'slotted',
            slots: { prefix: 'add_prefix', suffix: 'add_suffix', row: 'add_row' },
            defaultSlot: 'row',
            remove: 'remove',
            wrapSlots: { row: 'list-box-row' },
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
        //
        // AND `remove-all` COSTS THE PAGE OBJECT. A reorder removes and re-adds every
        // child, so every `Adw.ViewStackPage` is rebuilt. `name` and `title` come back
        // because `add_titled` re-supplies them from `layout`; MEASURED, `icon-name`,
        // `badge-number`, `needs-attention` and `use-underline` do not —
        // `go-home-symbolic/7/true/true` before a reversal, `null/0/false/false`
        // after. A layer that sets them therefore has to re-apply on every commit,
        // which is what `useViewStackPageProperties` in `@gjsify/adwaita-react-native`
        // does with a dependency-array-free effect. Pre-existing and unrelated to
        // `hideBeforeRemove` below: both arms of that A/B lose the same four.
        children: {
            kind: 'keyed',
            add: 'add_titled',
            remove: 'remove',
            nameFrom: 'name',
            titled: true,
            // libadwaita never clears `last_visible_child` when a page is removed,
            // and a keyed reorder removes every page. See `types.ts` for the
            // measurement and the exact critical this suppresses.
            hideBeforeRemove: true,
        },
    },
    {
        gtype: 'AdwClamp',
        ctor: () => Adw.Clamp,
        // MEASURED on libadwaita 1.9.3: `set_child` / `get_child`, nothing else that
        // takes a child. The same rule as `AdwBin`, and it was missing for the widget
        // libadwaita's own layout advice reaches for first — `<adw-clamp>` with a child
        // raised `uncurated-placement` in every JSX dialect this host serves.
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwToastOverlay',
        ctor: () => Adw.ToastOverlay,
        // MEASURED on libadwaita 1.9.3: the only child-taking pair on this class is
        // `set_child`/`get_child` — the same `AdwBin` rule. `add_toast` and
        // `dismiss_all` are on it too and are NOT placement: an `Adw.Toast` is a
        // GObject, not a widget, and libadwaita builds the `AdwToastWidget` that shows
        // it itself. So the overlay has exactly one child (the wrapped content) and the
        // toast layer is not addressable from a renderer at all.
        //
        // It was uncurated until `@gjsify/adwaita-react-native` needed it, which means
        // `<adw-toast-overlay>` with a child raised `uncurated-placement` in every JSX
        // dialect this host serves — the same hole `AdwClamp` had, on the widget an
        // application wraps its whole window in.
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwClampScrollable',
        ctor: () => Adw.ClampScrollable,
        // The scrollable sibling, and the same measurement: `set_child`/`get_child`.
        // Curated together with `AdwClamp` because the two are chosen by whether the
        // child scrolls, never by how it is adopted — leaving one uncurated would make
        // that choice look like a placement decision.
        //
        // ITS CHILD MUST IMPLEMENT `GtkScrollable`, and nothing here can say so. This
        // class forwards its own `hadjustment`/`vadjustment`/`hscroll-policy`/
        // `vscroll-policy` to the child through `g_object_bind_property`, so a child
        // without them is FOUR warnings at exit 0 — measured with a `GtkLabel`:
        // `gbinding.c:1301: The target object of type GtkLabel has no property called
        // 'hadjustment'`, and three more. The widget appears, nothing throws, and the
        // scrolling silently does not work. A descriptor declares HOW a child is
        // adopted, never WHICH child is allowed (that is `rejectedChild`'s territory
        // and GTK's knowledge), so this is written down rather than enforced —
        // `GtkTextView`, `GtkViewport` and `GtkListView` are scrollable, `GtkLabel`
        // and `GtkButton` are not.
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwBreakpointBin',
        ctor: () => Adw.BreakpointBin,
        // MEASURED: `set_child`/`get_child`, plus `add_breakpoint`/`remove_breakpoint`.
        // Only the first pair is a CHILD policy. An `Adw.Breakpoint` is not a widget —
        // it is a GObject holding a condition and its setters (`set_condition`,
        // `add_setter`, measured) — so it can be neither a child nor a slot here, and a
        // renderer applies it imperatively against the widget. It is not even a TAG:
        // the generated table carries `GtkWidget` descendants only, so
        // `createElement('AdwBreakpoint')` is `unknown-tag`. MEASURED with one
        // registered by hand anyway, the placement is refused as `rejected-child`,
        // carrying GTK's own `Object is of type Adw.Breakpoint - cannot convert to
        // GtkWidget` — NOT as `not-a-widget`: `addressOf()` throws that only for an
        // element with no widget at all, and a materialized `Adw.Breakpoint` is a
        // perfectly real GObject that walks straight through it.
        children: { kind: 'single', set: 'set_child' },
    },
    {
        gtype: 'AdwNavigationSplitView',
        ctor: () => Adw.NavigationSplitView,
        // Two setter-backed slots, and the reason `slotted.remove` is optional.
        // MEASURED: this class has `set_sidebar`/`set_content` (+ their getters) and NO
        // remove method of its own — every `remove*` on it is `GtkWidget`'s
        // (`remove_controller`, `remove_css_class`, `remove_mnemonic_label`,
        // `remove_tick_callback`). A setter-backed slot is emptied by writing `null`
        // back through the setter, which `detachChild` already does, so naming a remove
        // here would be a claim `descriptorProblems()` correctly rejects rather than a
        // capability.
        children: {
            kind: 'slotted',
            slots: { sidebar: 'set_sidebar', content: 'set_content' },
            defaultSlot: 'content',
        },
    },
    {
        gtype: 'AdwOverlaySplitView',
        ctor: () => Adw.OverlaySplitView,
        // Same shape, same measurement as `AdwNavigationSplitView`, and the same
        // absent remove. The difference between the two is collapse BEHAVIOUR, not
        // adoption: this one overlays the sidebar, the other one replaces the content.
        children: {
            kind: 'slotted',
            slots: { sidebar: 'set_sidebar', content: 'set_content' },
            defaultSlot: 'content',
        },
    },
    {
        gtype: 'AdwWrapBox',
        ctor: () => Adw.WrapBox,
        // `GtkBox`'s policy, on the libadwaita widget that wraps. MEASURED on
        // libadwaita 1.9.3: `append`, `prepend`, `remove`, `remove_all`,
        // `insert_child_after` and `reorder_child_after` are all present, so the O(1)
        // reorder path is real and this pays no tail re-append.
        //
        // Curated because the generated table cannot be: `adw-wrap-box` was a tag a
        // renderer could CREATE and never fill — `uncurated-placement` on the first
        // child — which, for a container whose entire purpose is holding children, is
        // the hole `AdwClamp` had. Found from `@gjsify/adwaita-react-native`, whose
        // `AdwWrapBox` is this host's first consumer of the tag.
        children: {
            kind: 'ordered',
            append: 'append',
            after: 'insert_child_after',
            remove: 'remove',
            reorder: 'native',
        },
    },
];
