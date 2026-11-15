// GtkFlowBox — a container that lays its children out in lines and wraps them, for
// NativeScript.
//
// A REAL `FlexboxLayout` in wrapping mode, the platform's own answer to "as many as fit on a
// line, then the next line" (`adw-wrap-box.ts` is the same base for the same reason). What it
// adds is GTK's vocabulary and the three things flexbox has no word for:
//
//   · `max-children-per-line`, as a forced line break before every `max`-th child — the one
//     per-child knob the platform offers for it (`FlexboxLayout.setFlexWrapBefore`);
//   · `column-spacing` / `row-spacing`, as the children's margins, because no NS layout has a
//     gap property. Half a gap on each facing edge adds up to the whole gap between two
//     neighbours, so the outer edges carry an inset GTK does not have; the share is swapped
//     rather than stacked, so a child's own margin survives;
//   · `homogeneous`, as an equal `flex-grow` for every child. GTK gives every child the size of
//     the largest one; equal shares of a line are equal but not minimal.
//
// A CHILD IS NOT WRAPPED. GTK puts every child in a `GtkFlowBoxChild`; this port appends the
// view itself, so `get_first_child()` / `get_next_sibling()` walk the views a caller added.
//
// WHAT IT DOES NOT DO, and says so rather than pretending:
//   · NO SELECTION. `selection-mode` is held and read back (default `single`, as in GTK), but
//     no child is ever selected and `child-activated` / `selected-children-changed` are never
//     emitted; `activate-on-single-click` is held the same way. An app that sets `none`, as
//     the flow boxes of a card grid do, gets exactly what it asked for.
//   · `min-children-per-line` is held and not applied: flexbox decides how many fit.
//   · ALWAYS HORIZONTAL. `orientation` is `GtkOrientable`'s and is not declared; a vertical flow
//     needs a bounded height to wrap against, and a flexbox column in a scrolling parent never
//     wraps. `accept-unpaired-release` is a declared gap: a touch screen has no unpaired release.
//
// Reference: refs/gtk gtk/gtkflowbox.c (GtkFlowBox)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { FlexboxLayout, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import {
    DEFAULT_MAX_CHILDREN_PER_LINE,
    DEFAULT_MIN_CHILDREN_PER_LINE,
    flowBoxCount,
    flowBoxGap,
    flowBoxPlan,
} from './flow-box-state.js';
import { gridSpacing } from './grid-state.js';
import { DEFAULT_LIST_SELECTION_MODE, selectionMode } from './list-box-state.js';
import { lengthValue } from './ns-length.js';
import { withSignals } from './signals.js';
import { type AdwStyleClassesInput, classNameWith, StyleClassList } from './style-classes.js';
import { NOTIFY_HEXPAND, type GtkWidgetLayout } from './widget-layout.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** The nicks of `Gtk.SelectionMode`, as `list-box-state.ts` reads them. */
type SelectionModeNick = ReturnType<typeof selectionMode>;

/** The share of a flow box's gap a child carries, so it can be swapped rather than stacked. */
interface AppliedGap {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

const NO_GAP: AppliedGap = { left: 0, top: 0, right: 0, bottom: 0 };

export class GtkFlowBox extends withSignals(FlexboxLayout) {
    static readonly GTypeName: string = 'GtkFlowBox';

    private _columnSpacing = 0;
    private _rowSpacing = 0;
    private _homogeneous = false;
    private _minChildrenPerLine = DEFAULT_MIN_CHILDREN_PER_LINE;
    private _maxChildrenPerLine = DEFAULT_MAX_CHILDREN_PER_LINE;
    private _selectionMode: SelectionModeNick = DEFAULT_LIST_SELECTION_MODE;
    private _activateOnSingleClick = true;
    private readonly _classList = new StyleClassList();
    private readonly _gaps = new Map<View, AppliedGap>();
    private readonly _followers = new Map<View, () => void>();

    constructor(props?: ConstructProps<GtkFlowBox>) {
        super();
        this.flexDirection = 'row';
        this.flexWrap = 'wrap';
        // A line's children keep their own height; GTK does not stretch a short card to its
        // neighbour's, and a `homogeneous` box equalises widths only.
        this.alignItems = 'flex-start';
        this.alignContent = 'flex-start';
        applyConstructProps(this, props);
    }

