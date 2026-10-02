// <gtk-inscription> — text laid out to a SIZE in CHARACTERS AND LINES, not to a size in
// pixels. It is the widget for the text whose extent you want to be the same everywhere:
// a caption under an icon that must not reflow when the string changes, a placeholder that
// reserves four lines so the page does not jump, a truncated title whose window is measured
// rather than guessed.
//
// WHAT IT IS NOT. It is not a `<gtk-label>`. GtkInscription has no label string, no child
// widget, no selectable text, no ellipsize family, no justify — its `text` is the string
// itself and its `min`/`nat` CHAR and LINE counts ARE its size request. GtkLabel measures
// its own content; GtkInscription never looks at the text when it is measured at all
// (`gtk_inscription_measure_width`, gtkinscription.c:338-349, multiplies `min_chars` by a
// per-font char width and stops). So this element does NOT reach for a label's content
// measurement: it reaches for CSS `ch` and `lh`, which are the same two units Pango's
// average-char-width and line-height are, and it lays the string out once.
//
// THE FOUR COUNTS ARE THE SIZE REQUEST, AND `MAX` IS NOT A DETAIL. `measure_width`
// returns `min_chars * char_pixels` as the MINIMUM and `MAX (min_chars, nat_chars) *
// char_pixels` as the NATURAL (gtkinscription.c:347-348); `measure_height` does the same
// with `min_lines`/`nat_lines` and a line pixel (gtkinscription.c:383-384). `labelWidth-
// CharsExtent` (`@gjsify/adwaita-core`) already encodes the char half of that `MAX`, which
// is why it is reused rather than re-derived — a second copy of a formula is the one that
// drifts. The zero case matters too: both measures return NOTHING — minimum and natural
// stay at whatever the widget already had — when the two counts are both 0
// (gtkinscription.c:344-345, :378-379), which is the "this inscription does not
// participate in sizing" state, so `min-width`/`width` are cleared rather than set to `0`.
//
// THE DEFAULTS ARE NOT GtkLabel's. An inscription installs `min-chars 3`, `nat-chars 0`,
// `min-lines 1`, `nat-lines 0` (gtkinscription.c:59-65, :787-790) — so out of the box it
// reserves three characters on the inline axis and one line on the block axis and lets its
// text be as long as it likes. `xalign` defaults to 0.0 and `yalign` to 0.5
// (gtkinscription.c:67-69, :791-792), the opposite pairing to GtkLabel's centred default,
// which is what makes a caption left-aligned under a centred icon without a line of CSS.
// Both are the numbers this element carries, and `nat` beating `min` is why the default
// three is a MINIMUM and never a width.
//
// `WRAP-MODE` DEFAULTS DIFFERENTLY, AND THAT IS THE POINT. The pspec spells it out in its
// own doc comment — "unlike `GtkLabel`, the default here is `%PANGO_WRAP_WORD_CHAR`"
// (gtkinscription.c:738-740) — because an inscription is a box of a known extent, and a
// box of a known extent has to break a word that does not fit it or overflow. `word-char`
// is therefore the DEFAULT here and `word` is the opt-in, the reverse of
// `DEFAULT_LABEL_WRAP_MODE`; the three nicks are shared with GtkLabel
// (`LABEL_WRAP_MODES`) so the mapping table has one home.
//
// THE NICK SPELLING IS THE WIDGET'S, NOT THE LABEL'S. `GtkInscriptionOverflow` has four
// members and its nicks are `clip`, `ellipsize-start`, `ellipsize-middle`,
// `ellipsize-end` (`packages/framework/gtk-host/src/generated/props.ts:331`), where
// `Gtk.Label:ellipsize` spells the same four cases `none`, `start`, `middle`, `end`. They
// are kept apart deliberately: an attribute-driven tree reaches the enum through its GIR
// name, and a reader who writes `ellipsize-end` here and `end` on a `<gtk-label>` is
// writing two different correct things. The DRAWING is the same single CSS value for all
// three truncating members — `labelEllipsizeOverflowValue` (`@gjsify/adwaita-core`) draws
// any non-clipping mode as an end ellipsis, the truncating value both CSS
// `text-overflow` and NativeScript's `textOverflow` have — and `start`/`middle` remain a
// DECLARED divergence documented there, not re-litigated per renderer.
//
// A11Y: no role. GtkInscription sets `GTK_ACCESSIBLE_ROLE_LABEL` (gtkinscription.c:781),
// which is the same role `GtkLabel` sets and which ARIA has no keyword for: a static run of
// text takes no role at all, and adding one would make it a group in some screen readers.
// `role="label"` is not in the ARIA role list, so none is set — the same answer
// `<gtk-label>` gives, for the same reason.
//
// `xalign` IS WHERE THE TEXT SITS IN THE BOX, `yalign` VERTICALLY — the same two
// properties `GtkLabel` has, mapped the same way (`_labels.scss`'s spacer pair, and
// `labelYalignAlignItems` for the cross axis, which CSS gives three keywords rather than
// the continuum `flex-grow` gives `xalign`). The default of 0 makes the `::before` spacer
// zero-growth and the whole of the free space land before the text, which is what a caption
// wants, without the author writing a flex rule.
//
// `markup` IS REDUCED TO TEXT, NEVER PARSED. `GtkInscription:markup` is a Pango-markup
// string (gtkinscription.c:617-622) and `text` is a plain one; setting `markup` clears
// `text` and the other way round (`gtk_inscription_set_markup` invalidates the label, which
// is the `text` property's own job). `labelDisplayText` (`@gjsify/adwaita-core`) reduces
// markup to its plain text — the same reduction `<gtk-label>` and the NativeScript port
// use — and never hands the string to `innerHTML`, so a `markup` attribute cannot run
// anything. `text` wins when both are set, because that is the order the C's invalidation
// leaves them in: `gtk_inscription_set_markup` writes the label directly, and a later
// `set_text` overwrites it.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every
// real change.
//
// Reference: refs/gtk/gtk/gtkinscription.c (the defaults :59-69, :787-792, the measure
//   :338-412, the property table :599-777, `gtk_inscription_set_markup`
//   invalidating `text`)
// Reference: refs/gtk/gtk/gtkinscription.h:34-49 (the four overflow members)
// Reference: packages/framework/gtk-host/src/generated/props.ts:331 (the overflow nicks)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    LABEL_WRAP_MODES,
    labelDisplayText,
    labelEllipsizeOverflowValue,
    labelWidthCharsExtent,
    labelYalignAlignItems,
    type LabelWrapMode,
} from '@gjsify/adwaita-core';

