// <adw-avatar> — A round avatar showing initials derived from a name (with a
// colour picked from the name), or a symbolic fallback icon.
// Attributes: text, size (px, default 48), show-initials (boolean),
//   icon (symbolic fallback name, with or without -symbolic).
// Reference: refs/adwaita-web/adwaita-web/scss/_avatar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.
//
// The two derivations — initials from the name, and the palette colour the name
// hashes to — are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004) as
// {@link avatarInitials} / {@link avatarColor}; this element only paints them.
// They used to be a local copy that had drifted from both libadwaita and the
// NativeScript renderer (single-word names rendered TWO letters here and one
// there, and accented names picked the wrong colour in both). The shared
// vectors in `@gjsify/adwaita-core/conformance` now pin this element to the C
// source — see `src/adw-avatar.spec.ts`.

import { avatarColor, avatarInitials } from '@gjsify/adwaita-core';

export class AdwAvatar extends HTMLElement {
    private _textEl!: HTMLSpanElement;
    private _iconEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['text', 'size', 'show-initials', 'icon'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._textEl = document.createElement('span');
        this._textEl.className = 'adw-avatar-text';

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'adw-avatar-icon adw-icon';
        this._iconEl.setAttribute('aria-hidden', 'true');

        this.replaceChildren(this._textEl, this._iconEl);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const size = parseFloat(this.getAttribute('size') || '48');
        this.style.width = `${size}px`;
        this.style.height = `${size}px`;
        this.style.fontSize = `${Math.round(size * (size < 32 ? 0.5 : 0.4))}px`;

        const text = this.getAttribute('text') ?? '';
        const initials = avatarInitials(text);
        const showInitials = this.hasAttribute('show-initials') && initials.length > 0;

        if (showInitials) {
            const { fg, start, stop } = avatarColor(text);
            this.style.backgroundImage = `linear-gradient(${start}, ${stop})`;
            this.style.color = fg;
            this._textEl.textContent = initials;
            this._textEl.hidden = false;
            this._iconEl.hidden = true;
        } else {
            this.style.backgroundImage = '';
            this.style.color = '';
            this._textEl.hidden = true;
            const icon = (this.getAttribute('icon') ?? 'avatar-default').replace(/-symbolic$/, '');
            this._iconEl.className = `adw-avatar-icon adw-icon adw-icon--${icon}`;
            this._iconEl.style.width = `${Math.round(size * 0.55)}px`;
            this._iconEl.style.height = `${Math.round(size * 0.55)}px`;
            this._iconEl.hidden = false;
        }
    }
}

customElements.define('adw-avatar', AdwAvatar);
