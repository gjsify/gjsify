// <gtk-flow-box> — a wrapping grid of `<gtk-flow-box-child>` cells with GTK's four selection
// modes, the web counterpart of `Gtk.FlowBox`.
//
// THE SELECTION IS THE SAME CORE MODULE `<gtk-list-box>` USES, and that is not a
// coincidence to be lucky about: `gtk_flow_box_update_selection` (gtkflowbox.c:1077-1131) and
// `gtk_list_box_update_selection_full` (gtklistbox.c:1799-1871) are line for line the same
// function with `child` spelled `row`, down to the `browse` branch and the anchor that stays
// put on a `Shift`-extend. `listBoxSelect` and its three siblings in
// `@gjsify/adwaita-core` (ADR 0004) hold them both; a second copy here would be the drift the
// core module exists to prevent. What is NOT shared is the layout, and the whole difference
// is `orientation`.
//
// HORIZONTAL IS THE DEFAULT, and it is the one thing a reader of the GIR will get wrong:
// `gtk_flow_box_init` sets `priv->orientation = GTK_ORIENTATION_HORIZONTAL`
// (gtkflowbox.c:3981) where every `Gtk.Box` in this package answers horizontal too but
// `GtkListBase` answers VERTICAL. So this box fills ROWS first, and `orientation="vertical"`
// is the off switch.
//
// THE LAYOUT IS `flex-wrap`, which IS GTK's allocation: GTK hands each child a slot on a
// running line in the given orientation and starts a new one when the next would not fit
// (gtkflowbox.c:1640-1900), and `flex-flow: row wrap` with a per-child `max-width` of
// `100% / max-children-per-line` is that rule. `min-children-per-line` becomes the matching
// `min-width`, so a narrow viewport asks each child for a smaller share instead of overflowing
// — which is the property's own documented job ("ensures that a reasonably small height will
// be requested for the overall minimum width of the box", gtkflowbox.c:3747-3755).
// `homogeneous` is `flex: 1 1 0`, GTK's equal allotment (gtkflowbox.c:1647, :1781).
//
// THE ARROWS MOVE BY VISUAL POSITION, not by index, and that is the one place this element
// diverges from the default roving step. GTK binds Left/Right as
// `GTK_MOVEMENT_VISUAL_POSITIONS` and Up/Down as `GTK_MOVEMENT_DISPLAY_LINES`
// (gtkflowbox.c:3944-3951): against a grid those are different steps, so from the last cell of
// a full line "left" is one row up by POSITION where by index it is simply the next cell.
// Both are derived from the children's own layout boxes, which is the only place a browser has
// the geometry GTK measures.
//
// WHAT IS NOT HERE, and why nothing was lost. `set_filter_func` / `set_sort_func` are FUNCTION
// properties with no markup form. `get_child_at_index` / `get_child_at_pos` / `insert` /
// `prepend` / `remove` are METHODS over a children sequence — `insert` and `prepend` are
// reachable as markup (append the child in the position it should take), `remove` as
// `child.remove()`, and the two getters as the `children` collection and the `index` on a
// cell. `set_hadjustment` / `set_vadjustment` are the scrolled-window relationship ADR 0047
// gave a portable value for. `get_selected_children` is the `selectedChildren` getter.
//
// Reference: refs/gtk/gtk/gtkflowbox.c:750-790 (property enum), :943-1131 (selection),
//   :3676-3990 (class init, properties, the key table, css name, role), :3977-4010 (the
//   defaults), :4702-4800 (the public select/unselect API)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:52-91 (flowbox > flowboxchild)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the selection rules
// composed from @gjsify/adwaita-core.

import {
    listBoxSelect,
    listBoxSelectAll,
    listBoxSelectRow,
    listBoxUnselectAll,
    listBoxUnselectRow,
    normalizeBoxSelectionMode,
    type AdwBoxSelectionMode,
} from '@gjsify/adwaita-core';

import type { GtkFlowBoxChild } from './gtk-flow-box-child.js';
import { attachRovingFocus } from './roving-focus.js';

