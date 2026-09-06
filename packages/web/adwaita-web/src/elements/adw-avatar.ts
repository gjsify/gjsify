// <adw-avatar> — A round avatar showing a custom image, initials derived from a
// name (with a colour picked from the name), or a symbolic fallback icon.
// Attributes: text, size (px, default 48), show-initials (boolean),
//   icon (symbolic fallback name, with or without -symbolic),
//   custom-image (an image URL — `Adw.Avatar:custom-image` is a GdkPaintable,
//   and a URL is what a browser draws one from).
// Reference: refs/adwaita-web/adwaita-web/scss/_avatar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// fallback icon node is <gtk-image>.
//
// The two derivations — initials from the name, and the palette colour the name hashes to
// — are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004) as {@link avatarInitials} /
// {@link avatarColor}; this element only paints them. The shared vectors in
// `@gjsify/adwaita-core/conformance` pin it to the C source — see `src/adw-avatar.spec.ts`.
//
// `custom-image` was UNPORTED until #1049's follow-up: this element passed
// `hasCustomImage: false` unconditionally, so the `image` branch of `update_visibility`
// (adw-avatar.c:117-125) — the branch that wins over both others — could not be reached,
// and the vector row covering it had nothing to drive.

import {
    avatarColor,
    avatarFontSize,
    avatarIconSize,
    avatarInitials,
    avatarMaxFontSize,
    avatarMode,
} from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';

export class AdwAvatar extends HTMLElement {
    private _textEl!: HTMLSpanElement;
    private _iconEl!: GtkImage;
    private _imageEl!: HTMLImageElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['text', 'size', 'show-initials', 'icon', 'custom-image'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._textEl = document.createElement('span');
        this._textEl.className = 'adw-avatar-text';

        this._iconEl = createGtkImage(null, 'adw-avatar-icon');

        this._imageEl = document.createElement('img');
        this._imageEl.className = 'adw-avatar-custom-image';
        // The image is the avatar's own presentation, not content of its own —
        // the accessible name comes from the surrounding row, as in GTK where
        // the custom image is a plain GtkImage inside the widget.
        this._imageEl.alt = '';

        this.replaceChildren(this._textEl, this._iconEl, this._imageEl);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const size = parseFloat(this.getAttribute('size') || '48');
        this.style.width = `${size}px`;
        this.style.height = `${size}px`;

        const text = this.getAttribute('text') ?? '';
        const customImage = this.getAttribute('custom-image') ?? '';
        // The gate is the TEXT, not the derived initials — `update_visibility`
        // keeps a whitespace-only name in initials mode with a blank label.
        const mode = avatarMode({
            hasCustomImage: customImage.length > 0,
            showInitials: this.hasAttribute('show-initials'),
            text,
        });

        this._imageEl.hidden = mode !== 'image';
        if (mode === 'image') {
            // Only touch `src` when it changed: re-assigning the same URL
            // restarts the load and flashes the avatar on every unrelated
            // attribute change.
            if (this._imageEl.getAttribute('src') !== customImage) this._imageEl.src = customImage;
            // No gradient behind an image: `set_class_color` still runs in the C,
            // but nothing of it is visible, and leaving it would show through a
            // transparent PNG.
            this.style.backgroundImage = '';
            this.style.color = '';
            this._textEl.hidden = true;
            this._iconEl.hidden = true;
        } else if (mode === 'initials') {
            const { fg, start, stop } = avatarColor(text);
            this.style.backgroundImage = `linear-gradient(${start}, ${stop})`;
            this.style.color = fg;
            this._textEl.textContent = avatarInitials(text);
            this._textEl.hidden = false;
            this._iconEl.hidden = true;
            this._applyFontSize(size);
        } else {
            this.style.backgroundImage = '';
            this.style.color = '';
            this._textEl.hidden = true;
            this._iconEl.iconName = this.getAttribute('icon') ?? 'avatar-default';
            // The glyph scales with the avatar: `size` sizes the BOX and the mask
            // together, which is what `.adw-avatar-icon`'s `mask-size: contain`
            // was there to approximate. The factor moved into the core when the
            // NativeScript avatar grew the same fallback — one number, two renderers.
            this._iconEl.size = avatarIconSize(size);
            this._iconEl.hidden = false;
        }
    }

    /**
     * Size the initials the way `update_font_size` does: measure the label, then
     * scale its aspect ratio against the cap.
     *
     * Only the ratio matters and it is font-size invariant, so measuring AT the
     * cap is the browser's equivalent of Pango's reset-then-measure. The old
     * `size * (size < 32 ? 0.5 : 0.4)` guess overflowed that cap at sizes 28, 30,
     * 31 and everything from 64 up — the initials spilled out of the circle —
     * and was not monotonic across the 32px boundary.
     */
    private _applyFontSize(size: number) {
        const cap = avatarMaxFontSize(size);
        this._textEl.style.fontSize = `${cap}px`;
        const { width, height } = this._textEl.getBoundingClientRect();
        this._textEl.style.fontSize = `${avatarFontSize(size, { width, height })}px`;
    }
}

customElements.define('adw-avatar', AdwAvatar);