    // --- child list ---

    /** `gtk_flow_box_append`. */
    append(child: View): void {
        this.addChild(child);
    }

    /** `gtk_flow_box_prepend`. */
    prepend(child: View): void {
        this.insertChild(child, 0);
    }

    /** `gtk_flow_box_insert` — `position` counts from 0, and `-1` appends. */
    insert(child: View, position: number): void {
        if (position < 0 || position >= this.getChildrenCount()) this.addChild(child);
        else this.insertChild(child, position);
    }

    /** `gtk_flow_box_remove`. */
    remove(child: View): void {
        this.removeChild(child);
    }

    /** `gtk_flow_box_remove_all`. */
    remove_all(): void {
        for (const child of this._childViews()) this.removeChild(child);
    }

    /**
     * Every path a child can enter by — `append()`, a direct `addChild()`, and XML inflation
     * through `_addChildFromBuilder` — ends in one of these three, which is why the plan is
     * derived here and not in `append()` (`AdwWrapBox` records the incident that rule comes
     * from).
     */
    addChild(view: View): void {
        super.addChild(view);
        this._follow(view);
        this._applyChildren();
    }

    insertChild(child: View, atIndex: number): boolean {
        const inserted = super.insertChild(child, atIndex);
        this._follow(child);
        this._applyChildren();
        return inserted;
    }

    removeChild(view: View): void {
        this._unfollow(view);
        super.removeChild(view);
        this._applyChildren();
    }

    // --- properties ---

    /** `Gtk.FlowBox:column-spacing` — the gap between children in a line, in DIPs. */
    get columnSpacing(): number {
        return this._columnSpacing;
    }

    set columnSpacing(value: number | string) {
        const next = gridSpacing(xmlNumber(value, Number.NaN), value, this._columnSpacing, 'columnSpacing');
        if (next === this._columnSpacing) return;
        this._columnSpacing = next;
        this._applyChildren();
        this._notify('column-spacing');
    }

    /** `Gtk.FlowBox:row-spacing` — the gap between lines, in DIPs. */
    get rowSpacing(): number {
        return this._rowSpacing;
    }

    set rowSpacing(value: number | string) {
        const next = gridSpacing(xmlNumber(value, Number.NaN), value, this._rowSpacing, 'rowSpacing');
        if (next === this._rowSpacing) return;
        this._rowSpacing = next;
        this._applyChildren();
        this._notify('row-spacing');
    }

    /** `Gtk.FlowBox:homogeneous` — every child the same share of its line. */
    get homogeneous(): boolean {
        return this._homogeneous;
    }

    set homogeneous(value: boolean | string) {
        const next = xmlBoolean(value, this._homogeneous);
        if (next === this._homogeneous) return;
        this._homogeneous = next;
        this._applyChildren();
        this._notify('homogeneous');
    }

    /** `Gtk.FlowBox:max-children-per-line` — a line holds at most this many. Defaults to 7. */
    get maxChildrenPerLine(): number {
        return this._maxChildrenPerLine;
    }

    set maxChildrenPerLine(value: number | string) {
        const next = flowBoxCount(
            xmlNumber(value, Number.NaN),
            value,
            this._maxChildrenPerLine,
            'maxChildrenPerLine',
            1,
        );
        if (next === this._maxChildrenPerLine) return;
        this._maxChildrenPerLine = next;
        this._applyChildren();
        this._notify('max-children-per-line');
    }

    /** `Gtk.FlowBox:min-children-per-line` — HELD, NOT APPLIED (see the header). Defaults to 0. */
    get minChildrenPerLine(): number {
        return this._minChildrenPerLine;
    }

    set minChildrenPerLine(value: number | string) {
        const next = flowBoxCount(
            xmlNumber(value, Number.NaN),
            value,
            this._minChildrenPerLine,
            'minChildrenPerLine',
            0,
        );
        if (next === this._minChildrenPerLine) return;
        this._minChildrenPerLine = next;
        this._notify('min-children-per-line');
    }

    /** `Gtk.FlowBox:selection-mode` — HELD, NOT APPLIED (see the header). Defaults to `single`. */
    get selectionMode(): SelectionModeNick {
        return this._selectionMode;
    }

