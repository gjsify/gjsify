// <gtk-label> — a run of text, and the node libadwaita's typography classes are written
// for (`.title-1` … `.caption`, `.dimmed`, `_labels.scss`).
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita ships no label
// type, so there is no `adw-` spelling. `_labels.scss` used to argue there should be no
// element at all — a `<span>` with a class does everything a hand-written page needs. What
// it cannot do is be the target of an authored tree: a Blueprint `Gtk.Label { label: …; }`
// mounted through `mountSharedTree` arrives as a TAG with a `label` attribute, and without
// an element that reads it the text never reached the screen.
//
// THE TEXT IS WRITTEN AS TEXT. `use-markup` is honoured by REDUCING the markup to its
// plain text (`labelDisplayText` in `@gjsify/adwaita-core`, the reduction the NativeScript
// label shares), never by handing it to `innerHTML`, which would run whatever the string
// carries. GTK draws the bold; this port shows the word. `use-underline` strips the
// mnemonic marker and binds no key.
//
// `xalign` IS WHERE THE TEXT SITS IN THE LABEL'S BOX, `justify` how its LINES align with
// each other — two properties, as in GTK. `xalign` is a continuum and CSS alignment has
// three keywords, so the box splits its free space between two spacers in the ratio
// `xalign : 1 − xalign` (`_labels.scss`), which is the C's `xalign * (width − text width)`
// to the pixel, and mirrors in RTL as `gtk_label` does. `justify` maps through Pango's own
// switch: LEFT and RIGHT are START and END of the text direction, FILL is start-aligned
// lines with inter-word justification.
//
// `ELLIPSIZE`, `WRAP-MODE`, `LINES`, `WIDTH-CHARS`, `MAX-WIDTH-CHARS` AND `YALIGN` are
// Pango's text-layout knobs, and each reaches a REAL CSS mechanism rather than being
// declared unreachable: `wrap-mode` is `word-break`/`overflow-wrap`, `width-chars`/
// `max-width-chars` are `min-width`/`max-width` in `ch` (`@gjsify/adwaita-core`'s
// `labelWidthCharsExtent`). `ellipsize` and `lines` are the SAME `-webkit-line-clamp` box
// (`.adw-label-clamp` in `_labels.scss`) WHENEVER `ellipsize` is active, `wrap` or not —
// MEASURED (a real `Gtk.Label`, allocated, gjs 1.88.1/gtk 4.22.5, `@gjsify/adwaita-core`'s
// `label.ts` header carries the numbers): `wrap` gates NOTHING once `ellipsize` is set,
// and an unset `lines` still caps at Pango's own default of ONE line, never "unlimited" —
// `labelEffectiveLines` is that whole derivation, shared with the NativeScript port. A
// single-line, non-ellipsized, non-wrapping label is the one case with no box at all: a
// bare text node, see `_renderSpan`'s doc comment for why it still needs the measurement
// pass the wrap-only case always needed. `yalign` is a DECLARED divergence past its three
// exact values (0, 0.5, 1): CSS `align-items` has three keywords and no ratio the way
// `flex-grow` gives `xalign` one — `_labels.scss`'s header says why a second spacer pair
// is not the fix; `labelYalignAlignItems` (`@gjsify/adwaita-core`) is the nearest-of-three
// zone map. `ellipsize` carries its own declared divergence at `start`/`middle`:
// `labelEllipsizeOverflowValue` (`@gjsify/adwaita-core`) draws every non-`none` mode as an
// end-ellipsis, the one truncating value CSS `text-overflow` and NativeScript's
// `textOverflow` both have.
//
// NOT HERE, and declared in `check-adwaita-element-properties.mjs`: `natural-wrap-mode`
// (a NATURAL-SIZE-REQUEST hint over a size-negotiation protocol this renderer does not
// run — a browser lays out once, it does not ask a widget for a preferred width first),
// `single-line-mode` (height pinned to one line's ascent+descent regardless of content —
// no CSS box does that without measuring the font, which a `<gtk-label>` never needs to:
// its own height already IS one line's whenever `wrap` is off) and the mnemonic machinery.
// `selectable` is only the ability to select; there is no caret or context menu.
//
// Reference: refs/gtk/gtk/gtklabel.c (properties, the `label` CSS name, the justify
//   switch, get_default_widths, gtk_label_ensure_layout's width/height conditions)
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss (`label {}`)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.

import {
    labelDisplayText,
    labelEffectiveLines,
    labelEllipsizeOverflowValue,
    labelWidthCharsExtent,
    labelYalignAlignItems,
    normalizeLabelEllipsize,
    normalizeLabelJustify,
    normalizeLabelLines,
    normalizeLabelMaxWidthChars,
    normalizeLabelWidthChars,
    normalizeLabelWrapMode,
    normalizeLabelXalign,
    normalizeLabelYalign,
    type LabelEllipsizeMode,
    type LabelJustification,
    type LabelWrapMode,
} from '@gjsify/adwaita-core';

