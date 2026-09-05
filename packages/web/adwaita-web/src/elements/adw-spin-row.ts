// <adw-spin-row> — row with a title/subtitle and a numeric spin control (+/− buttons).
//
// The ADJUSTMENT state machine (the range, the clamp on every mutation and the change
// detection) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link SpinState}; this element keeps only the DOM half — the −/input/+ control, the
// step-precision display (the `Adw.SpinRow:digits` concern, which belongs to the widget
// rather than to the adjustment) and the `notify::value` event.
//
// THE RANGE IS ONE ATTRIBUTE, `adjustment`, and it is JSON:
//
//     <adw-spin-row title="Zoom" adjustment='{"lower":1,"upper":20,"stepIncrement":1}'>
//
// `min` / `max` / `step` are gone. `Adw.SpinRow` has no such properties — it has an
// `adjustment`, and three renderers spelling that range three ways is what ADR 0047
// removes. The value is the portable `AdwAdjustment`, so a range authored here is the one
// the NativeScript row and the React Native widget take. The same markup door
// `<adw-combo-row model=…>` opens for its list, on the same reasoning.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.SpinRow; the adjustment state
//   machine composed from @gjsify/adwaita-core.

import { SpinState, deriveRowLabels, normalizeAdjustment, parseAdjustment } from '@gjsify/adwaita-core';
import type { AdwAdjustment, AdwAdjustmentInput } from '@gjsify/adwaita-core';

export class AdwSpinRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless adjustment: the range, the clamp and the two signals (ADR 0004, ADR 0047). */
    private readonly _state = new SpinState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'value', 'adjustment'];
    }

    get value(): number {
        return this._state.value;
    }

    set value(v: number) {
        // Round to step precision BEFORE the core clamp so repeated stepping
        // cannot accumulate floating-point drift (0.1 + 0.2 → 0.30000000000000004).
        this._state.setValue(this._roundToStep(v));
        this._syncValue();
    }

    /**
     * The numeric range — `Adw.SpinRow:adjustment`, as the portable value.
     *
     * Reads back whole; writes MERGE, so `el.adjustment = { upper: 20 }` moves one bound
     * and leaves the value where it is. A string is read as the JSON the attribute carries,
     * so the property and the attribute mean the same thing.
     */
    get adjustment(): AdwAdjustment {
        return this._state.adjustment;
    }

    set adjustment(v: AdwAdjustmentInput | string) {
        this._state.configure(typeof v === 'string' ? parseAdjustment(v) : v);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Seed the headless adjustment BEFORE subscribing, so building the initial
        // DOM below is not driven by a change notification. The range comes whole, so the
        // authored `value` attribute is applied against the range it was authored beside
        // rather than against whatever a partly-seeded state held.
        const range = normalizeAdjustment(parseAdjustment(this.getAttribute('adjustment')));
        this._state.configure(range);
        const authoredValue = this.getAttribute('value');
        this._state.setValue(
            this._roundToStep(authoredValue === null ? range.value : Number.parseFloat(authoredValue)),
        );

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        const control = document.createElement('div');
        control.className = 'adw-spin-control';

        const decBtn = document.createElement('button');
        decBtn.className = 'adw-spin-dec';
        decBtn.textContent = '−';
        decBtn.addEventListener('click', () => this._adjust(-this._state.adjustment.stepIncrement));

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this._formatValue(this._state.value);
        input.addEventListener('change', () => {
            const parsed = parseFloat(input.value);
            if (!Number.isNaN(parsed)) {
                this.value = parsed;
                this._emitChange();
            } else {
                input.value = this._formatValue(this._state.value);
            }
        });

        const incBtn = document.createElement('button');
        incBtn.className = 'adw-spin-inc';
        incBtn.textContent = '+';
        incBtn.addEventListener('click', () => this._adjust(this._state.adjustment.stepIncrement));

        control.append(decBtn, input, incBtn);
        this.replaceChildren(text, control);
        this._input = input;

        // Every core change (a set, or a re-clamp after a bound moved) refreshes
        // the display; `notify::value` is emitted at the interactive sites below.
        this._state.subscribe(() => this._syncValue());

        this._renderText();
    }

    attributeChangedCallback(name: string, _old: string | null, val: string | null) {
        if (!this._initialized) return;
        if (name === 'title' || name === 'subtitle') {
            this._renderText();
            return;
        }
        if (name === 'adjustment') {
            this._state.configure(parseAdjustment(val));
            return;
        }
        // `value`, the only other observed attribute reaching here.
        this._state.setValue(this._roundToStep(Number.parseFloat(val || '0')));
    }

    private _renderText() {
        // The `string_is_not_empty` label rule, from core — it hides the TITLE too.
        const labels = deriveRowLabels({
            title: this.getAttribute('title'),
            subtitle: this.getAttribute('subtitle'),
        });
        this._titleEl.textContent = labels.title;
        this._titleEl.hidden = !labels.titleVisible;
        this._subtitleEl.textContent = labels.subtitle;
        this._subtitleEl.hidden = !labels.subtitleVisible;
    }

    /** A stepper press — the interactive path, so it emits `notify::value`. */
    private _adjust(delta: number) {
        this.value = this._state.value + delta;
        this._emitChange();
    }

    private _emitChange() {
        this.dispatchEvent(
            new CustomEvent('notify::value', {
                bubbles: true,
                detail: { value: this._state.value },
            }),
        );
    }

    /** Mirror the core value into the input display + the reflected attribute. */
    private _syncValue() {
        if (this._input) this._input.value = this._formatValue(this._state.value);
        this.setAttribute('value', String(this._state.value));
    }

    private _roundToStep(n: number): number {
        if (!Number.isFinite(n)) return n;
        const decimals = this._countDecimals(this._state.adjustment.stepIncrement);
        return decimals > 0 ? parseFloat(n.toFixed(decimals)) : n;
    }

    private _countDecimals(n: number): number {
        const s = String(n);
        const dot = s.indexOf('.');
        return dot === -1 ? 0 : s.length - dot - 1;
    }

    private _formatValue(v: number): string {
        const decimals = this._countDecimals(this._state.adjustment.stepIncrement);
        return decimals > 0 ? v.toFixed(decimals) : String(v);
    }
}

customElements.define('adw-spin-row', AdwSpinRow);
