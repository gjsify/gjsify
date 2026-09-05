// The element model UI-framework renderers bind to.
//
// Every framework renderer contract (Vue `RendererOptions`, React `HostConfig`,
// Solid `solid-js/universal`, the Svelte custom-renderer PR) reduces to the same
// small set of operations over a node tree. This file describes that tree.
//
// The tree is a SHADOW tree, deliberately: `parent`/`first`/`next` are our own
// links, never `Gtk.Widget.get_parent()`/`get_first_child()`. Text nodes and
// anchors have no widget, so the GTK tree cannot answer navigation questions
// about them — and a renderer that asks GTK gets an off-by-one insertion the
// moment a `v-if` places a comment anchor between two widgets.

import type GObject from '@girs/gobject-2.0';
import type Gtk from '@girs/gtk-4.0';

export type NodeKind = 'element' | 'text' | 'anchor';

export interface HostNodeBase {
    readonly kind: NodeKind;
    parent: HostElement | null;
    prev: HostNode | null;
    next: HostNode | null;
}

/** A text run. GTK has no text node — the OWNING element writes it to its text sink. */
export interface HostText extends HostNodeBase {
    readonly kind: 'text';
    data: string;
}

/**
 * A position marker. Vue's `createComment` and Svelte's comment markers land here.
 * An anchor NEVER enters the GTK tree; `insert` resolves forward past it to the
 * next node that actually owns a widget.
 */
export interface HostAnchor extends HostNodeBase {
    readonly kind: 'anchor';
    data: string;
}

export interface HostElement extends HostNodeBase {
    readonly kind: 'element';
    readonly descriptor: WidgetDescriptor;
    /** null until materialisation — construct-only properties must be known first. */
    widget: GObject.Object | null;
    /** `Gtk.ListBoxRow` & friends: the object the PARENT addresses, not the child itself. */
    wrapper: Gtk.Widget | null;
    /** Declared by the CHILD (`slot="end"`), not derived from its position. */
    slot: string | null;
    first: HostNode | null;
    last: HostNode | null;
    /**
     * signal name -> the one native handler, and the prop that owns it.
     *
     * One handler per signal name, ever. The owner is recorded because two props
     * can resolve to the same signal (`onClicked` and `on:clicked`), and the
     * second used to disconnect the first without saying so.
     */
    handlers: Map<string, { id: number; prop: string }>;
    /** Authored property values, kebab-normalised. Kept after materialisation so a
     *  construct-only change can rebuild the widget from the same intent. */
    props: Record<string, unknown>;
    /** Authored signal callbacks by prop name — a rebuild has to re-bind them. */
    listeners: Map<string, (...args: unknown[]) => unknown>;
    /** Positional data for `coords` parents (`Gtk.Grid`), read off the child. */
    layout: Record<string, unknown> | null;
    /** True once text CHILDREN wrote the sink, so removing the last one clears it
     *  instead of leaving the stale string an authored prop never set. */
    textFromChildren: boolean;
    /**
     * True while this element is actually IN its parent's GTK tree.
     *
     * Owning a widget is not the same thing: every framework builds bottom-up,
     * so a subtree is materialised long before it is inserted. Deriving "is my
     * sibling in the tree" from `widget !== null` made the remove-all policy
     * detach non-children and re-add already-parented ones — two Adwaita
     * criticals per replay, at exit 0.
     */
    attached: boolean;
    /** True once `destroy` has torn this element down. It never comes back. */
    destroyed: boolean;
    /**
     * Children this element already had before the host adopted it.
     *
     * Only an ADOPTED root has any: a renderer mounts into a container the
     * application built, and those children are in the GTK tree while being absent
     * from the shadow tree. Placement offsets past them, or the first insertion
     * computes "first" and the whole rendered tree lands ABOVE the app's own chrome.
     */
    foreign: readonly Gtk.Widget[];
    /**
     * A PORTAL node's subscription to its parent's `root`, or null.
     *
     * Only a `portal` placement ever has one, and it is per-attachment state
     * exactly like `wrapper` — a side table keyed on the element would be a second
     * tree that can disagree with this one. See {@link NodePlacement}'s portal arm
     * for what the subscription is for and what it was measured against.
     */
    portalWatch: { widget: Gtk.Widget; id: number } | null;
}

export type HostNode = HostElement | HostText | HostAnchor;

// ---------------------------------------------------------------------------
// Node placement — how a node reaches the screen at all
// ---------------------------------------------------------------------------

