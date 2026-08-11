// <adw-wrap-box> — A box-like container that lays its children out in a line and
// wraps them onto new lines when they run out of room (the web analog of flexbox
// `flex-wrap: wrap` with a gap). Mirrors Adw.WrapBox.
//
// Attributes — all fourteen of the widget's properties, each with a
// `notify::<property>`:
//
//   child-spacing / line-spacing        (int >= 0, default 0) -> column-gap / row-gap
//   child-spacing-unit / line-spacing-unit ("px" | "pt" | "sp", default "px")
//   orientation      ("horizontal" | "vertical", default "horizontal")
//   pack-direction   ("start-to-end" | "end-to-start", default "start-to-end")
//   align            (0..1, default 0) — MAIN-axis offset of the whole line block
//   justify          ("none" | "fill" | "spread", default "none")
//   justify-last-line (boolean)
//   line-homogeneous  (boolean)
//   wrap-reverse      (boolean)
//   wrap-policy      ("minimum" | "natural", default "natural")
//   natural-line-length (int >= -1, default -1 = unset) + -unit
//
// The property CONTRACT — the normalisers and the justify/align/last-line decision —
// is `@gjsify/adwaita-core`'s `wrap-box.ts`, held to `WRAP_BOX_LINE_VECTORS` and
// friends, which the NativeScript suite drives too.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c / adw-wrap-layout.c (Adw.WrapBox)
// Reference: refs/adwaita-web/adwaita-web/scss/_wrap_box.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET,
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapBoxSpacing,
    normalizeWrapPolicy,
    resolveWrapBoxChildOrder,
    resolveWrapBoxLine,
    wrapBoxLengthToPx,
    wrapPolicyFlexShrink,
    type AdwLengthUnit,
} from '@gjsify/adwaita-core';

/**
 * The attributes that carry a property, in the order the C installs them.
 *
 * Doubles as the `notify::` roster: every entry gets an event on a real change,
 * so adding an attribute without its notification is not expressible here.
 */
const PROPERTY_ATTRIBUTES = [
    'child-spacing',
    'child-spacing-unit',
    'pack-direction',
    'align',
    'justify',
    'justify-last-line',
    'line-spacing',
    'line-spacing-unit',
    'line-homogeneous',
    'natural-line-length',
    'natural-line-length-unit',
    'wrap-reverse',
    'wrap-policy',
    'orientation',
] as const;

/** One attribute's normalised value, for the "did it really change" comparison. */
type PropertyValue = string | number | boolean;

/**
 * `align` as a `justify-content` keyword. C offsets the whole line block by
 * `roundf (length_delta * align)` — a continuum — while flexbox has three main-axis
 * positions, so the nearest one is taken. That approximation is the renderer's, not
 * libadwaita's rule, which is why it lives here and not in the conformance table.
 */
function alignToJustifyContent(align: number): string {
    if (align < 0.25) return 'flex-start';
    if (align < 0.75) return 'center';
    return 'flex-end';
}

