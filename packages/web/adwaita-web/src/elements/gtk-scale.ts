// <gtk-scale> — a slider: a trough, the highlighted part of it and a knob you drag.
//
// `Gtk.Scale` EXTENDS `Gtk.Range`, and `Gtk.Range` is CONCRETE — `gtk_range_get_type()`
// is registered with a bare `G_DEFINE_TYPE_WITH_CODE` (gtkrange.c:267), with no
// `G_TYPE_FLAG_ABSTRACT` anywhere in it. GTK still only ever builds one as the BASE of a
// subclass, so it has no tag of its own here and no block: its whole surface is this
// widget's and `Gtk.Scrollbar`'s — the adjustment, the value, `inverted`, the fill level
// and `round-digits` are `Gtk.Range` properties carried by `<gtk-scale>` and
// `<gtk-scrollbar>`, which is where they are documented.
//
// THE RANGE IS HEADLESS: `SpinState` from `@gjsify/adwaita-core` IS the portable
// `Gtk.Adjustment` (ADR 0047) — the six numbers, the clamp and the two signals — and
// `<adw-spin-row>` and `<adw-spinner>`'s siblings already hold one. `coord_to_value`
// (gtkrange.c) and `gtk_range_real_change_value` (gtkrange.c) are ported here literally.
//
// A NOTE ON THE `Gtk.Range` PROPERTIES THE WIDGET DOES NOT OBSERVE: none — the four
// `GtkScale` scalars (`digits`, `draw-value`, `has-origin`, `value-pos`) and the
// `GtkRange` ones are all attributes here, which is what keeps `KNOWN_GAPS` in
// `scripts/check-adwaita-element-properties.mjs` without an entry for this tag.
//
// NOT PORTED: the `marks` subnodes. `gtk_scale_add_mark()` / `clear_marks()` are
// DEPRECATED since GTK 4.10 and the marks widget is built only by them, so libadwaita's
// `.marks-before` / `.marks-after` rules (`_scale.scss:98-111`, `:152-170`, `:212-226`)
// and its `> marks` blocks have nothing here that can select them. The same file's
// `.fine-tune` rules (`:137-150`, `:197-210`) key on a style class `GtkRange` adds for
// the duration of a Shift-held drag (`gtkrange.c:1799-1801`) — this element's pointer
// handling does not run that zoom state, so it has no `.fine-tune` either. And `.color`
// (`:229-250`) belongs to `Gtk.ScaleButton`, which adds it itself.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_scale.scss:1-251
// Reference: refs/libadwaita/src/stylesheet/_colors.scss:280-289 (the trough and slider colours)
// Reference: refs/gtk/gtk/gtkrange.c (coord_to_value, gtk_range_real_change_value, should_invert)
// Reference: refs/gtk/gtk/gtkscale.c (class docs, properties, key bindings, format_value)
// Copyright (c) GNOME contributors (libadwaita, GTK). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the range state
//   composed from @gjsify/adwaita-core.

import {
    SpinState,
    glibClamp,
    normalizeAdjustment,
    normalizeBoxOrientation,
    parseAdjustment,
} from '@gjsify/adwaita-core';
import type { AdwAdjustment, AdwAdjustmentInput, BoxOrientation } from '@gjsify/adwaita-core';

/** `Gtk.PositionType` nicks, as `GtkScale:value-pos` spells them. */
const VALUE_POSITIONS = ['left', 'right', 'top', 'bottom'] as const;

/** `GtkScale:value-pos` in the order libadwaita lays the value out: default `top`. */
type ValuePosition = (typeof VALUE_POSITIONS)[number];

/**
 * `gtk_scale_init`'s `digits`, and the pspec default (gtkscale.c:705-708). `-1` on the
 * pspec is the range floor, not a default: the default is 1.
 */
const SCALE_DEFAULT_DIGITS = 1;

/** `round-digits` — `gtk_scale_init` sets `-1`, which `gtk_range_set_round_digits` reads as "do not round". */
const NO_ROUNDING = -1;

