// <adw-button-content> — a box-like child pairing a symbolic icon with a label,
// intended as the child of an <adw-button> (or Gtk.Button / MenuButton /
// SplitButton in libadwaita) when it needs both an icon and a label. With
// `can-shrink` the label ellipsizes instead of forcing the button wider.
// Attributes: icon-name (symbolic name, e.g. "folder-download"; empty hides the
//   icon), label (empty hides the label), can-shrink (boolean — label
//   ellipsizes when set).
// Events: `notify::icon-name`, `notify::label`, `notify::can-shrink`
//   (CustomEvent, bubbles) mirroring the AdwButtonContent GObject notify signals
//   the native story observes.
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (buttoncontent)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwButtonContent extends HTMLElement {
    private _boxEl!: HTMLDivElement;
    private _iconEl!: HTMLSpanElement;
    private _labelEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['icon-name', 'label', 'can-shrink'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // CSS node mirrors libadwaita's `buttoncontent > box > {image, label}`.
        this._boxEl = document.createElement('div');
        this._boxEl.className = 'adw-button-content-box';

        this._iconEl = document.createElement('span');
        // The image node is GTK_ACCESSIBLE_ROLE_PRESENTATION in libadwaita —
        // it is decorative, the label carries the accessible name.
        this._iconEl.setAttribute('aria-hidden', 'true');

        this._labelEl = document.createElement('span');
        this._labelEl.className = 'adw-button-content-label';

        this._boxEl.append(this._iconEl, this._labelEl);
        this.replaceChildren(this._boxEl);
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        // Mirror the AdwButtonContent notify::<prop> signals the native story
        // listens to (icon-name / label / can-shrink).
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true }));
    }

    private _render() {
        const icon = this.getAttribute('icon-name') ?? '';
        this._iconEl.className = icon ? `adw-icon adw-icon--${icon}` : '';
        this._iconEl.hidden = icon.length === 0;

        const label = this.getAttribute('label') ?? '';
        this._labelEl.textContent = label;
        this._labelEl.hidden = label.length === 0;

        // can-shrink → ellipsize the label (Gtk.Label PANGO_ELLIPSIZE_END).
        this.classList.toggle('can-shrink', this.hasAttribute('can-shrink'));
    }
}

customElements.define('adw-button-content', AdwButtonContent);
