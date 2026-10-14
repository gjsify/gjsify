// The one name → glyph lookup every icon in this package goes through, symbolic AND colour.
//
// GTK draws two kinds of icon from the same `icon-name`: a symbolic one, recoloured with the
// foreground colour, and a full-colour one (an application icon, a document thumbnail) that
// is drawn as it is. Which one a name reaches is not the widget's choice. `GtkImage` builds a
// `GThemedIcon` for the name (gtkimage.c → `gtk_icon_theme_lookup_by_gicon`) without
// `use-default-fallbacks`, and `g_themed_icon_update_names` (GLib gio/gthemedicon.c, not in refs/)
// turns it into an ordered candidate list:
//
//   `X`           → [X, X-symbolic]
//   `X-symbolic`  → [X-symbolic, X]
//
// and `gtk_icon_theme_lookup_icon` returns the first candidate the theme has, else
// `image-missing` — it never returns NULL (refs/gtk/gtk/gtkicontheme.c, `choose_icon`).
//
// This package compiles and registers symbolic glyphs only (`icon-registry.ts`, the
// stylesheet's `.adw-icon--<name>` masks). The colour half lives here: a map from an EXACT
// name to an image URL, filled by {@link registerColorIcon}. With the map empty every lookup
// ends where it ended before this module existed, so nothing that only uses symbolic icons
// changes.
//
// The colour map is keyed by the raw name, not by `normalizeIconName`: an application icon
// is named after its application ID (`org.gnome.Builder`, adw-about-dialog.c:1215), which is
// not a CSS token and never could be a mask class, but is a perfectly good Map key.
//
// Original implementation.

import { normalizeIconName } from '@gjsify/adwaita-core';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

/** What one icon name resolves to, in the order GTK's theme would try it. */
export type IconLookup =
    /** A registered full-colour image, drawn as-is. `url` is ready for `url("…")`. */
    | { kind: 'color'; name: string; url: string }
    /** A symbolic glyph, drawn through the `.adw-icon--<name>` mask. `name` is normalized. */
    | { kind: 'symbolic'; name: string }
    /** Nothing in the theme answers this name — draw `image-missing`. */
    | { kind: 'missing' };

/** The suffix `g_themed_icon_update_names` swaps to build the other variant. */
const SYMBOLIC_SUFFIX = /-symbolic$/;

/**
 * Every name GTK's theme treats as a symbolic FILE (gtkicontheme.c `icon_name_is_symbolic`):
 * the directional variants are symbolic too, so none of them is a colour icon.
 */
const SYMBOLIC_FILE_NAME = /-symbolic(?:-ltr|-rtl)?$/;

/** Schemes a colour icon may be fetched from. Anything else can run script or is unknown. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'file:']);

const colorIcons = new Map<string, string>();

/**
 * Elements that drew a lookup result and have to redraw when the theme changes. A symbolic
 * registration is live through CSS and needs no redraw, but a colour one is an inline
 * `background-image`, and GTK's own images re-run their lookup on the theme's `changed`
 * signal for the same reason.
 */
const listeners = new Set<() => void>();

/** Subscribe to theme changes. Returns the unsubscribe function. */
export function onIconThemeChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Run every subscriber — after any registration that can change a lookup's answer. */
export function notifyIconThemeChanged(): void {
    for (const listener of listeners) listener();
}

/** Whether a symbolic glyph for an already-normalized name is in the cascade. */
function hasSymbolic(normalized: string): boolean {
    if (normalized === '') return false;
    return getComputedStyle(document.documentElement).getPropertyValue(`--icon-${normalized}`).trim() !== '';
}

/**
 * Resolve `iconName` as `gtk_icon_theme_lookup_by_gicon` would for a `GtkImage`. `null` when
 * no name was given — the state where GTK draws nothing, not `image-missing`.
 *
 * When no colour icon is registered for the name, a symbolic request is returned WITHOUT
 * checking the cascade: the mask class falls back to `image-missing` through CSS by itself
 * and corrects itself when a later `registerIcon` lands, which is how `<gtk-image>` behaved
 * before this module. The cascade is read only to choose between a colour entry and a
 * symbolic glyph.
 */
