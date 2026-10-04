// <gtk-spin-button> — a number field with a decrement and an increment arrow either side of it.
//
// THE RANGE IS HEADLESS: `SpinState` from `@gjsify/adwaita-core` IS the portable
// `Gtk.Adjustment` (ADR 0047), the same one `<adw-spin-row>` and `<gtk-scale>` hold, so
// the `adjustment` attribute takes the same portable value on all three.
//
// THE CHILD ORDER IS `Gtk.SpinButton`'s, not the one a spinner usually draws. C builds
// its children in the order text, down, up (gtkspinbutton.c:1091-1126) and the box layout
// lays them out in it, so `Gtk.SpinButton` is `text ▼ ▲` horizontally and `▲ text ▼`
// vertically — `gtk_spin_button_set_orientation` MOVES the up arrow between the two
// (`insert_after (up, …, down)` for horizontal, `insert_before (up, …, entry)` for
// vertical, gtkspinbutton.c:1290-1299) and this element re-parents the same way, which is
// what libadwaita's `:first-child` / `:last-child` corner rules are written against.
//
// `snap-to-ticks` and `numeric` are `gtk_spin_button_update` / `gtk_spin_button_insert_text`
// ported literally, and `wrap` is `gtk_spin_button_real_spin`'s two branches.
//
// NOT PORTED: `input` / `output`, the two class-override hooks on the signal. They are C
// function pointers with no declarative spelling, and `gtk_spin_button_default_input` /
// `default_output` — the behaviour this element implements — are what they fall back to.
// `activates-default` is in `KNOWN_GAPS`: activating "the default widget" is a toplevel
// GTK concept a browser document has no word for.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_spin-button.scss:1-76
// Reference: refs/gtk/gtk/gtkspinbutton.c (properties, real_spin, update, insert_text,
//   update_buttons_sensitivity, gtk_spin_button_timer, format_for_value)
// Copyright (c) GNOME contributors (libadwaita, GTK). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the range state
//   composed from @gjsify/adwaita-core.

import { SpinState, glibClamp, normalizeAdjustment, parseAdjustment, snapAdjustmentValue } from '@gjsify/adwaita-core';
import type { AdwAdjustment, AdwAdjustmentInput } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';

import { formatScaleValue } from './gtk-scale.js';

/** `EPSILON` in gtkspinbutton.c:64 — the "is the value already at the bound" test. */
const EPSILON = 1e-10;

/** `TIMEOUT_INITIAL` / `TIMEOUT_REPEAT` / `MAX_TIMER_CALLS` (gtkspinbutton.c:63-67). */
const TIMEOUT_INITIAL = 500;
const TIMEOUT_REPEAT = 50;
const MAX_TIMER_CALLS = 5;

/** `Gtk.SpinButtonUpdatePolicy` nicks; `always` is the pspec default (gtkspinbutton.c:472-475). */
const UPDATE_POLICIES = ['always', 'if-valid'] as const;

export class GtkSpinButton extends HTMLElement {
    private readonly _range = new SpinState();
    private _input!: HTMLInputElement;
    private _down!: HTMLButtonElement;
    private _up!: HTMLButtonElement;
    private _initialized = false;
    private _edited = false;
    /** The orientation the children are CURRENTLY arranged for — see `_render`. */
    private _vertical: boolean | null = null;
    private _initialTimer: number | null = null;
    private _repeatTimer: number | null = null;
    private _timerCalls = 0;
    private _timerStep = 0;

    static get observedAttributes() {
        return [
            'adjustment',
            'climb-rate',
            'digits',
            'disabled',
            'numeric',
            'orientation',
            'snap-to-ticks',
            'update-policy',
            'value',
            'wrap',
        ];
    }

    /** The numeric range — `Gtk.SpinButton:adjustment`, as the portable value. Writes MERGE. */
    get adjustment(): AdwAdjustment {
        return this._range.adjustment;
    }

    set adjustment(value: AdwAdjustmentInput | string) {
        this._range.configure(typeof value === 'string' ? parseAdjustment(value) : value);
        this._render();
    }

    /** `Gtk.SpinButton:value` — always inside `adjustmentRange`. */
    get value(): number {
        return this._range.value;
    }

    set value(v: number) {
        this._range.setValue(v);
        this._render();
    }

    /** `Gtk.SpinButton:digits` — `gtk_spin_button_init` starts it at 0. */
    get digits(): number {
        const declared = Number.parseInt(this.getAttribute('digits') ?? '', 10);
        return Number.isFinite(declared) ? Math.max(0, declared) : 0;
    }

