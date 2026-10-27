// THE ORACLE: the RGBA_VECTORS run against real `gi://Gdk`. A vector that fails here is a wrong
// vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveRGBAVectors, type GdkRGBALike } from './conformance/rgba.js';

export default async () => {
    await on('Gjs', async () => {
        const Gdk = (await import('gi://Gdk?version=4.0' as string)).default as GdkRGBALike;
        await driveRGBAVectors({ name: 'GJS (real Gdk)', isOracle: true, Gdk }, { describe, it, expect });
    });
};
