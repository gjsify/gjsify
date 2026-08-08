// <adw-wrap-box> — A box-like container that lays its children out in a line and
// wraps them onto new lines when they run out of room (the web analog of
// flexbox `flex-wrap: wrap` with a gap). Mirrors Adw.WrapBox.
// Attributes:
//   child-spacing   (px, default 0) — spacing between children on the same line
//                                      → CSS column-gap
//   line-spacing    (px, default 0) — spacing between lines → CSS row-gap
//   orientation     ("horizontal" | "vertical", default "horizontal") — the main
//                                      axis children are packed along
//   align           (0..1, default 0) — where the children sit ALONG the line
//                                      (main axis); 0 = start, 0.5 = middle, 1 = end
//   justify         ("none" | "fill" | "spread", default "none") — whether/how
//                                      each line is stretched to fill the widget
//   justify-last-line (boolean) — also justify the last (final) line
//   line-homogeneous  (boolean) — make every line take the same amount of space
//   pack-direction  ("start-to-end" | "end-to-start", default "start-to-end") —
//                                      direction children are packed within a line
//   wrap-reverse    (boolean) — reverse the wrap direction (lines wrap upwards)
// Events: notify::child-spacing, notify::line-spacing (CustomEvent, bubbles —
//   mirrors GObject signal naming, including its "only on a real change" rule).
// Reference: refs/libadwaita/src/adw-wrap-box.c / adw-wrap-layout.c (Adw.WrapBox)
// Reference: refs/adwaita-web/adwaita-web/scss/_wrap_box.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** `AdwJustifyMode` (adw-wrap-layout.c:74-83). */
type JustifyMode = 'none' | 'fill' | 'spread';

/** The three modes, for validating the attribute against the C enum. */
const JUSTIFY_MODES: readonly JustifyMode[] = ['none', 'fill', 'spread'];

/** What one line does with the space its children do not use. */
interface LineLayout {
    /** The mode governing this line, after the last-line gate. */
    justify: JustifyMode;
    /** Whether the CHILDREN absorb the leftover (adw-wrap-layout.c:336-341). */
    growChildren: boolean;
    /** Whether the GAPS absorb it (adw-wrap-layout.c:338-339, :752-757). */
    growGaps: boolean;
    /** The main-axis offset factor for an un-justified line (adw-wrap-layout.c:717-725). */
    align: number;
}

/**
 * The line-layout decision, straight from the C.
 *
 * `lastLine` is the FINAL line, complete or not (`i == *n_lines - 1`,
 * adw-wrap-layout.c:463-464), so a wrap box whose children all fit on one line
 * has that line governed by `justify-last-line` rather than by `justify`.
 *
 * The conformance table this must agree with is
 * `@gjsify/adwaita-core/conformance` → `WRAP_BOX_LINE_VECTORS`; the same rows
 * are asserted against the NativeScript port, so the two cannot drift apart
 * without a test naming the input.
 */
function resolveLine(
    justify: JustifyMode,
    justifyLastLine: boolean,
    align: number,
    lastLine: boolean,
    childrenInLine: number,
): LineLayout {
    // adw-wrap-layout.c:397-400 / :705-706 — the final line is only justified on
    // request; otherwise it falls back to ADW_JUSTIFY_NONE and to `align`.
    const effective: JustifyMode = lastLine && !justifyLastLine ? 'none' : justify;
    if (effective === 'none') return { justify: 'none', growChildren: false, growGaps: false, align };
    // adw-wrap-layout.c:338 — SPREAD keeps children at their minimum size and
    // widens the gaps, but the branch is guarded by `n_children > 1`: a lone
    // child has nothing to spread against and is stretched instead, which the
    // property documentation states outright (adw-wrap-box.c:349-352).
    const spreadsGaps = effective === 'spread' && childrenInLine > 1;
    return { justify: effective, growChildren: !spreadsGaps, growGaps: spreadsGaps, align: 0 };
}

/**
 * `Adw.WrapBox:child-spacing` / `:line-spacing` normalisation.
 *
 * C clamps a negative value to 0 before it reaches the layout
 * (adw-wrap-box.c:587-588, :927-928) — the property is declared with a minimum
 * of 0, so without the clamp GObject would reject it. The non-numeric cases have
 * no C counterpart (the property is an `int`); they resolve to the default so a
 * typo cannot put `NaN` into a `column-gap`.
 */
function normalizeSpacing(raw: string | null): number {
    const value = Number.parseFloat(raw ?? '');
    if (!Number.isFinite(value) || value < 0) return 0;
    return value;
}

