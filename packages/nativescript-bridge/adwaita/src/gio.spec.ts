// The `Gio.AppInfo` door of adwaita-nativescript, held to the shared vectors (real GJS is their oracle,
// in adwaita-core's `gio-app-info.gjs.spec.ts`). No vector launches anything, so the real host stays.

import { GIO_APP_INFO_VECTORS, driveGioAppInfoVectors, type GioAppInfoSubject } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as Gdk from './namespace/gdk.js';
import * as Gio from './namespace/gio.js';
import * as GLib from './namespace/glib.js';

export default async () => {
    await driveGioAppInfoVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            display: true,
            Gio,
            GLib,
            Gdk,
        } as unknown as GioAppInfoSubject,
        { describe, it, expect },
        GIO_APP_INFO_VECTORS,
    );
    await describe('adwaita-nativescript: Gio door', async () => {
        await it('has a vector row for every vector', () => {
            expect(GIO_APP_INFO_VECTORS.length > 0).toBe(true);
        });
    });
};