    set digits(value: number) {
        this.setAttribute('digits', String(value));
    }

    /** `Gtk.SpinButton:numeric` — "whether non-numeric characters should be ignored". */
    get numeric(): boolean {
        return this.hasAttribute('numeric');
    }

    set numeric(value: boolean) {
        this.toggleAttribute('numeric', !!value);
    }

    /** `Gtk.SpinButton:snap-to-ticks`. */
    get snapToTicks(): boolean {
        return this.hasAttribute('snap-to-ticks');
    }

    set snapToTicks(value: boolean) {
        this.toggleAttribute('snap-to-ticks', !!value);
    }

    /** `Gtk.SpinButton:wrap` — whether the value wraps at either bound. */
    get wrap(): boolean {
        return this.hasAttribute('wrap');
    }

    set wrap(value: boolean) {
        this.toggleAttribute('wrap', !!value);
    }

    /** `Gtk.SpinButton:update-policy` — `always` (the default) or `if-valid`. */
    get updatePolicy(): (typeof UPDATE_POLICIES)[number] {
        const declared = this.getAttribute('update-policy');
        return UPDATE_POLICIES.includes(declared as (typeof UPDATE_POLICIES)[number])
            ? (declared as (typeof UPDATE_POLICIES)[number])
            : 'always';
    }

    set updatePolicy(value: (typeof UPDATE_POLICIES)[number]) {
        this.setAttribute('update-policy', value);
    }

    /** `Gtk.SpinButton:climb-rate` — the acceleration of a held arrow. */
    get climbRate(): number {
        const declared = Number.parseFloat(this.getAttribute('climb-rate') ?? '');
        return Number.isFinite(declared) && declared > 0 ? declared : 0;
    }

    set climbRate(value: number) {
        this.setAttribute('climb-rate', String(value));
    }

