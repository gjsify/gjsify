// <gtk-button> — Adwaita button.
// Attributes: icon (symbolic name, e.g. "go-previous" / "view-refresh"), or
//   icon-name, the GObject spelling a projected `.blp` writes; label, tooltip,
//   disabled, and the boolean variant flags flat / suggested / destructive /
//   circular / pill. The GTK style classes on the host (`class="pill"`, which is
//   what a `.blp`'s `styles ["pill"]` becomes) select the same classes.
// Renders an inner <button class="adw-button …">; `click` bubbles to the host,
// so `adwButton.addEventListener('click', …)` works.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon node is <gtk-image>.

import { buttonStyleClasses } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';

/** The boolean attributes that select a style class; the mapping lives in the core. */
const STYLE_ATTRIBUTES = ['flat', 'suggested', 'destructive', 'circular', 'pill'] as const;

export class GtkButton extends HTMLElement {
    private _button!: HTMLButtonElement;
    private _label = '';
    private _initialized = false;

    static get observedAttributes() {
        return [
            'icon',
            'icon-name',
            'label',
            'tooltip',
            'disabled',
            'flat',
            'suggested',
            'destructive',
            'circular',
            'pill',
            'class',
        ];
    }

    /** The inner native button (for focus/imperative access). */
    get button(): HTMLButtonElement {
        return this._button;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        // Capture any inline text as the label before we take over the subtree.
        this._label = (this.getAttribute('label') ?? this.textContent ?? '').trim();
        this._button = document.createElement('button');
        this.replaceChildren(this._button);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const btn = this._button;
        btn.className = 'adw-button';
        // The attribute → class mapping is `@gjsify/adwaita-core`'s, so this element
        // and the NativeScript one cannot disagree about which classes exist —
        // `circular` was in this table and missing from that one.
        // The host's own classes go through the same table: a built `.blp` spells the
        // style as GTK does, a class on the widget, and reading only the attributes
        // rendered its pill and flat buttons as plain ones.
        const styles = [...STYLE_ATTRIBUTES.filter((attr) => this.hasAttribute(attr)), ...this.classList];
        btn.classList.add(...buttonStyleClasses(styles));

        const icon = this.getAttribute('icon') ?? this.getAttribute('icon-name');
        const label = (this.getAttribute('label') ?? this._label).trim();
        if (icon && !label) btn.classList.add('icon-only');

        btn.replaceChildren();
        if (icon) btn.appendChild(createGtkImage(icon));
        if (label) btn.appendChild(document.createTextNode(label));

        const tooltip = this.getAttribute('tooltip');
        btn.title = tooltip ?? '';
        // An icon-only button has no text content, so screen readers would
        // announce it as unlabeled. Give it an accessible name — prefer the
        // tooltip, fall back to the symbolic icon name (WCAG 4.1.2).
        if (icon && !label) {
            btn.setAttribute('aria-label', tooltip ?? icon);
        } else {
            btn.removeAttribute('aria-label');
        }
        btn.disabled = this.hasAttribute('disabled');
    }
}

customElements.define('gtk-button', GtkButton);
