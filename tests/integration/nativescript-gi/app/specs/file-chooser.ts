// ADR 0100's FILE_CHOOSER_VECTORS against real `Gio.File` ON THE DEVICE (ADR 0105 stage 3).
//
// The payload carries no Gtk typelib, so the subject uses its Gtk stand-in and `rowsFor` drops the
// rows that are about GTK itself (dialog, filter, the FileFilter/FileDialog rules). Everything
// about Gio.File, streams, GLib.Error and `_promisify` runs for real.
import { knownFolders } from '@nativescript/core';
import { FILE_CHOOSER_VECTORS, driveFileChooserVectors } from '@gjsify/adwaita-core/conformance';
import { createRealGioFileChooserSubject, rowsFor } from '@gjsify/adwaita-gobject-native';

import { describe, expect, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

export default async function fileChooserVectors(): Promise<void> {
    const GLib = requireGi('GLib', '2.0') as { mkdir_with_parents(path: string, mode: number): number };
    const dir = `${knownFolders.documents().path}/file-chooser-${Date.now()}`;
    GLib.mkdir_with_parents(dir, 0o755);
    const subject = createRealGioFileChooserSubject(requireGi, { dir });
    try {
        await driveFileChooserVectors(subject, { describe, it, expect }, rowsFor(subject, FILE_CHOOSER_VECTORS));
    } finally {
        subject.dispose();
    }
}