/**
 * The authored range with its authored value folded IN, which is what the C's constructor
 * does with the two properties together and what a separate setter would not: configuring
 * `value` after `adjustment` clamps it against the range it was authored beside, but it
 * also notifies, and nothing has been built to notify yet.
 */
function seededRange(adjustment: string | null, value: string | null): AdwAdjustment {
    const range = normalizeAdjustment(parseAdjustment(adjustment));
    if (value === null) return range;
    const authored = Number.parseFloat(value);
    // A non-numeric `value` is not a placement, exactly as `SpinState.configure` says of its
    // own: the value stays where the range put it.
    return Number.isFinite(authored) ? { ...range, value: authored } : range;
}

/**
 * `gtk_scale_format_value`'s default arm plus `weed_out_neg_zero` (gtkscale.c:1230-1245).
 *
 * Exported for the widget's own spec; `<gtk-spin-button>` carries the SAME `g_strdup_printf
 * ("%0.*f")` in its own C (`gtk_spin_button_format_for_value`, gtkspinbutton.c:1319-1326) with
 * a different `digits` default, and reuses this rather than growing a second copy of it.
 */
export function formatScaleValue(value: number, digits: number): string {
    const text = value.toFixed(digits);
    // `-0.00` at two places IS `-0.00` in `toFixed`, and C's `weed_out_neg_zero` compares the
    // formatted string against `g_snprintf ("%0.*f", digits, -0.0)` — so the minus goes
    // exactly when the rounded value is a negative zero at that precision.
    if (text.startsWith('-') && Number.parseFloat(text) === 0) return text.slice(1);
    return text;
}

export class GtkScale extends HTMLElement {
    /** The headless `Gtk.Adjustment`: the range, the clamp and the two signals (ADR 0004, ADR 0047). */
    private readonly _range = new SpinState();
    private _trough!: HTMLElement;
    private _highlight!: HTMLElement;
    private _fill!: HTMLElement;
    private _slider!: HTMLElement;
    private _value!: HTMLElement;
    private _initialized = false;
    private _pointerId: number | null = null;

    static get observedAttributes() {
        return [
            'adjustment',
            'digits',
            'disabled',
            'draw-value',
            'fill-level',
            'has-origin',
            'inverted',
            'orientation',
            'restrict-to-fill-level',
            'round-digits',
            'show-fill-level',
            'value',
            'value-pos',
        ];
    }

    /** `GtkOrientable:orientation` — `horizontal` (the default) or `vertical`. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    /** The numeric range — `Gtk.Range:adjustment`, as the portable value. Writes MERGE. */
    get adjustment(): AdwAdjustment {
        return this._range.adjustment;
    }

    set adjustment(value: AdwAdjustmentInput | string) {
        this._range.configure(typeof value === 'string' ? parseAdjustment(value) : value);
        this._render();
    }

    /** `Gtk.Range:value` — always inside `adjustmentRange`. */
    get value(): number {
        return this._range.value;
    }

    set value(v: number) {
        this._setValue(v, false);
    }

    /** `Gtk.Range:inverted`. */
    get inverted(): boolean {
        return this.hasAttribute('inverted');
    }

    set inverted(value: boolean) {
        this.toggleAttribute('inverted', !!value);
    }

    /** `GtkScale:draw-value` — whether the value is shown beside the slider. */
    get drawValue(): boolean {
        return this.hasAttribute('draw-value');
    }

    set drawValue(value: boolean) {
        this.toggleAttribute('draw-value', !!value);
    }

    /** `GtkScale:value-pos` — `left`, `right`, `top` (the default) or `bottom`. */
    get valuePos(): ValuePosition {
        const declared = this.getAttribute('value-pos');
        return VALUE_POSITIONS.includes(declared as ValuePosition) ? (declared as ValuePosition) : 'top';
    }

    set valuePos(value: ValuePosition) {
        this.setAttribute('value-pos', value);
    }

