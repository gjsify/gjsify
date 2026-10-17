// THE ORACLE: the CHECK_GROUP_VECTORS run against real `Gtk.CheckButton`. A vector that fails here
// is a wrong vector; fix the vector. Needs a display; without one it stands down. `.gjs.spec.ts` is
// skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveCheckGroupVectors, type CheckButtonLike } from './conformance/check-group.js';

interface GtkCheck extends CheckButtonLike {
    activate(): boolean;
    connect(signal: string, run: () => void): number;
}

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as {
            init_check(): boolean;
            CheckButton: new () => GtkCheck;
        };
        if (!Gtk.init_check()) return;
        await driveCheckGroupVectors(
            {
                name: 'GJS (real Gtk)',
                isOracle: true,
                make: () => new Gtk.CheckButton(),
                activate: (button) => void (button as GtkCheck).activate(),
                countToggled(button) {
                    let count = 0;
                    (button as GtkCheck).connect('toggled', () => void (count += 1));
                    return () => count;
                },
            },
            { describe, it, expect },
        );
    });
};
