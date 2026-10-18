// `Gio.AppInfo.launch_default_for_uri` and the `Gio.AppLaunchContext` it takes, renderer-free —
// the app-facing door ADR 0101 names over the OpenURI driver. A TRUE SUBSET of `gi://Gio`: the
// static function and an empty launch context; no `AppInfo` instance, no `launch_default_for_uri_async`,
// no `get_default_for_uri_scheme`. The ports export the context only as what an app is handed,
// `Gdk.AppLaunchContext` from `Gdk.Display.get_app_launch_context()`; it extends the class here.
//
// WHAT THE HOST DOES: the launch. GLib looks up the handler of the URI's scheme; a port has exactly
// one handler, the platform (`window.open`, Android's `ACTION_VIEW`), which is the `openUri` member of
// the {@link PlatformHost} `Gtk.show_uri` already uses. What GLib refuses before any lookup — a string
// with no scheme — is refused here the same way, with `G_IO_ERROR_NOT_SUPPORTED`. The context only
// carries startup notification and the display, neither of which a port has, so it is accepted and
// not read.
//
// Reference: GLib gio/gappinfo.c (g_app_info_launch_default_for_uri, launch_default_for_uri),
// glib/guri.c (g_uri_peek_scheme), gtk gdk/gdkdisplay.c (gdk_display_get_app_launch_context)
// Copyright (c) GNOME contributors (GLib, GTK). LGPLv2.1+.

import { GLibError, IOErrorEnum } from './glib-error.js';
import type { PlatformHost } from './gtk-platform.js';

/** `Gio.AppLaunchContext`, the base of `Gdk.AppLaunchContext`: carries nothing a port reads. */
export class AppLaunchContext {}

/** `g_uri_peek_scheme`: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` before the first `:`, lowercased. */
export function uriPeekScheme(uri: string): string | null {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri);
    return match ? match[1].toLowerCase() : null;
}

/** `Gio.AppInfo` as far as this subset goes. */
export interface GioAppInfo {
    launch_default_for_uri(uri: string, context: AppLaunchContext | null): boolean;
}

export function createAppInfo(host: Pick<PlatformHost, 'openUri'>): GioAppInfo {
    return Object.freeze({
        launch_default_for_uri(uri: string, _context: AppLaunchContext | null): boolean {
            if (uriPeekScheme(uri) === null) {
                throw new GLibError(IOErrorEnum, IOErrorEnum.NOT_SUPPORTED, 'The specified location is not supported');
            }
            host.openUri(uri);
            return true;
        },
    });
}
