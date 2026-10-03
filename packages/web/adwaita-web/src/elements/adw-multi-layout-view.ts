// <adw-multi-layout-view> — one set of children, several arrangements of them.
//
// Each child has an ID, each layout has slots, each slot has an ID; switching layouts
// re-inserts every child into the slot of the SAME ID (adw-multi-layout-view.c:16-26).
// That is what lets a secondary pane be a sidebar in one layout and a bottom bar in
// another without the application moving anything: the children are declared once and
// the view decides where they sit.
//
// THE MARKUP FORM, because two of the three objects have no tag. `Adw.Layout` is a
// GObject (`G_DEFINE_TYPE… G_TYPE_OBJECT`, adw-layout.c:37), so it is not in a table of
// concrete widgets and has no element of its own; `Adw.Breakpoint`-style GObjects in this
// package became markup children, and so does this one:
//
//   * a direct child carrying `name` is a LAYOUT, and that element is its content —
//     `AdwLayout:content` is construct-only (adw-layout.c:144), so the layout IS the
//     tree rather than a wrapper around one;
//   * any other direct child is a CHILD, keyed by its `slot` attribute, which is the
//     GtkBuilder `<child type="ID">` of adw-multi-layout-view.c:88;
//   * an `<adw-layout-slot id="…">` inside a layout is where a child with that ID lands.
//
// Attributes:
//   layout-name  (`Adw.MultiLayoutView:layout-name` — the name of the layout in use.
//                Setting a name no layout carries logs the C's `g_critical` text
//                (adw-multi-layout-view.c:520) and leaves the current layout alone.)
//
// Methods:
//   `getChild(id)` — `adw_multi_layout_view_get_child` (:635).
//   `getLayoutByName(name)` — `adw_multi_layout_view_get_layout_by_name` (:605).
//   `registerSlot(id, slot)` — `adw_multi_layout_view_register_slot` (:682), which every
//     `<adw-layout-slot>` calls on itself once it is rooted.
//
// THERE IS NO `addLayout()`, because in this port the MARKUP is `add_layout()`: the
// declared child carrying `name` is the layout, and the first declared one is made
// current the way `adw_multi_layout_view_add_layout` makes it (:553). An imperative list
// beside a declarative one would be two sources for the same table, and the derived one
// would silently win.
//
// Events:
//   `notify::layout` and `notify::layout-name` (CustomEvent, bubbles,
//     `detail = { layout }` / `{ layoutName }`) on every change — `set_layout` notifies
//     BOTH (:263), so switching layouts is two signals even when only the name moved.
//
// A11Y: `role="group"`, the accessible role libadwaita installs on the class (:386).
// `visible` is bound one way, child to slot (`G_BINDING_SYNC_CREATE` alone,
// adw-multi-layout-view.c:151), so hiding a child hides the hole and nothing more.
//
// NOT PORTED: the focus save/restore around a rebuild (`rebuild_current_layout`, :200)
// and the delayed-focus queue (`delayed_focus`, :159). Both are a GTK frame-clock
// concern — the whole widget is snapshotted into a render node, hidden, rewritten and
// shown on the next tick, which is what makes focus observable in between. A browser
// element moves nodes synchronously, so focus is never lost across a layout change; the
// consequence is that this port has nothing to restore.
//
// Reference: refs/libadwaita/src/adw-multi-layout-view.c
// Reference: refs/libadwaita/src/adw-layout.c
// Copyright (c) 2023-2024 Purism SPC / GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwLayoutSlot } from './adw-layout-slot.js';

/** One layout: the element itself, plus the name `AdwLayout:name` carries. */
interface Layout {
    readonly name: string;
    readonly content: Element;
}

export class AdwMultiLayoutView extends HTMLElement {
    /** The C's own tables: layouts in order, children by id, and the current layout. */
    private _layouts: Layout[] = [];
    private _children = new Map<string, Element>();
    /** `slots` — the current layout's holes, which are cleared on every rebuild. */
    private _slots = new Map<string, AdwLayoutSlot>();
    private _current: Layout | null = null;
    /** `accepting_slots` — only TRUE while a layout is being mounted (:116, :690). */
    private _acceptingSlots = false;
    private _observer: MutationObserver | null = null;

    static get observedAttributes() {
        return ['layout-name'];
    }

    /** `adw_multi_layout_view_get_layout_name()` (:485), read under its property's name. */
    get layoutName(): string | null {
        return this._current?.name ?? null;
    }

    /**
     * `adw_multi_layout_view_set_layout_name()` (:507) — writable, unlike `layout`.
     *
     * The property is written, not the layout: the C looks the name up and refuses a
     * name no layout carries, and the lookup is what makes the ORDER of declaration
     * irrelevant here.
     */
    set layoutName(value: string | null) {
        if (value === null) return;
        this.setAttribute('layout-name', value);
    }

