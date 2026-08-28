// AdwWrapBox — a Libadwaita-style flowing wrap box for NativeScript.
//
// Renders a REAL NativeScript `FlexboxLayout` in wrapping mode. `justify`, `align`,
// `justify-last-line`, `line-homogeneous`, `pack-direction`, `wrap-reverse` and
// `wrap-policy` all map onto `FlexboxLayout`'s own knobs, off the SAME
// `@gjsify/adwaita-core` decision the browser element uses.
//
// FIDELITY: approximated in three places, all in `wrap-box-layout.ts` — the spacing
// comes out of child margins (no NS layout has a gap property), `align` snaps to
// flexbox's three positions rather than C's continuum, and the final-line rule reaches
// only the single-child case, because NS offers no `:only-child` selector and no
// generated content.
//
// `natural-line-length` and its unit are carried but NOT applied: NativeScript's
// `Style` has `minWidth`/`minHeight` and no maximum, so there is nothing to cap
// a line with. The property still exists so an XML layout and a binding can
// round-trip it, and `naturalLineLengthPx` is the resolved value the day NS
// grows a maximum.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c (AdwWrapBox is a layout, no dedicated scss)
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { FlexboxLayout, type View } from '@nativescript/core';

import {
    ADW_WRAP_BOX_DEFAULT_ALIGN,
    ADW_WRAP_BOX_DEFAULT_JUSTIFY,
    ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT,
    ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION,
    ADW_WRAP_BOX_DEFAULT_WRAP_POLICY,
    ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET,
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapPolicy,
    resolveWrapBoxChildOrder,
    wrapBoxLengthToPx,
    type AdwLengthUnit,
    type AdwWrapBoxJustify,
    type AdwWrapBoxOrientation,
    type AdwWrapBoxPackDirection,
    type AdwWrapPolicy,
} from '@gjsify/adwaita-core';

import {
    DEFAULT_WRAP_BOX_SPACING,
    normalizeWrapBoxSpacing,
    wrapBoxChildFlex,
    wrapBoxChildMargin,
    wrapBoxFlexStyle,
    wrapBoxSpacingChanges,
    type WrapBoxFlexInput,
} from './wrap-box-layout.js';
import { xmlNumber } from './xml-values.js';

/** Every `notify::` an `Adw.WrapBox` emits (adw-wrap-box.c:284-497). */
export type AdwWrapBoxProperty =
    | 'child-spacing'
    | 'child-spacing-unit'
    | 'pack-direction'
    | 'align'
    | 'justify'
    | 'justify-last-line'
    | 'line-spacing'
    | 'line-spacing-unit'
    | 'line-homogeneous'
    | 'natural-line-length'
    | 'natural-line-length-unit'
    | 'wrap-reverse'
    | 'wrap-policy'
    | 'orientation';

export class AdwWrapBox extends FlexboxLayout {
    private _childSpacing = DEFAULT_WRAP_BOX_SPACING;
    private _lineSpacing = DEFAULT_WRAP_BOX_SPACING;
    private _childSpacingUnit: AdwLengthUnit = ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT;
    private _lineSpacingUnit: AdwLengthUnit = ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT;
    private _align = ADW_WRAP_BOX_DEFAULT_ALIGN;
    private _justify: AdwWrapBoxJustify = ADW_WRAP_BOX_DEFAULT_JUSTIFY;
    private _justifyLastLine = false;
    private _lineHomogeneous = false;
    private _wrapReverse = false;
    private _wrapPolicy: AdwWrapPolicy = ADW_WRAP_BOX_DEFAULT_WRAP_POLICY;
    private _packDirection: AdwWrapBoxPackDirection = ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION;
    private _orientation: AdwWrapBoxOrientation = 'horizontal';
    private _naturalLineLength = ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET;
    private _naturalLineLengthUnit: AdwLengthUnit = ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT;

    constructor() {
        super();

        this.className = 'adw-wrap-box';
        this._applyLayout();
    }

    // --- child list ---

    /** Append a child — `adw_wrap_box_append` (adw-wrap-box.c:1344-1352). */
    add(view: View): void {
        this.addChild(view);
    }

    /** Remove a previously-added child — `adw_wrap_box_remove` (:1387-1395). */
    remove(view: View): void {
        this.removeChild(view);
    }

    /** `adw_wrap_box_remove_all` (:1406-1414). */
    removeAll(): void {
        this.removeChildren();
    }

    /**
     * Every path a child can enter by — `add()`, a direct `addChild()`, and XML
     * inflation via `_addChildFromBuilder` — ends here, which is why the spacing
     * is applied here and not in `add()`. It used to be applied in `add()` only,
     * so a child declared in markup got no spacing at all; C routes GtkBuildable's
     * `add_child` through the same append for the same reason.
     */
    addChild(view: View): void {
        super.addChild(view);
        // Adding the SECOND child changes the FIRST one's answer too — a box with
        // one child is a box whose only line is the LAST one — so the whole set is
        // re-applied rather than just the newcomer.
        this._applyChildren();
    }