/** The attributes that carry a property — also the `notify::` roster. */
const PROPERTY_ATTRIBUTES = [
    'label',
    'use-markup',
    'use-underline',
    'justify',
    'xalign',
    'yalign',
    'wrap',
    'wrap-mode',
    'ellipsize',
    'lines',
    'width-chars',
    'max-width-chars',
    'selectable',
] as const;

/** `Gtk.Justification` as a CSS `text-align`, through Pango's switch in `gtklabel.c`. */
const JUSTIFY_TEXT_ALIGN: Record<LabelJustification, string> = {
    left: 'start',
    right: 'end',
    center: 'center',
    fill: 'justify',
};

export class GtkLabel extends HTMLElement {
    /**
     * The rendered text's own box — present while {@link wrap} is set (so it can be pinned
     * to its measured wrap width, see `_remeasure`) OR while {@link ellipsize} is not
     * `none` (so `overflow`/`text-overflow` have a box of their own to clip, rather than
     * the label's flex container, which also holds the `xalign` spacer pseudo-elements).
     * `null` the rest of the time so a single-line, non-ellipsized label keeps the plain
     * text node `childElementCount` asserts on (`gtk-label.spec.ts`'s XSS note: "the DOM
     * gets one text node").
     */
    private _wrapSpan: HTMLSpanElement | null = null;
    private _resizes: ResizeObserver | null = null;

    static get observedAttributes() {
        return [...PROPERTY_ATTRIBUTES];
    }

    /** `Gtk.Label:label` — the text as written, before markup and the mnemonic come out. */
    get label(): string {
        return this.getAttribute('label') ?? '';
    }

    set label(value: string) {
        this.setAttribute('label', value ?? '');
    }

    /** `Gtk.Label:use-markup` — whether {@link label} is Pango markup (shown as its text). */
    get useMarkup(): boolean {
        return this.hasAttribute('use-markup');
    }

    set useMarkup(value: boolean) {
        this.toggleAttribute('use-markup', !!value);
    }

