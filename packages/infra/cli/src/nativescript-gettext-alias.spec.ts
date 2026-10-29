// SPDX-License-Identifier: MIT
// Bare `gettext` on `--app nativescript` must reach the GLib gettext (libintl reader),
// not an unresolved GJS built-in: shared UI code imports it the same way on GNOME.

import { describe, expect, it } from '@gjsify/unit';
import { ALIASES_GJS_FOR_NODE } from '@gjsify/rolldown-plugin-gjsify';
import { ALIASES_NODE_FOR_NATIVESCRIPT } from '@gjsify/resolve-npm';

export default async () => {
    await describe('--app nativescript: bare gettext alias', async () => {
        await it('routes gettext to @gjsify/node-gi/gettext', async () => {
            expect(ALIASES_NODE_FOR_NATIVESCRIPT['gettext']).toBe('@gjsify/node-gi/gettext');
        });
        await it('uses the same target as the node reverse bridge', async () => {
            expect(ALIASES_NODE_FOR_NATIVESCRIPT['gettext']).toBe(ALIASES_GJS_FOR_NODE['gettext']);
        });
    });
};
