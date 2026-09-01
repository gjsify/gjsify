// <adw-button-content> — a box-like child pairing a symbolic icon with a label,
// intended as the child of a button (or Gtk.Button / MenuButton / SplitButton in
// libadwaita) when it needs both an icon and a label.
// Attributes: icon-name (symbolic name, e.g. "folder-download"; EMPTY shows the
//   `image-missing` fallback, it does not hide the icon), label (empty hides the
//   label), use-underline (boolean — `_` marks a mnemonic), can-shrink (boolean —
//   label ellipsizes when set).
// Events: `notify::icon-name`, `notify::label`, `notify::use-underline`,
//   `notify::can-shrink` (CustomEvent, bubbles) mirroring the AdwButtonContent
//   GObject notify signals the native story observes.
//
// The derivations come from `@gjsify/adwaita-core` (ADR 0004). THE STYLE CLASS IS THE
// POINT: `AdwButtonContent` puts `image-text-button` on the button hosting it and removes
// it on unroot, and the stylesheet gives that class `padding-left/right: 9px` where a
// plain text button has 17px. Without the class, an icon+label button is drawn with a
// plain button's padding.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
//            (image-text-button · the splitbutton override · buttoncontent)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon node is <gtk-image>.

import { BUTTON_CONTENT_STYLE_CLASS, buttonContentIconName, buttonContentLabelText } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';

/**
 * What `gtk_widget_get_ancestor (…, GTK_TYPE_BUTTON)` looks like in the DOM: a native
 * `<button>`, or anything wearing the Adwaita button class — `<gtk-button>` renders an
 * inner button with it, and the stories put it on plain ones.
 */
const BUTTON_SELECTOR = 'button, .adw-button';

/** The split-button node the class is RETARGETED to. */
const SPLIT_BUTTON_SELECTOR = 'adw-split-button, .adw-split-button';

export class AdwButtonContent extends HTMLElement {
    private _boxEl!: HTMLDivElement;
    private _iconEl!: GtkImage;
    private _labelEl!: HTMLSpanElement;
    private _initialized = false;
    /** The node currently carrying `image-text-button`, so unroot can find it. */
    private _styledHost: HTMLElement | null = null;

    static get observedAttributes() {
        return ['icon-name', 'label', 'use-underline', 'can-shrink'];
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;

            // CSS node mirrors libadwaita's `buttoncontent > box > {image, label}`.
            this._boxEl = document.createElement('div');
            this._boxEl.className = 'adw-button-content-box';

            // The image node is GTK_ACCESSIBLE_ROLE_PRESENTATION in libadwaita: decorative,
            // with the label carrying the accessible name — what `<gtk-image>`'s own
            // `aria-hidden` already says.
            this._iconEl = createGtkImage(null);

            this._labelEl = document.createElement('span');
            this._labelEl.className = 'adw-button-content-label';

            this._boxEl.append(this._iconEl, this._labelEl);
            this.replaceChildren(this._boxEl);
            this._render();
        }
        // `adw_button_content_root` runs on every rooting, not just the first, so a
        // re-parented content re-stamps its new host.
        this._root();
    }

    disconnectedCallback() {
        this._unroot();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        // Mirrors the AdwButtonContent notify::<prop> signals the native story listens to.
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true }));
    }

    /**
     * `adw_button_content_root`: the nearest button ancestor, unless that button's DIRECT
     * parent is a split button — then the split button takes the class, because
     * `splitbutton.image-text-button > button` is the rule that styles it.
     */
    private _hostButton(): HTMLElement | null {
        const button = this.parentElement?.closest<HTMLElement>(BUTTON_SELECTOR) ?? null;
        if (!button) return null;
        const parent = button.parentElement;
        return parent?.matches(SPLIT_BUTTON_SELECTOR) ? parent : button;
    }

    private _root(): void {
        const host = this._hostButton();
        if (host === this._styledHost) return;
        this._unroot();
        // A content with no button ancestor styles nothing: the C would pass NULL to
        // `gtk_widget_get_parent`/`add_css_class`, i.e. two CRITICALs, so there is nothing
        // to reproduce.
        if (!host) return;
        host.classList.add(BUTTON_CONTENT_STYLE_CLASS);
        this._styledHost = host;
    }

    private _unroot(): void {
        // `adw_button_content_unroot`: a button that loses its content goes back to
        // plain-button padding.
        this._styledHost?.classList.remove(BUTTON_CONTENT_STYLE_CLASS);
        this._styledHost = null;
    }

    private _render() {
        // An empty `icon-name` resolves to `image-missing` and the image node stays
        // VISIBLE. libadwaita's own docs say the icon is not shown, but its code never
        // hides it; this follows the code — see `BUTTON_CONTENT_ICON_VECTORS`.
        this._iconEl.iconName = buttonContentIconName(this.getAttribute('icon-name') ?? '');
        this._iconEl.hidden = false;

        const label = this.getAttribute('label') ?? '';
        this._labelEl.textContent = buttonContentLabelText(label, this.hasAttribute('use-underline'));
        // `gtk_widget_set_visible (self->label, label[0])`: the RAW label decides, not the
        // mnemonic-resolved text.
        this._labelEl.hidden = label.length === 0;

        // can-shrink → ellipsize the label (Gtk.Label PANGO_ELLIPSIZE_END).
        this.classList.toggle('can-shrink', this.hasAttribute('can-shrink'));
    }
}

customElements.define('adw-button-content', AdwButtonContent);