    /** `Gtk.Label:use-underline` — whether an `_` marks a mnemonic (stripped, not bound). */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', !!value);
    }

    /** `Gtk.Label:justify` — how the lines align with each other. Defaults to `left`. */
    get justify(): LabelJustification {
        return normalizeLabelJustify(this.getAttribute('justify'));
    }

    set justify(value: LabelJustification) {
        this.setAttribute('justify', value);
    }

    /** `Gtk.Label:xalign` — where the text sits in the label's box, 0…1. Defaults to 0.5. */
    get xalign(): number {
        return normalizeLabelXalign(this.getAttribute('xalign'));
    }

    set xalign(value: number) {
        this.setAttribute('xalign', String(value));
    }

    /**
     * `Gtk.Label:yalign` — where the text sits vertically in the label's box, 0…1.
     * Defaults to 0.5. Exact at 0, 0.5 and 1; a DECLARED divergence between them — see
     * `_labels.scss`'s header for why `align-items` has no continuum the way `xalign`'s
     * flex-grow ratio does.
     */
    get yalign(): number {
        return normalizeLabelYalign(this.getAttribute('yalign'));
    }

    set yalign(value: number) {
        this.setAttribute('yalign', String(value));
    }

    /** `Gtk.Label:wrap` — whether the text breaks into lines rather than overflowing. */
    get wrap(): boolean {
        return this.hasAttribute('wrap');
    }

    set wrap(value: boolean) {
        this.toggleAttribute('wrap', !!value);
    }

    /**
     * `Gtk.Label:wrap-mode` — where a wrapping line may break. Defaults to `word`. Only
     * affects the formatting while the layout can actually span more than one line —
     * {@link wrap}, or {@link ellipsize} being active (`ellipsize`, not just `wrap`, is
     * what gives GTK's own Pango layout a width to break within: `label.ts`'s header in
     * `@gjsify/adwaita-core`).
     */
    get wrapMode(): LabelWrapMode {
        return normalizeLabelWrapMode(this.getAttribute('wrap-mode'));
    }

    set wrapMode(value: LabelWrapMode) {
        this.setAttribute('wrap-mode', value);
    }

    /**
     * `Gtk.Label:ellipsize` — where the string is trimmed when it does not fit. Defaults
     * to `none`. `start` and `middle` are HELD faithfully — read `ellipsize` back and it
     * is exactly what was set — but DRAWN as an end-ellipsis: `labelEllipsizeOverflowValue`
     * (`@gjsify/adwaita-core`) says why.
     */
    get ellipsize(): LabelEllipsizeMode {
        return normalizeLabelEllipsize(this.getAttribute('ellipsize'));
    }

    set ellipsize(value: LabelEllipsizeMode) {
        this.setAttribute('ellipsize', value);
    }

    /**
     * `Gtk.Label:lines` — the line count an ellipsized label is held to. Defaults to -1
     * ("unset"), which still caps at ONE line the moment {@link ellipsize} is active —
     * Pango's own default, not "unlimited". Has no effect at all while ellipsize is
     * `none`, `wrap` or not — `labelEffectiveLines` (`@gjsify/adwaita-core`) is that
     * MEASURED guard, and its own doc comment carries the numbers.
     */
    get lines(): number {
        return normalizeLabelLines(this.getAttribute('lines'));
    }

    set lines(value: number) {
        this.setAttribute('lines', String(value));
    }

    /**
     * `Gtk.Label:width-chars` — the label's minimum width, in characters. Defaults to -1
     * (calculated automatically, i.e. unset here).
     */
    get widthChars(): number {
        return normalizeLabelWidthChars(this.getAttribute('width-chars'));
    }

    set widthChars(value: number) {
        this.setAttribute('width-chars', String(value));
    }

    /**
     * `Gtk.Label:max-width-chars` — the label's natural (maximum) width, in characters.
     * Defaults to -1 (calculated automatically, i.e. unset here).
     */
    get maxWidthChars(): number {
        return normalizeLabelMaxWidthChars(this.getAttribute('max-width-chars'));
    }

    set maxWidthChars(value: number) {
        this.setAttribute('max-width-chars', String(value));
    }

    /** `Gtk.Label:selectable` — whether the text can be selected. GTK's default is not. */
    get selectable(): boolean {
        return this.hasAttribute('selectable');
    }

    set selectable(value: boolean) {
        this.toggleAttribute('selectable', !!value);
    }

    /** `gtk_label_get_text` — the text as SHOWN, markup reduced and the marker removed. */
    getText(): string {
        return labelDisplayText(this.label, this.useMarkup, this.useUnderline);
    }

    connectedCallback() {
        this._render();
        this._resizes = new ResizeObserver(() => this._remeasure());
        this._resizes.observe(this);
        void document.fonts?.ready.then(() => this._remeasure());
    }

    disconnectedCallback() {
        this._resizes?.disconnect();
        this._resizes = null;
    }

    private _remeasure(): void {
        if (!this._wrapSpan || !this.isConnected) return;
        this._wrapSpan.style.width = '';
        const width = measuredWrapWidth(this._wrapSpan);
        this._wrapSpan.style.width = width !== null ? `${width}px` : '';
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._render();
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _normalized(name: string, raw: string | null): string | number | boolean {
        if (name === 'label') return raw ?? '';
        if (name === 'justify') return normalizeLabelJustify(raw);
        if (name === 'xalign') return normalizeLabelXalign(raw);
        if (name === 'yalign') return normalizeLabelYalign(raw);
        if (name === 'wrap-mode') return normalizeLabelWrapMode(raw);
        if (name === 'ellipsize') return normalizeLabelEllipsize(raw);
        if (name === 'lines') return normalizeLabelLines(raw);
        if (name === 'width-chars') return normalizeLabelWidthChars(raw);
        if (name === 'max-width-chars') return normalizeLabelMaxWidthChars(raw);
        return raw !== null;
    }

    private _render(): void {
        // `textContent`, the whole of the XSS answer: whatever the label holds, the DOM
        // gets one text node (wrapped in {@link _wrapSpan} while {@link wrap} or
        // {@link ellipsize} needs a box of its own — see `_renderSpan`).
        const text = this.getText();
        const wrap = this.wrap;
        const ellipsize = this.ellipsize;
        const clamped = ellipsize !== 'none';
        if (wrap || clamped) this._renderSpan(text, clamped);
        else this._renderSingleLine(text);

        this.style.setProperty('--gtk-label-xalign', String(this.xalign));
        this.style.textAlign = JUSTIFY_TEXT_ALIGN[this.justify];
        // `yalign`'s three-zone snap — `_labels.scss`'s header explains why there is no
        // continuum here the way `xalign`'s ratio spacers give the main axis one.
        this.style.setProperty('--gtk-label-align-items', labelYalignAlignItems(this.yalign));

        // The ONE truncating value CSS/NativeScript can both draw — see
        // `labelEllipsizeOverflowValue`'s comment. Left unset (falling through to the
        // `clip` `_labels.scss`'s non-clamping rules default to) while `ellipsize` is
        // `none`, so a label that never asked to be truncated never gets a stray custom
        // property a later `getComputedStyle` read would have to explain.
        const overflow = labelEllipsizeOverflowValue(ellipsize);
        if (overflow === 'ellipsis') this.style.setProperty('--gtk-label-ellipsize-overflow', overflow);
        else this.style.removeProperty('--gtk-label-ellipsize-overflow');

        // MEASURED (`label.ts`'s header, `@gjsify/adwaita-core`): `wrap` plays no part in
        // whether `lines` has an effect — only `ellipsize` does, and once it is active an
        // UNSET `lines` still caps at Pango's own default of ONE line, never "unlimited".
        // So this custom property is set whenever `ellipsize` is active, `wrap` or not;
        // `_labels.scss`'s `.adw-label-clamp` rule (toggled by `_renderSpan`, not an
        // attribute selector, since the RAW `ellipsize` attribute can hold a value this
        // method's own `normalizeLabelEllipsize` already rejected) is the one place that
        // reads it.
        const effectiveLines = labelEffectiveLines(this.lines, ellipsize);
        if (effectiveLines !== null) this.style.setProperty('--gtk-label-lines', String(effectiveLines));
        else this.style.removeProperty('--gtk-label-lines');

        // `width-chars` / `max-width-chars`, in `ch` — GTK's MINIMUM and NATURAL widths
        // (`get_default_widths`, gtklabel.c) — on the flex item itself, so wrap/ellipsize
        // resolve against that box rather than the ambient container.
        const extent = labelWidthCharsExtent(this.widthChars, this.maxWidthChars);
        if (extent.minCh !== null) this.style.minWidth = `${extent.minCh}ch`;
        else this.style.removeProperty('min-width');
        if (extent.maxCh !== null) this.style.maxWidth = `${extent.maxCh}ch`;
        else this.style.removeProperty('max-width');
    }

    private _renderSingleLine(text: string): void {
        this._wrapSpan?.remove();
        this._wrapSpan = null;
        if (this.textContent !== text) this.textContent = text;
    }

    /**
     * A WRAPPED OR ELLIPSIZED label centres its BLOCK by `xalign` (`gtklabel.c`,
     * `gtk_label_get_layout_location`), not just each line — `_labels.scss`'s two spacer
     * pseudo-elements split the label's FREE space by `xalign`, and a flex item only has
     * free space to give them once it FITS. `flex-basis: auto` sizes the plain text node to
     * its max-content (single-line) width; once that overflows, `flex-shrink` collapses the
     * zero-basis spacers to nothing and stretches the text item to the full container width
     * instead — which is where the offset was lost (the defect this method fixes).
     *
     * NO PURE-CSS FIX EXISTS: `width: fit-content` clamps to that SAME full-container width
     * the moment its content no longer fits one line — CSS shrink-to-fit is
     * `min(max(min-content, available), max-content)`, and `available` IS the container
     * here, not the narrower width GTK's Pango layout actually wrapped to. So this measures
     * instead, in two passes: first let {@link _wrapSpan} wrap at the FULL container width
     * (`width: ''`, the same collapse above, which is exactly the width GTK's own
     * allocation wraps against), then pin the span to its widest resulting line via
     * `Range.getClientRects()`, which gives the pseudo spacers real free space to split.
     * Approximate on purpose, and cheap: one synchronous reflow per render. The pinned
     * width goes stale whenever the available width or the font changes, and a page does
     * both (a rotated phone, an opened sidebar, a web font arriving late), so
     * {@link connectedCallback} re-measures on each resize and once the fonts have loaded.
     *
     * AN ELLIPSIZED SPAN NEEDS THIS TOO, MEASURED THE HARD WAY: an earlier version of this
     * method skipped it for `ellipsize` without `wrap`, reasoning that `white-space: nowrap`
     * text has one width whichever way it is measured. That reasoning stopped applying the
     * moment `ellipsize` alone started wrapping onto MULTIPLE lines to match GTK
     * (`label.ts`'s header) — `white-space: normal` multi-word text has a real
     * min-content/max-content gap, the exact shrink-to-fit collapse the wrapped case above
     * was already written for. One code path now, for both.
     */
    private _renderSpan(text: string, clamped: boolean): void {
        if (!this._wrapSpan) {
            this.textContent = '';
            this._wrapSpan = document.createElement('span');
            this._wrapSpan.className = 'adw-label-text';
            this.appendChild(this._wrapSpan);
        }
        this._wrapSpan.classList.toggle('adw-label-clamp', clamped);
        if (this._wrapSpan.textContent !== text) this._wrapSpan.textContent = text;
        this._remeasure();
    }
}

/** The widest line {@link span}'s text wrapped to, at its CURRENT width — see `_renderSpan`. */
function measuredWrapWidth(span: HTMLSpanElement): number | null {
    const range = document.createRange();
    range.selectNodeContents(span);
    let max = 0;
    for (const rect of range.getClientRects()) max = Math.max(max, rect.width);
    return max > 0 ? Math.ceil(max) : null;
}

customElements.define('gtk-label', GtkLabel);
