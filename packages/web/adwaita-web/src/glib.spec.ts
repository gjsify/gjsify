// The GLib timers door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `glib-timers.gjs.spec.ts`). The door is the namespace module itself, so a member
// that stops being exported fails here.

import {
    GLIB_PATH_VECTORS,
    GLIB_TIMER_VECTORS,
    GLIB_URI_VECTORS,
    GLIB_VARIANT_VECTORS,
    driveGLibPathVectors,
    driveGLibTimerVectors,
    driveGLibUriVectors,
    driveGLibVariantVectors,
    type GLibPathsLike,
    type GLibTimersLike,
    type GLibUriLike,
    type GLibVariantLike,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as GLib from './namespace/glib.js';

export const GLibTest = async () => {
    await driveGLibTimerVectors(
        {
            name: 'adwaita-web',
            isOracle: false,
            GLib: GLib as unknown as GLibTimersLike,
            settle: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            quiet: async (body) => {
                const original = console.error;
                console.error = () => {};
                try {
                    await body();
                } finally {
                    console.error = original;
                }
            },
        },
        { describe, it, expect },
    );
    await driveGLibPathVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibPathsLike },
        { describe, it, expect },
        GLIB_PATH_VECTORS,
    );
    await driveGLibUriVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibUriLike },
        { describe, it, expect },
        GLIB_URI_VECTORS,
    );
    await driveGLibVariantVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibVariantLike },
        { describe, it, expect },
        GLIB_VARIANT_VECTORS,
    );
    await describe('adwaita-web: GLib door', async () => {
        await it('answers the host-bound path questions with the root and no data dirs', () => {
            expect(GLib.get_current_dir()).toBe('/');
            expect(GLib.get_system_data_dirs().length).toBe(0);
        });
        await it('has a vector row for every vector', () => {
            expect(GLIB_TIMER_VECTORS.length > 0 && GLIB_PATH_VECTORS.length > 0).toBe(true);
        });
    });
};
