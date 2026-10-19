// THE ORACLE: the GLIB_VARIANT_VECTORS run against real `gi://GLib`. A vector that fails here is a
// wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { GLIB_VARIANT_VECTORS, driveGLibVariantVectors, type GLibVariantLike } from './conformance/glib-variant.js';

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibVariantLike;
        await driveGLibVariantVectors(
            { name: 'GJS (real GLib)', isOracle: true, GLib },
            { describe, it, expect },
            GLIB_VARIANT_VECTORS,
        );
    });
};
