import { describe, expect, it } from '@gjsify/unit';

import { GTKSOURCE_BUFFER_VECTORS, type GtkSourceBufferLike } from './buffer-vectors.js';
import { Buffer } from './buffer.js';

export default async () => {
    await describe('gtksource-core: Buffer surface, the vectors', async () => {
        const door = { Buffer } as unknown as GtkSourceBufferLike;
        for (const vector of GTKSOURCE_BUFFER_VECTORS) {
            await it(vector.rule, () => {
                expect(vector.observe(door)).toStrictEqual(vector.shows);
            });
        }
    });
};
