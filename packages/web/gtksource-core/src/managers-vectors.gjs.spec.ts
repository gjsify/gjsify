// THE ORACLE: the GTKSOURCE_MANAGER_VECTORS run against real `gi://GtkSource`. A vector that fails
// here is a wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`, so the
// dynamic `gi://` load does not count against this package's runtimes.

import { describe, expect, it, on } from '@gjsify/unit';

import { GTKSOURCE_MANAGER_VECTORS, type GtkSourceManagersLike } from './managers-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string)).default as GtkSourceManagersLike;
        await describe('GJS (real GtkSource): managers and buffer', async () => {
            for (const vector of GTKSOURCE_MANAGER_VECTORS) {
                await it(vector.rule, () => {
                    expect(vector.observe(GtkSource)).toStrictEqual(vector.shows);
                });
            }
        });
    });
};
