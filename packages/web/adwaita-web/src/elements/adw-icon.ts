// <adw-icon> — the symbolic icon node, as an element instead of a shape you
// retype. Every icon in this package is a CSS-masked box whose glyph comes from
// a generated `.adw-icon--<name>` class and whose colour is `currentColor`, so
// it themes with whatever contains it.
//
// WHY IT EXISTS: `<span class="adw-icon adw-icon--<name>" aria-hidden="true">`
// was built by hand at TWENTY-THREE sites across SEVENTEEN files, NINE of which
// re-derived the name (`name.replace(/-symbolic$/, '')`) on the spot — one of
// them unanchored. Exactly ONE site (`<adw-split-button>`) also checked the
// result was a single CSS token. The others did not, so `icon-name="a b"`
// interpolated into `class="adw-icon adw-icon--a b"` and shipped a stray `b`
// class; that was live on `<adw-menu-button>`, for its own icon and for every
// JSON menu entry's. The derivation now happens once, in
// `@gjsify/adwaita-core`'s {@link normalizeIconName} (guard included), and the
// markup happens once, here.
//
// Attributes:
//   icon-name — symbolic name, with or without the `-symbolic` suffix. A name
//               that is not a single CSS token (a space, a quote, a
//               reverse-DNS application id) resolves to NO icon rather than to
//               injected markup — see `normalizeIconName`.
//   size      — the rendered edge length in px. Absent leaves the stylesheet's
//               16px in charge; a context that sizes its own icons through CSS
//               (`.adw-about-dialog-icon`, the split button's 14px arrows) keeps
//               doing exactly that and should NOT set this.
// Properties:
//   iconName         — the declared name (get/set; reflects to the attribute).
//   resolvedIconName — what actually reached the mask class ('' = no icon).
//   size             — the px size, or null when the stylesheet decides (get/set).
//
// THE ELEMENT *IS* THE ICON BOX — it carries `.adw-icon` itself rather than
// wrapping a span. A wrapper would have inserted a layout node into flex rows,
// button interiors and absolutely-positioned arrows that were all measured
// against the icon box directly; carrying the class keeps every existing
// class-scoped rule (`.adw-drop-down-arrow`, `.adw-tab-icon`, `.adw-row-edit`, …)
// matching the same node it always matched.
//
// Reference: refs/libadwaita/src/stylesheet/_common.scss:34-41 — `.normal-icons`
//   / `.large-icons` set `-gtk-icon-size`; libadwaita has NO `_icon.scss`, the
//   icon is a GtkImage and its size is a GTK property, not a stylesheet rule.
// Reference: refs/adwaita-web/adwaita-web/scss/_icon.scss — the vendored web
//   port's `.adw-icon` (an inline-flex SVG holder; this package masks instead).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
//   name derivation composed from @gjsify/adwaita-core.

import { normalizeIconName } from '@gjsify/adwaita-core';

/** The generated mask-class prefix — the one place the `--` spelling appears. */
const MASK_CLASS_PREFIX = 'adw-icon--';

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
     * whether an icon is being drawn ask this, not the raw attribute.
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

    // ── internals ──────────────────────────────────────────────────────────

    private _render(): void {
        this.classList.add('adw-icon');

        // Swap ONLY the mask class: the callers put their own positioning class
        // on the same node (`adw-drop-down-arrow`, `adw-sidebar-item-arrow`, …),
        // and a `className =` assignment here would take those with it. The list
        // is collected BEFORE removing — `classList` is live, so removing while
        // iterating it would skip the entry after each hit.
        const stale = [...this.classList].filter((existing) => existing.startsWith(MASK_CLASS_PREFIX));
        this.classList.remove(...stale);
        const name = this.resolvedIconName;
        if (name !== '') this.classList.add(`${MASK_CLASS_PREFIX}${name}`);

        // A masked box has no text, so assistive tech has nothing to announce —
        // the accessible name belongs to the control that HOSTS the icon. Every
        // hand-rolled copy that thought about it said the same thing; the ones
        // that did not were the inconsistency, not the intent.
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
            // The box and the mask scale together — sizing only the box leaves a
            // 16px glyph floating in the middle of it.
            this.style.setProperty('mask-size', px);
            this.style.setProperty('-webkit-mask-size', px);
        }
    }
}

/**
 * Build one icon node: the three lines every caller would otherwise write.
 *
 * `extraClasses` are the caller's own positioning/context classes, added
 * alongside the managed `.adw-icon` + mask class rather than replacing them.
 */
export function createAdwIcon(iconName: string | null, ...extraClasses: string[]): AdwIcon {
    const icon = document.createElement('adw-icon') as AdwIcon;
    if (iconName !== null) icon.setAttribute('icon-name', iconName);
    if (extraClasses.length > 0) icon.classList.add(...extraClasses);
    return icon;
}

customElements.define('adw-icon', AdwIcon);
