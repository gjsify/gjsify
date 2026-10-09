// THE ORACLE: the GTKSOURCE_BUFFER_VECTORS run against real `gi://GtkSource`. A vector that fails
// here is a wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { GTKSOURCE_BUFFER_VECTORS, type GtkSourceBufferLike } from './buffer-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string)).default as GtkSourceBufferLike;
        await describe('GJS (real GtkSource): Buffer surface', async () => {
            for (const vector of GTKSOURCE_BUFFER_VECTORS) {
                await it(vector.rule, () => {
                    expect(vector.observe(GtkSource)).toStrictEqual(vector.shows);
                });
            }
        });
    });
};
