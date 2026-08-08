// <adw-spin-row> — Row with a title/subtitle and a numeric spin control (+/− buttons).
// Attributes: title, subtitle, min, max, step, value
// Events: notify::value (CustomEvent, mirrors GJS GObject signal naming)
//
// The ADJUSTMENT state machine (value/min/max/step plus the clamp-on-every-
// mutation and the change detection) is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004) as {@link SpinState}; this element composes it
// and keeps only the DOM render half — the −/input/+ control, the step-precision
// display (the `Adw.SpinRow:digits` concern, which belongs to the widget, not to
// the adjustment) and the `notify::value` event.
// `@gjsify/adwaita-nativescript` composes the same state machine, so both ports
// share one behaviour.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.SpinRow; the adjustment state
//   machine composed from @gjsify/adwaita-core.

import { SpinState, deriveRowLabels } from '@gjsify/adwaita-core';

export class AdwSpinRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless value/min/max/step adjustment with clamping (ADR 0004). */
    private readonly _state = new SpinState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'value', 'min', 'max', 'step'];
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

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Seed the headless adjustment BEFORE subscribing, so building the initial
        // DOM below is not driven by a change notification.
        this._state.setMin(parseFloat(this.getAttribute('min') || '0'));
        this._state.setMax(parseFloat(this.getAttribute('max') || '100'));
        this._state.setStep(parseFloat(this.getAttribute('step') || '1'));
        this._state.setValue(this._roundToStep(parseFloat(this.getAttribute('value') || String(this._state.min))));

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        // Spin control container
        const control = document.createElement('div');
        control.className = 'adw-spin-control';

        const decBtn = document.createElement('button');
        decBtn.className = 'adw-spin-dec';
        decBtn.textContent = '−';
        decBtn.addEventListener('click', () => this._adjust(-this._state.step));

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
        incBtn.addEventListener('click', () => this._adjust(this._state.step));

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
        const num = parseFloat(val || '0');
        switch (name) {
            case 'value':
                this._state.setValue(this._roundToStep(num));
                break;
            case 'min':
                this._state.setMin(num);
                break;
            case 'max':
                this._state.setMax(num);
                break;
            case 'step':
                this._state.setStep(num);
                break;
        }
    }

    private _renderText() {
        // The `string_is_not_empty` label rule, from core — this block was one of
        // six hand-rolled copies, all of which omitted the TITLE half.
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
        const decimals = this._countDecimals(this._state.step);
        return decimals > 0 ? parseFloat(n.toFixed(decimals)) : n;
    }

    private _countDecimals(n: number): number {
        const s = String(n);
        const dot = s.indexOf('.');
        return dot === -1 ? 0 : s.length - dot - 1;
    }

    private _formatValue(v: number): string {
        const decimals = this._countDecimals(this._state.step);
        return decimals > 0 ? v.toFixed(decimals) : String(v);
    }
}

customElements.define('adw-spin-row', AdwSpinRow);
