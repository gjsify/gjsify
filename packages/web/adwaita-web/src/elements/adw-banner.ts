// <adw-banner> — a full-width strip carrying a single in-context message and an optional
// action button. `button-style` is `"default" | "suggested"`, and `button-clicked`
// (CustomEvent) fires when the button is pressed.
//
// The defaults and the derivations (including stripping the mnemonic marker the upstream
// template pins onto the button label) come from `@gjsify/adwaita-core` (ADR 0004), so
// this element and the NativeScript one answer the same markup the same way.
//
// Reference: refs/libadwaita/src/adw-banner.c (AdwBanner)
// Reference: refs/libadwaita/src/adw-banner.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss (banner)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_BANNER_BUTTON_STYLE_CLASSES,
    bannerButtonStyleClasses,
    bannerButtonText,
    bannerButtonVisible,
    parseBannerButtonStyle,
} from '@gjsify/adwaita-core';

export class AdwBanner extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _button!: HTMLButtonElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'button-label', 'revealed', 'use-markup', 'button-style'];
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
        // DELIBERATE DEPARTURE FROM THE C DEFAULT. `Adw.Banner:use-markup`
        // defaults to TRUE and `@gjsify/adwaita-core`
        // carries that as the spec value — but Pango markup is not HTML. Pango
        // has a fixed tag set and no scripting; `innerHTML` will run an
        // `onerror` handler. Adopting the C default here would turn every
        // `title` attribute into an injection sink for a widget that is not one
        // in GTK, so on this renderer markup is OPT-IN and the default is text.
        // The opt-in is the developer asserting the title is trusted.
        // The title label carries `use-underline=False` in the template
        //, so its underscores are literal — no stripping here.
        if (this.hasAttribute('use-markup')) this._titleEl.innerHTML = title;
        else this._titleEl.textContent = title;

        // `label && label[0]` — a first-character test, so a label of
        // spaces still shows a button. The template pins the BUTTON to
        // `use-underline=True`, so the painted text drops the
        // mnemonic markers the attribute keeps.
        const buttonLabel = this.getAttribute('button-label') ?? '';
        this._button.textContent = bannerButtonText(buttonLabel);
        this._button.hidden = !bannerButtonVisible(buttonLabel);

        // `button-style` (Since 1.7) adds or removes exactly one class
        // — swap within the managed set so nothing else is touched.
        const style = parseBannerButtonStyle(this.getAttribute('button-style'));
        const applied = bannerButtonStyleClasses(style);
        for (const cls of ADW_BANNER_BUTTON_STYLE_CLASSES) {
            this._button.classList.toggle(cls, applied.includes(cls));
        }

        // `revealed` (default FALSE) slides the strip in/out.
        this.classList.toggle('revealed', this.hasAttribute('revealed'));
    }
}

customElements.define('adw-banner', AdwBanner);
