// <gtk-list-box-row> — one row of a `Gtk.ListBox`: the `activatable` / `selectable` pair and
// the child that fills it, the web counterpart of `Gtk.ListBoxRow`.
//
// BOTH PROPERTIES DEFAULT TRUE (gtklistbox.c:3961-3962), so on this element they are INVERTED
// flags and the attribute is read as `activatable="false"` — the same convention
// `<gtk-tree-expander>` uses for `indent-for-depth`, and for the same reason: a bare
// `activatable` on an element whose GIR default is TRUE would mean the opposite of what it
// reads like. The alternative — a present-means-true attribute — cannot express "true", which
// is the DEFAULT case and therefore the common one.
//
// THE `.activatable` CLASS IS NOT `activatable`. `gtk_list_box_update_row`
// (gtklistbox.c:3600-3624) sets it when the row is activatable OR when it is selectable and
// the BOX is not in `GTK_SELECTION_NONE`, and removes it otherwise. So a row in a
// `selection-mode="none"` box with `activatable="false"` carries no class, and the same row
// in a `selection-mode="single"` box does. The row therefore asks its parent, and the parent
// owns that answer for every row at once — which is what `<gtk-list-box>`'s `_syncRows`
// calls down into here for.
//
// `aria-selected` IS THE PARENT'S TOO, for the same C line: the accessible state is only
// published when `selectable && can_select`, so a row in a `none` box must NOT announce
// itself as unselected, and this element sets nothing of its own — `<gtk-list-box>` writes
// the attribute.
//
// ENTER AND SPACE ARE THE ROW'S, and the C says so twice: `attachRowActivation` is the
// module that makes a `GtkListBoxRow` a tab stop, and `gtk_list_box_row_class_init` installs
// the `activate` signal this row dispatches (gtklistbox.c:3905-3910).
//
// WHAT IS NOT HERE, and why: `action-name` / `action-target` are `g_param_spec_override`s of
// `GtkActionable` (gtklistbox.c:3946-3950), a `GAction` name and a `GVariant` target over a
// `GActionMap` — there is no map here to look a name up in, and a target is a value rather
// than a string. `get_index()` and `is_selected()` are METHODS over the box's children
// sequence and are answered from the DOM (`index`, `selected`), so a row moved by
// `insert_child_before` keeps reporting where it IS. The GIR puts `action-name` and
// `action-target` in the `GtkActionableProps` chain rather than in the row's own body, so
// `check-adwaita-element-properties` reads the row's OWN surface — which is exactly the two
// booleans this element observes, and neither has a gap entry.
//
// Reference: refs/gtk/gtk/gtklistbox.c:3307-3331 (child), :3594-3722 (activatable, selectable,
//   the `.activatable` class and the accessible state), :3877-3966 (class init, the signal, the
//   defaults and the css name)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss:16-19, :47-95 (row)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';
import { type AdwRowActivation, attachRowActivation } from './row-activation.js';

export class GtkListBoxRow extends HTMLElement {
    private _contentsEl!: HTMLDivElement;
    private _activation?: AdwRowActivation;
    private _initialized = false;

    static get observedAttributes() {
        return ['activatable', 'selectable'];
    }

    /**
     * `GtkListBoxRow:activatable` — TRUE by default (gtklistbox.c:3961), so this is the OFF
     * switch and the attribute is read as `activatable="false"`.
     */
    get activatable(): boolean {
        return this.getAttribute('activatable') !== 'false';
    }

    set activatable(value: boolean) {
        this.setAttribute('activatable', String(!!value));
    }

    /**
     * `GtkListBoxRow:selectable` — TRUE by default (gtklistbox.c:3962), read the same way as
     * `activatable`.
     */
    get selectable(): boolean {
        return this.getAttribute('selectable') !== 'false';
    }

    set selectable(value: boolean) {
        this.setAttribute('selectable', String(!!value));
    }

    /** Where this row sits in its box, or -1 while it has no box. */
    get index(): number {
        return this.parentElement ? [...this.parentElement.children].indexOf(this) : -1;
    }

    /**
     * Whether this row is selected — `gtk_list_box_row_is_selected`, answered by the parent so
     * a row moved between boxes never carries a stale answer.
     */
    get selected(): boolean {
        return this.classList.contains('selected');
    }

    /** `GtkListBoxRow:child`, as the light-DOM child it already is. */
    get child(): Element | null {
        return this._contentsEl.firstElementChild;
    }

    connectedCallback() {
        if (this._initialized) {
            // Re-entering a document: nothing here is torn down, so only the parent's derived
            // state needs re-asking, and it re-asks on its own child list change.
            return;
        }
        this._initialized = true;

        this._contentsEl = document.createElement('div');
        this._contentsEl.className = 'adw-list-box-row-contents';

        // `child` is a WIDGET property, so it is a slot here (gtklistbox.c:3307-3331): the
        // authored child lands in the same node `gtk_list_box_row_set_child` would put it in,
        // and a child appended after connect lands there too.
        bindSlottedChildren(this, [{ into: this._contentsEl }]).install(this._contentsEl);

        // GTK declares the accessible role unconditionally (gtklistbox.c:3955), so there is
        // no `selection-mode` to condition it on here.
        this.setAttribute('role', 'listitem');
        // `gtk_list_box_row_init` adds `.activatable` and makes the row focusable BEFORE any
        // box exists (gtklistbox.c:3959-3966), because both properties default TRUE — so the
        // class is already right for a row nobody has adopted yet, and it is the tab stop. The
        // box NARROWS it in `syncClasses`, which is where `can_select` enters.
        this.syncClasses(true);
    }

    attributeChangedCallback() {
        if (!this._initialized) return;
        // Both flags feed the class, so a write to either re-derives it against the box's LAST
        // answer — not against a fresh default, which would resurrect the class on a row whose
        // box has `selection-mode="none"`.
        this.syncClasses(this._canSelect);
    }

    /** What the box last said about itself; TRUE until a box narrows it. */
    private _canSelect = true;

    /**
     * Re-derive the tab stop and the `.activatable` class.
     *
     * Public because the box owns the second half of the class rule — it knows
     * `selection-mode`, this row does not — and calls this for every row when that changes.
     */
    syncClasses(canSelect: boolean): void {
        this._canSelect = canSelect;
        // `gtk_list_box_update_row` :3611-3615.
        this.classList.toggle('activatable', this.activatable || (this.selectable && canSelect));
        this._syncActivation();
    }

    private _syncActivation(): void {
        this._activation ??= attachRowActivation({
            row: this,
            activatable: () => this.classList.contains('activatable'),
            activate: () => this.dispatchEvent(new CustomEvent('activate', { bubbles: true })),
        });
        this._activation.sync();
    }
}

customElements.define('gtk-list-box-row', GtkListBoxRow);