// SIDE-EFFECT import, separate from the type import above for the reason
// `gtk-list-box.ts` states at its own: a combined import would be elided and take the
// registration with it.
import './gtk-flow-box-child.js';

/** `GtkFlowBox:max-children-per-line`'s default — `DEFAULT_MAX_CHILDREN_PER_LINE` (:728). */
export const ADW_FLOW_BOX_MAX_CHILDREN_PER_LINE = 7;

/** `GtkFlowBox:orientation` — HORIZONTAL by default here, unlike a `GtkListBase` (:3981). */
export type AdwFlowBoxOrientation = 'horizontal' | 'vertical';

export class GtkFlowBox extends HTMLElement {
    private _children: GtkFlowBoxChild[] = [];
    private _selection: number[] = [];
    /** `priv->selected_child`, `-1` for the C's NULL. */
    private _anchor = -1;
    private _initialized = false;

    static get observedAttributes() {
        return [
            'selection-mode',
            'activate-on-single-click',
            'accept-unpaired-release',
            'homogeneous',
            'min-children-per-line',
            'max-children-per-line',
            'row-spacing',
            'column-spacing',
            'orientation',
        ];
    }

    get selectionMode(): AdwBoxSelectionMode {
        return normalizeBoxSelectionMode(this.getAttribute('selection-mode'));
    }

    set selectionMode(value: AdwBoxSelectionMode) {
        this.setAttribute('selection-mode', value);
    }

    /** Default TRUE (gtkflowbox.c:3723), so the attribute is the OFF switch. */
    get activateOnSingleClick(): boolean {
        return this.getAttribute('activate-on-single-click') !== 'false';
    }

    set activateOnSingleClick(value: boolean) {
        this.setAttribute('activate-on-single-click', String(!!value));
    }

    /** Default FALSE (gtkflowbox.c:3731). Read as boolean because a browser always pairs a
     * click's halves somewhere; see `<gtk-list-box>`'s header for the rest. */
    get acceptUnpairedRelease(): boolean {
        return this.hasAttribute('accept-unpaired-release');
    }

    set acceptUnpairedRelease(value: boolean) {
        this.toggleAttribute('accept-unpaired-release', !!value);
    }

    get homogeneous(): boolean {
        return this.hasAttribute('homogeneous');
    }

    set homogeneous(value: boolean) {
        this.toggleAttribute('homogeneous', !!value);
    }

    /** `GtkFlowBox:min-children-per-line` — 0 is the ParamSpec default (:3758). */
    get minChildrenPerLine(): number {
        return count(this.getAttribute('min-children-per-line'), 0);
    }

    set minChildrenPerLine(value: number) {
        this.setAttribute('min-children-per-line', String(value));
    }

    /** `GtkFlowBox:max-children-per-line` — 7 is the default, and the ParamSpec's MINIMUM is 1. */
    get maxChildrenPerLine(): number {
        return Math.max(1, count(this.getAttribute('max-children-per-line'), ADW_FLOW_BOX_MAX_CHILDREN_PER_LINE));
    }

    set maxChildrenPerLine(value: number) {
        this.setAttribute('max-children-per-line', String(value));
    }

    get rowSpacing(): number {
        return count(this.getAttribute('row-spacing'), 0);
    }

    set rowSpacing(value: number) {
        this.setAttribute('row-spacing', String(value));
    }

    get columnSpacing(): number {
        return count(this.getAttribute('column-spacing'), 0);
    }

    set columnSpacing(value: number) {
        this.setAttribute('column-spacing', String(value));
    }

    get orientation(): AdwFlowBoxOrientation {
        return this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal';
    }

    set orientation(value: AdwFlowBoxOrientation) {
        this.setAttribute('orientation', value);
    }

    /**
     * The cells, in document order — GTK's `children` sequence.
     *
     * NOT spelled `children`: that name is `HTMLElement.children`, an `HTMLCollection`, and
     * shadowing it on an element that HAS children would break `firstElementChild` consumers
     * and the DOM's own `[...el.children]` idiom everywhere else in this package.
     */
    get cells(): readonly GtkFlowBoxChild[] {
        return this._children;
    }

