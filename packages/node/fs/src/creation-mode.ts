// Applying Node's creation `mode` to a file or directory GLib has just created.
//
// Neither `GLib.IOChannel.new_file()` nor `Gio.File.make_directory()` takes a mode, so the
// `mode` argument of `open`/`openSync`/`mkdir`/`mkdirSync` was parsed and then silently
// dropped. Everything landed at the process default — files 0644, directories 0755 — which is
// a correctness bug with a security edge: a caller writing private data with `0o600` got a
// world-readable file and no indication that its request had been ignored.
//
// open(2) and mkdir(2) mask the requested mode with the process umask, and we cannot read the
// umask from GJS (there is no binding, and the C idiom `umask(0); umask(old)` is not reachable).
// So we DERIVE it from what GLib just produced: GLib creates files with `0666 & ~umask` and
// directories with `0777 & ~umask`, so the bits missing from the result ARE the umask.
//
// That makes the fix a no-op for the defaults — `mode` 0666 under umask 022 resolves to the
// 0644 the file already has, so nothing is chmod'ed and no existing behaviour changes. Only a
// caller who asked for something specific sees a difference.

import Gio from '@girs/gio-2.0';

/** Permission bits GLib would give a newly created FILE before the umask is applied. */
export const FILE_BASE_MODE = 0o666;
/** Permission bits Gio would give a newly created DIRECTORY before the umask is applied. */
export const DIR_BASE_MODE = 0o777;

/** Read the permission bits of an existing path, or null when they cannot be read. */
function currentMode(path: string): number | null {
    try {
        const info = Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_attribute_uint32('unix::mode') & 0o7777;
    } catch {
        // A filesystem without unix::mode (or a path that vanished under us) simply gets no
        // mode applied — better than failing a create that otherwise succeeded.
        return null;
    }
}

/**
 * Apply `requested` to a path GLib has just created, emulating the umask that open(2)/mkdir(2)
 * would have applied.
 *
 * Call ONLY for a path this process just created: Node ignores `mode` for a file that already
 * existed, and re-applying it to one would be a silent permission change.
 *
 * Never throws. A create that succeeded must not be turned into a failure because the mode
 * could not be adjusted afterwards — the caller already has their file.
 */
export function applyCreationMode(path: string, requested: number, baseMode: number): void {
    const actual = currentMode(path);
    if (actual === null) return;

    // The bits GLib dropped from the base mode are exactly the umask.
    const umask = baseMode & ~actual;
    const target = requested & ~umask & 0o7777;
    if (target === actual) return; // the common case: `mode` was the default

    try {
        Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', target, Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        /* see above — a best-effort narrowing, not a reason to fail the create */
    }
}
