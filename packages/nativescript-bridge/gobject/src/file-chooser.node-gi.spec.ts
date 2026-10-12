// ADR 0100's `FILE_CHOOSER_VECTORS` against real `Gio.File` through node-gi (ADR 0105 stage 3).
// The host has GTK, so `Gtk` is the real namespace here and every row that the oracle runs runs.

import { describe, expect, it } from '@gjsify/unit';

import { FILE_CHOOSER_VECTORS, driveFileChooserVectors } from '@gjsify/adwaita-core/conformance';

import { createRealGioFileChooserSubject, rowsFor } from './file-chooser-subject.js';
import type { RequireGi } from './engine.js';

export const realGioFileChooserSuite =
    (requireGi: RequireGi, standIn = false) =>
    async () => {
        const GLib = requireGi('GLib', '2.0') as { dir_make_tmp(template: string): string };
        const subject = createRealGioFileChooserSubject(requireGi, {
            dir: GLib.dir_make_tmp('gjsify-file-chooser-XXXXXX'),
            standIn,
        });
        try {
            await driveFileChooserVectors(subject, { describe, it, expect }, rowsFor(subject, FILE_CHOOSER_VECTORS));
        } finally {
            subject.dispose();
        }
    };
