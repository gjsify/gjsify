// <adw-button-row> — A boxed-list row that behaves like a button: a centered
// title with an optional start icon, spanning the full width of the list. The
// `suggested-action` / `destructive-action` style classes recolor it like the
// matching Adwaita button variants.
// Attributes: title, start-icon-name (symbolic name, e.g. "list-add"),
//   activatable (default on — matches Adw.ButtonRow).
// Events: `activated` (CustomEvent, bubbles) when the row is clicked — mirrors
//   the Adw.ButtonRow `activated` GObject signal.
// Reference: refs/libadwaita/src/adw-button-row.ui (AdwButtonRow template)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwButtonRow extends HTMLElement {
    private _contentsEl!: HTMLDivElement;
    private _startIconEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'start-icon-name', 'activatable'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Adw.ButtonRow is activatable by default; only an explicit
        // activatable="false" turns it off.
        if (!this.hasAttribute('activatable')) {
            this.setAttribute('activatable', '');
        }

        this._contentsEl = document.createElement('div');
        this._contentsEl.className = 'adw-button-row-contents';

        this._startIconEl = document.createElement('span');
        this._startIconEl.setAttribute('aria-hidden', 'true');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-button-row-title';

        this._contentsEl.append(this._startIconEl, this._titleEl);
        this.replaceChildren(this._contentsEl);
        this._render();

        this.addEventListener('click', () => {
            if (this._isActivatable()) {
                this.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            }
        });
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _isActivatable(): boolean {
        return this.getAttribute('activatable') !== 'false';
    }

    private _render() {
        const title = this.getAttribute('title') ?? '';
        this._titleEl.textContent = title;
        this._titleEl.hidden = title.length === 0;

        const icon = this.getAttribute('start-icon-name') ?? '';
        this._startIconEl.className = icon ? `adw-icon adw-icon--${icon}` : '';
        this._startIconEl.hidden = icon.length === 0;

        this.classList.toggle('activatable', this._isActivatable());
    }
}

customElements.define('adw-button-row', AdwButtonRow);
