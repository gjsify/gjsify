import { describe, expect, it } from '@gjsify/unit';

import { GTKSOURCE_MANAGER_VECTORS, type GtkSourceManagersLike } from './managers-vectors.js';
import { Buffer } from './buffer.js';
import { LanguageManager } from './language-manager.js';
import { StyleSchemeManager } from './style-scheme.js';

export default async () => {
    await describe('gtksource-core: managers and buffer, the vectors', async () => {
        const door = { LanguageManager, StyleSchemeManager, Buffer } as unknown as GtkSourceManagersLike;
        for (const vector of GTKSOURCE_MANAGER_VECTORS) {
            await it(vector.rule, () => {
                expect(vector.observe(door)).toStrictEqual(vector.shows);
            });
        }
    });
};