    /**
     * `adw_wrap_box_insert_child_after` (:1283-1300).
     *
     * A NULL/absent `sibling` inserts at the FIRST position, not the last —
     * `gtk_widget_insert_after`'s documented rule, pinned by
     * `WRAP_BOX_CHILD_ORDER_VECTORS`. Returns whether the insert happened; a
     * refusal is where C would have hit a `g_return_if_fail`.
     */
    insertChildAfter(view: View, sibling: View | null = null): boolean {
        return this._applyOrder('insert-after', view, sibling);
    }

    /** `adw_wrap_box_reorder_child_after` (:1315-1332). Same NULL rule. */
    reorderChildAfter(view: View, sibling: View | null = null): boolean {
        return this._applyOrder('reorder-after', view, sibling);
    }

    private _childViews(): View[] {
        const views: View[] = [];
        for (let i = 0; i < this.getChildrenCount(); i++) views.push(this.getChildAt(i));
        return views;
    }

    private _applyOrder(op: 'insert-after' | 'reorder-after', view: View, sibling: View | null): boolean {
        const children = this._childViews();
        const next = resolveWrapBoxChildOrder({ children, child: view, sibling, op });
        if (next === null) return false;
        // `insertChild` does not MOVE an existing child, so a reorder detaches
        // first. An insert never needs it — the resolver only accepted the child
        // because it has no parent.
        if (children.includes(view)) this.removeChild(view);
        this.insertChild(view, next.indexOf(view));
        this._applyChildren();
        return true;
    }

    // --- properties ---

    /** Gap between items in a line, in {@link childSpacingUnit}. Defaults to 0, as in C. */
    get childSpacing(): number {
        return this._childSpacing;
    }

    set childSpacing(value: number | string) {
        const spacing = xmlNumber(value, this._childSpacing);
        if (!wrapBoxSpacingChanges(this._childSpacing, spacing)) return;
        this._childSpacing = normalizeWrapBoxSpacing(spacing);
        this._applyChildren();
        this._notify('child-spacing');
    }

    /** The unit {@link childSpacing} is written in. Defaults to `px`, as in C. */
    get childSpacingUnit(): AdwLengthUnit {
        return this._childSpacingUnit;
    }

    set childSpacingUnit(value: AdwLengthUnit) {
        const next = normalizeWrapBoxLengthUnit(value);
        if (next === this._childSpacingUnit) return;
        this._childSpacingUnit = next;
        this._applyChildren();
        this._notify('child-spacing-unit');
    }

    /** Gap between wrapped lines, in {@link lineSpacingUnit}. Defaults to 0, as in C. */
    get lineSpacing(): number {
        return this._lineSpacing;
    }

    set lineSpacing(value: number | string) {
        const spacing = xmlNumber(value, this._lineSpacing);
        if (!wrapBoxSpacingChanges(this._lineSpacing, spacing)) return;
        this._lineSpacing = normalizeWrapBoxSpacing(spacing);
        this._applyChildren();
        this._notify('line-spacing');
    }

    /** The unit {@link lineSpacing} is written in. Defaults to `px`, as in C. */
    get lineSpacingUnit(): AdwLengthUnit {
        return this._lineSpacingUnit;
    }

    set lineSpacingUnit(value: AdwLengthUnit) {
        const next = normalizeWrapBoxLengthUnit(value);
        if (next === this._lineSpacingUnit) return;
        this._lineSpacingUnit = next;
        this._applyChildren();
        this._notify('line-spacing-unit');
    }

    /** Where the children sit ALONG the line (main axis): 0 start, 0.5 middle, 1 end. */
    get align(): number {
        return this._align;
    }

    set align(value: number) {
        const next = normalizeWrapBoxAlign(value);
        if (next === this._align) return;
        this._align = next;
        this._applyLayout();
        this._notify('align');
    }

    /** Whether and how each line is stretched to fill the widget. */
    get justify(): AdwWrapBoxJustify {
        return this._justify;
    }

    set justify(value: AdwWrapBoxJustify) {
        const next = normalizeWrapBoxJustify(value);
        if (next === this._justify) return;
        this._justify = next;
        this._applyLayout();
        this._notify('justify');
    }

    /** Whether the FINAL line is justified too. Default false, as in C. */
    get justifyLastLine(): boolean {
        return this._justifyLastLine;
    }

    set justifyLastLine(value: boolean) {
        const next = !!value;
        if (next === this._justifyLastLine) return;
        this._justifyLastLine = next;
        this._applyLayout();
        this._notify('justify-last-line');
    }

    /** Whether every line takes the same amount of space. */
    get lineHomogeneous(): boolean {
        return this._lineHomogeneous;
    }

