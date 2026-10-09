// THE ORACLE: the SIMPLE_ACTION_GROUP_VECTORS run against real `gi://Gio`. A vector that fails here
// is a wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveSimpleActionGroupVectors, type GioActionsLike } from './conformance/simple-action-group.js';

export default async () => {
    await on('Gjs', async () => {
        const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioActionsLike;
        await driveSimpleActionGroupVectors({ name: 'GJS (real Gio)', isOracle: true, Gio }, { describe, it, expect });
    });
};
