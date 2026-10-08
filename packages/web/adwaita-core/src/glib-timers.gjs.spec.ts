// THE ORACLE: the GLIB_TIMER_VECTORS run against real `gi://GLib`. A vector that fails here is a
// wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`, so the dynamic
// `gi://` load does not count against this package's runtimes.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveGLibTimerVectors, type GLibTimersLike } from './conformance/glib-timers.js';

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibTimersLike;
        await driveGLibTimerVectors(
            {
                name: 'GJS (real GLib)',
                isOracle: true,
                GLib,
                quiet: (body) => body(),
                settle: (milliseconds) =>
                    new Promise((resolve) =>
                        (GLib as unknown as { timeout_add: GLibTimersLike['timeout_add'] }).timeout_add(
                            GLib.PRIORITY_DEFAULT,
                            milliseconds,
                            () => {
                                resolve();
                                return false;
                            },
                        ),
                    ),
            },
            { describe, it, expect },
        );
    });
};
