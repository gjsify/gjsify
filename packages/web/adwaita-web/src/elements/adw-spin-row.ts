// <adw-spin-row> — Row with a label and numeric spin control (+/− buttons).
// Attributes: title, min, max, step, value
// Events: notify::value (CustomEvent, mirrors GJS GObject signal naming)
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwSpinRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _min = 0;
    private _max = 100;
    private _step = 1;
    private _value = 0;
    private _initialized = false;

    static get observedAttributes() { return ['value', 'min', 'max', 'step']; }

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

        const title = this.getAttribute('title') || '';
        this._min = parseFloat(this.getAttribute('min') || '0');
        this._max = parseFloat(this.getAttribute('max') || '100');
        this._step = parseFloat(this.getAttribute('step') || '1');
        this._value = parseFloat(this.getAttribute('value') || String(this._min));

        // Title
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-row-title';
        titleEl.textContent = title;

        // Spin control container
        const control = document.createElement('div');
        control.className = 'adw-spin-control';

        // Decrement button
        const decBtn = document.createElement('button');
        decBtn.className = 'adw-spin-dec';
        decBtn.textContent = '−';
        decBtn.addEventListener('click', () => this._adjust(-this._step));

        // Value input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this._formatValue(this._value);
        input.addEventListener('change', () => {
            const parsed = parseFloat(input.value);
            if (!isNaN(parsed)) {
                this.value = parsed;
                this._emitChange();
            } else {
                input.value = this._formatValue(this._value);
            }
        });

        // Increment button
        const incBtn = document.createElement('button');
        incBtn.className = 'adw-spin-inc';
        incBtn.textContent = '+';
        incBtn.addEventListener('click', () => this._adjust(this._step));

        control.append(decBtn, input, incBtn);
        this.append(titleEl, control);
        this._input = input;
    }

    attributeChangedCallback(name: string, _old: string | null, val: string | null) {
        if (!this._initialized) return;
        const num = parseFloat(val || '0');
        switch (name) {
            case 'value':
                if (num !== this._value) {
                    this._value = Math.min(this._max, Math.max(this._min, num));
                    this._input.value = this._formatValue(this._value);
                }
                break;
            case 'min': this._min = num; break;
            case 'max': this._max = num; break;
            case 'step': this._step = num; break;
        }
    }

    private _adjust(delta: number) {
        this.value = this._value + delta;
        this._emitChange();
    }

    private _emitChange() {
        this.dispatchEvent(new CustomEvent('notify::value', {
            bubbles: true,
            detail: { value: this._value },
        }));
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
