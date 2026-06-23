// <adw-combo-row> — Row with a title/subtitle and a dropdown select.
// Attributes: title, subtitle, items (JSON string[]), selected (index number)
// Events: notify::selected (CustomEvent, mirrors GJS GObject signal naming)
// The native <select> is stretched invisibly over the row so clicking anywhere opens it.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.ComboRow.

export class AdwComboRow extends HTMLElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _items: string[] = [];
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'selected'];
    }

    get selected(): number {
        return this._select ? this._select.selectedIndex : parseInt(this.getAttribute('selected') || '0', 10);
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._items = JSON.parse(this.getAttribute('items') || '[]');
        const selectedIdx = parseInt(this.getAttribute('selected') || '0', 10);

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        // Visible selected value display
        this._valueEl = document.createElement('span');
        this._valueEl.className = 'adw-row-value';
        this._valueEl.textContent = this._items[selectedIdx] ?? '';

        // Hidden select overlaying the entire row
        const select = document.createElement('select');
        this._items.forEach((item, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = item;
            if (i === selectedIdx) option.selected = true;
            select.appendChild(option);
        });

        this.replaceChildren(text, this._valueEl, select);

        this._select = select;
        this._select.addEventListener('change', () => {
            const idx = this._select.selectedIndex;
            this._valueEl.textContent = this._items[idx] ?? '';
            this.setAttribute('selected', String(idx));
            this.dispatchEvent(
                new CustomEvent('notify::selected', {
                    bubbles: true,
                    detail: { selected: idx },
                }),
            );
        });

        this._renderText();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'selected') {
            const idx = parseInt(value || '0', 10);
            this._select.selectedIndex = idx;
            this._valueEl.textContent = this._items[idx] ?? '';
        } else {
            this._renderText();
        }
    }

    private _renderText() {
        this._titleEl.textContent = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
    }
}

customElements.define('adw-combo-row', AdwComboRow);
