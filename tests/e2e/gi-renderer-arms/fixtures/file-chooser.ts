// ADR 0100: `Gtk.FileDialog` and `Gio.File` answered by the renderer, driven the way Learn6502's
// `file.service.ts` drives them — `_promisify`, a `ListStore` of filters, open + `load_contents`,
// save + `replace` / `write_bytes` / `close`. The picker is a scripted driver: neither stub host
// has one, and the renderer's own driver is what the package specs cover.
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { registerFileChooserDriver, type FileChooserHandle } from '@gjsify/adwaita-core';

export const kind = typeof Gtk.FileDialog;

export async function exercise(): Promise<Record<string, unknown>> {
    const written: Uint8Array[] = [];
    let committed = false;
    const handle = (basename: string): FileChooserHandle => ({
        basename,
        read: async () => new TextEncoder().encode('LDA #$01'),
        openWriter: async () => ({
            write: async (chunk) => void written.push(chunk),
            close: async () => void (committed = true),
        }),
    });
    const previous = registerFileChooserDriver({
        open: async () => handle('demo.asm'),
        save: async (request) => handle(request.initialName ?? 'untitled.asm'),
    });

    try {
        Gio._promisify(Gtk.FileDialog.prototype, 'open', 'open_finish');
        Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
        Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
        Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
        Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
        Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');

        const filter = Gtk.FileFilter.new();
        filter.set_name('Assembly');
        filter.add_suffix('asm');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter.$gtype });
        filters.append(filter);

        const dialog = new Gtk.FileDialog({ filters, modal: true });
        const opened = await dialog.open(null, null);
        const [contents] = await opened!.load_contents_async(null);

        dialog.set_initial_name('out.asm');
        const saved = await dialog.save(null, null);
        const stream = await saved!.replace_async(null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null);
        await stream.write_bytes_async(new GLib.Bytes(new TextEncoder().encode('BRK')), GLib.PRIORITY_DEFAULT, null);
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);

        let refusesUri = false;
        try {
            Gio.File.new_for_uri('file:///tmp/x.asm');
        } catch (error) {
            refusesUri = (error as Error).message.includes('new_for_uri');
        }

        return {
            openedName: opened!.get_basename(),
            text: new TextDecoder().decode(contents),
            savedName: saved!.get_basename(),
            written: written.map((chunk) => new TextDecoder().decode(chunk)).join(''),
            committed,
            refusesUri,
        };
    } finally {
        registerFileChooserDriver(previous);
    }
}
