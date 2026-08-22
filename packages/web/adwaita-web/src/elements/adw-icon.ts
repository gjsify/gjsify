// <adw-icon> — the symbolic icon node as an element. Every icon in this package is a
// CSS-masked box whose glyph comes from a generated `.adw-icon--<name>` class and
// whose colour is `currentColor`, so it themes with whatever contains it. The name
// derivation and its guard live once in `@gjsify/adwaita-core`'s
// {@link normalizeIconName}, the markup once here.
//
// Attributes:
//   icon-name — symbolic name, with or without the `-symbolic` suffix. A name that is
//               not a single CSS token (a space, a quote, a reverse-DNS application
//               id) never reaches a class — it draws {@link MISSING_ICON_NAME}, which
//               is what GTK draws for it, rather than injecting markup.
//   size      — rendered edge length in px. Absent leaves the stylesheet's 16px in
//               charge; a context that sizes its own icons through CSS
//               (`.adw-about-dialog-icon`, the split button's 14px arrows) keeps doing
//               exactly that and should NOT set this.
//
// THE ELEMENT *IS* THE ICON BOX — it carries `.adw-icon` itself rather than wrapping a
// span, because a wrapper would insert a layout node into flex rows, button interiors
// and absolutely-positioned arrows that are all measured against the icon box, and
// would stop every class-scoped rule (`.adw-drop-down-arrow`, `.adw-tab-icon`, …)
// matching the node it matches today.
//
// Reference: refs/libadwaita/src/stylesheet/_common.scss — `.normal-icons` /
//   `.large-icons` set `-gtk-icon-size`; libadwaita has NO `_icon.scss`, the icon is a
//   GtkImage and its size is a GTK property, not a stylesheet rule.
// Reference: refs/adwaita-web/adwaita-web/scss/_icon.scss — the vendored web
//   port's `.adw-icon` (an inline-flex SVG holder; this package masks instead).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
//   name derivation composed from @gjsify/adwaita-core.

import { normalizeIconName, stringIsNotEmpty } from '@gjsify/adwaita-core';

/**
 * The generated mask-class prefix — the one place the `--` spelling appears. `icon-registry`
 * builds the same class for a runtime registration and imports it from here rather than
 * spelling it twice.
 */
export const MASK_CLASS_PREFIX = 'adw-icon--';

/**
 * The glyph an icon falls back to — the same name `_icon.scss` masks with, the same one
 * libadwaita's C substitutes for a NULL icon-name, and the same one GTK's icon theme
 * returns for a name it cannot find.
 */
export const MISSING_ICON_NAME = 'image-missing';

export class AdwIcon extends HTMLElement {
    static get observedAttributes() {
        return ['icon-name', 'size'];
    }

    /** The declared symbolic name, `-symbolic` suffix optional. */
    get iconName(): string {
        return this.getAttribute('icon-name') ?? '';
    }

    set iconName(value: string | null) {
        if (value === null) this.removeAttribute('icon-name');
        else this.setAttribute('icon-name', value);
    }

    /**
     * The name that actually reached the mask class — `''` when the icon-name is
     * absent, empty, or not usable as one CSS token. Consumers that need to know
     * whether the DECLARED name is drawable ask this, not the raw attribute.
     *
     * `''` does NOT mean the box draws nothing: an unusable name that was given still
     * draws {@link MISSING_ICON_NAME}. Whether an icon was ASKED FOR is the raw
     * attribute's emptiness, which is the predicate a host's visibility follows.
     */
    get resolvedIconName(): string {
        return normalizeIconName(this.getAttribute('icon-name'));
    }

    /** The rendered edge length in px, or `null` when the stylesheet decides. */
    get size(): number | null {
        const declared = Number.parseFloat(this.getAttribute('size') ?? '');
        return Number.isFinite(declared) && declared > 0 ? declared : null;
    }

    set size(value: number | null) {
        if (value === null) this.removeAttribute('size');
        else this.setAttribute('size', String(value));
    }

    connectedCallback() {
        this._render();
    }

    attributeChangedCallback() {
        this._render();
    }

    private _render(): void {
        this.classList.add('adw-icon');

        // Swap ONLY the mask class: callers put their own positioning class on the same
        // node, and a `className =` assignment would take those with it. The list is
        // collected BEFORE removing — `classList` is live, so removing while iterating it
        // would skip the entry after each hit.
        const stale = [...this.classList].filter((existing) => existing.startsWith(MASK_CLASS_PREFIX));
        this.classList.remove(...stale);
        const name = this.resolvedIconName;
        if (name !== '') {
            this.classList.add(`${MASK_CLASS_PREFIX}${name}`);
        } else if (stringIsNotEmpty(this.getAttribute('icon-name'))) {
            // A name was GIVEN and cannot be one CSS token (a space, a quote, a reverse-DNS
            // application id). GTK has no such state: `gtk_icon_theme_lookup_icon` never
            // returns NULL, it returns the always-available `image-missing`
            // (refs/gtk/gtk/gtkicontheme.c:2269 · gtk_icon_paintable_get_icon_name's docs).
            // So the same glyph is drawn here rather than an invisible 16px hole — that hole
            // is what `<adw-button-row start-icon-name="a b">` reserved and showed.
            this.classList.add(`${MASK_CLASS_PREFIX}${MISSING_ICON_NAME}`);
        }

        // A masked box has no text, so assistive tech has nothing to announce — the
        // accessible name belongs to the control that HOSTS the icon.
        this.setAttribute('aria-hidden', 'true');

        const size = this.size;
        if (size === null) {
            this.style.removeProperty('width');
            this.style.removeProperty('height');
            this.style.removeProperty('mask-size');
            this.style.removeProperty('-webkit-mask-size');
        } else {
            const px = `${size}px`;
            this.style.width = px;
            this.style.height = px;
            // The box and the mask scale together: sizing only the box leaves a 16px glyph
            // floating in the middle of it.
            this.style.setProperty('mask-size', px);
            this.style.setProperty('-webkit-mask-size', px);
        }
    }
}

/**
 * Build one icon node. `extraClasses` are the caller's own positioning/context
 * classes, added alongside the managed `.adw-icon` + mask class, not replacing them.
 */
export function createAdwIcon(iconName: string | null, ...extraClasses: string[]): AdwIcon {
    const icon = document.createElement('adw-icon') as AdwIcon;
    if (iconName !== null) icon.setAttribute('icon-name', iconName);
    if (extraClasses.length > 0) icon.classList.add(...extraClasses);
    return icon;
}

customElements.define('adw-icon', AdwIcon);
