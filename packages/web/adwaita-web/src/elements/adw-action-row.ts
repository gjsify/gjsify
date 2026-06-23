// <adw-action-row> — A boxed-list row with a title, optional subtitle, and
// prefix / suffix widget slots. The most fundamental Adwaita row type.
// Attributes: title, subtitle, activatable.
// Slots: slot="prefix" (icons/widgets before the text), slot="suffix" (controls
//   after the text — switches, buttons, value labels).
// Events: `activated` (CustomEvent) when an `activatable` row is clicked.
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/actionrow.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (.row styling)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwActionRow extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _suffixEl!: HTMLDivElement;
    private _prefixEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'activatable'];
    }

    /** The end (suffix) section — append controls here imperatively. */
    get suffixSection(): HTMLDivElement {
        return this._suffixEl;
    }

    /** The start (prefix) section — append icons/widgets here imperatively. */
    get prefixSection(): HTMLDivElement {
        return this._prefixEl;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const prefixChildren = Array.from(this.querySelectorAll(':scope > [slot="prefix"]'));
        const suffixChildren = Array.from(this.querySelectorAll(':scope > [slot="suffix"]'));

        this._prefixEl = document.createElement('div');
        this._prefixEl.className = 'adw-action-row-prefix';
        for (const child of prefixChildren) this._prefixEl.appendChild(child);

        const textEl = document.createElement('div');
        textEl.className = 'adw-action-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        textEl.append(this._titleEl, this._subtitleEl);

        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'adw-action-row-suffix';
        for (const child of suffixChildren) this._suffixEl.appendChild(child);

        this.replaceChildren(this._prefixEl, textEl, this._suffixEl);
        this._render();

        this.addEventListener('click', () => {
            if (this.hasAttribute('activatable')) {
                this.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            }
        });
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const title = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._titleEl.textContent = title;
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
        this._prefixEl.hidden = this._prefixEl.childElementCount === 0;
        this._suffixEl.hidden = this._suffixEl.childElementCount === 0;
        this.classList.toggle('activatable', this.hasAttribute('activatable'));
    }
}

customElements.define('adw-action-row', AdwActionRow);
