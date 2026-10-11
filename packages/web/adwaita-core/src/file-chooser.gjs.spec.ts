// THE ORACLE: the FILE_CHOOSER_VECTORS run against real `gi://Gtk`, `gi://Gio` and `gi://GLib`. A
// vector that fails here is a wrong vector; fix the vector. GJS answers for the shape of results and
// errors, not for the picker: `open`/`save` are replaced by a script that resolves a real `Gio.File`
// under a temporary directory, or rejects `Gtk.DialogError.DISMISSED` as a closed portal does.
// `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    driveFileChooserVectors,
    FILE_CHOOSER_VECTORS,
    type FileChooserNamespaces,
    type ScriptedPick,
} from './conformance/file-chooser.js';

type Callback = (source: unknown, result: unknown) => void;
type Outcome = { file: unknown } | { error: unknown };

interface ScriptedDialog {
    filters: { get_n_items(): number; get_item(i: number): { to_gvariant(): { recursiveUnpack(): unknown } } } | null;
}

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const Gio = (await import('gi://Gio?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        Gtk.init_check();

        const dir: string = GLib.dir_make_tmp('gjsify-file-chooser-XXXXXX');
        let next: ScriptedPick = null;
        let filters: string[][] = [];

        const answer = function (this: ScriptedDialog, _parent: unknown, _cancellable: unknown, callback: Callback) {
            filters = [];
            for (let i = 0; this.filters && i < this.filters.get_n_items(); i++) {
                const [, rules] = this.filters.get_item(i).to_gvariant().recursiveUnpack() as [
                    string,
                    [number, string][],
                ];
                filters.push(rules.map(([, rule]) => rule));
            }
            let outcome: Outcome;
            if (next === null) {
                outcome = { error: new GLib.Error(Gtk.DialogError, Gtk.DialogError.DISMISSED, 'Dismissed by user') };
            } else {
                const file = Gio.File.new_for_path(GLib.build_filenamev([dir, next.basename]));
                // An empty Uint8Array reaches GIO as NULL and trips an assertion; create the file instead.
                if (next.contents?.length) {
                    file.replace_contents(next.contents, null, false, Gio.FileCreateFlags.NONE, null);
                } else if (next.contents) {
                    file.replace(null, false, Gio.FileCreateFlags.NONE, null).close(null);
                }
                outcome = { file };
            }
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                callback(this, outcome);
                return GLib.SOURCE_REMOVE;
            });
        };
        const finish = (result: Outcome) => {
            if ('error' in result) throw result.error;
            return result.file;
        };
        Object.assign(Gtk.FileDialog.prototype, {
            open: answer,
            save: answer,
            open_finish: finish,
            save_finish: finish,
        });

        try {
            await driveFileChooserVectors(
                {
                    name: 'GJS (real Gtk and Gio)',
                    isOracle: true,
                    GLib,
                    Gio,
                    Gtk,
                    script: (pick) => void (next = pick),
                    pickerFilters: () => filters,
                    cancelled: () => {
                        const cancellable = new Gio.Cancellable();
                        cancellable.cancel();
                        return cancellable;
                    },
                } as FileChooserNamespaces & Parameters<typeof driveFileChooserVectors>[0],
                { describe, it, expect },
                FILE_CHOOSER_VECTORS,
            );
        } finally {
            const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
            for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
                enumerator.get_child(info).delete(null);
            }
            Gio.File.new_for_path(dir).delete(null);
        }
    });
};
