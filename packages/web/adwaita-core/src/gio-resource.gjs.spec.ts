// THE ORACLE: the GIO_RESOURCE_VECTORS run against real `gi://Gio`, over the bytes
// `glib-compile-resources` wrote. A vector that fails here is a wrong vector; fix the vector.
// `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveGioResourceVectors, type GioResourceNamespace } from './conformance/gio-resource.js';

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioResourceNamespace;
        await driveGioResourceVectors(
            {
                name: 'GJS (real Gio)',
                isOracle: true,
                Gio,
                bytes: (data) => new GLib.Bytes(data),
            },
            { describe, it, expect },
        );
    });
};
