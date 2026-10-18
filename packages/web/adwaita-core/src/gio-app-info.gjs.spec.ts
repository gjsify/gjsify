// THE ORACLE: the GIO_APP_INFO_VECTORS run against real `gi://Gio`. A vector that fails here is a
// wrong vector; fix the vector. The vectors that need a display are skipped without one.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveGioAppInfoVectors, GIO_APP_INFO_VECTORS, type GioAppInfoNamespaces } from './conformance/gio-app-info.js';

export default async () => {
    await on('Gjs', async () => {
        const Gio = (await import('gi://Gio?version=2.0' as string)).default;
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        const Gdk = (await import('gi://Gdk?version=4.0' as string)).default;
        const display = Gtk.init_check();
        await driveGioAppInfoVectors(
            { name: 'GJS (real Gio)', isOracle: true, display, Gio, GLib, Gdk } as GioAppInfoNamespaces &
                Parameters<typeof driveGioAppInfoVectors>[0],
            { describe, it, expect },
            GIO_APP_INFO_VECTORS,
        );
    });
};
