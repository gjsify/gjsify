// <adw-spin-row> — Row with a title/subtitle and a numeric spin control (+/− buttons).
// Attributes: title, subtitle, min, max, step, value
// Events: notify::value (CustomEvent, mirrors GJS GObject signal naming)
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.SpinRow.

export class AdwSpinRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _min = 0;
    private _max = 100;
    private _step = 1;
    private _value = 0;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'value', 'min', 'max', 'step'];
    }

    get value(): number {
        return this._value;
    }

    set value(v: number) {
        const clamped = Math.min(this._max, Math.max(this._min, v));
        // Round to step precision to avoid floating-point drift
        const decimals = this._countDecimals(this._step);
        this._value = parseFloat(clamped.toFixed(decimals));
        if (this._input) {
            this._input.value = this._formatValue(this._value);
        }
        this.setAttribute('value', String(this._value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._min = parseFloat(this.getAttribute('min') || '0');
        this._max = parseFloat(this.getAttribute('max') || '100');
        this._step = parseFloat(this.getAttribute('step') || '1');
        this._value = parseFloat(this.getAttribute('value') || String(this._min));

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
        decBtn.addEventListener('click', () => this._adjust(-this._step));

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this._formatValue(this._value);
        input.addEventListener('change', () => {
            const parsed = parseFloat(input.value);
            if (!Number.isNaN(parsed)) {
                this.value = parsed;
                this._emitChange();
            } else {
                input.value = this._formatValue(this._value);
            }
        });

        const incBtn = document.createElement('button');
        incBtn.className = 'adw-spin-inc';
        incBtn.textContent = '+';
        incBtn.addEventListener('click', () => this._adjust(this._step));

        control.append(decBtn, input, incBtn);
        this.replaceChildren(text, control);
        this._input = input;
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
                if (num !== this._value) {
                    this._value = Math.min(this._max, Math.max(this._min, num));
                    this._input.value = this._formatValue(this._value);
                }
                break;
            case 'min':
                this._min = num;
                break;
            case 'max':
                this._max = num;
                break;
            case 'step':
                this._step = num;
                break;
        }
    }

    private _renderText() {
        this._titleEl.textContent = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
    }

    private _adjust(delta: number) {
        this.value = this._value + delta;
        this._emitChange();
    }

    private _emitChange() {
        this.dispatchEvent(
            new CustomEvent('notify::value', {
                bubbles: true,
                detail: { value: this._value },
            }),
        );
    }

    private _countDecimals(n: number): number {
        const s = String(n);
        const dot = s.indexOf('.');
        return dot === -1 ? 0 : s.length - dot - 1;
    }

    private _formatValue(v: number): string {
        const decimals = this._countDecimals(this._step);
        return decimals > 0 ? v.toFixed(decimals) : String(v);
    }
}

customElements.define('adw-spin-row', AdwSpinRow);