/**
 * The axis ABOVE `ChildPolicy`, and the two are orthogonal on purpose.
 *
 * `ChildPolicy` answers "how does this parent adopt a child". It presumes the
 * answer to a question nobody had to ask until now: *does this node go into its
 * parent at all?* For every widget in the table it does. For an `Adw.Dialog` it
 * does not, and the difference is not a degradation the parent can absorb —
 * MEASURED on libadwaita 1.9.3 / GTK 4.22.4 / gjs 1.88.1, `box.append(dialog)`
 * with the box ROOTED IN A WINDOW reaches
 *
 *     Adwaita-ERROR **: Trying to add AdwDialog 0x… to GtkBox 0x…. Use
 *     adw_dialog_present() to show dialogs.
 *
 * which is `g_error()`: SIGABRT, exit 134, a core dump. Not an exception a `try`
 * in the reconciler can catch and not a warning a diagnostics gate can count.
 * `adw_dialog_root()` raises it from the ROOT vfunc, which is why a DETACHED box
 * accepts the very same append in silence at exit 0 — re-testing this on a bare
 * box "disproves" it and puts the append back.
 *
 * So the descriptor declares the axis, and `policies.ts` is the only reader.
 * `parented` is every other widget and is what an ABSENT `placement` means; the
 * union still cannot be forgotten because there is exactly one normaliser
 * (`placementOf`) and every switch over it ends in `unhandledPlacement`.
 */
export type NodePlacement =
    /** The parent's `ChildPolicy` places it. Every widget but the dialog family. */
    | { readonly kind: 'parented' }
    /**
     * The node places ITSELF against its parent: `present(parent)` / `close()`.
     *
     * Three measurements shape the two method names, all on libadwaita 1.9.3:
     *
     *  - `present` TAKES THE PARENT WIDGET (`adw_dialog_present` arity 1, against
     *    `gtk_window_present`'s 0). That is what makes this a portal rather than a
     *    toplevel: the node has a place in the shadow tree and a different place in
     *    the GTK tree, and the parent is what joins them.
     *  - `close` IS THE UNCONDITIONAL ONE, `force_close` and not `close`. An
     *    unmount is not a user request: with `can-close: false` (which is how
     *    `onRequestClose` is honoured one layer up) `adw_dialog_close()` returns
     *    FALSE, emits `close-attempt` and LEAVES THE DIALOG ON SCREEN — measured.
     *    `force_close()` closes it and emits `closed`.
     *  - AND `force_close` IS SAFE ON A NODE THAT WAS NEVER PRESENTED, where
     *    `close` is not: measured, `close()` on an unpresented dialog answers
     *    `Adwaita-CRITICAL **: Trying to close AdwDialog 0x… that's not presented`
     *    at exit 0, and `force_close()` is silent. So the host needs no
     *    "is it up?" probe before retracting one.
     */
    | { readonly kind: 'portal'; readonly present: string; readonly close: string };

// ---------------------------------------------------------------------------
// Child placement
// ---------------------------------------------------------------------------

export type PolicyKind = 'none' | 'single' | 'ordered' | 'indexed' | 'slotted' | 'keyed' | 'coords';

/**
 * How a parent adopts children. GTK4 deleted `GtkContainer`, so there is no
 * generic `add`. `Gtk.Buildable.add_child` is introspected as a vfunc only
 * (`typeof headerBar.add_child === 'undefined'`, gjs 1.88.1) — but the vfunc form
 * IS callable and DOES dispatch correctly, measured across 29 containers, so it is
 * a real escape hatch. This comment used to claim otherwise.
 *
 * The table exists because the generic call is unsafe as a default, not because it
 * is unavailable: `GtkLabel.vfunc_add_child` accepts a child and says nothing until
 * `Finalizing GtkLabel …, but it still has children left` at teardown. Every
 * container states its own rules here, and a widget with no rule is REFUSED.
 */
