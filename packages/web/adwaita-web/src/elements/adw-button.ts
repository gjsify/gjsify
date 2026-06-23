// <adw-button> — Adwaita button.
// Attributes: icon (symbolic name, e.g. "go-previous" / "view-refresh"),
//   label, tooltip, disabled, and the boolean variant flags
//   flat / suggested / destructive / circular / pill.
// Renders an inner <button class="adw-button …">; `click` bubbles to the host,
// so `adwButton.addEventListener('click', …)` works.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

const VARIANT_CLASSES: Record<string, string> = {
    flat: 'flat',
    suggested: 'suggested-action',
    destructive: 'destructive-action',
    circular: 'circular',
    pill: 'pill',
};

export class AdwButton extends HTMLElement {
    private _button!: HTMLButtonElement;
    private _label = '';
    private _initialized = false;

    static get observedAttributes() {
        return ['icon', 'label', 'tooltip', 'disabled', 'flat', 'suggested', 'destructive', 'circular', 'pill'];
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
        for (const [attr, cls] of Object.entries(VARIANT_CLASSES)) {
            if (this.hasAttribute(attr)) btn.classList.add(cls);
        }

        const icon = this.getAttribute('icon');
        const label = (this.getAttribute('label') ?? this._label).trim();
        if (icon && !label) btn.classList.add('icon-only');

        btn.replaceChildren();
        if (icon) {
            const span = document.createElement('span');
            span.className = `adw-icon adw-icon--${icon}`;
            btn.appendChild(span);
        }
        if (label) btn.appendChild(document.createTextNode(label));

        btn.title = this.getAttribute('tooltip') ?? '';
        btn.disabled = this.hasAttribute('disabled');
    }
}

customElements.define('adw-button', AdwButton);
