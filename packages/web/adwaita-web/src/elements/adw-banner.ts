// <adw-banner> — A full-width strip carrying a single in-context message and an
// optional action button.
// Attributes: title, button-label, revealed (boolean), use-markup (boolean),
//   button-style ("default" | "suggested").
// Events: `button-clicked` (CustomEvent) when the action button is pressed.
//
// The defaults and the derivations come from `@gjsify/adwaita-core` (ADR 0004),
// so this element and `@gjsify/adwaita-nativescript` answer the same markup the
// same way. They used not to: `revealed` was opt-in here and initialised TRUE
// there, and neither renderer had `button-style` (Since 1.7) or stripped the
// mnemonic marker the template pins onto the button (adw-banner.ui:33).
//
// Reference: refs/libadwaita/src/adw-banner.c (AdwBanner)
// Reference: refs/libadwaita/src/adw-banner.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss (banner :243-262)
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
        // defaults to TRUE (adw-banner.c:422-425) and `@gjsify/adwaita-core`
        // carries that as the spec value — but Pango markup is not HTML. Pango
        // has a fixed tag set and no scripting; `innerHTML` will run an
        // `onerror` handler. Adopting the C default here would turn every
        // `title` attribute into an injection sink for a widget that is not one
        // in GTK, so on this renderer markup is OPT-IN and the default is text.
        // The opt-in is the developer asserting the title is trusted.
        // The title label carries `use-underline=False` in the template
        // (adw-banner.ui:20), so its underscores are literal — no stripping here.
        if (this.hasAttribute('use-markup')) this._titleEl.innerHTML = title;
        else this._titleEl.textContent = title;

        // `label && label[0]` (:663) — a first-character test, so a label of
        // spaces still shows a button. The template pins the BUTTON to
        // `use-underline=True` (adw-banner.ui:33), so the painted text drops the
        // mnemonic markers the attribute keeps.
        const buttonLabel = this.getAttribute('button-label') ?? '';
        this._button.textContent = bannerButtonText(buttonLabel);
        this._button.hidden = !bannerButtonVisible(buttonLabel);

        // `button-style` (Since 1.7, :443-447) adds or removes exactly one class
        // (:764-774) — swap within the managed set so nothing else is touched.
        const style = parseBannerButtonStyle(this.getAttribute('button-style'));
        const applied = bannerButtonStyleClasses(style);
        for (const cls of ADW_BANNER_BUTTON_STYLE_CLASSES) {
            this._button.classList.toggle(cls, applied.includes(cls));
        }

        // `revealed` (default FALSE, :456-459) slides the strip in/out.
        this.classList.toggle('revealed', this.hasAttribute('revealed'));
    }
}

customElements.define('adw-banner', AdwBanner);