/** `GtkInscriptionOverflow`, in enum order (gtkinscription.h:44-48). */
export const INSCRIPTION_OVERFLOW_MODES = ['clip', 'ellipsize-start', 'ellipsize-middle', 'ellipsize-end'] as const;

export type InscriptionOverflow = (typeof INSCRIPTION_OVERFLOW_MODES)[number];

/** `GTK_INSCRIPTION_OVERFLOW_CLIP`, the pspec default (gtkinscription.c:728-733). */
export const DEFAULT_INSCRIPTION_OVERFLOW: InscriptionOverflow = 'clip';

/**
 * `PANGO_WRAP_WORD_CHAR`, the pspec's default — which is NOT GtkLabel's
 * (gtkinscription.c:738-740). The nick set is shared; only the fallback differs, and it
 * differs because this widget sizes itself in characters and lines and therefore has to be
 * able to break a word inside the box it just reserved.
 */
export const DEFAULT_INSCRIPTION_WRAP_MODE: LabelWrapMode = 'word-char';

/** `GtkInscription:text-overflow` from its nick, leaving an unknown nick at the default. */
export function normalizeInscriptionOverflow(value: unknown): InscriptionOverflow {
    return (INSCRIPTION_OVERFLOW_MODES as readonly unknown[]).includes(value)
        ? (value as InscriptionOverflow)
        : DEFAULT_INSCRIPTION_OVERFLOW;
}

