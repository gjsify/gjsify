// <adw-entry-row> — A boxed-list row that is itself a text entry: the title
// floats as a label and the editable text sits inline on the row.
// Attributes: title, text.
// Property: text (get/set, proxies the inner input).
// Events: `changed` (CustomEvent) on every edit — mirrors Adw.EntryRow's
//   `changed` signal so it drives the same code path as the GTK renderer.
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/entryrow.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwEntryRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'text'];
    }

    get text(): string {
        return this._input ? this._input.value : (this.getAttribute('text') ?? '');
    }

    set text(value: string) {
        if (this._input) this._input.value = value;
        else this.setAttribute('text', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._titleEl.textContent = this.getAttribute('title') ?? '';

        this._input = document.createElement('input');
        this._input.className = 'adw-entry-row-input';
        this._input.type = 'text';
        this._input.value = this.getAttribute('text') ?? '';
        this._input.addEventListener('input', () => {
            this.dispatchEvent(new CustomEvent('changed', { bubbles: true, detail: { text: this._input.value } }));
        });

        this.replaceChildren(this._titleEl, this._input);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'title') this._titleEl.textContent = value ?? '';
        else if (name === 'text' && this._input.value !== (value ?? '')) this._input.value = value ?? '';
    }
}

customElements.define('adw-entry-row', AdwEntryRow);