/** `Adw.WrapBox:align` — `g_param_spec_float (…, 0, 1, 0, …)`, adw-wrap-box.c:335-337. */
function normalizeAlign(raw: string | null): number {
    const value = Number.parseFloat(raw ?? '');
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/** An out-of-range enum value leaves a GObject property at its default. */
function normalizeJustify(raw: string | null): JustifyMode {
    return JUSTIFY_MODES.includes(raw as JustifyMode) ? (raw as JustifyMode) : 'none';
}

/**
 * `align` as a `justify-content` keyword.
 *
 * C offsets the whole line block by `roundf (length_delta * align)` — a
 * continuum. Flexbox has three main-axis positions, so the nearest one is taken;
 * that is the renderer's approximation, not libadwaita's rule, which is why it
 * lives here and not in the conformance table.
 */
function alignToJustifyContent(align: number): string {
    if (align < 0.25) return 'flex-start';
    if (align < 0.75) return 'center';
    return 'flex-end';
}

export class AdwWrapBox extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return [
            'child-spacing',
            'line-spacing',
            'orientation',
            'align',
            'justify',
            'justify-last-line',
            'line-homogeneous',
            'pack-direction',
            'wrap-reverse',
        ];
    }

    /** Spacing between children on the same line, in px (CSS column-gap). */
    get childSpacing(): number {
        return normalizeSpacing(this.getAttribute('child-spacing'));
    }

    set childSpacing(value: number) {
        this.setAttribute('child-spacing', String(value));
    }

    /** Spacing between lines, in px (CSS row-gap). */
    get lineSpacing(): number {
        return normalizeSpacing(this.getAttribute('line-spacing'));
    }

    set lineSpacing(value: number) {
        this.setAttribute('line-spacing', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this._sync();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        if (!this._initialized) return;
        this._sync();
        // C compares AFTER normalising and returns early when nothing changed
        // (adw-wrap-box.c:592-593), so `child-spacing="-5"` on a box already at 0
        // notifies nobody.
        if (name === 'child-spacing') {
            const next = normalizeSpacing(value);
            if (next === normalizeSpacing(old)) return;
            this.dispatchEvent(
                new CustomEvent('notify::child-spacing', { bubbles: true, detail: { childSpacing: next } }),
            );
        } else if (name === 'line-spacing') {
            const next = normalizeSpacing(value);
            if (next === normalizeSpacing(old)) return;
            this.dispatchEvent(
                new CustomEvent('notify::line-spacing', { bubbles: true, detail: { lineSpacing: next } }),
            );
        }
    }

    private _sync() {
        const style = this.style;
        const vertical = this.getAttribute('orientation') === 'vertical';
        const reverseWrap = this.hasAttribute('wrap-reverse');
        const packEndToStart = this.getAttribute('pack-direction') === 'end-to-start';

        // Main axis is the packing direction; lines wrap along the cross axis.
        const direction = vertical ? 'column' : 'row';
        const reversed = packEndToStart ? `${direction}-reverse` : direction;
        style.flexDirection = reversed;
        style.flexWrap = reverseWrap ? 'wrap-reverse' : 'wrap';

        // child-spacing is along the line (main axis), line-spacing is between
        // lines (cross axis). For a horizontal box that maps to column-gap /
        // row-gap respectively; the mapping flips for a vertical box.
        const childSpacing = this.childSpacing;
        const childGap = `${childSpacing}px`;
        const lineGap = `${this.lineSpacing}px`;
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

        const justify = normalizeJustify(this.getAttribute('justify'));
        const justifyLastLine = this.hasAttribute('justify-last-line');
        const align = normalizeAlign(this.getAttribute('align'));

        // A flex container has ONE `justify-content` and applies it to every
        // line, so it carries the COMPLETE-line rule; the final-line rule is
        // published beside it for the stylesheet, which reaches that line through
        // the only two selectors CSS offers — `:only-child` (a box with one child
        // has one line, and it is the last) and the generated `::after` filler.
        // The pair is deliberately never collapsed into one attribute: flexbox
        // cannot express "every line but the last", and pretending otherwise is
        // what made `justify-last-line` a no-op in the first place.
        const line = resolveLine(justify, justifyLastLine, align, false, 2);
        const lastLine = resolveLine(justify, justifyLastLine, align, true, 2);
        this.dataset.lineJustify = line.justify;
        this.dataset.lastLineJustify = lastLine.justify;

        // SPREAD widens the gaps; FILL grows the children (stylesheet) and leaves
        // the gaps alone; NONE offsets the whole line block by `align` — along
        // the MAIN axis, never the cross one.
        style.justifyContent = line.growGaps ? 'space-between' : alignToJustifyContent(line.align);

        // line-homogeneous makes every line take the same amount of space, which
        // flexbox approximates by stretching the lines across the cross axis.
        style.alignContent = this.hasAttribute('line-homogeneous') ? 'stretch' : 'flex-start';
    }
}

customElements.define('adw-wrap-box', AdwWrapBox);