/** `GtkInscription:wrap-mode` from its nick, with {@link DEFAULT_INSCRIPTION_WRAP_MODE}. */
export function normalizeInscriptionWrapMode(value: unknown): LabelWrapMode {
    return (LABEL_WRAP_MODES as readonly unknown[]).includes(value)
        ? (value as LabelWrapMode)
        : DEFAULT_INSCRIPTION_WRAP_MODE;
}

/**
 * `GtkInscription:xalign` / `yalign` from a FLOAT with a range of 0…1
 * (gtkinscription.c:757-760, :773-776). The clamping is `normalizeLabelXalign`'s — a
 * value outside the pspec's range never reaches an attribute-driven tree, and one that does
 * is held to the interval rather than trusted.
 */
function normalizeAlignment(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(1, Math.max(0, parsed));
}

/**
 * The four counts are `guint` with a floor of ZERO (gtkinscription.c:638-644, :660-666,
 * :680-686, :700-706) — no `-1` "auto" exists here, unlike `GtkLabel:width-chars`. A
 * negative attribute value clamps to 0, which is the "does not participate in sizing"
 * state the C expresses by both counts being zero at once.
 */
function normalizeCount(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
}

export class GtkInscription extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return [
            'markup',
            'min-chars',
            'min-lines',
            'nat-chars',
            'nat-lines',
            'text',
            'text-overflow',
            'wrap-mode',
            'xalign',
            'yalign',
        ];
    }

    /** `GtkInscription:text` — the plain string to draw (gtkinscription.c:713-717). */
    get text(): string {
        return this.getAttribute('text') ?? '';
    }

    set text(value: string) {
        this._write('text', value);
    }

    /**
     * `GtkInscription:markup` — a Pango-markup string (gtkinscription.c:617-622), reduced
     * to its plain text by `labelDisplayText` rather than parsed. See the header for why
     * that is the XSS answer and why {@link text} wins when both are present.
     */
    get markup(): string {
        return this.getAttribute('markup') ?? '';
    }

    set markup(value: string) {
        this._write('markup', value);
    }

    /** `GtkInscription:min-chars` (gtkinscription.c:638-644). Defaults to 3. */
    get minChars(): number {
        const raw = this.getAttribute('min-chars');
        return raw === null ? 3 : normalizeCount(raw);
    }

    set minChars(value: number) {
        this._write('min-chars', String(value));
    }

    /** `GtkInscription:nat-chars` (gtkinscription.c:680-686). Defaults to 0. */
    get natChars(): number {
        return normalizeCount(this.getAttribute('nat-chars'));
    }

    set natChars(value: number) {
        this._write('nat-chars', String(value));
    }

    /** `GtkInscription:min-lines` (gtkinscription.c:660-666). Defaults to 1. */
    get minLines(): number {
        const raw = this.getAttribute('min-lines');
        return raw === null ? 1 : normalizeCount(raw);
    }

    set minLines(value: number) {
        this._write('min-lines', String(value));
    }

    /** `GtkInscription:nat-lines` (gtkinscription.c:700-706). Defaults to 0. */
    get natLines(): number {
        return normalizeCount(this.getAttribute('nat-lines'));
    }

    set natLines(value: number) {
        this._write('nat-lines', String(value));
    }

    /** `GtkInscription:text-overflow` (gtkinscription.c:726-732). Defaults to CLIP. */
    get textOverflow(): InscriptionOverflow {
        return normalizeInscriptionOverflow(this.getAttribute('text-overflow'));
    }

    set textOverflow(value: InscriptionOverflow) {
        this._write('text-overflow', value);
    }

    /** `GtkInscription:wrap-mode` (gtkinscription.c:741-746). Defaults to WORD_CHAR. */
    get wrapMode(): LabelWrapMode {
        return normalizeInscriptionWrapMode(this.getAttribute('wrap-mode'));
    }

    set wrapMode(value: LabelWrapMode) {
        this._write('wrap-mode', value);
    }

    /**
     * `GtkInscription:xalign` (gtkinscription.c:757-760). Defaults to 0.0
     * (gtkinscription.c:67, :791) — start-aligned, unlike GtkLabel's 0.5.
     */
    get xalign(): number {
        return normalizeAlignment(this.getAttribute('xalign'), 0);
    }

    set xalign(value: number) {
        this._write('xalign', String(value));
    }

    /** `GtkInscription:yalign` (gtkinscription.c:773-776). Defaults to 0.5. */
    get yalign(): number {
        return normalizeAlignment(this.getAttribute('yalign'), 0.5);
    }

    set yalign(value: number) {
        this._write('yalign', String(value));
    }

    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _property(name: string): string | number {
        switch (name) {
            case 'text':
                return this.text;
            case 'markup':
                return this.markup;
            case 'min-chars':
                return this.minChars;
            case 'nat-chars':
                return this.natChars;
            case 'min-lines':
                return this.minLines;
            case 'nat-lines':
                return this.natLines;
            case 'text-overflow':
                return this.textOverflow;
            case 'wrap-mode':
                return this.wrapMode;
            case 'xalign':
                return this.xalign;
            default:
                return this.yalign;
        }
    }

    private _render(): void {
        // `text` over `markup` (see the header): a `set_text` after a `set_markup` is the
        // state the C's invalidation leaves behind.
        const plain = this.text;
        const markup = this.markup;
        this.textContent = plain || !markup ? plain : labelDisplayText(markup, true, false);

        // The MEASURE, transcribed. `labelWidthCharsExtent` is the `MAX (min_chars,
        // nat_chars)` of gtkinscription.c:348 over the CSS `ch` unit, which is the same
        // average-char-width Pango measures in `get_char_pixels`.
        const { minCh, maxCh } = labelWidthCharsExtent(this.minChars, this.natChars);
        // `gtk_inscription_measure_width` returns NOTHING when both counts are zero
        // (gtkinscription.c:344-345), so the declarations are cleared rather than set to 0 —
        // `min-width: 0` would be a different, much smaller widget.
        this.style.setProperty('--gtk-inscription-min-ch', minCh === null ? 'auto' : `${minCh}ch`);
        this.style.setProperty('--gtk-inscription-width', maxCh === null ? 'auto' : `${maxCh}ch`);
        // The line half is the same `MAX` over a line height, and `lh` is that unit in CSS:
        // it resolves to the element's own line box, which is what Pango's `line_pixels` is
        // (gtkinscription.c:383-384). The counts repeat the zero case, which is a separate
        // test in the C (`min_lines == 0 && nat_lines == 0`, :378-379).
        const minLines = this.minLines;
        const natLines = this.natLines;
        this.style.setProperty('--gtk-inscription-min-lh', minLines === 0 && natLines === 0 ? 'auto' : `${minLines}lh`);
        this.style.setProperty(
            '--gtk-inscription-height',
            minLines === 0 && natLines === 0 ? 'auto' : `${Math.max(minLines, natLines)}lh`,
        );

        // `xalign`'s spacer ratio — `_inscription.scss` splits the free space between
        // `::before` and `::after` in exactly this ratio, which is the C's
        // `xalign * (width − text width)` (see `_labels.scss` for the GtkLabel statement of
        // the same formula and why it mirrors in RTL).
        this.style.setProperty('--gtk-inscription-xalign', String(this.xalign));
        this.style.setProperty('--gtk-inscription-align-items', labelYalignAlignItems(this.yalign));

        // `labelEllipsizeOverflowValue` draws every non-clipping overflow as an END
        // ellipsis; `clip` stays `clip`, which is what the pspec default means and the only
        // value that drops the overflow with no indication at all.
        const overflow = this.textOverflow;
        this.style.setProperty(
            '--gtk-inscription-text-overflow',
            labelEllipsizeOverflowValue(overflow === 'clip' ? 'none' : 'end'),
        );
        // The class form as well: a consumer's own rule needs something to select on, and a
        // class set from the NORMALIZED value cannot be left half-applied by a raw
        // unrecognised attribute the way an `[text-overflow=…]` selector could.
        this.classList.toggle('clip', overflow === 'clip');
        this.classList.toggle('ellipsized', overflow !== 'clip');
    }
}

customElements.define('gtk-inscription', GtkInscription);
