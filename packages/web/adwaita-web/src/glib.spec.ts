// The GLib timers door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `glib-timers.gjs.spec.ts`). The door is the namespace module itself, so a member
// that stops being exported fails here.

import { GLIB_TIMER_VECTORS, driveGLibTimerVectors, type GLibTimersLike } from '@gjsify/adwaita-core/conformance';
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
    await describe('adwaita-web: GLib door', async () => {
        await it('has a vector row for every vector', () => {
            expect(GLIB_TIMER_VECTORS.length > 0).toBe(true);
        });
    });
};