    /** The selected positions, ascending. A method upstream (`get_selected_children`). */
    get selectedChildren(): number[] {
        return [...this._selection];
    }

    set selectedChildren(value: Iterable<number> | number | null) {
        for (const position of typeof value === 'number' ? [value] : (value ?? [])) {
            this.selectChild(this._children[position] ?? null);
        }
    }

    get selectedChildElements(): GtkFlowBoxChild[] {
        return this._selection.map((position) => this._children[position]).filter((child) => child !== undefined);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.addEventListener('click', (event) => this._onClick(event));
        this.addEventListener('dblclick', (event) => this._onDoubleClick(event));
        this.addEventListener('keydown', (event) => this._onKeyDown(event));

        attachRovingFocus({
            host: this,
            // A FUNCTION, twice: `orientation` is a live property and it decides BOTH which
            // keys move and what one of them means.
            orientation: () => this.orientation,
            items: () => this._children,
            // `flex-flow: <orientation> wrap` lays children out in LINES along the
            // orientation, so one along the line is one index.
            step: (items, from, direction) => {
                const to = from + direction;
                return to < 0 || to >= items.length ? null : to;
            },
            crossAxis: {
                orientation: () => (this.orientation === 'horizontal' ? 'vertical' : 'horizontal'),
                // Read per press, not per install: `orientation` is a live property.
                step: (items, from, direction) => visualStep(items, from, direction, this.orientation),
            },
            select: (child) => this._updateSelection(child as GtkFlowBoxChild, {}),
        });

        // A cell appended AFTER connect has to join the selection from its first frame; the
        // observer watches THIS element, so there is nothing to release on disconnect
        // (`slotted-children.ts` states why).
        new MutationObserver(() => this._collectChildren()).observe(this, { childList: true });

        this._applyAttributes();
        this._collectChildren();
    }

    attributeChangedCallback() {
        if (!this._initialized) return;
        this._applyAttributes();
        this._syncChildren();
    }

    /** `gtk_flow_box_select_child` (gtkflowbox.c:4731-4739). `null` is the C's unselect-all. */
    selectChild(child: GtkFlowBoxChild | null): void {
        const result = listBoxSelectRow(
            this._selection,
            this._anchor,
            child === null ? null : this._children.indexOf(child),
            this._children.length,
            this.selectionMode,
        );
        if (same(result.selection, this._selection) && result.anchor === this._anchor) return;
        this._selection = result.selection;
        this._anchor = result.anchor;
        this._emitSelection(child);
    }

    /** `gtk_flow_box_unselect_child` (gtkflowbox.c:4749-4756). */
    unselectChild(child: GtkFlowBoxChild): void {
        const result = listBoxUnselectRow(
            this._selection,
            this._anchor,
            this._children.indexOf(child),
            this._children.length,
            this.selectionMode,
        );
        if (same(result.selection, this._selection)) return;
        this._selection = result.selection;
        this._emitSelection(null);
    }

    /** `gtk_flow_box_select_all` — refused unless the mode is `multiple` (:4770-4771). */
    selectAll(): void {
        const next = listBoxSelectAll(this._children.length, this.selectionMode);
        if (next === null) return;
        this._selection = next;
        this._anchor = next.length > 0 ? next[0]! : -1;
        this._emitSelection(this.selectedChildElements[0] ?? null);
    }

    /** `gtk_flow_box_unselect_all` — refused in `browse` (:4792-4793). */
    unselectAll(): void {
        if (listBoxUnselectAll(this._selection, this.selectionMode) === null) return;
        this._selection = [];
        this._anchor = -1;
        this._emitSelection(null);
    }

