// The Linux host fallback: an XDG autostart file, for a host with no Background portal
// (ADR 0144 § 2). The driver owns this file, so the marker is load-bearing: it deletes and
// replaces only a file that carries it.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { autostartFileName, desktopFileText, isOwnedFile } from './desktop-entry.js';

export interface AutostartFileRequest {
    readonly appId: string;
    readonly name: string;
    readonly commandline: readonly string[];
    readonly autostart: boolean;
    /** `$XDG_CONFIG_HOME`; the file lands in its `autostart/` directory. */
    readonly configDir: string;
}

export function autostartFilePath(configDir: string, appId: string): string {
    return GLib.build_filenamev([configDir, 'autostart', autostartFileName(appId)]);
}

function readIfPresent(file: Gio.File): string | null {
    try {
        const [, contents] = file.load_contents(null);
        return new TextDecoder().decode(contents);
    } catch (error) {
        // A missing file is the expected "no entry yet"; any other failure is real.
        if ((error as GLib.Error).matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) return null;
        throw error;
    }
}

/**
 * Make the autostart file match the wish. A file without our marker belongs to someone else —
 * the person or another tool — and is left alone in both directions: an entry that already
 * exists is the wish fulfilled, and one we did not write is not ours to delete.
 */
export function applyAutostartFile(request: AutostartFileRequest): void {
    const path = autostartFilePath(request.configDir, request.appId);
    const file = Gio.File.new_for_path(path);
    const existing = readIfPresent(file);
    const owned = existing !== null && isOwnedFile(existing);

    if (!request.autostart) {
        if (owned) file.delete(null);
        return;
    }
    if (existing !== null && !owned) return;

    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const output = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try {
        output.write_all(new TextEncoder().encode(desktopFileText(request)), null);
    } finally {
        output.close(null);
    }
}
