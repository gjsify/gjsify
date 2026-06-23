// <adw-banner> — A full-width strip carrying a single in-context message and an
// optional action button.
// Attributes: title, button-label, revealed (boolean), use-markup (boolean).
// Events: `button-clicked` (CustomEvent) when the action button is pressed.
// Reference: refs/adwaita-web/adwaita-web/scss/_banner.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_banner.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwBanner extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _button!: HTMLButtonElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'button-label', 'revealed', 'use-markup'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-banner-title';

        this._button = document.createElement('button');
        this._button.className = 'adw-banner-button';
        this._button.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('button-clicked', { bubbles: true }));
        });

        this.replaceChildren(this._titleEl, this._button);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const title = this.getAttribute('title') ?? '';
        // `use-markup` mirrors Adw.Banner.use_markup: an opt-in (off by default)
        // for developer-supplied markup in the title, not user input. Plain text
        // goes through textContent.
        if (this.hasAttribute('use-markup')) this._titleEl.innerHTML = title;
        else this._titleEl.textContent = title;

        const buttonLabel = this.getAttribute('button-label') ?? '';
        this._button.textContent = buttonLabel;
        this._button.hidden = buttonLabel.length === 0;

        // `revealed` (default false to match Adw.Banner) slides the strip in/out.
        this.classList.toggle('revealed', this.hasAttribute('revealed'));
    }
}

customElements.define('adw-banner', AdwBanner);