    /**
     * The properties, as inline custom properties, so the flex rules in `_flow_box.scss` stay
     * declarative and a `homogeneous` write is one class flip.
     */
    private _applyAttributes(): void {
        this.classList.toggle('homogeneous', this.homogeneous);
        this.classList.toggle('vertical', this.orientation === 'vertical');
        this.style.setProperty('--adw-flow-box-row-spacing', `${this.rowSpacing}px`);
        this.style.setProperty('--adw-flow-box-column-spacing', `${this.columnSpacing}px`);
        this.style.setProperty('--adw-flow-box-max-children-per-line', String(this.maxChildrenPerLine));
        if (this.minChildrenPerLine > 0) {
            this.style.setProperty('--adw-flow-box-min-children-per-line', String(this.minChildrenPerLine));
        } else {
            this.style.removeProperty('--adw-flow-box-min-children-per-line');
        }
        const selectable = this.selectionMode !== 'none';
        // `GTK_ACCESSIBLE_ROLE_GRID` (:3973). GTK declares it unconditionally and no role
        // carries the selection better in ARIA: `grid`/`gridcell` is what a wrapping grid IS,
        // and the per-cell `aria-selected` is what does the announcing.
        this.setAttribute('role', 'grid');
        if (this.selectionMode === 'multiple') this.setAttribute('aria-multiselectable', 'true');
        else this.removeAttribute('aria-multiselectable');
        // `aria-readonly` is the one ARIA state `none` has and `multiple` does not, and it is
        // what tells a screen reader that the cells will not take a click.
        if (selectable) this.removeAttribute('aria-readonly');
        else this.setAttribute('aria-readonly', 'true');
    }

    private _collectChildren(): void {
        const next = [...this.querySelectorAll(':scope > gtk-flow-box-child')] as GtkFlowBoxChild[];
        if (next.length === this._children.length && next.every((child, index) => child === this._children[index])) {
            return;
        }
        this._children = next;
        this._selection = this._selection.filter((position) => position < this._children.length);
        if (this._anchor >= this._children.length) this._anchor = -1;
        this._syncChildren();
    }

    /**
     * The `GTK_STATE_FLAG_SELECTED` each selected cell raises and the accessible state that
     * goes with it (`gtk_flow_box_child_set_selected`, gtkflowbox.c:943-962). The accessible
     * state is published ONLY while the box can select, which is the same reset the list box
     * does (:3617-3623).
     */
    private _syncChildren(): void {
        const canSelect = this.selectionMode !== 'none';
        const selection = new Set(this._selection);
        this._children.forEach((child, position) => {
            const isSelected = selection.has(position);
            child.classList.toggle('selected', isSelected);
            child.classList.toggle('activatable', canSelect);
            if (canSelect) child.setAttribute('aria-selected', String(isSelected));
            else child.removeAttribute('aria-selected');
        });
    }

    private _onClick(event: MouseEvent): void {
        const child = this._childAt(event.target);
        if (child === null && !this.acceptUnpairedRelease) return;
        if (child !== null) {
            this._updateSelection(child, { modify: event.ctrlKey || event.metaKey, extend: event.shiftKey });
        }
        // `activate-on-single-click` defaults TRUE (gtkflowbox.c:3723), so a FIRST click
        // activates, and a SECOND one when it is off; `detail` is the only thing that can tell
        // them apart, which is why the threshold is the property and not a constant.
        if (event.detail < (this.activateOnSingleClick ? 1 : 2)) return;
        if (child !== null) this._activate(child);
    }

    private _onDoubleClick(event: MouseEvent): void {
        if (this.activateOnSingleClick) return;
        const child = this._childAt(event.target);
        if (child === null) return;
        this._activate(child);
    }

