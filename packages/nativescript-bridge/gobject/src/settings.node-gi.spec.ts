// ADR 0099's `SETTINGS_VECTORS` against real `Gio.Settings` through node-gi (ADR 0105 stage 3).
// The schema is compiled into a temp dir with `glib-compile-schemas`, like the GJS oracle does; the
// device cannot spawn that binary, so `tests/integration/nativescript-gi` ships the compiled file.

import { describe, expect, it } from '@gjsify/unit';

import { FIXTURE_SCHEMA, FIXTURE_SCHEMA_XML, driveSettingsVectors } from '@gjsify/app-settings/conformance';

import { createRealGioSettingsSubject } from './settings-subject.js';
import type { RequireGi } from './engine.js';

interface HostGLib {
    dir_make_tmp(template: string): string;
    file_set_contents(path: string, contents: string): boolean;
    spawn_command_line_sync(command: string): [boolean, Uint8Array, Uint8Array, number];
}

export const realGioSettingsSuite = (requireGi: RequireGi) => async () => {
    const GLib = requireGi('GLib', '2.0') as HostGLib;
    const dir = GLib.dir_make_tmp('gjsify-settings-XXXXXX');
    GLib.file_set_contents(`${dir}/${FIXTURE_SCHEMA.id}.gschema.xml`, FIXTURE_SCHEMA_XML);
    const [, , , status] = GLib.spawn_command_line_sync(`glib-compile-schemas ${dir}`);
    if (status !== 0) throw new Error('glib-compile-schemas failed');

    const subject = createRealGioSettingsSubject(requireGi, { schemaDir: dir, schemaId: FIXTURE_SCHEMA.id });
    await driveSettingsVectors(subject, { describe, it, expect });

    await describe('real Gio.Settings: what the vectors cannot say', async () => {
        await it('reset forgets a write, so the next vector sees the schema default again', () => {
            const settings = new subject.Settings({ schema_id: FIXTURE_SCHEMA.id });
            settings.set_int('window-width', 123);
            subject.reset();
            expect(settings.get_int('window-width')).toBe(1000);
        });
    });
};
