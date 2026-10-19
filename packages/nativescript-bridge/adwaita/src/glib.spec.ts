// The GLib timers door of adwaita-nativescript, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `glib-timers.gjs.spec.ts`). The door is the namespace module itself, so a member
// that stops being exported fails here.

import {
    GLIB_PATH_VECTORS,
    GLIB_TIMER_VECTORS,
    GLIB_UNICHAR_VECTORS,
    GLIB_URI_VECTORS,
    GLIB_VARIANT_VECTORS,
    driveGLibPathVectors,
    driveGLibTimerVectors,
    driveGLibUnicharVectors,
    driveGLibUriVectors,
    driveGLibVariantVectors,
    type GLibPathsLike,
    type GLibTimersLike,
    type GLibUnicharLike,
    type GLibUriLike,
    type GLibVariantLike,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as GLib from './namespace/glib.js';

export default async () => {
    await driveGLibTimerVectors(
        {
            name: 'adwaita-nativescript',
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
        { name: 'adwaita-nativescript', isOracle: false, GLib: GLib as unknown as GLibPathsLike },
        { describe, it, expect },
        GLIB_PATH_VECTORS,
    );
    await driveGLibUriVectors(
        { name: 'adwaita-nativescript', isOracle: false, GLib: GLib as unknown as GLibUriLike },
        { describe, it, expect },
        GLIB_URI_VECTORS,
    );
    await driveGLibVariantVectors(
        { name: 'adwaita-nativescript', isOracle: false, GLib: GLib as unknown as GLibVariantLike },
        { describe, it, expect },
        GLIB_VARIANT_VECTORS,
    );
    await driveGLibUnicharVectors(
        { name: 'adwaita-nativescript', isOracle: false, GLib: GLib as unknown as GLibUnicharLike },
        { describe, it, expect },
        GLIB_UNICHAR_VECTORS,
    );
    await describe('adwaita-nativescript: GLib door', async () => {
        await it('answers the host-bound path questions with the root and no data dirs', () => {
            expect(GLib.get_current_dir()).toBe('/');
            expect(GLib.get_system_data_dirs().length).toBe(0);
        });
        await it('has a vector row for every vector', () => {
            expect(GLIB_TIMER_VECTORS.length > 0 && GLIB_PATH_VECTORS.length > 0).toBe(true);
        });
    });
};