    /**
     * `Ctrl`+Space is `toggle-cursor-child` (gtkflowbox.c:3957-3959); Enter and Space are the
     * CELL's, via `activate-cursor-child` (:3836) and `GtkFlowBoxChild`'s own `activate`.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== ' ') return;
        const child = this._childAt(event.target);
        if (child === null) return;
        event.preventDefault();
        this._updateSelection(child, { modify: true });
    }

    private _childAt(target: EventTarget | null): GtkFlowBoxChild | null {
        if (!(target instanceof Element)) return null;
        const child = target.closest('gtk-flow-box-child');
        return this.contains(child) ? (child as GtkFlowBoxChild) : null;
    }

    /** One click or `Ctrl`+Space — `gtk_flow_box_update_selection` (:1077-1131). */
    private _updateSelection(child: GtkFlowBoxChild, step: { modify?: boolean; extend?: boolean }): void {
        const result = listBoxSelect(
            this._selection,
            this._anchor,
            this._children.indexOf(child),
            this._children.length,
            this.selectionMode,
            step,
        );
        if (same(result.selection, this._selection)) return;
        this._selection = result.selection;
        this._anchor = result.anchor;
        this._emitSelection(result.selection.includes(this._children.indexOf(child)) ? child : null);
    }

    /** `gtk_flow_box_select_and_activate` (:1136-1148) — the `child-activated` signal. */
    private _activate(child: GtkFlowBoxChild): void {
        this.dispatchEvent(new CustomEvent('child-activated', { bubbles: true, detail: { child } }));
        child.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    }

    /** `child-activated`'s companion `selected-children-changed` (:3820-3826) plus the notify. */
    private _emitSelection(child: GtkFlowBoxChild | null): void {
        this._syncChildren();
        this.dispatchEvent(new CustomEvent('selected-children-changed', { bubbles: true }));
        this.dispatchEvent(new CustomEvent('child-selected', { bubbles: true, detail: { child } }));
        this.dispatchEvent(
            new CustomEvent('notify::selected-children', {
                bubbles: true,
                detail: { selectedChildren: [...this._selection] },
            }),
        );
    }
}

/**
 * `GTK_MOVEMENT_VISUAL_POSITIONS` / `GTK_MOVEMENT_DISPLAY_LINES` over a wrapped flex line
 * (gtkflowbox.c:1390-1520): the neighbour in that DIRECTION, found by the children's own
 * layout boxes.
 *
 * The line count comes from grouping the children by their offset along the wrap axis — which
 * is the same thing GTK knows from its allocation, measured rather than asked for. Where the
 * target line is short the step falls back to the nearest child on that line, or to the one
 * along the line, exactly as the C's search does when no cell sits in that position.
 */
const visualStep = (
    items: readonly HTMLElement[],
    from: number,
    direction: -1 | 1,
    orientation: AdwFlowBoxOrientation,
): number | null => {
    if (items.length < 2) return null;
    const vertical = orientation === 'vertical';
    // Along-line is `offsetTop` for a row-wrap box and `offsetLeft` for a column-wrap one —
    // `flex-flow: <orientation> wrap` puts the NEXT child beside this one along that axis.
    const alongLine = (item: HTMLElement): number => (vertical ? item.offsetLeft : item.offsetTop);
    const acrossLine = (item: HTMLElement): number => (vertical ? item.offsetTop : item.offsetLeft);

    const current = items[from] as HTMLElement;
    const line = alongLine(current);
    const position = acrossLine(current);
    const wanted = direction > 0 ? line + 1 : line - 1;

    let nearest: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < items.length; index++) {
        const item = items[index] as HTMLElement;
        if (alongLine(item) !== wanted) continue;
        const distance = Math.abs(acrossLine(item) - position);
        if (nearest === null || distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    }
    if (nearest !== null) return nearest;

    // No cell on the line the cursor wanted — a SHORT last line, or the very first line going
    // back. The C's search then falls back to walking the current line, and so does this:
    // one along it, in the direction asked for.
    const neighbour = from + direction;
    if (neighbour < 0 || neighbour >= items.length) return null;
    return alongLine(items[neighbour] as HTMLElement) === line ? neighbour : null;
};

/** Selection equality without an allocation — both arrays are sorted ascending. */
function same(next: readonly number[], current: readonly number[]): boolean {
    return next.length === current.length && next.every((position, index) => position === current[index]);
}

/** A `guint` property read, with the ParamSpec's own default for an absent or broken value. */
function count(raw: string | null, fallback: number): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

customElements.define('gtk-flow-box', GtkFlowBox);
