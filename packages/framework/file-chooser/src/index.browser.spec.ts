// In the browser `./platform.js` resolves to `platform.web.ts`: every export is adwaita-web's own
// class, so `gi://Gtk` under `--gi-renderer` and this package hand out the same objects, and the
// web driver is already registered. The picker itself is scripted; adwaita-web's spec drives the
// real File System Access and OPFS paths.

import { Gio, GLib, Gtk } from '@gjsify/adwaita-web';
import { describe, expect, it } from '@gjsify/unit';

import * as FileChooser from './index.js';
import type { FileChooserDriver, FileChooserHandle } from './index.js';

export default async () => {
    await describe('@gjsify/file-chooser in the browser', async () => {
        await it("re-exports adwaita-web's classes by identity", async () => {
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

        await it('opens and saves through a registered driver', async () => {
            const written: string[] = [];
            const handle = (basename: string): FileChooserHandle => ({
                basename,
                read: async () => new TextEncoder().encode('LDA #$01'),
                openWriter: async () => ({
                    write: async (chunk: Uint8Array) => void written.push(new TextDecoder().decode(chunk)),
                    close: async () => undefined,
                }),
            });
            const driver: FileChooserDriver = {
                open: async () => handle('demo.asm'),
                save: async (request) => handle(request.initialName ?? 'untitled.asm'),
            };
            const previous = FileChooser.registerFileChooserDriver(driver);
            try {
                // The web door registers its driver on import.
                expect(previous).not.toBeNull();

                const dialog = new FileChooser.FileDialog({ modal: true });
                const opened = await new Promise<Gio.File>((resolve, reject) =>
                    dialog.open(null, null, (_source, result) => {
                        try {
                            resolve(dialog.open_finish(result)!);
                        } catch (error) {
                            reject(error);
                        }
                    }),
                );
                expect(opened.get_basename()).toBe('demo.asm');

                dialog.set_initial_name('out.asm');
                const saved = await new Promise<Gio.File>((resolve, reject) =>
                    dialog.save(null, null, (_source, result) => {
                        try {
                            resolve(dialog.save_finish(result)!);
                        } catch (error) {
                            reject(error);
                        }
                    }),
                );
                expect(saved.get_basename()).toBe('out.asm');
            } finally {
                FileChooser.registerFileChooserDriver(previous);
            }
        });
    });
};
