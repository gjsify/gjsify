// The GLib URI helper of the core against the shared vectors.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_URI_VECTORS, driveGLibUriVectors } from './conformance/glib-uri.js';
import { uriEscapeString } from './glib-uri.js';

export default async () => {
    await driveGLibUriVectors(
        { name: 'adwaita-core', isOracle: false, GLib: { uri_escape_string: uriEscapeString } },
        { describe, it, expect },
        GLIB_URI_VECTORS,
    );

    await describe('adwaita-core: GLib URI', async () => {
        await it('escapes what encodeURIComponent keeps', () => {
            expect(uriEscapeString("!'()*", null, false)).toBe('%21%27%28%29%2A');
        });
    });
};
