// <adw-combo-row> — Row with a label and dropdown select.
// Attributes: title, items (JSON string[]), selected (index number)
// Events: notify::selected (CustomEvent, mirrors GJS GObject signal naming)
// The native <select> is stretched invisibly over the row so clicking anywhere opens it.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwComboRow extends HTMLElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    private _items: string[] = [];
    private _initialized = false;

    static get observedAttributes() { return ['selected']; }

    get selected(): number {
        return this._select ? this._select.selectedIndex : parseInt(this.getAttribute('selected') || '0', 10);
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const title = this.getAttribute('title') || '';
        this._items = JSON.parse(this.getAttribute('items') || '[]');
        const selectedIdx = parseInt(this.getAttribute('selected') || '0', 10);

        // Title label
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-row-title';
        titleEl.textContent = title;

        // Visible selected value display
        const valueEl = document.createElement('span');
        valueEl.className = 'adw-row-value';
        valueEl.textContent = this._items[selectedIdx] ?? '';
        this._valueEl = valueEl;

        // Hidden select overlaying the entire row
        const select = document.createElement('select');
        this._items.forEach((item, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = item;
            if (i === selectedIdx) option.selected = true;
            select.appendChild(option);
        });

        this.appendChild(titleEl);
        this.appendChild(valueEl);
        this.appendChild(select);

        this._select = select;
        this._select.addEventListener('change', () => {
            const idx = this._select.selectedIndex;
            this._valueEl.textContent = this._items[idx] ?? '';
            this.setAttribute('selected', String(idx));
            this.dispatchEvent(new CustomEvent('notify::selected', {
                bubbles: true,
                detail: { selected: idx },
            }));
        });
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'selected' && this._select) {
            const idx = parseInt(value || '0', 10);
            this._select.selectedIndex = idx;
            if (this._valueEl) {
                this._valueEl.textContent = this._items[idx] ?? '';
            }
        }
    }
}

customElements.define('adw-combo-row', AdwComboRow);
