// @gjsify/adwaita-app — promise-based Gtk.FileDialog helpers.
// Wrap the async open/save callbacks so a caller can `await` a path, and turn
// the "user cancelled" throw into a `null` result instead of a rejection.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

/** A named file filter (glob patterns and/or MIME types). */
export interface FileFilterSpec {
    /** Human-readable filter name. */
    name: string;
    /** Glob patterns, e.g. `*.json`. */
    patterns?: string[];
    /** MIME types, e.g. `application/pdf`. */
    mimeTypes?: string[];
}

/** Options for {@link pickFile} / {@link saveFile}. */
export interface PickFileOptions {
    /** Dialog title. */
    title?: string;
    /** File filters offered in the dialog. */
    filters?: FileFilterSpec[];
    /** Pre-filled file name (save dialogs). */
    initialName?: string;
}

function buildFilters(specs: FileFilterSpec[] | undefined): Gio.ListStore | undefined {
    if (!specs?.length) return undefined;
    const store = new Gio.ListStore({ itemType: Gtk.FileFilter.$gtype });
    for (const spec of specs) {
        const filter = new Gtk.FileFilter();
        filter.set_name(spec.name);
        for (const pattern of spec.patterns ?? []) filter.add_pattern(pattern);
        for (const mime of spec.mimeTypes ?? []) filter.add_mime_type(mime);
        store.append(filter);
    }
    return store;
}

/** Open-file dialog; resolves the chosen path, or `null` if cancelled. */
export function pickFile(parent: Gtk.Window, options: PickFileOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog = new Gtk.FileDialog({ title: options.title ?? 'Open File' });
        const filters = buildFilters(options.filters);
        if (filters) dialog.set_filters(filters);
        dialog.open(parent, null, (_source, result) => {
            try {
                resolve(dialog.open_finish(result)?.get_path() ?? null);
            } catch {
                resolve(null); // cancelled / dismissed
            }
        });
    });
}

/** Save-file dialog; resolves the chosen path, or `null` if cancelled. */
export function saveFile(parent: Gtk.Window, options: PickFileOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog = new Gtk.FileDialog({ title: options.title ?? 'Save File' });
        if (options.initialName) dialog.set_initial_name(options.initialName);
        const filters = buildFilters(options.filters);
        if (filters) dialog.set_filters(filters);
        dialog.save(parent, null, (_source, result) => {
            try {
                resolve(dialog.save_finish(result)?.get_path() ?? null);
            } catch {
                resolve(null); // cancelled / dismissed
            }
        });
    });
}