export type ChildPolicy =
    | { kind: 'none' }
    /** `set_child` / `set_content` / `set_titlebar`: at most one child. */
    | { kind: 'single'; set: string }
    /**
     * Sequential children. `after` is the O(1) reorder path
     * (`Gtk.Box.insert_child_after`); a container without it — `Adw.PreferencesGroup`
     * has `add`/`remove` but no `insert`, measured — declares `reorder: 'remove-all'`
     * and pays a full re-append per reorder. That degradation is DECLARED, never silent.
     */
    | { kind: 'ordered'; append: string; after?: string; remove: string; reorder: 'native' | 'remove-all' }
    /** `Gtk.ListBox`/`Gtk.FlowBox`: index-addressed, and the parent addresses a WRAPPER row. */
    | { kind: 'indexed'; insert: string; remove: string; wrap: 'list-box-row' | 'flow-box-child' | null }
    /**
     * `Adw.HeaderBar`, `Adw.ToolbarView`, `Adw.ActionRow`: named attachment points.
     *
     * `remove` is OPTIONAL because a slot can be backed two ways and only one of them
     * needs it. A `set_`-prefixed slot is emptied by writing `null` back through the
     * same setter (`detachChild` already does exactly that, via `setterSlotOf`), so a
     * policy whose slots are ALL setters never reaches a remove method — and
     * `Adw.NavigationSplitView` / `Adw.OverlaySplitView` have none to name: measured on
     * libadwaita 1.9.3, their only `remove*` methods are `GtkWidget`'s
     * (`remove_controller`, `remove_css_class`, …). Declaring `remove: 'remove'` there
     * would be a claim `descriptorProblems()` correctly rejects.
     *
     * An ADDER-backed slot (`add_top_bar`, `pack_start`) is the opposite: nothing takes
     * a child back out of it but a remove method, so `remove` is REQUIRED the moment one
     * slot does not start with `set_`. That rule is machine-checked in `policyProblems()`
     * rather than left to this comment — optional in the type and unchecked would turn
     * `Adw.ToolbarView` losing its `remove` into a `TypeError` deep inside an unmount.
     */
    | {
          kind: 'slotted';
          slots: Record<string, string>;
          defaultSlot: string;
          remove?: string;
          /**
           * Slots whose adder hands the child to an inner `Gtk.ListBox`, and which
           * therefore need the same wrap `indexed` declares — keyed by slot, because a
           * widget can have one such slot and two ordinary ones.
           *
           * MEASURED on GTK 4.22.4, and it is the wrap or a leak: `gtk_list_box_remove`
           * does NOT unwrap. A `Gtk.ListBox` given a non-row child puts it inside an
           * implicit `GtkListBoxRow`, and removing the ORIGINAL child then answers
           * `Gtk-WARNING **: Tried to remove non-child 0x…` and leaves it parented —
           * with a plain `Gtk.Label` and with a `Gtk.Button` alike. `Adw.ExpanderRow`'s
           * `add_row` is that adder, so its disclosure slot declares the wrap and the
           * host addresses the row it made.
           */
          wrapSlots?: Readonly<Record<string, 'list-box-row'>>;
      }
    /**
     * `Gtk.Stack`, `Adw.NavigationView`: children addressed by name/tag.
     *
     * `titled` states the ARITY, because it differs and getting it wrong is not
     * a type error: `gtk_stack_add_titled(child, name, title)` requires all
     * three and GJS throws "At least 3 arguments required" (measured), while
     * `adw_navigation_view_add(page)` takes one. `descriptorProblems()` checks
     * that a method EXISTS, never how many arguments it wants.
     */
    | {
          kind: 'keyed';
          add: string;
          remove: string;
          nameFrom: string;
          titled: boolean;
          /**
           * Take the child out of view BEFORE the parent removes it, and put its
           * own `visible` back afterwards. Declared per widget, because it is a
           * defect in one of them rather than a property of being keyed.
           *
           * The defect is libadwaita's. `stack_remove` — what both
           * `adw_view_stack_remove` and dispose call — clears `visible_child`, then
           * does `g_clear_object (&page->widget)`, and never touches
           * `last_visible_child`, which can still point at that same page. A later
           * reader then dereferences a page whose widget is NULL:
           *
           *     Gtk-CRITICAL **: gtk_widget_set_child_visible: assertion 'GTK_IS_WIDGET (widget)' failed
           *
           * Source: `refs/libadwaita/src/adw-view-stack.c` — `stack_remove` at 1184,
           * the stale read at 934 in `transition_done_cb`. Read at 42f647f
           * (1.10.alpha.1); that file is byte-identical at the 1.9.3 tag, which is
           * what is installed here, so one reading covers both.
           *
           * MEASURED on libadwaita 1.9.3 / GTK 4.22.4 / GJS 1.88.1. Reproducer, no
           * renderer involved: add `a` and `b`, present a window holding the stack,
           * `set_visible_child_name('b')`, `remove(a)`, then let the window go away.
           * Each precondition alone is silent, a stack never made visible included —
           * `set_visible_child` only records `last_visible_child` when
           * `gtk_widget_is_visible` answers yes. `Gtk.Stack` and
           * `Adw.NavigationView`, the other two `keyed` descriptors, do not
           * reproduce it at all, which is why this is a field and not the kind.
           *
           * WHICH read fires decides what a test has to do, so it is measured rather
           * than listed: the UNMAP one. `AdwAnimation` connects `adw_animation_skip`
           * to its widget's `unmap` (`adw-animation.c`) and the skip runs
           * `transition_done_cb`, so merely hiding the window is enough and
           * destroying it does the same — while a queued resize plus draw, and a
           * direct `measure()`, both stayed quiet. The file's other reads (snapshot,
           * size-allocate, measure) are real paths this reproducer does not reach.
           *
           * Hiding first is libadwaita's OWN cleanup: the visibility notify runs
           * `update_child_visible`, which does clear `last_visible_child`. Measured
           * SUFFICIENT and not merely necessary — 400 randomised
           * add/remove/switch/reorder steps against a live 200 ms transition, three
           * seeds, 44/23/25 criticals unpatched against 0/0/0 patched.
           *
           * The restore is load-bearing. `reorderMode` answers `remove-all` for
           * `keyed`, and measured, a reversal that hides without restoring leaves the
           * stack with no visible child and no way back: the last line of
           * `adw_view_stack_set_visible_child_name` is
           * `if (gtk_widget_get_visible (page->widget)) set_visible_child (...)`, so
           * for a hidden page it is a no-op with no warning at all.
           */
          hideBeforeRemove?: boolean;
      }
    /** `Gtk.Grid`: position is data on the child, so document order carries nothing. */
    | { kind: 'coords'; attach: string; remove: string }
    /**
     * Generated, not curated: the tag exists, its placement rule does not.
     *
     * The generated table adds every concrete GtkWidget descendant the GIR
     * describes, plus the placement carriers, while the curated table measures placement for a
     * fraction. Guessing an adder for the rest would be the worst of the three
     * options: `add` and `append` and `set_child` all exist somewhere in GTK, and
     * calling the wrong one is a warning at exit 0.
     *
     * So the honest state is spelled out. Such a widget can be CREATED and given
     * properties and handlers; inserting a child raises a named error that says
     * which tag needs a curated policy. A leaf widget — most of the table — needs
     * nothing more.
     */
    | { kind: 'uncurated' };

