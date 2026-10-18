// THE ORACLE: the ROW_ACCESSOR_VECTORS run against real `gi://Adw`. A vector that fails here is a
// wrong vector; fix the vector. Needs a display; without one it stands down. `.gjs.spec.ts` is
// skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    driveRowAccessorVectors,
    type ComboRowLike,
    type RowAccessorSubject,
    type SwitchRowLike,
} from './conformance/row-accessors.js';

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as {
            init_check(): boolean;
            StringList: RowAccessorSubject['StringList'];
        };
        const Adw = (await import('gi://Adw?version=1' as string)).default as {
            init(): void;
            ComboRow: new () => ComboRowLike;
            SwitchRow: new () => SwitchRowLike;
        };
        if (!Gtk.init_check()) return;
        Adw.init();
        await driveRowAccessorVectors(
            {
                name: 'GJS (real Adw)',
                isOracle: true,
                makeComboRow: () => new Adw.ComboRow(),
                makeSwitchRow: () => new Adw.SwitchRow(),
                StringList: Gtk.StringList,
            },
            { describe, it, expect },
        );
    });
};
