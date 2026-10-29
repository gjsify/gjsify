// GLib/GTK primitive specs. `glibClamp` and `gStrStrip` are exercised through their
// callers (adjustment, avatar, about-dialog); this suite covers the readback rule, which
// has no caller-visible table of its own and is the whole reason an `''` icon name
// notifies forever.

import { describe, expect, it } from '@gjsify/unit';

import { gtkButtonIconNameReadback } from './glib.js';

/** `[stored, readback, rule]`, measured on GJS 1.88.1 / GTK 4.22.5. */
const ICON_NAME_READBACK: ReadonlyArray<readonly [string | null, string | null, string]> = [
    ['document-open-symbolic', 'document-open-symbolic', 'a real icon name reads straight back'],
    ['', null, 'an empty name leaves the internal GtkImage EMPTY, so the getter answers NULL'],
    [null, null, 'no icon name is already NULL'],
    [' ', ' ', 'a SPACE is a name like any other — nothing trims, and the image is not empty'],
    ['\0', '\0', 'only the empty string is special; a NUL byte inside a JS string is content'],
];

export default async () => {
    await describe('gtkButtonIconNameReadback (gtk_button_get_icon_name)', async () => {
        for (const [stored, readback, rule] of ICON_NAME_READBACK) {
            await it(`${JSON.stringify(stored)} → ${JSON.stringify(readback)} — ${rule}`, () => {
                expect(gtkButtonIconNameReadback(stored)).toBe(readback);
            });
        }

        await it('is the guard C compares against, so `""` is never equal to itself', () => {
            // `g_strcmp0 ('', get_icon_name (self))` with `''` already stored: the getter
            // answers NULL, the compare is non-zero, the write goes through again. This
            // is the one non-idempotent property write on a button.
            expect(gtkButtonIconNameReadback('') === '').toBe(false);
            // Every other value IS idempotent under the same comparison.
            expect(gtkButtonIconNameReadback('edit-find-symbolic') === 'edit-find-symbolic').toBe(true);
        });

        await it('is idempotent as a function, even though the WRITE it guards is not', () => {
            for (const [stored] of ICON_NAME_READBACK) {
                const once = gtkButtonIconNameReadback(stored);
                expect(gtkButtonIconNameReadback(once)).toBe(once);
            }
        });
    });
};
