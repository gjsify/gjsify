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
// RESOURCE PATHS (ADR 0116 § 4). The names go through the `Gtk.IconTheme` resource paths an
// application added (`GtkApplication` adds `<resource-base-path>/icons/` at startup);
// `@gjsify/adwaita-core`'s `lookupResourceIcon` decides which file answers, as gtkicontheme.c
// does, and asks this module only whether the stylesheet holds a symbolic glyph. A colour
// registration stands in hicolor there, as the file an app ships in `hicolor/scalable/apps/`
// would: the stylesheet's `X-symbolic` answers `X` before it, as Adwaita's does on GNOME. A file
// answers as a blob URL of its bytes: a symbolic one is drawn as a mask in `currentColor`, the
// rest as-is. A browser draws SVG and PNG; an XPM or a compressed entry draws `image-missing`
// with a warning.
//
// Original implementation.

import {
    iconLookupNames,
    lookupResourceIcon,
    normalizeIconName,
    resources_lookup_data,
    type IconDirection,
} from '@gjsify/adwaita-core';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

import { IconTheme } from './namespace/gtk-platform.js';

/** What one icon name resolves to, in the order GTK's theme would try it. */
export type IconLookup =
    /** A registered full-colour image, drawn as-is. `url` is ready for `url("…")`. */
    | { kind: 'color'; name: string; url: string }
    /**
     * A file under a `Gtk.IconTheme` resource path; `symbolic` files are masks in `currentColor`.
     * `url` is `null` when the browser cannot draw the file (XPM, compressed): draw `image-missing`.
     */
    | { kind: 'resource'; name: string; path: string; url: string | null; symbolic: boolean }
    /** A symbolic glyph, drawn through the `.adw-icon--<name>` mask. `name` is normalized. */
    | { kind: 'symbolic'; name: string }
    /** Nothing in the theme answers this name — draw `image-missing`. */
    | { kind: 'missing' };

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
 * When neither a colour registration nor a resource holds a name, the request is returned as a
 * symbolic one WITHOUT checking the cascade: the mask class falls back to `image-missing`
 * through CSS by itself and corrects itself when a later `registerIcon` lands, which is how
 * `<gtk-image>` behaved before this module. The cascade is read only to choose between a
 * symbolic glyph and a colour entry or file.
 */
export function lookupIcon(iconName: string | null | undefined, request: IconRequest = {}): IconLookup | null {
    if (iconName === null || iconName === undefined || iconName === '') return null;
    const found = resourceIcon(iconName, request);
    if (found !== null) return found;
    const symbolic = normalizeIconName(iconName);
    return symbolic === '' ? { kind: 'missing' } : { kind: 'symbolic', name: symbolic };
}

/** What a `GtkImage` hands its theme besides the name: its size, scale and text direction. */
export interface IconRequest {
    /** In CSS pixels; 16 when absent. */
    readonly size?: number;
    /** The device scale; 1 when absent. */
    readonly scale?: number;
    readonly direction?: IconDirection;
}

const theme = IconTheme.get_for_display(null);

/** Blob URLs of resource files, by resource path, for the current scan. */
const resourceUrls = new Map<string, string | null>();

theme.connect('changed', () => {
    for (const url of resourceUrls.values()) if (url !== null) URL.revokeObjectURL(url);
    resourceUrls.clear();
    notifyIconThemeChanged();
});

const RESOURCE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/** The file at `path` as a URL a browser draws, or `null` (warned once) when it cannot. */
function resourceUrl(path: string): string | null {
    const cached = resourceUrls.get(path);
    if (cached !== undefined) return cached;
    let url: string | null = null;
    const type = RESOURCE_TYPES[path.slice(path.lastIndexOf('.'))];
    if (type === undefined) {
        console.warn(`Gtk.IconTheme: ${path} is not an SVG or a PNG, which is all a browser draws (ADR 0116 § 4).`);
    } else {
        try {
            const data = resources_lookup_data(path, 0).get_data();
            url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
        } catch (error) {
            console.warn(`Gtk.IconTheme: ${path} cannot be drawn: ${(error as Error).message}`);
        }
    }
    resourceUrls.set(path, url);
    return url;
}

/**
 * The lookup over the colour registrations and the theme's resource paths; `null` when neither
 * answers any name, a `symbolic` entry when the current theme's glyph comes first.
 */
export function resourceIcon(iconName: string, request: IconRequest): IconLookup | null {
    const match = lookupResourceIcon(theme, {
        names: iconLookupNames(iconName, request.direction ?? null),
        get size() {
            return request.size ?? 16;
        },
        scale: request.scale ?? 1,
        themeHas: (name) => hasSymbolic(normalizeIconName(name)),
        hicolorHas: (name) => colorIcons.has(name),
    });
    if (match === null) return null;
    if (match.kind === 'theme') return { kind: 'symbolic', name: normalizeIconName(match.name) };
    if (match.kind === 'hicolor') return { kind: 'color', name: match.name, url: colorIcons.get(match.name)! };
    return {
        kind: 'resource',
        name: match.name,
        path: match.path,
        url: resourceUrl(match.path),
        symbolic: match.symbolic,
    };
}

/**
 * Whether `iconName` resolves to something other than `image-missing` — a registered colour
 * icon, a file under a resource path, or a symbolic glyph compiled into the stylesheet or
 * registered at runtime.
 */
export function iconResolves(iconName: string): boolean {
    const found = lookupIcon(iconName);
    if (found === null || found.kind === 'missing') return false;
    if (found.kind === 'resource') return found.url !== null;
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