    /** `GtkScale:has-origin` — the default, so the highlight exists unless it is cleared. */
    get hasOrigin(): boolean {
        return !this.hasAttribute('has-origin') || this.getAttribute('has-origin') !== 'false';
    }

    set hasOrigin(value: boolean) {
        this.toggleAttribute('has-origin', !!value);
    }

    /** `GtkScale:digits` — decimal places in the value text. */
    get digits(): number {
        const declared = Number.parseInt(this.getAttribute('digits') ?? '', 10);
        return Number.isFinite(declared) ? Math.max(0, declared) : SCALE_DEFAULT_DIGITS;
    }

    set digits(value: number) {
        this.setAttribute('digits', String(value));
    }

    /** `Gtk.Range:fill-level` — the buffer level a media player would draw. */
    get fillLevel(): number {
        const declared = Number.parseFloat(this.getAttribute('fill-level') ?? '');
        return Number.isFinite(declared) ? declared : 0;
    }

    set fillLevel(value: number) {
        this.setAttribute('fill-level', String(value));
    }

    /** `Gtk.Range:show-fill-level` — no property by default, as `gtk_range_init` leaves it. */
    get showFillLevel(): boolean {
        return this.hasAttribute('show-fill-level');
    }

    set showFillLevel(value: boolean) {
        this.toggleAttribute('show-fill-level', !!value);
    }

    /** `Gtk.Range:restrict-to-fill-level`. */
    get restrictToFillLevel(): boolean {
        return this.hasAttribute('restrict-to-fill-level');
    }

    set restrictToFillLevel(value: boolean) {
        this.toggleAttribute('restrict-to-fill-level', !!value);
    }

