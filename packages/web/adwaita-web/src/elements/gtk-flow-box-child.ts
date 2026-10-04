// <gtk-flow-box-child> — one cell of a `Gtk.FlowBox`: the child that fills it, the web
// counterpart of `Gtk.FlowBoxChild`.
//
// ONE PROPERTY, ONE SIGNAL. `GtkFlowBoxChild` declares `child` (:542-543) and `activate`
// (:563-571) and nothing else — no `activatable`, no `selectable`, unlike its sibling
// `GtkListBoxRow`. The box asks each child whether it is selected through the child itself
// (`gtk_flow_box_child_set_selected`, gtkflowbox.c:943-962), which raises the
// `GTK_STATE_FLAG_SELECTED` widget state and the `GTK_ACCESSIBLE_STATE_SELECTED` accessible
// state, and there is no property a caller writes to ask for either. So this element has no
// observed attribute of its own: the parent writes the `selected` CLASS and the
// `aria-selected` attribute, and the CHILD publishes a `selected` getter over the class.
//
// `child` is a WIDGET property, so it is a slot here (gtkflowbox.c:610-628): the authored
// child lands in the node `gtk_flow_box_child_set_child` would put it in, and a child appended
// after connect lands there too.
//
// A11Y: `gridcell`, which is what GTK declares unconditionally (:573). The box is a
// `GTK_ACCESSIBLE_ROLE_GRID` (:3973) — a `grid` whose cells are `gridcell`s, not the
// `list`/`option` pairing a list box uses, because a flow box wraps in more than one
// direction.
//
// Reference: refs/gtk/gtk/gtkflowbox.c:277-282 (child property), :542-582 (class init, the
//   activate signal, the css name and role), :610-628 (set_child), :943-962 (set_selected)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:52-91 (flowbox > flowboxchild)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

export class GtkFlowBoxChild extends HTMLElement {
    private _contentsEl!: HTMLDivElement;
    private _initialized = false;

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._contentsEl = document.createElement('div');
        this._contentsEl.className = 'adw-flow-box-child-contents';

        bindSlottedChildren(this, [{ into: this._contentsEl }]).install(this._contentsEl);

        this.setAttribute('role', 'gridcell');
        // `gtk_flow_box_child_init` makes the cell focusable (:578-580) — the box's cursor
        // lives here, and Enter/Space is the box's `activate-cursor-child`.
        this.tabIndex = 0;
    }

    /** `GtkFlowBoxChild:child`, as the light-DOM child it already is. */
    get child(): Element | null {
        return this._contentsEl.firstElementChild;
    }

    /** Where this child sits in its box, or -1 while it has no box. */
    get index(): number {
        return this.parentElement ? [...this.parentElement.children].indexOf(this) : -1;
    }

    /**
     * `gtk_flow_box_child_is_selected` — read over the class the box writes, so a cell moved
     * between boxes never carries a stale answer.
     */
    get selected(): boolean {
        return this.classList.contains('selected');
    }
}

customElements.define('gtk-flow-box-child', GtkFlowBoxChild);