    /** The inner text node, for a consumer that needs to place a caret in it. */
    get text(): HTMLInputElement {
        return this._input;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Range and authored value in ONE configure, as `GtkSpinButton`'s constructor takes
        // both: a `value` written through a setter after the range would notify a value the
        // widget never had, and `SpinState.configure` treats an authored value as a
        // placement either way.
        const range = normalizeAdjustment(parseAdjustment(this.getAttribute('adjustment')));
        const authored = this.getAttribute('value');
        const authoredValue = authored === null ? Number.NaN : Number.parseFloat(authored);
        this._range.configure(Number.isFinite(authoredValue) ? { ...range, value: authoredValue } : range);

        this._input = document.createElement('input');
        this._input.className = 'adw-spin-button-text';
        this._input.type = 'text';
        this._input.inputMode = 'decimal';
        this._input.autocomplete = 'off';
        this._input.spellcheck = false;

        // `can_focus` is FALSE on both arrows in C (gtkspinbutton.c:1106, 1125) — the field
        // owns the keys and the arrows are pointer targets. They stay real buttons here so a
        // click reaches them, and each carries the label C gives its accessible role NONE.
        this._down = document.createElement('button');
        this._down.type = 'button';
        this._down.className = 'adw-button image-button down';
        this._down.append(createGtkImage('value-decrease-symbolic'));
        this._down.setAttribute('aria-label', 'Decrease');
        this._up = document.createElement('button');
        this._up.type = 'button';
        this._up.className = 'adw-button image-button up';
        this._up.append(createGtkImage('value-increase-symbolic'));
        this._up.setAttribute('aria-label', 'Increase');

        this._down.addEventListener('click', () => this._spin(-this._range.adjustment.stepIncrement));
        this._up.addEventListener('click', () => this._spin(this._range.adjustment.stepIncrement));
        this._hold(this._down, -1);
        this._hold(this._up, 1);

        this._input.addEventListener('input', () => {
            this._edited = true;
            if (this.numeric) this._rejectNonNumeric();
        });
        this._input.addEventListener('change', () => this._update());
        this._input.addEventListener('keydown', (event) => this._onKeyDown(event));

        // `Gtk.AccessibleRole.spin_button` (gtkspinbutton.c:660), with the range's own
        // min/max/now, which C announces through `adjustment_changed_cb` (gtkspinbutton.c:1237-1246).
        this.setAttribute('role', 'spinbutton');
        this.replaceChildren(this._input, this._down, this._up);

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
     * `gtk_spin_button_real_spin` (gtkspinbutton.c:1666-1711), the whole of it: the two wrap
     * branches, the two clamp branches and the `wrapped` signal.
     *
     * The clamp itself is `SpinState`'s; what is here is that `wrap` REPLACES it, which is
     * why this is a method and not `increment()`/`decrement()` on the core state.
     */
    private _spin(increment: number): void {
        const adjustment = this.adjustment;
        let next = adjustment.value + increment;
        let wrapped = false;
        if (increment > 0) {
            if (this.wrap) {
                if (Math.abs(adjustment.value - adjustment.upper) < EPSILON) {
                    next = adjustment.lower;
                    wrapped = true;
                } else if (next > adjustment.upper) next = adjustment.upper;
            } else {
                next = Math.min(next, adjustment.upper);
            }
        } else if (increment < 0) {
            if (this.wrap) {
                if (Math.abs(adjustment.value - adjustment.lower) < EPSILON) {
                    next = adjustment.upper;
                    wrapped = true;
                } else if (next < adjustment.lower) next = adjustment.lower;
            } else {
                next = Math.max(next, adjustment.lower);
            }
        }
        if (Math.abs(next - adjustment.value) > EPSILON) this._range.setValueInteractive(next);
        if (wrapped) this.dispatchEvent(new CustomEvent('wrapped', { bubbles: true }));
    }

    /**
     * `gtk_spin_button_update` (gtkspinbutton.c:1795-1832) over
     * `gtk_spin_button_default_input` (gtkspinbutton.c:1673-1752).
     *
     * `update-policy` is the two branches that decide what a bad entry does: `always`
     * clamps, `if-valid` leaves the field ALONE and re-formats the committed value — which
     * is the `value_changed` call plus the early return C does at :1820-1824.
     */
    private _update(): void {
        const adjustment = this.adjustment;
        const parsed = Number.parseFloat(this._input.value);
        const error = this._input.value.trim() !== '' && Number.isNaN(parsed);
        if (this.updatePolicy === 'always') {
            const target = error || !Number.isFinite(parsed) ? adjustment.value : parsed;
            const bounded = glibClamp(target, adjustment.lower, adjustment.upper - adjustment.pageSize);
            this._commit(this.snapToTicks ? snapAdjustmentValue(adjustment, bounded) : bounded);
            return;
        }
        if (error || !Number.isFinite(parsed) || parsed < adjustment.lower || parsed > adjustment.upper) {
            this._render();
            this.dispatchEvent(
                new CustomEvent('value-changed', { bubbles: true, detail: { value: this._range.value } }),
            );
            return;
        }
        this._commit(this.snapToTicks ? snapAdjustmentValue(adjustment, parsed) : parsed);
    }

    private _commit(target: number): void {
        this._range.setValue(target);
        this._edited = false;
        this._render();
    }

    /**
     * `gtk_spin_button_insert_text`'s `numeric` filter (gtkspinbutton.c:1589-1649), applied to
     * the field's whole text rather than to one insertion — a browser input hands over the
     * result, not the keystroke. The three refusals C has are the three here: a sign after
     * the first character, a decimal point when `digits` is 0 or one is already there, and
     * anything that is not a digit.
     */
    private _rejectNonNumeric(): void {
        const digits = this.digits;
        let seenSign = false;
        let seenPoint = false;
        let out = '';
        for (const character of this._input.value) {
            if (character === '-' || character === '+') {
                // Only one sign, and only leading — C returns on any later one.
                if (seenSign || out !== '') return this._resetText();
                seenSign = true;
                out += character;
                continue;
            }
            if (character === '.') {
                if (!digits || seenPoint) return this._resetText();
                seenPoint = true;
                out += character;
                continue;
            }
            if (character < '0' || character > '9') return this._resetText();
            out += character;
        }
        if (out !== this._input.value) this._input.value = out;
    }

    /** A refused character drops the WHOLE edit and restores the formatted value, as C does. */
    private _resetText(): void {
        this._input.value = this._formatted();
    }

    /**
     * The held-arrow repeat, `gtk_spin_button_timer` (gtkspinbutton.c:1374-1407) with the
     * two constants that shape it.
     *
     * The ramp is C's exactly: the step grows by `climb-rate` once every `MAX_TIMER_CALLS`
     * ticks, and only while it is still below `page-increment`.
     */
    private _hold(button: HTMLButtonElement, direction: 1 | -1): void {
        const begin = (event: PointerEvent) => {
            if (event.button !== 0 || this.hasAttribute('disabled')) return;
            this._timerStep = this._range.adjustment.stepIncrement;
            this._timerCalls = 0;
            this._spin(direction * this._timerStep);
            this._initialTimer = window.setTimeout(() => {
                this._initialTimer = null;
                this._spin(direction * this._timerStep);
                this._repeatTimer = window.setInterval(() => this._tick(direction), TIMEOUT_REPEAT);
            }, TIMEOUT_INITIAL);
        };
        const end = () => this._stopHold();
        button.addEventListener('pointerdown', begin);
        button.addEventListener('pointerup', end);
        button.addEventListener('pointerleave', end);
        button.addEventListener('pointercancel', end);
    }

    private _tick(direction: 1 | -1): void {
        this._spin(direction * this._timerStep);
        const adjustment = this._range.adjustment;
        if (this.climbRate > 0 && this._timerStep < adjustment.pageIncrement) {
            if (this._timerCalls < MAX_TIMER_CALLS) this._timerCalls += 1;
            else {
                this._timerCalls = 0;
                this._timerStep += this.climbRate;
            }
        }
    }

    private _stopHold(): void {
        if (this._initialTimer !== null) {
            clearTimeout(this._initialTimer);
            this._initialTimer = null;
        }
        if (this._repeatTimer !== null) {
            clearInterval(this._repeatTimer);
            this._repeatTimer = null;
        }
        this._timerCalls = 0;
        this._timerStep = 0;
    }

    /**
     * The keys `GtkSpinButton` takes on the entry (gtkspinbutton.c:1495-1525): the arrows and
     * Page Up/Down move by the step and the page, and the vertical pair is bound on the
     * SCROLL controller rather than the keyboard — which is the same "arrows step whatever way
     * the widget runs" rule `GtkScale` states in its own words.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const adjustment = this._range.adjustment;
        const step = adjustment.stepIncrement;
        const page = adjustment.pageIncrement;
        let increment: number | null = null;
        switch (event.key) {
            case 'ArrowUp':
                increment = step;
                break;
            case 'ArrowDown':
                increment = -step;
                break;
            case 'PageUp':
                increment = page;
                break;
            case 'PageDown':
                increment = -page;
                break;
            case 'Enter': {
                // `gtk_spin_button_activate` (gtkspinbutton.c:1565-1579) emits `activate` only
                // when the text was NOT edited, and `gtk_spin_button_update` resets the latch.
                const wasEdited = this._edited;
                this._update();
                if (!wasEdited) this.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
                return;
            }
            default:
                return;
        }
        event.preventDefault();
        this._spin(increment);
    }

    private _formatted(): string {
        return formatScaleValue(this._range.value, this.digits);
    }

    private _render(): void {
        if (!this._input) return;
        const adjustment = this.adjustment;
        const vertical = this.getAttribute('orientation') === 'vertical';
        this.classList.toggle('vertical', vertical);
        this.classList.toggle('horizontal', !vertical);

        // `gtk_spin_button_set_orientation`'s two moves, so libadwaita's `:first-child` /
        // `:last-child` corner rules (`_spin-button.scss:41-52`, `:62-74`) select what they
        // select on a desktop: the up arrow hugs the rounded end in both orientations.
        // Only on a CHANGE of orientation — re-parenting a focused node blurs it, and
        // `_render` runs on every value change.
        if (vertical !== this._vertical) {
            this._vertical = vertical;
            if (vertical) this.replaceChildren(this._up, this._input, this._down);
            else this.replaceChildren(this._input, this._down, this._up);
        }

        this._input.disabled = this.hasAttribute('disabled');
        // `update_width_chars` (gtkspinbutton.c:1329-1360): with no authored `width-chars` the
        // field is as wide as the WIDER bound formatted at `digits`, capped at 10 characters.
        this._input.size = 10;

        // `gtk_spin_button_default_output` only replaces the text when it DIFFERS, and never
        // while the caret is in the field: a re-render mid-keystroke would move it.
        if (document.activeElement !== this._input && this._input.value !== this._formatted()) {
            this._input.value = this._formatted();
        }

        // `update_buttons_sensitivity` (gtkspinbutton.c:1214-1226): wrap OR room to move.
        this._up.disabled = !this.wrap && adjustment.upper - adjustment.value <= EPSILON;
        this._down.disabled = !this.wrap && adjustment.value - adjustment.lower <= EPSILON;

        this.setAttribute('aria-valuemin', String(adjustment.lower));
        this.setAttribute('aria-valuemax', String(adjustment.upper - adjustment.pageSize));
        this.setAttribute('aria-valuenow', String(adjustment.value));
        if (this.hasAttribute('disabled')) this.setAttribute('aria-disabled', 'true');
        else this.removeAttribute('aria-disabled');
    }
}

customElements.define('gtk-spin-button', GtkSpinButton);
