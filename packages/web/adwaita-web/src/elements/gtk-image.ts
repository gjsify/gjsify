// <gtk-image> — the icon node as an element. A symbolic icon is a CSS-masked box whose
// glyph comes from a generated `.adw-icon--<name>` class and whose colour is
// `currentColor`, so it themes with whatever contains it. A full-colour icon registered
// through `registerColorIcon` is the same box with the image as its background and no
// mask. Which of the two a name reaches is decided once, in `../icon-theme.ts`, in the
// order GTK's own theme tries them; the symbolic name derivation and its guard live once
// in `@gjsify/adwaita-core`'s {@link normalizeIconName}, the markup once here.
//
// Attributes:
//   icon-name — icon name, `-symbolic` suffix optional. A name that is neither a
//               registered colour icon nor a single CSS token (a space, a quote, an
//               unregistered reverse-DNS application id) never reaches a class — it
//               draws {@link MISSING_ICON_NAME}, which is what GTK draws for it, rather
//               than injecting markup.
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

import { normalizeIconName } from '@gjsify/adwaita-core';

import { lookupIcon, onIconThemeChanged, type IconRequest } from '../icon-theme.js';
import { WidgetElement } from '../widget-element.js';

/** `url` as one CSS string token, whatever quotes or backslashes it holds. */
function cssUrl(url: string): string {
    return `url("${url.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`;
}

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

/**
 * The modifier a colour icon carries. Deliberately NOT under {@link MASK_CLASS_PREFIX}: the
 * stale-class sweep below and `.adw-icon:not([class*='adw-icon--'])` both read that prefix
 * as "a mask is applied", and a colour icon has none.
 */
export const COLOR_ICON_CLASS = 'adw-icon-color';

export class GtkImage extends WidgetElement {
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
     * The name the SYMBOLIC lookup works with — `''` when the icon-name is absent, empty,
     * or not usable as one CSS token. A registered colour icon can still draw for a name
     * that answers `''` here (`org.gnome.Builder`); whether a name draws anything but
     * `image-missing` is `isIconAvailable`'s question.
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

    private _unsubscribe: (() => void) | null = null;

    connectedCallback() {
        this._unsubscribe ??= onIconThemeChanged(() => this._render());
        this._render();
    }

    disconnectedCallback() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    attributeChangedCallback() {
        this._render();
    }

    /**
     * What `GtkImage` hands `gtk_icon_theme_lookup_by_gicon` besides the name: the size (the
     * attribute, else the box the stylesheet gave it), the integer scale and the direction.
     * `size` is a getter: measuring flushes style, which would start the CSS transitions of
     * every control around an icon, so only a lookup a resource answers pays for it.
     */
    private _request(): IconRequest {
        const measure = (): number => {
            if (this.size !== null) return this.size;
            const measured = this.isConnected ? Number.parseFloat(getComputedStyle(this).width) : Number.NaN;
            return Number.isFinite(measured) && measured > 0 ? Math.round(measured) : 16;
        };
        return {
            get size() {
                return measure();
            },
            scale: Math.max(1, Math.round(globalThis.devicePixelRatio ?? 1)),
            direction: this.matches(':dir(rtl)') ? 'rtl' : 'ltr',
        };
    }

    private _render(): void {
        this.classList.add('adw-icon');

        // Swap ONLY the mask class: callers put their own positioning class on the same
        // node, and a `className =` assignment would take those with it. The list is
        // collected BEFORE removing — `classList` is live, so removing while iterating it
        // would skip the entry after each hit.
        const stale = [...this.classList].filter((existing) => existing.startsWith(MASK_CLASS_PREFIX));
        this.classList.remove(...stale);
        const looked = lookupIcon(this.getAttribute('icon-name'), this._request());
        // A resource file the browser cannot draw (XPM, compressed) is GTK's `image-missing`.
        const found = looked?.kind === 'resource' && looked.url === null ? ({ kind: 'missing' } as const) : looked;
        const asIs = found?.kind === 'color' || (found?.kind === 'resource' && !found.symbolic) ? found.url : null;
        const mask = found?.kind === 'resource' && found.symbolic ? found.url : null;
        this.classList.toggle(COLOR_ICON_CLASS, asIs !== null);
        if (asIs !== null) {
            // Drawn as-is: `_icon.scss` drops the mask and the `currentColor` fill for this
            // modifier, so only the image paints. `url` is a data-URI, a blob or a resolved href;
            // the quote and backslash escapes keep it one CSS string either way.
            this.style.backgroundImage = cssUrl(asIs);
        } else {
            this.style.removeProperty('background-image');
        }
        if (mask !== null) {
            // A symbolic file from a resource path: the mask is the file, the fill `currentColor`
            // (inline, because the classless-box rule in `_icon.scss` makes it transparent).
            this.style.setProperty('mask-image', cssUrl(mask));
            this.style.setProperty('-webkit-mask-image', cssUrl(mask));
            this.style.backgroundColor = 'currentColor';
        } else {
            this.style.removeProperty('mask-image');
            this.style.removeProperty('-webkit-mask-image');
            this.style.removeProperty('background-color');
        }
        if (found?.kind === 'symbolic') {
            this.classList.add(`${MASK_CLASS_PREFIX}${found.name}`);
        } else if (found?.kind === 'missing') {
            // A name was GIVEN and nothing answers it — not a colour icon, and not one CSS
            // token (a space, a quote, an unregistered reverse-DNS application id). GTK has
            // no such state: `gtk_icon_theme_lookup_icon` never returns NULL, it returns the
            // always-available `image-missing` (refs/gtk/gtk/gtkicontheme.c —
            // `gtk_icon_paintable_get_icon_name`'s own docs say so). So the same glyph is
            // drawn here rather than an invisible 16px hole, which is what
            // `<adw-button-row start-icon-name="a b">` reserved and showed.
            this.classList.add(`${MASK_CLASS_PREFIX}${MISSING_ICON_NAME}`);
        }

        // An icon box has no text, so assistive tech has nothing to announce — the
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
export function createGtkImage(iconName: string | null, ...extraClasses: string[]): GtkImage {
    const icon = document.createElement('gtk-image') as GtkImage;
    if (iconName !== null) icon.setAttribute('icon-name', iconName);
    if (extraClasses.length > 0) icon.classList.add(...extraClasses);
    return icon;
}

customElements.define('gtk-image', GtkImage);