export class AdwWrapBox extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return [...PROPERTY_ATTRIBUTES];
    }

    /** Spacing between children on the same line, in `child-spacing-unit`. */
    get childSpacing(): number {
        return normalizeWrapBoxSpacing(this.getAttribute('child-spacing'));
    }

    set childSpacing(value: number) {
        this.setAttribute('child-spacing', String(value));
    }

    get childSpacingUnit(): AdwLengthUnit {
        return normalizeWrapBoxLengthUnit(this.getAttribute('child-spacing-unit'));
    }

    set childSpacingUnit(value: AdwLengthUnit) {
        this.setAttribute('child-spacing-unit', value);
    }

    /** Spacing between lines, in `line-spacing-unit`. */
    get lineSpacing(): number {
        return normalizeWrapBoxSpacing(this.getAttribute('line-spacing'));
    }

    set lineSpacing(value: number) {
        this.setAttribute('line-spacing', String(value));
    }

    get lineSpacingUnit(): AdwLengthUnit {
        return normalizeWrapBoxLengthUnit(this.getAttribute('line-spacing-unit'));
    }

    set lineSpacingUnit(value: AdwLengthUnit) {
        this.setAttribute('line-spacing-unit', value);
    }

    /** Where the children sit ALONG the line (main axis): 0 start, 0.5 middle, 1 end. */
    get align(): number {
        return normalizeWrapBoxAlign(this.getAttribute('align'));
    }

    set align(value: number) {
        this.setAttribute('align', String(value));
    }

    get justify(): 'none' | 'fill' | 'spread' {
        return normalizeWrapBoxJustify(this.getAttribute('justify'));
    }

    set justify(value: 'none' | 'fill' | 'spread') {
        this.setAttribute('justify', value);
    }

    /** Whether the FINAL line is justified too. Default false, as in C. */
    get justifyLastLine(): boolean {
        return this.hasAttribute('justify-last-line');
    }

    set justifyLastLine(value: boolean) {
        this.toggleAttribute('justify-last-line', !!value);
    }

    /** Whether an overflowing line squeezes its children or lets them spill. */
    get wrapPolicy(): 'minimum' | 'natural' {
        return normalizeWrapPolicy(this.getAttribute('wrap-policy'));
    }

    set wrapPolicy(value: 'minimum' | 'natural') {
        this.setAttribute('wrap-policy', value);
    }

    get packDirection(): 'start-to-end' | 'end-to-start' {
        return normalizeWrapBoxPackDirection(this.getAttribute('pack-direction'));
    }

    set packDirection(value: 'start-to-end' | 'end-to-start') {
        this.setAttribute('pack-direction', value);
    }

    /** Whether lines wrap upwards (horizontal) / towards the start (vertical). */
    get wrapReverse(): boolean {
        return this.hasAttribute('wrap-reverse');
    }

    set wrapReverse(value: boolean) {
        this.toggleAttribute('wrap-reverse', !!value);
    }

    get lineHomogeneous(): boolean {
        return this.hasAttribute('line-homogeneous');
    }

    set lineHomogeneous(value: boolean) {
        this.toggleAttribute('line-homogeneous', !!value);
    }

    /** The natural line length in `natural-line-length-unit`, or `-1` when unset. */
    get naturalLineLength(): number {
        return normalizeNaturalLineLength(this.getAttribute('natural-line-length'));
    }

    set naturalLineLength(value: number) {
        this.setAttribute('natural-line-length', String(value));
    }

    get naturalLineLengthUnit(): AdwLengthUnit {
        return normalizeWrapBoxLengthUnit(this.getAttribute('natural-line-length-unit'));
    }

    set naturalLineLengthUnit(value: AdwLengthUnit) {
        this.setAttribute('natural-line-length-unit', value);
    }

    get orientation(): 'horizontal' | 'vertical' {
        return this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal';
    }

    set orientation(value: 'horizontal' | 'vertical') {
        this.setAttribute('orientation', value);
    }

    // `adw_wrap_box_append`, `_prepend` and `_remove` are deliberately NOT redeclared:
    // `ParentNode.append` / `.prepend` and `Node.removeChild` ARE those three, with the
    // same semantics, and shadowing them would give this element two spellings of one
    // operation. Only the three the DOM has no counterpart for are added.

    private get _children(): Element[] {
        return [...this.children];
    }

    /**
     * `adw_wrap_box_insert_child_after`. A NULL/absent `sibling` inserts at the FIRST
     * position, not the last — `gtk_widget_insert_after`'s documented rule, pinned by
     * `WRAP_BOX_CHILD_ORDER_VECTORS`. Returns whether the insert happened; a refusal is
     * where C would have hit a `g_return_if_fail`.
     */
    insertChildAfter(child: Element, sibling: Element | null = null): boolean {
        return this._applyOrder('insert-after', child, sibling);
    }

    /** `adw_wrap_box_reorder_child_after`. Same NULL rule. */
    reorderChildAfter(child: Element, sibling: Element | null = null): boolean {
        return this._applyOrder('reorder-after', child, sibling);
    }

    /** `adw_wrap_box_remove_all`. */
    removeAll(): void {
        for (const child of this._children) this.removeChild(child);
    }

    private _applyOrder(op: 'insert-after' | 'reorder-after', child: Element, sibling: Element | null): boolean {
        const next = resolveWrapBoxChildOrder({ children: this._children, child, sibling, op });
        if (next === null) return false;
        // Move exactly the one node: `insertBefore` relocates a node already in
        // the tree, and a null reference node appends. Re-appending the whole
        // resolved list would reach the same order while detaching and
        // re-attaching every sibling, which resets focus and any element state.
        const at = next.indexOf(child);
        this.insertBefore(child, next[at + 1] ?? null);
        return true;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this._sync();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        if (!this._initialized) return;
        this._sync();
        // C compares AFTER normalising and returns early when nothing changed, so
        // `child-spacing="-5"` on a box already at 0 notifies nobody. The gate applies to
        // EVERY property, not just the two spacings.
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    /** One attribute's value as the widget stores it — the notify comparison key. */
    private _normalized(name: string, raw: string | null): PropertyValue {
        switch (name) {
            case 'child-spacing':
            case 'line-spacing':
                return normalizeWrapBoxSpacing(raw);
            case 'child-spacing-unit':
            case 'line-spacing-unit':
            case 'natural-line-length-unit':
                return normalizeWrapBoxLengthUnit(raw);
            case 'align':
                return normalizeWrapBoxAlign(raw);
            case 'justify':
                return normalizeWrapBoxJustify(raw);
            case 'wrap-policy':
                return normalizeWrapPolicy(raw);
            case 'pack-direction':
                return normalizeWrapBoxPackDirection(raw);
            case 'natural-line-length':
                return normalizeNaturalLineLength(raw);
            case 'orientation':
                return raw === 'vertical' ? 'vertical' : 'horizontal';
            default:
                // The three booleans: a present attribute is true whatever it says.
                return raw !== null;
        }
    }

    private _sync() {
        const style = this.style;
        const vertical = this.orientation === 'vertical';

        const direction = vertical ? 'column' : 'row';
        style.flexDirection = this.packDirection === 'end-to-start' ? `${direction}-reverse` : direction;
        style.flexWrap = this.wrapReverse ? 'wrap-reverse' : 'wrap';

        // child-spacing is along the line (main axis), line-spacing is between
        // lines (cross axis). For a horizontal box that maps to column-gap /
        // row-gap respectively; the mapping flips for a vertical box. Both are
        // resolved through their OWN unit first, which is why they can disagree.
        const childGap = `${wrapBoxLengthToPx(this.childSpacing, this.childSpacingUnit)}px`;
        const lineGap = `${wrapBoxLengthToPx(this.lineSpacing, this.lineSpacingUnit)}px`;
        if (vertical) {
            style.rowGap = childGap;
            style.columnGap = lineGap;
        } else {
            style.columnGap = childGap;
            style.rowGap = lineGap;
        }
        // Read back by the last-line filler, which has to cancel exactly one
        // main-axis gap so it can never push a full line into a new one.
        style.setProperty('--adw-wrap-box-child-spacing', childGap);

        const justify = this.justify;
        const justifyLastLine = this.justifyLastLine;
        const align = this.align;

        // A flex container has ONE `justify-content` and applies it to every line, so it
        // carries the COMPLETE-line rule; the final-line rule is published beside it for
        // the stylesheet, which reaches that line through the only two selectors CSS
        // offers — `:only-child` (a box with one child has one line, and it is the last)
        // and the generated `::after` filler. Never collapse the pair into one attribute:
        // flexbox cannot express "every line but the last", and pretending it can is what
        // makes `justify-last-line` a no-op.
        const line = resolveWrapBoxLine({ justify, justifyLastLine, align, lastLine: false, childrenInLine: 2 });
        const lastLine = resolveWrapBoxLine({ justify, justifyLastLine, align, lastLine: true, childrenInLine: 2 });
        this.dataset.lineJustify = line.justify;
        this.dataset.lastLineJustify = lastLine.justify;

        // SPREAD widens the gaps; FILL grows the children (stylesheet) and leaves
        // the gaps alone; NONE offsets the whole line block by `align` — along
        // the MAIN axis, never the cross one.
        style.justifyContent = line.growGaps ? 'space-between' : alignToJustifyContent(line.align);

        // line-homogeneous makes every line take the same amount of space, which
        // flexbox approximates by stretching the lines across the cross axis.
        style.alignContent = this.lineHomogeneous ? 'stretch' : 'flex-start';

        // `wrap-policy` decides whether an overflowing line squeezes its children or lets
        // them spill. CSS defaults `flex-shrink` to 1, i.e. to ADW_WRAP_MINIMUM — which is
        // NOT libadwaita's default, so the policy has to be written out explicitly. What
        // flexbox cannot do either way is pack MORE children onto a line, since line
        // breaking runs on hypothetical sizes; see `wrapPolicyFlexShrink`.
        style.setProperty('--adw-wrap-box-child-shrink', String(wrapPolicyFlexShrink(this.wrapPolicy)));

        // DELIBERATE DEVIATION: libadwaita's `natural-line-length` caps the box's
        // NATURAL size request, leaving a larger allocation free to happen; CSS
        // has no property that caps only the intrinsic contribution, so this is a
        // max-size on the main axis and therefore caps the allocation too. It is
        // the intended use (limiting line length inside a popover) either way.
        const natural = wrapBoxLengthToPx(this.naturalLineLength, this.naturalLineLengthUnit);
        const cap = natural === ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET ? '' : `${natural}px`;
        style.maxWidth = vertical ? '' : cap;
        style.maxHeight = vertical ? cap : '';
    }
}

customElements.define('adw-wrap-box', AdwWrapBox);
