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
}

export type HostNode = HostElement | HostText | HostAnchor;

// ---------------------------------------------------------------------------
// Child placement
// ---------------------------------------------------------------------------

export type PolicyKind = 'none' | 'single' | 'ordered' | 'indexed' | 'slotted' | 'keyed' | 'coords';

/**
 * How a parent adopts children. GTK4 deleted `GtkContainer`, so there is no
 * generic `add` — and `Gtk.Buildable.add_child` is introspected as a vfunc only
 * (`typeof headerBar.add_child === 'undefined'`, measured on gjs 1.88.1), so it
 * is not an escape hatch either. Every container states its own rules here.
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
    /** `Adw.HeaderBar`, `Adw.ToolbarView`, `Adw.ActionRow`: named attachment points. */
    | { kind: 'slotted'; slots: Record<string, string>; defaultSlot: string; remove: string }
    /**
     * `Gtk.Stack`, `Adw.NavigationView`: children addressed by name/tag.
     *
     * `titled` states the ARITY, because it differs and getting it wrong is not
     * a type error: `gtk_stack_add_titled(child, name, title)` requires all
     * three and GJS throws "At least 3 arguments required" (measured), while
     * `adw_navigation_view_add(page)` takes one. `descriptorProblems()` checks
     * that a method EXISTS, never how many arguments it wants.
     */
    | { kind: 'keyed'; add: string; remove: string; nameFrom: string; titled: boolean }
    /** `Gtk.Grid`: position is data on the child, so document order carries nothing. */
    | { kind: 'coords'; attach: string; remove: string }
    /**
     * Generated, not curated: the tag exists, its placement rule does not.
     *
     * The generated table adds every concrete GtkWidget descendant the GIR
     * describes — 164 of them — while the curated table measures placement for a
     * fraction. Guessing an adder for the rest would be the worst of the three
     * options: `add` and `append` and `set_child` all exist somewhere in GTK, and
     * calling the wrong one is a warning at exit 0.
     *
     * So the honest state is spelled out. Such a widget can be CREATED and given
     * properties and handlers; inserting a child raises a named error that says
     * which tag needs a curated policy. A leaf widget — most of the 164 — needs
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
