// <adw-entry> — Adwaita single-line text entry (e.g. a browser URL bar).
// Attributes: value, placeholder, type, disabled.
// Property: value (get/set, proxies the inner input).
// Events: native `input` bubbles from the inner input; `activate` (CustomEvent)
//   fires on Enter — mirroring Gtk.Entry's `activate` signal.
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwEntry extends HTMLElement {
    private _input!: HTMLInputElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['value', 'placeholder', 'type', 'disabled'];
    }

    get value(): string {
        return this._input ? this._input.value : (this.getAttribute('value') ?? '');
    }

    set value(v: string) {
        if (this._input) this._input.value = v;
        else this.setAttribute('value', v);
    }

    /** The inner native input (for focus/selection). */
    get input(): HTMLInputElement {
        return this._input;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const input = document.createElement('input');
        input.className = 'adw-entry';
        input.type = this.getAttribute('type') || 'text';
        input.value = this.getAttribute('value') ?? '';
        input.placeholder = this.getAttribute('placeholder') ?? '';
        input.disabled = this.hasAttribute('disabled');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { value: input.value } }));
            }
        });

        this._input = input;
        this.replaceChildren(input);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._input) return;
        if (name === 'value') this._input.value = value ?? '';
        else if (name === 'placeholder') this._input.placeholder = value ?? '';
        else if (name === 'type') this._input.type = value || 'text';
        else if (name === 'disabled') this._input.disabled = value !== null;
    }
}

customElements.define('adw-entry', AdwEntry);
