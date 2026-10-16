// THE ORACLE: the ICON_THEME_RESOURCE_VECTORS against real `gi://Gtk`, through
// `gtk_icon_theme_lookup_by_gicon` with a `GThemedIcon` as `GtkImage` builds one, on a theme named
// Adwaita. Without an installed Adwaita the current-theme vector cannot be asked and is skipped.
// `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    ICON_THEME_RESOURCE_VECTORS,
    driveIconThemeResourceVectors,
    type IconThemeLike,
} from './conformance/icon-theme-resources.js';

interface Paintable {
    get_file(): { get_uri(): string } | null;
    get_property(name: string, value: { get_boolean(): boolean }): void;
}
interface GtkTheme extends IconThemeLike {
    has_icon(name: string): boolean;
    lookup_by_gicon(icon: object, size: number, scale: number, direction: number, flags: number): Paintable;
}

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const GObject = (await import('gi://GObject?version=2.0' as string)).default;
        const Gio = (await import('gi://Gio?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        const newTheme = (): GtkTheme => new Gtk.IconTheme({ theme_name: 'Adwaita', resource_path: [] });
        const hasAdwaita = newTheme().has_icon('go-next-symbolic');
        const direction = { ltr: Gtk.TextDirection.LTR, rtl: Gtk.TextDirection.RTL };

        await driveIconThemeResourceVectors(
            {
                name: 'GJS (real Gtk.IconTheme)',
                isOracle: true,
                register(data) {
                    const resource = Gio.Resource.new_from_data(new GLib.Bytes(data));
                    Gio.resources_register(resource);
                    return () => Gio.resources_unregister(resource);
                },
                theme: newTheme,
                lookup(theme, name, size, scale, dir) {
                    const paintable = (theme as GtkTheme).lookup_by_gicon(
                        Gio.ThemedIcon.new(name),
                        size,
                        scale,
                        dir === null ? Gtk.TextDirection.NONE : direction[dir],
                        0,
                    );
                    const uri = paintable.get_file()?.get_uri() ?? '';
                    if (uri.endsWith('/image-missing.svg') || uri === '') return null;
                    if (!uri.startsWith('resource://')) return 'theme';
                    // The `is-symbolic` property is deprecated; reading it through a GValue does not warn.
                    const value = new GObject.Value();
                    value.init(GObject.TYPE_BOOLEAN);
                    paintable.get_property('is-symbolic', value);
                    return { uri, symbolic: value.get_boolean() };
                },
            },
            { describe, it, expect },
            ICON_THEME_RESOURCE_VECTORS.filter((vector) => hasAdwaita || vector.row !== 'symbolic'),
        );
    });
};
