// ADR 0099's SETTINGS_VECTORS against real `Gio.Settings` ON THE DEVICE (ADR 0105 stage 3).
//
// Host twin: `packages/nativescript-bridge/gobject/src/settings.node-gi.spec.ts`. The device cannot
// run `glib-compile-schemas`, so `scripts/compile-schemas.mjs` compiles the fixture schema on the
// host and the bytes ride in the bundle as base64; this writes them to the app's documents folder
// and points GSETTINGS_SCHEMA_DIR there. The backend is `memory`, never dconf.
//
// This must run BEFORE anything else touches `Gio.Settings`: GIO fixes its schema source and
// backend at first use.
import { knownFolders } from '@nativescript/core';
import { FIXTURE_SCHEMA, driveSettingsVectors } from '@gjsify/app-settings/conformance';
import { createRealGioSettingsSubject } from '@gjsify/adwaita-gobject-native';

import { describe, expect, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';
import { gschemasCompiledBase64 } from './gschemas.generated.js';

export default async function settingsVectors(): Promise<void> {
    const dir = `${knownFolders.documents().path}/gschemas`;
    const GLib = requireGi('GLib', '2.0') as {
        mkdir_with_parents(path: string, mode: number): number;
        file_set_contents(path: string, contents: Uint8Array): boolean;
    };
    GLib.mkdir_with_parents(dir, 0o755);
    const bytes = Uint8Array.from(atob(gschemasCompiledBase64), (c) => c.charCodeAt(0));
    GLib.file_set_contents(`${dir}/gschemas.compiled`, bytes);

    const subject = createRealGioSettingsSubject(requireGi, { schemaDir: dir, schemaId: FIXTURE_SCHEMA.id });
    await driveSettingsVectors(subject, { describe, it, expect });
}