/**
 * One row of the GENERATED table: a tag, its GType, and how to reach the class.
 *
 * Deliberately not a `WidgetDescriptor`: it carries no placement rule, so making
 * it the same type would invite a `children` field to appear here and become a
 * second source for what `descriptors/` owns.
 */
export interface GeneratedWidget {
    readonly gtype: string;
    readonly tag: string;
    readonly ctor: () => GObject.ObjectClass & (new (props?: Record<string, unknown>) => GObject.Object);
}

export interface WidgetDescriptor {
    /** GType name — and the tag a renderer writes. `GtkButton`, `AdwActionRow`. */
    readonly gtype: string;
    /** Lazy so `gi://` loads late and an unused descriptor costs nothing. */
    readonly ctor: () => GObject.ObjectClass & (new (props?: Record<string, unknown>) => GObject.Object);
    readonly children: ChildPolicy;
    /**
     * How this node reaches the screen. Absent means `{ kind: 'parented' }`.
     *
     * Optional rather than required, and the reason is the shape of the table
     * rather than convenience: the generated half is the whole GIR widget set and
     * not one row of it is a portal, so a required field would be ~900 identical
     * lines. Nothing is left implicit by that — `placementOf()` normalises the
     * absence in ONE place and every switch over the result has a `never` arm, so
     * a third placement kind cannot be added without every reader failing to
     * compile. `descriptorProblems()` holds the declared methods against the
     * installed class, exactly as it does for `children`.
     */
    readonly placement?: NodePlacement;
    /**
     * Where a text child goes. Absent means text under this widget is an ERROR
     * that names the tag — never a silent drop.
     */
    readonly textSink?: string;
    /** `onActivate` -> `activate` is derived; irregular pairs live here, in the TABLE. */
    readonly eventAliases?: Readonly<Record<string, string>>;
    /**
     * Construct-only properties whose ABSENCE aborts the process rather than
     * raising — see `REQUIRED_CONSTRUCT_PROPS` in `descriptors/` for the measurement.
     * Checked in `materialize`, because after `g_object_new` there is nothing left
     * to check with.
     */
    readonly requiresProps?: readonly string[];
}
