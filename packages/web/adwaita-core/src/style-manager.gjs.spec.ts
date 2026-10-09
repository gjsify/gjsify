// THE ORACLE: the STYLE_MANAGER_VECTORS run against real `gi://Adw`. A vector that fails here is a
// wrong vector; fix the vector. Needs a display; without one it stands down. `.gjs.spec.ts` is
// skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveStyleManagerVectors, type AdwStyleLike } from './conformance/style-manager.js';

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as { init_check(): boolean };
        const Adw = (await import('gi://Adw?version=1' as string)).default as AdwStyleLike & {
            init(): void;
            ColorScheme: { FORCE_DARK: number; FORCE_LIGHT: number };
        };
        if (!Gtk.init_check()) return;
        Adw.init();
        const manager = Adw.StyleManager.get_default() as unknown as { color_scheme: number };
        await driveStyleManagerVectors(
            {
                name: 'GJS (real Adw)',
                isOracle: true,
                Adw,
                setDark: (dark) => {
                    manager.color_scheme = dark ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.FORCE_LIGHT;
                },
                settle: async () => {},
            },
            { describe, it, expect },
        );
    });
};
