// `Gio.AppInfo` of the core against the shared vectors, plus what only the core can see: the URI the
// host is handed.

import { describe, expect, it } from '@gjsify/unit';

import { driveGioAppInfoVectors, GIO_APP_INFO_VECTORS } from './conformance/gio-app-info.js';
import { createGdk } from './gdk.js';
import { createAppInfo, uriPeekScheme } from './gio-app-info.js';
import { GLibError, IOErrorEnum } from './glib-error.js';

export default async () => {
    const opened: string[] = [];
    const AppInfo = createAppInfo({ openUri: (uri) => void opened.push(uri) });
    const Gdk = createGdk({ writeText: () => {} });
    await driveGioAppInfoVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            display: true,
            Gio: { AppInfo, IOErrorEnum },
            GLib: { Error: GLibError },
            Gdk,
        },
        { describe, it, expect },
        GIO_APP_INFO_VECTORS,
    );

    await describe('adwaita-core: Gio.AppInfo host', async () => {
        await it('hands a URI with a scheme to the host and returns true', () => {
            opened.length = 0;
            const context = Gdk.Display.get_default().get_app_launch_context();
            expect(AppInfo.launch_default_for_uri('https://example.org/?q=1', context)).toBe(true);
            expect(AppInfo.launch_default_for_uri('mailto:a@example.org', null)).toBe(true);
            expect(JSON.stringify(opened)).toBe(JSON.stringify(['https://example.org/?q=1', 'mailto:a@example.org']));
        });
        await it('hands nothing to the host for a string with no scheme', () => {
            opened.length = 0;
            expect(() => AppInfo.launch_default_for_uri('example.org', null)).toThrow();
            expect(opened.length).toBe(0);
        });
        await it('peeks the scheme as g_uri_peek_scheme does', () => {
            expect(
                JSON.stringify(['HTTPS://x', 'a+b.c-d:x', '1a:x', ':x', 'no scheme', 'c:\\x'].map(uriPeekScheme)),
            ).toBe(JSON.stringify(['https', 'a+b.c-d', null, null, null, 'c']));
        });
    });
};
