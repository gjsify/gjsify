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
// The stylesheet compiles a SUBSET of Adwaita's symbolic glyphs (the `.adw-icon--<name>`
// masks); that subset is the port's current theme. Everything else — an application's own
// symbolic glyphs and its full-colour icons alike — comes from GResource files.
//
// RESOURCE PATHS (ADR 0116 § 4). The names go through the `Gtk.IconTheme` resource paths an
// application added (`GtkApplication` adds `<resource-base-path>/icons/` at startup);
// `@gjsify/adwaita-core`'s `lookupResourceIcon` decides which file answers, as gtkicontheme.c
// does, and asks this module only whether the stylesheet holds a symbolic glyph: the
// stylesheet's `X-symbolic` answers `X` before a resource's colour `X`, as Adwaita's does on
// GNOME. A file answers as a blob URL of its bytes: a symbolic one is drawn as a mask in
// `currentColor`, the rest as-is. A browser draws SVG and PNG; an XPM or a compressed entry
// draws `image-missing` with a warning.
//
// Original implementation.

import {
    iconLookupNames,
    lookupResourceIcon,
    normalizeIconName,
    resources_lookup_data,
    type IconDirection,
} from '@gjsify/adwaita-core';

import { IconTheme } from './namespace/gtk-platform.js';

/** What one icon name resolves to, in the order GTK's theme would try it. */
export type IconLookup =
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
 * Elements that drew a lookup result and have to redraw when the theme changes. A resource
 * file is an inline `background-image` or mask, and GTK's own images re-run their lookup on
 * the theme's `changed` signal for the same reason.
 */
const listeners = new Set<() => void>();

/** Subscribe to theme changes. Returns the unsubscribe function. */
export function onIconThemeChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
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
 * When no resource holds a name, the request is returned as a symbolic one WITHOUT checking
 * the cascade: the mask class falls back to `image-missing` through CSS by itself. The cascade
 * is read only to choose between a symbolic glyph and a resource file.
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
    for (const listener of listeners) listener();
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
 * The lookup over the theme's resource paths; `null` when no resource answers any name, a
 * `symbolic` entry when the current theme's glyph comes first.
 */
export function resourceIcon(iconName: string, request: IconRequest): IconLookup | null {
    const match = lookupResourceIcon(theme, {
        names: iconLookupNames(iconName, request.direction ?? null),
        get size() {
            return request.size ?? 16;
        },
        scale: request.scale ?? 1,
        themeHas: (name) => hasSymbolic(normalizeIconName(name)),
    });
    if (match === null) return null;
    if (match.kind === 'theme') return { kind: 'symbolic', name: normalizeIconName(match.name) };
    return {
        kind: 'resource',
        name: match.name,
        path: match.path,
        url: resourceUrl(match.path),
        symbolic: match.symbolic,
    };
}

/**
 * Whether `name` draws something other than `image-missing` — a file under a `Gtk.IconTheme`
 * resource path, or a symbolic glyph compiled into the stylesheet. The name is looked up
 * exactly as `<gtk-image icon-name>` looks it up.
 *
 * Reads the live cascade rather than a generated list, so it answers for a glyph that arrived
 * by any route, including a consumer's own `--icon-<name>` declaration. It is deliberately the
 * CUSTOM PROPERTY that is read and not the rendered `mask-image` of a probe element: since
 * `_icon.scss` gives every icon box the `image-missing` fallback, a rendered mask is never
 * `none`, and comparing against the fallback would answer `false` for `image-missing` itself.
 */
export function isIconAvailable(name: string): boolean {
    const found = lookupIcon(name);
    if (found === null || found.kind === 'missing') return false;
    if (found.kind === 'resource') return found.url !== null;
    return hasSymbolic(found.name);
}