    set lineHomogeneous(value: boolean) {
        const next = !!value;
        if (next === this._lineHomogeneous) return;
        this._lineHomogeneous = next;
        this._applyLayout();
        this._notify('line-homogeneous');
    }

    /** Whether lines wrap upwards (horizontal) / towards the start (vertical). */
    get wrapReverse(): boolean {
        return this._wrapReverse;
    }

    set wrapReverse(value: boolean) {
        const next = !!value;
        if (next === this._wrapReverse) return;
        this._wrapReverse = next;
        this._applyLayout();
        this._notify('wrap-reverse');
    }

    /** Whether an overflowing line squeezes its children or lets them spill. */
    get wrapPolicy(): AdwWrapPolicy {
        return this._wrapPolicy;
    }

    set wrapPolicy(value: AdwWrapPolicy) {
        const next = normalizeWrapPolicy(value);
        if (next === this._wrapPolicy) return;
        this._wrapPolicy = next;
        this._applyLayout();
        this._notify('wrap-policy');
    }

    /** The direction children are packed in each line. */
    get packDirection(): AdwWrapBoxPackDirection {
        return this._packDirection;
    }

    set packDirection(value: AdwWrapBoxPackDirection) {
        const next = normalizeWrapBoxPackDirection(value);
        if (next === this._packDirection) return;
        this._packDirection = next;
        this._applyLayout();
        this._notify('pack-direction');
    }

    /** The axis children are packed along. */
    get orientation(): AdwWrapBoxOrientation {
        return this._orientation;
    }

    set orientation(value: AdwWrapBoxOrientation) {
        const next = value === 'vertical' ? 'vertical' : 'horizontal';
        if (next === this._orientation) return;
        this._orientation = next;
        this._applyLayout();
        this._notify('orientation');
    }

    /**
     * The natural line length in {@link naturalLineLengthUnit}, or `-1` unset.
     *
     * CARRIED, NOT APPLIED — see the header: NativeScript's `Style` has no
     * maximum-size property to cap a line with.
     */
    get naturalLineLength(): number {
        return this._naturalLineLength;
    }

    set naturalLineLength(value: number) {
        const next = normalizeNaturalLineLength(value);
        if (next === this._naturalLineLength) return;
        this._naturalLineLength = next;
        this._notify('natural-line-length');
    }

    /** The unit {@link naturalLineLength} is written in. Defaults to `px`, as in C. */
    get naturalLineLengthUnit(): AdwLengthUnit {
        return this._naturalLineLengthUnit;
    }

    set naturalLineLengthUnit(value: AdwLengthUnit) {
        const next = normalizeWrapBoxLengthUnit(value);
        if (next === this._naturalLineLengthUnit) return;
        this._naturalLineLengthUnit = next;
        this._notify('natural-line-length-unit');
    }

    /** {@link naturalLineLength} resolved through its unit, `-1` when unset. */
    get naturalLineLengthPx(): number {
        return wrapBoxLengthToPx(this._naturalLineLength, this._naturalLineLengthUnit);
    }

    // --- application ---

    /** Re-emit `notify::<property>`, as GObject does on a real change. */
    private _notify(property: AdwWrapBoxProperty): void {
        this.notify({ eventName: `notify::${property}`, object: this });
    }

    /** The widget's properties, as the pure resolvers take them. */
    private _flexInput(): WrapBoxFlexInput {
        return {
            orientation: this._orientation,
            packDirection: this._packDirection,
            wrapReverse: this._wrapReverse,
            justify: this._justify,
            justifyLastLine: this._justifyLastLine,
            align: this._align,
            lineHomogeneous: this._lineHomogeneous,
            wrapPolicy: this._wrapPolicy,
        };
    }

    private _applyLayout(): void {
        const style = wrapBoxFlexStyle(this._flexInput());
        this.flexDirection = style.flexDirection;
        this.flexWrap = style.flexWrap;
        this.justifyContent = style.justifyContent;
        this.alignContent = style.alignContent;
        // Each child is allocated the FULL cross extent of its line —
        // `h = line_size` in adw-wrap-layout.c:746-751.
        this.alignItems = 'stretch';
        this._applyChildren();
    }

    private _applyChildren(): void {
        const margin = wrapBoxChildMargin(
            wrapBoxLengthToPx(this._childSpacing, this._childSpacingUnit),
            wrapBoxLengthToPx(this._lineSpacing, this._lineSpacingUnit),
        );
        const children = this._childViews();
        // The per-CHILD half of the decision, which one container `justifyContent`
        // cannot carry: a box with a single child has one line, that line is the
        // LAST one, and `spread` stretches its lone child instead of spreading.
        const flex = wrapBoxChildFlex(this._flexInput(), children.length);
        for (const view of children) {
            view.set('margin', margin);
            FlexboxLayout.setFlexGrow(view, flex.flexGrow);
            FlexboxLayout.setFlexShrink(view, flex.flexShrink);
        }
    }
}