    /** The knob, for a consumer that needs to measure it (`coord_to_value` needs its length). */
    get slider(): HTMLElement {
        return this._slider;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Seed the headless range BEFORE subscribing, so building the DOM below is not
        // driven by a change notification. The authored `value` goes IN with the range and
        // not through a setter after it: in C this is `priv->value` being initialised, and a
        // setter would emit `value-changed` for a state the widget never had.
        this._range.configure(seededRange(this.getAttribute('adjustment'), this.getAttribute('value')));

        this._trough = document.createElement('span');
        this._trough.className = 'adw-scale-trough';
        this._highlight = document.createElement('span');
        this._highlight.className = 'adw-scale-highlight';
        this._fill = document.createElement('span');
        this._fill.className = 'adw-scale-fill';
        this._slider = document.createElement('span');
        this._slider.className = 'adw-scale-slider';
        this._trough.append(this._fill, this._highlight, this._slider);

        this._value = document.createElement('span');
        this._value.className = 'adw-scale-value';

        this.replaceChildren(this._trough, this._value);

        // `Gtk.AccessibleRole.slider` (gtkscale.c:143), and the range is focusable in C
        // (`gtk_widget_set_focusable (…, TRUE)`, gtkscale.c:825) because it owns the keys.
        this.setAttribute('role', 'slider');
        if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');

        this._trough.addEventListener('pointerdown', (event) => this._onPointerDown(event));
        this._value.addEventListener('pointerdown', (event) => this._onPointerDown(event));
        this.addEventListener('keydown', (event) => this._onKeyDown(event));
        this.addEventListener('pointermove', (event) => this._onPointerMove(event));
        this.addEventListener('pointerup', (event) => this._onPointerUp(event));
        this.addEventListener('pointercancel', (event) => this._onPointerUp(event));

        this._range.subscribe((change) => {
            this._render();
            this.dispatchEvent(new CustomEvent('value-changed', { bubbles: true, detail: { value: change.value } }));
        });
        this._range.subscribeChanged(() => this._render());

        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'adjustment') {
            this._range.configure(parseAdjustment(this.getAttribute('adjustment')));
            return;
        }
        if (name === 'value') {
            this._range.setValue(Number.parseFloat(this.getAttribute('value') ?? '0'));
            return;
        }
        this._render();
    }

    /**
     * `gtk_range_real_change_value`'s write, with the range's own clamp inside `SpinState`.
     *
     * `restrict-to-fill-level` and `round-digits` are `GtkRange`'s own two lines before the
     * CLAMP (gtkrange.c:2873-2891), so they belong here rather than in the element's setter.
     * `interactive` is what separates a drag from a programmatic write in `SpinState`.
     */
    private _setValue(target: number, interactive: boolean): boolean {
        let next = target;
        if (this.restrictToFillLevel) next = Math.min(next, Math.max(this.adjustment.lower, this.fillLevel));
        const digits = Number.parseInt(this.getAttribute('round-digits') ?? '', 10);
        if (Number.isFinite(digits) && digits !== NO_ROUNDING) {
            // `floor (value * power + 0.5) / power`, which rounds half UP — not `toFixed`,
            // which rounds half away from zero and would differ on every negative half.
            const power = 10 ** digits;
            next = Math.floor(next * power + 0.5) / power;
        }
        return interactive ? this._range.setValueInteractive(next) : this._range.setValue(next);
    }

    /**
     * `coord_to_value` (gtkrange.c:1838-1878), which is `GtkScale`'s whole pointer mapping.
     *
     * A SCALE sets `slider_size_fixed`, so the fraction is `coord / trough_length` and the
     * slider's own length does not shorten the track — the knob's CENTRE is the value. An
     * equal-length degenerate trough answers 1.0, as C does.
     */
    private _valueAtCoord(coord: number): number {
        const adjustment = this.adjustment;
        const troughLength = this.orientation === 'horizontal' ? this._trough.clientWidth : this._trough.clientHeight;
        let frac = troughLength === 0 ? 1 : glibClamp(coord / troughLength, 0, 1);
        if (this._shouldInvert()) frac = 1 - frac;
        return adjustment.lower + frac * (adjustment.upper - adjustment.lower - adjustment.pageSize);
    }

    /**
     * `should_invert` (gtkrange.c:1806-1818) for a scale, which is always `flippable`
     * (`gtk_scale_init`, gtkscale.c:838).
     *
     * A horizontal scale in a RIGHT-TO-LEFT document is the case the `flippable` flag
     * exists for: `inverted` false already reads backwards there, so the two cancel and
     * the fraction is used as it comes.
     */
    private _shouldInvert(): boolean {
        const rtl = this.closest('[dir="rtl"]') !== null;
        if (this.orientation === 'horizontal') {
            return this.inverted ? !rtl : rtl;
        }
        return this.inverted;
    }

    private _onPointerDown(event: PointerEvent): void {
        if (this.hasAttribute('disabled')) return;
        // GTK refuses the grab on a trough press without a primary button (gtkrange.c:2088-2135).
        if (event.button !== 0) return;
        const rect = this._trough.getBoundingClientRect();
        const coord = this.orientation === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
        this._pointerId = event.pointerId;
        this.focus();
        this._setValue(this._valueAtCoord(coord), true);
        // `setPointerCapture` THROWS `NotFoundError` for a pointerId with no active pointer,
        // which is what a dispatched (not generated) event carries — so the value has moved
        // first and the capture is best-effort.
        try {
            this.setPointerCapture(event.pointerId);
        } catch {
            // No active pointer to capture: the drag ends on the next `pointerup` anywhere.
        }
        event.preventDefault();
    }

    private _onPointerMove(event: PointerEvent): void {
        if (this._pointerId !== event.pointerId) return;
        const rect = this._trough.getBoundingClientRect();
        const coord = this.orientation === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
        this._setValue(this._valueAtCoord(coord), true);
    }

    private _onPointerUp(event: PointerEvent): void {
        if (this._pointerId !== event.pointerId) return;
        this._pointerId = null;
        // `hasPointerCapture` is the guard that needs no exception: it answers FALSE for the
        // pointerId the press never captured.
        if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    }

    /**
     * The keys `GtkScale` binds (gtkscale.c:745-800), and none of them is orientation-bound:
     * the C says so in its own comment, because a blind user should not have to know which
     * way the slider runs.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (this.hasAttribute('disabled')) return;
        const adjustment = this.adjustment;
        const page = event.ctrlKey;
        let target: number | null = null;
        switch (event.key) {
            case 'ArrowLeft':
                target = this.value - (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            case 'ArrowRight':
                target = this.value + (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            case 'ArrowDown':
                target = this.value - (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            case 'ArrowUp':
                target = this.value + (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            case 'PageUp':
                target = this.value + adjustment.pageIncrement;
                break;
            case 'PageDown':
                target = this.value - adjustment.pageIncrement;
                break;
            case 'Home':
                target = adjustment.lower;
                break;
            case 'End':
                target = adjustment.upper - adjustment.pageSize;
                break;
            case '+':
            case '=':
                target = this.value + (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            case '-':
                target = this.value - (page ? adjustment.pageIncrement : adjustment.stepIncrement);
                break;
            default:
                return;
        }
        event.preventDefault();
        this._setValue(target, true);
    }

    private _render(): void {
        if (!this._trough) return;
        const orientation = this.orientation;
        const adjustment = this.adjustment;
        // The knob's CENTRE is the value, because a scale's slider size is fixed
        // (`gtk_scale_init`, gtkscale.c:832) and `coord_to_value` divides by the trough alone.
        const span = adjustment.upper - adjustment.lower - adjustment.pageSize;
        const raw = span === 0 ? 0 : (adjustment.value - adjustment.lower) / span;
        const fraction = glibClamp(this._shouldInvert() ? 1 - raw : raw, 0, 1);

        this.classList.toggle('horizontal', orientation === 'horizontal');
        this.classList.toggle('vertical', orientation === 'vertical');
        this.setAttribute('aria-orientation', orientation);
        if (orientation === 'horizontal') this._slider.style.left = `${fraction * 100}%`;
        else this._slider.style.bottom = `${fraction * 100}%`;
        this._slider.style.top = '';
        this._slider.style.right = '';

        const origin = this.hasOrigin;
        this._highlight.hidden = !origin;
        if (origin) {
            if (orientation === 'horizontal') {
                this._highlight.style.right = '';
                this._highlight.style.width = `${fraction * 100}%`;
            } else {
                this._highlight.style.width = '';
                this._highlight.style.height = `${fraction * 100}%`;
            }
        }

        // `> fill` is a SECOND trough-styled bar, for a media player's buffered range
        // (`_scale.scss:43-47`) — not the highlighted part the `has-origin` block owns.
        const filled = this.showFillLevel;
        this._fill.hidden = !filled;
        if (filled) {
            const level = glibClamp((this.fillLevel - adjustment.lower) / (span || 1), 0, 1);
            if (orientation === 'horizontal') this._fill.style.width = `${level * 100}%`;
            else this._fill.style.height = `${level * 100}%`;
        }

        this._value.textContent = formatScaleValue(adjustment.value, this.digits);
        this._value.hidden = !this.drawValue;
        const position = this.valuePos;
        this._value.classList.toggle('left', position === 'left');
        this._value.classList.toggle('right', position === 'right');
        this._value.classList.toggle('top', position === 'top');
        this._value.classList.toggle('bottom', position === 'bottom');

        this.setAttribute('aria-valuemin', String(adjustment.lower));
        this.setAttribute('aria-valuemax', String(adjustment.upper - adjustment.pageSize));
        this.setAttribute('aria-valuenow', String(adjustment.value));
        this.setAttribute('aria-valuetext', this._value.textContent ?? '');
        if (this.hasAttribute('disabled')) this.setAttribute('aria-disabled', 'true');
        else this.removeAttribute('aria-disabled');
    }
}

customElements.define('gtk-scale', GtkScale);
