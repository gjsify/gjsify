import { describe, expect, it } from '@gjsify/unit';

import { GTKSOURCE_INIT_VECTORS } from './init-vectors.js';
import { init } from './init.js';

export default async () => {
    await describe('gtksource-nativescript: GtkSource.init()', async () => {
        for (const vector of GTKSOURCE_INIT_VECTORS) {
            await it(vector.rule, () => {
                expect(vector.observe({ init })).toStrictEqual(vector.shows);
            });
        }
    });
};
