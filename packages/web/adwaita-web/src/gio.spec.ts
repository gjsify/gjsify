// The `Gio.SimpleActionGroup` and `Gio.AppInfo` door of adwaita-web, held to the shared vectors (real GJS
// is their oracle, in adwaita-core's `simple-action-group.gjs.spec.ts` / `gio-app-info.gjs.spec.ts`). The door is the namespace module itself.

import {
    GIO_APP_INFO_VECTORS,
    SIMPLE_ACTION_GROUP_VECTORS,
    driveGioAppInfoVectors,
    driveSimpleActionGroupVectors,
    type GioActionsLike,
    type GioAppInfoSubject,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as Gdk from './namespace/gdk.js';
import * as Gio from './namespace/gio.js';
import * as GLib from './namespace/glib.js';

export const GioActionsTest = async () => {
    await driveSimpleActionGroupVectors(
        { name: 'adwaita-web', isOracle: false, Gio: Gio as unknown as GioActionsLike },
        { describe, it, expect },
    );
    await driveGioAppInfoVectors(
        { name: 'adwaita-web', isOracle: false, display: true, Gio, GLib, Gdk } as unknown as GioAppInfoSubject,
        { describe, it, expect },
        GIO_APP_INFO_VECTORS,
    );
    await describe('adwaita-web: Gio door', async () => {
        await it('has a vector row for every vector', () => {
            expect(SIMPLE_ACTION_GROUP_VECTORS.length > 0 && GIO_APP_INFO_VECTORS.length > 0).toBe(true);
        });
    });
};
