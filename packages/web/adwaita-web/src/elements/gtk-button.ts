// <gtk-button> — Adwaita button.
// Attributes: icon (symbolic name, e.g. "go-previous" / "view-refresh"), or
//   icon-name, the GObject spelling a projected `.blp` writes; label, tooltip or
//   tooltip-text (the `.blp` spelling again),
//   disabled, and the boolean variant flags flat / suggested / destructive /
//   circular / pill. The GTK style classes on the host (`class="pill"`, which is
//   what a `.blp`'s `styles ["pill"]` becomes) select the same classes.
// Renders an inner <button class="adw-button …">; `click` bubbles to the host,
// so `adwButton.addEventListener('click', …)` works. An element child — what a
// `.blp`'s `child: Adw.ButtonContent { … }` becomes — is `Gtk.Button:child` and
// replaces the icon and the label inside that inner button.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon node is <gtk-image>.

import { buttonStyleClasses } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';
import type { DispatchedSignals } from '../signals.js';
import { createGtkImage } from './gtk-image.js';

/** The boolean attributes that select a style class; the mapping lives in the core. */
const STYLE_ATTRIBUTES = ['flat', 'suggested', 'destructive', 'circular', 'pill'] as const;

export class GtkButton extends HTMLElement {
    /** The GTK signals this element dispatches, each with the DOM event it arrives as (ADR 0093). */
    static readonly signals: DispatchedSignals = { clicked: 'click' };

    private _button!: HTMLButtonElement;
    private _label = '';
    private _initialized = false;
    /** `Gtk.Button:child`, or `null` while the icon and the label fill the button. */
    private _child: Element | null = null;

    static get observedAttributes() {
        return [
            'icon',
            'icon-name',
            'label',
            'tooltip',
            'tooltip-text',
            'disabled',
            'flat',
            'suggested',
            'destructive',
            'circular',
            'pill',
            'class',
        ];
    }

    /**
     * `Gtk.Button:icon-name` and `Gtk.Widget:tooltip-text`, the GObject spellings: a class that
     * holds a button as a template child writes `button.icon_name = …`, which must reach the DOM.
     */
    get icon_name(): string | null {
        return this.getAttribute('icon-name');
    }
    set icon_name(value: string | null) {
        this.reflect('icon-name', value);
    }
    get iconName(): string | null {
        return this.icon_name;
    }
    set iconName(value: string | null) {
        this.icon_name = value;
    }
    get tooltip_text(): string | null {
        return this.getAttribute('tooltip-text');
    }
    set tooltip_text(value: string | null) {
        this.reflect('tooltip-text', value);
    }
    get tooltipText(): string | null {
        return this.tooltip_text;
    }
    set tooltipText(value: string | null) {
        this.tooltip_text = value;
    }

    private reflect(attribute: string, value: string | null): void {
        if (value === null || value === undefined) this.removeAttribute(attribute);
        else this.setAttribute(attribute, value);
    }

    /** The inner native button (for focus/imperative access). */
    get button(): HTMLButtonElement {
        return this._button;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        // Capture any inline text as the label before we take over the subtree. Only the
        // host's own text: an element child is `child`, and its text is not a label.
        const inlineText = Array.from(this.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('');
        this._label = (this.getAttribute('label') ?? inlineText).trim();
        this._button = document.createElement('button');
        // An authored `child: …` names the `child` slot, and a bare element child means the
        // same thing, as GtkBuildable's untyped `<child>` does. Consumed rather than moved:
        // `_render` rebuilds the inner button's content, so it is `_render` that places it.
        // Stray text is claimed by nothing and leaves with the host's old children.
        bindSlottedChildren(this, [
            {
                name: 'child',
                claims: (node) => node instanceof Element,
                consume: (node) => {
                    this._child = node as Element;
                    this._render();
                },
            },
        ]).install(this._button);
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

        const child = this._child;
        const icon = child ? null : (this.getAttribute('icon') ?? this.getAttribute('icon-name'));
        const label = child ? '' : (this.getAttribute('label') ?? this._label).trim();
        if (icon && !label) btn.classList.add('icon-only');
        // GTK's `.text-button`: what `gtk_button_set_label` stamps on a label-only button.
        if (label && !icon) btn.classList.add('text-button');

        if (child) btn.replaceChildren(child);
        else btn.replaceChildren();
        if (icon) btn.appendChild(createGtkImage(icon));
        if (label) btn.appendChild(document.createTextNode(label));

        const tooltip = this.getAttribute('tooltip') ?? this.getAttribute('tooltip-text');
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
        this.decorate(btn);
    }

    /**
     * Last step of every render, after the class and the content are written. A subclass
     * adds its own state to the inner button here, because `_render` resets `className` and
     * anything set earlier would be gone with it.
     */
    protected decorate(_button: HTMLButtonElement): void {}
}

customElements.define('gtk-button', GtkButton);