    set selectionMode(value: SelectionModeNick) {
        const next = selectionMode(value);
        if (next === this._selectionMode) return;
        this._selectionMode = next;
        this._notify('selection-mode');
    }

    /** `Gtk.FlowBox:activate-on-single-click` — HELD, NOT APPLIED (see the header). Defaults to true. */
    get activateOnSingleClick(): boolean {
        return this._activateOnSingleClick;
    }

    set activateOnSingleClick(value: boolean | string) {
        const next = xmlBoolean(value, this._activateOnSingleClick);
        if (next === this._activateOnSingleClick) return;
        this._activateOnSingleClick = next;
        this._notify('activate-on-single-click');
    }

    // --- css classes ---

    /** `GtkWidget:css-classes`, spelled `styleClasses` — `cssClasses` is the platform's own live `Set`. */
    get styleClasses(): string[] {
        return this._classList.classes;
    }

    set styleClasses(value: AdwStyleClassesInput) {
        this._classList.replace(value);
        this._restyle();
    }

    /** `gtk_widget_add_css_class`. */
    add_css_class(name: string): void {
        this._classList.add(name);
        this._restyle();
    }

    /** `gtk_widget_remove_css_class`. */
    remove_css_class(name: string): void {
        this._classList.remove(name);
        this._restyle();
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._classList.has(name);
    }

    /** `gtk_widget_get_css_classes`. */
    get_css_classes(): string[] {
        return this._classList.classes;
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list. */
    set_css_classes(names: readonly string[]): void {
        this._classList.replaceAll(names);
        this._restyle();
    }

    // --- layout ---

    private _restyle(): void {
        this.className = classNameWith('', this._classList.classes);
    }

    private _notify(property: string): void {
        this.notify({ eventName: `notify::${property}`, object: this });
    }

    private _childViews(): View[] {
        const views: View[] = [];
        for (let index = 0; index < this.getChildrenCount(); index++) views.push(this.getChildAt(index));
        return views;
    }

    /** Re-plan when a child's `hexpand` changes after it was added. */
    private _follow(view: View): void {
        if (this._followers.has(view)) return;
        const follower = () => this._applyChildren();
        this._followers.set(view, follower);
        view.addEventListener(NOTIFY_HEXPAND, follower);
    }

    private _unfollow(view: View): void {
        const follower = this._followers.get(view);
        if (follower === undefined) return;
        view.removeEventListener(NOTIFY_HEXPAND, follower);
        this._followers.delete(view);
        this._withGap(view, NO_GAP);
        this._gaps.delete(view);
    }

    /** Make the margin carry `next` of this box's gap, in place of whatever share it had. */
    private _withGap(view: View, next: AppliedGap): void {
        const previous = this._gaps.get(view) ?? NO_GAP;
        if (previous.left !== next.left) {
            view.marginLeft = (lengthValue(view.marginLeft) ?? 0) - previous.left + next.left;
        }
        if (previous.top !== next.top) {
            view.marginTop = (lengthValue(view.marginTop) ?? 0) - previous.top + next.top;
        }
        if (previous.right !== next.right) {
            view.marginRight = (lengthValue(view.marginRight) ?? 0) - previous.right + next.right;
        }
        if (previous.bottom !== next.bottom) {
            view.marginBottom = (lengthValue(view.marginBottom) ?? 0) - previous.bottom + next.bottom;
        }
        this._gaps.set(view, next);
    }

    /**
     * Give every child its line break, its grow and its share of the gaps. Re-planned from the
     * whole set: adding a child shifts every index after it, and a changed maximum moves the
     * breaks of children that did not change.
     */
    private _applyChildren(): void {
        const children = this._childViews();
        const expands = children.map((child) => (child as Partial<Pick<GtkWidgetLayout, 'hexpand'>>).hexpand === true);
        const plan = flowBoxPlan(expands, this._maxChildrenPerLine, this._homogeneous);
        const gap = flowBoxGap(this._columnSpacing, this._rowSpacing);
        children.forEach((child, index) => {
            FlexboxLayout.setFlexWrapBefore(child, plan[index].wrapBefore);
            FlexboxLayout.setFlexGrow(child, plan[index].grow);
            this._withGap(child, gap);
        });
    }
}