export function lookupIcon(iconName: string | null | undefined): IconLookup | null {
    if (iconName === null || iconName === undefined || iconName === '') return null;
    const symbolicRequest = SYMBOLIC_SUFFIX.test(iconName);
    const colorName = symbolicRequest ? iconName.replace(SYMBOLIC_SUFFIX, '') : iconName;
    const color = colorIcons.get(colorName);
    const symbolic = normalizeIconName(iconName);

    if (color === undefined) {
        return symbolic === '' ? { kind: 'missing' } : { kind: 'symbolic', name: symbolic };
    }
    if (symbolicRequest && hasSymbolic(symbolic)) return { kind: 'symbolic', name: symbolic };
    return { kind: 'color', name: colorName, url: color };
}

/**
 * Whether `iconName` resolves to something other than `image-missing` — a registered colour
 * icon, or a symbolic glyph compiled into the stylesheet or registered at runtime.
 */
export function iconResolves(iconName: string): boolean {
    const found = lookupIcon(iconName);
    if (found === null || found.kind === 'missing') return false;
    return found.kind === 'color' || hasSymbolic(found.name);
}

/** `source` as a URL `background-image` can load, or a thrown reason why not. */
function colorIconUrl(name: string, source: string): string {
    if (source.trimStart().startsWith('<')) {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
        if (root.tagName !== 'svg') {
            throw new TypeError(
                `registerColorIcon(${JSON.stringify(name)}): the source starts with '<' but parsed ` +
                    `to <${root.tagName}>, not an <svg> root.`,
            );
        }
        return toDataUri(source);
    }

    let url: URL;
    try {
        url = new URL(source, document.baseURI);
    } catch {
        throw new TypeError(`registerColorIcon(${JSON.stringify(name)}): the source is neither SVG source nor a URL.`);
    }
    const isImageData = url.protocol === 'data:' && /^data:image\//i.test(url.href);
    if (!isImageData && !ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new TypeError(
            `registerColorIcon(${JSON.stringify(name)}): ${JSON.stringify(url.protocol)} URLs are not ` +
                'accepted — use http(s):, blob:, file: or a data:image/ URI.',
        );
    }
    return url.href;
}

/**
 * Register a FULL-COLOUR icon under `name` — what an application ships in
 * `hicolor/scalable/apps/<app-id>.svg` and GTK finds through its icon theme. Every
 * `<gtk-image>` asking for the name draws the image unrecoloured, the way `AdwAboutDialog`'s
 * `application-icon` does on GNOME.
 *
 * `name` is the EXACT icon name, reverse-DNS application IDs included. A name with a
 * `-symbolic` suffix THROWS: that is the other half of the theme, and {@link registerIcon}
 * is its door. `source` is SVG source, or a URL (resolved against the document) to any
 * image the browser can draw.
 *
 * Re-registering a name replaces the image, and every mounted `<gtk-image>` redraws.
 *
 * CLIENT-SIDE ONLY, like `registerIcon`: it reads `document`.
 */
export function registerColorIcon(name: string, source: string): void {
    if (typeof name !== 'string' || name === '' || /\s/.test(name)) {
        throw new TypeError(
            `registerColorIcon: ${JSON.stringify(name)} is not an icon name — it must be non-empty ` +
                'and contain no whitespace.',
        );
    }
    if (SYMBOLIC_FILE_NAME.test(name)) {
        throw new TypeError(
            `registerColorIcon: ${JSON.stringify(name)} names a SYMBOLIC icon, which is recoloured ` +
                'rather than drawn as-is — register it with registerIcon() instead.',
        );
    }
    if (typeof source !== 'string' || source.trim() === '') {
        throw new TypeError(`registerColorIcon(${JSON.stringify(name)}): the source is empty.`);
    }

    colorIcons.set(name, colorIconUrl(name, source));
    notifyIconThemeChanged();
}
