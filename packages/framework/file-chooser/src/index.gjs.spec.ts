// On GJS the package IS the native classes: `platform.gtk.ts` is what `./platform.js` resolves to
// under `--app gjs`, and every export is the `gi://` object itself, never a wrapper.

import { describe, expect, it, on } from '@gjsify/unit';

import * as FileChooser from './index.js';

export default async () => {
    await on('Gjs', async () => {
        const Gio = (await import('gi://Gio?version=2.0' as string)).default;
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;

        await describe('@gjsify/file-chooser on GJS', async () => {
            await it('re-exports the native classes by identity', async () => {
                expect(FileChooser.FileDialog).toBe(Gtk.FileDialog);
                expect(FileChooser.FileFilter).toBe(Gtk.FileFilter);
                expect(FileChooser.DialogError).toBe(Gtk.DialogError);
                expect(FileChooser.File).toBe(Gio.File);
                expect(FileChooser.ListStore).toBe(Gio.ListStore);
                expect(FileChooser.OutputStream).toBe(Gio.OutputStream);
                expect(FileChooser.FileOutputStream).toBe(Gio.FileOutputStream);
                expect(FileChooser.FileCreateFlags).toBe(Gio.FileCreateFlags);
                expect(FileChooser.IOErrorEnum).toBe(Gio.IOErrorEnum);
                expect(FileChooser.promisify).toBe(Gio._promisify);
                expect(FileChooser.Bytes).toBe(GLib.Bytes);
                expect(FileChooser.GLibError).toBe(GLib.Error);
            });

            await it('refuses a driver: the portal is the driver on GJS', async () => {
                expect(() => FileChooser.registerFileChooserDriver(null)).toThrow();
            });
        });
    });
};