    /** The element `Adw.MultiLayoutView:layout` points at, or null. */
    get layout(): Element | null {
        return this._current?.content ?? null;
    }

    connectedCallback() {
        this.setAttribute('role', 'group');
        // A GTK widget is a box and an unknown custom element is `inline`. libadwaita
        // ships no rule for this widget — its CSS node is `multi-layout-view` and no
        // partial names it — so the box model is set here rather than invented.
        this.style.display = 'block';
        this._observer?.disconnect();
        // A layout or child appended after connect has to be picked up: the authored tree
        // is the whole vocabulary of this widget, and a slot is read from the DOM.
        this._observer = new MutationObserver(() => this._rebuild());
        this._observer.observe(this, { childList: true });
        this._rebuild();
    }

    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
    }

    attributeChangedCallback(name?: string) {
        if (!this.isConnected || name !== 'layout-name') return;
        this._setLayoutByName(this.getAttribute('layout-name'));
    }

    /** `adw_multi_layout_view_get_child(id)` (:635). */
    getChild(id: string): Element | null {
        return this._children.get(id) ?? null;
    }

    /** `adw_multi_layout_view_get_layout_by_name(name)` (:605). */
    getLayoutByName(name: string): Element | null {
        return this._layouts.find((layout) => layout.name === name)?.content ?? null;
    }

    /**
     * `adw_multi_layout_view_add_layout()` (:538), over the declared children.
     *
     * The rules it carries are the ones a reader of the markup would otherwise have to
     * infer: the FIRST layout becomes current when the list is built (:553), and a
     * duplicate name is a warning rather than a shadowed entry (:549).
     */

    /**
     * `adw_multi_layout_view_register_slot()` (:682), called by every `<adw-layout-slot>`
     * that becomes rooted.
     *
     * Refused outside a mount, which is what `accepting_slots` is for: a slot in a layout
     * that is not current has no business in the table.
     *
     * A REPEAT registration by the SAME element is not a duplicate and says nothing. A DOM
     * move fires `connectedCallback` again — and moving a slot is ordinary here, because
     * the container it sits in re-homes its own slotted children when it builds its
     * internals. `g_hash_table_insert` upstream would overwrite with the same pointer, so
     * the C never notices; the warning is for two DIFFERENT slots under one ID, and
     * reporting a re-registration would train a reader to ignore it (adw-multi-layout-view.c:693).
     */
    registerSlot(id: string, slot: AdwLayoutSlot): void {
        if (!this._acceptingSlots) return;
        if (this._slots.get(id) === slot) return;
        if (this._slots.has(id)) {
            console.warn(`Duplicate slot ID in AdwLayout ${this.layoutName}: ${id}`);
            return;
        }
        this._slots.set(id, slot);
    }

    /**
     * Read the authored tree and mount the layout it names.
     *
     * A direct child with `name` is a layout; anything else is a child, keyed by `slot`.
     * Reading it from the DOM rather than from a list is what makes a child appended
     * after connect work, which is the whole of `bindSlottedChildren`'s contract for the
     * elements that use it.
     */
    private _rebuild(): void {
        if (!this.isConnected) return;
        // THE MOUNT IS A CHILD-LIST CHANGE OF THIS ELEMENT, and re-reading it is a loop:
        // `_rebuild` → `_mount` → `replaceChildren` → a record → `_rebuild` → … The
        // observer is therefore OFF for the duration, which drops those records and any
        // the previous mount already queued, and re-armed below. Without this the widget
        // spins a microtask cycle forever and takes the page with it — measured, and the
        // measurement is why this is a comment rather than a boolean.
        this._observer?.disconnect();
        try {
            this._readAuthoredTree();
        } finally {
            if (this.isConnected) this._observer?.observe(this, { childList: true });
        }
    }

    /** The C's three tables, read off the declared children. */
    private _readAuthoredTree(): void {
        const layouts: Layout[] = [];
        // ACCUMULATED, not replaced: while a layout is mounted the children this view has
        // taken into its slots are no longer children of the HOST, so a fresh map would
        // drop every one of them and the next mount would parent nothing. `set_child`
        // upserts by id too (adw-multi-layout-view.c:675).
        for (const node of Array.from(this.children)) {
            const name = node.getAttribute('name');
            if (name !== null) {
                layouts.push({ name, content: node });
                continue;
            }
            const id = node.getAttribute('slot');
            // No `slot=` is the DEFAULT child, and GtkBuilder's `<child>` with no type
            // is a deprecation warning upstream (adw-breakpoint-bin.c:679 is the same
            // rule for the bin); this port keeps the node where it is rather than
            // losing it, which is the browser shape of "not our child".
            if (id === null || id === '') continue;
            if (this._children.has(id)) {
                // `set_child` replaces the child of an id rather than adding a second.
                console.warn(`While adding child: duplicate slot ${id} in AdwMultiLayoutView; kept the first`);
            }
            this._children.set(id, node);
        }
        this._layouts = layouts;
        const wanted = this.getAttribute('layout-name');
        // A declared `layout-name` is `set_layout_name`, which REFUSES a name no layout
        // carries rather than falling back; an absent one takes the first, which is what
        // `add_layout` makes current when the list is built (:553).
        if (wanted !== null) this._setLayoutByName(wanted);
        else this._setLayout(layouts[0] ?? null);
    }

    /** `set_layout()` (:252): the same layout is not a change, and both properties notify. */
    private _setLayout(layout: Layout | null): void {
        if (layout === this._current) {
            // A rebuild still has to re-mount: the content's slots are rebuilt from the
            // DOM every time, so `_current` being unchanged says nothing about the tree.
            if (layout !== null) this._mount(layout);
            return;
        }
        this._current = layout;
        if (layout === null) this._destroy();
        else this._mount(layout);
        this.dispatchEvent(new CustomEvent('notify::layout', { bubbles: true, detail: { layout: this.layoutName } }));
        this.dispatchEvent(
            new CustomEvent('notify::layout-name', { bubbles: true, detail: { layoutName: this.layoutName } }),
        );
    }

    /**
     * `set_layout_name()` (:507): look the name up, refuse an unknown one, then switch.
     *
     * The refusal is C's, in its own shape — `g_critical` and `return`, with no call to
     * `set_layout` at all (:519), so the current layout is UNCHANGED rather than emptied.
     * That is why the lookup is not folded into `_setLayout`: it answers the question
     * first, and an unknown name is not a switch to nothing.
     */
    private _setLayoutByName(name: string | null): void {
        if (name === null) return;
        const layout = this._layouts.find((candidate) => candidate.name === name);
        if (layout === undefined) {
            console.error(`Layout name '${name}' not found in AdwMultiLayoutView`);
            return;
        }
        this._setLayout(layout);
    }

    /**
     * `destroy_current_layout()` (:192): forget every slot and unparent the content.
     *
     * The children are simply LEFT, which is what upstream does: a child whose id the
     * OUTGOING layout had no slot for is not unparented by `unparent_child`
     * (adw-multi-layout-view.c:175) and rides out with the content it was in. They stay
     * alive in `_children`, which is where this port remembers the declaration.
     */
    private _destroy(): void {
        this._slots.clear();
        this.replaceChildren();
    }

    /**
     * `rebuild_current_layout()` (:200), minus the render-node snapshot.
     *
     * The do/while is C's own: parenting a child can root a slot of its own, which grows
     * the table, which may make another child land. `slotCount` is what the loop compares
     * against — the C's `g_hash_table_size`.
     */
    private _mount(layout: Layout): void {
        this._destroy();
        this._acceptingSlots = true;
        // APPENDED, not `replaceChildren`: `_destroy` has already emptied the host, and
        // an unmatched child must not be a reason to drop the layout on the floor.
        this.appendChild(layout.content);
        // Re-register what is already in the mounted layout's own subtree, then let each
        // child's mount register more. The loop is `old_size` again.
        for (;;) {
            const before = this._slots.size;
            for (const slot of layout.content.querySelectorAll('adw-layout-slot')) {
                const id = slot.getAttribute('id');
                if (id !== null && id !== '' && !this._slots.has(id)) this.registerSlot(id, slot as AdwLayoutSlot);
            }
            for (const [id, child] of this._children) this._parent(id, child);
            if (this._slots.size === before) break;
        }
        this._acceptingSlots = false;
    }

    /** `parent_child()` (:136): bind `visible`, then insert. */
    private _parent(id: string, child: Element): void {
        const slot = this._slots.get(id);
        if (slot === undefined) return;
        if (child.parentElement === slot) return;
        this._mirrorVisible(slot, child);
        slot.appendChild(child);
    }

    /**
     * The one-way `visible` binding (:151), which CSS cannot express: the SLOT follows
     * the CHILD. `hidden` is observed rather than polled so a child hidden AFTER it
     * landed still hides the hole.
     */
    private _mirrorVisible(slot: Element, child: Element): void {
        const apply = () => {
            slot.toggleAttribute('hidden', (child as HTMLElement).hidden === true);
        };
        apply();
        new MutationObserver(apply).observe(child, { attributes: true, attributeFilter: ['hidden'] });
    }
}

customElements.define('adw-multi-layout-view', AdwMultiLayoutView);
