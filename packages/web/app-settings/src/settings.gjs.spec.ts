// THE ORACLE: SETTINGS_VECTORS against real `gi://Gio`, run with GSETTINGS_BACKEND=memory. The
// fixture schema is compiled into a temp dir first. `.gjs.spec.ts` is skipped by audit-runtimes.

import { describe, expect, it, on } from '@gjsify/unit';

import { FIXTURE_SCHEMA_XML, driveSettingsVectors, type SettingsClassLike } from './conformance/settings.js';

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as any;
        const Gio = (await import('gi://Gio?version=2.0' as string)).default as any;
        const dir = GLib.dir_make_tmp('gjsify-settings-XXXXXX');
        GLib.file_set_contents(`${dir}/eu.jumplink.Learn6502.gschema.xml`, FIXTURE_SCHEMA_XML);
        const [, , , status] = GLib.spawn_command_line_sync(`glib-compile-schemas ${dir}`);
        if (status !== 0) throw new Error('glib-compile-schemas failed');
        GLib.setenv('GSETTINGS_SCHEMA_DIR', dir, true);
        GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
        await driveSettingsVectors(
            {
                name: 'GJS (real Gio.Settings)',
                isOracle: true,
                Settings: Gio.Settings as SettingsClassLike,
                reset: () => {},
            },
            { describe, it, expect },
        );
    });
};
