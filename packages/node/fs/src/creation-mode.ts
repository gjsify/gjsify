// Applying Node's creation `mode` to a file or directory GLib has just created.
//
// Neither `GLib.IOChannel.new_file()` nor `Gio.File.make_directory()` takes a mode, so the
// `mode` argument of `open`/`openSync`/`mkdir`/`mkdirSync` was parsed and then silently
// dropped. Everything landed at the process default — files 0644, directories 0755 — which is
// a correctness bug with a security edge: a caller writing private data with `0o600` got a
// world-readable file and no indication that its request had been ignored.
//
// open(2) and mkdir(2) mask the requested mode with the process umask, and GJS cannot read the
// umask (there is no binding, and the C idiom `umask(0); umask(old)` is not reachable). So we
// MEASURE it once per process, by creating a throwaway directory and seeing which bits of 0777
// survive. A directory is the right probe: its base mode carries every permission bit, so the
// execute bits are observable — a file probe (base 0666) is structurally blind to them and
// would under-mask a requested `0o777`.
//
// TWO RULES keep this from changing anything it should not:
//
//   1. It runs ONLY when the caller passed a mode explicitly. An omitted `mode` means "whatever
//      the system gives me", which is precisely what GLib already did, so there is nothing to
//      correct and nothing is touched.
//   2. It rewrites ONLY the low 0o777 permission bits, preserving whatever setuid/setgid/sticky
//      bits are already there. The kernel INHERITS setgid from the parent directory — the
//      standard shared-workspace setup — and a chmod computed from a plain `mode` would strip
//      it, silently breaking group ownership for everyone else working in that tree.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

/** Permission bits Gio would give a newly created DIRECTORY before the umask is applied. */
const DIR_BASE_MODE = 0o777;
/** The permission bits this module owns; everything above is left exactly as found. */
const PERMISSION_BITS = 0o777;

/** Read the permission + special bits of an existing path, or null when unreadable. */
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

let cachedUmask: number | null = null;

/**
 * The process umask, measured once by creating a throwaway directory.
 *
 * Cached because the umask cannot change under us: nothing in GJS can call `umask(2)`. Falls
 * back to 0 when the probe cannot run (a read-only or missing temp dir), which makes the
 * requested mode apply verbatim — the caller's stated intent, and never MORE permissive than
 * what they asked for.
 */
function processUmask(): number {
    if (cachedUmask !== null) return cachedUmask;
    let parent: string | null = null;
    let child: Gio.File | null = null;
    try {
        // The probe must be an ORDINARY directory create. `GLib.Dir.make_tmp` is mkdtemp(3),
        // which forces 0700 regardless of the umask, so measuring IT reports a umask of 0o077
        // on every machine — which would then narrow every explicit mode far past what was
        // asked for. Only `make_directory`, the call mkdirSync itself uses, sees the umask.
        parent = GLib.Dir.make_tmp('gjsify-umask-XXXXXX');
        child = Gio.File.new_for_path(`${parent}/probe`);
        child.make_directory(null);
        const actual = currentMode(child.get_path() as string);
        cachedUmask = actual === null ? 0 : DIR_BASE_MODE & ~actual & PERMISSION_BITS;
    } catch {
        cachedUmask = 0;
    } finally {
        try {
            child?.delete(null);
        } catch {
            /* best-effort */
        }
        if (parent) {
            try {
                Gio.File.new_for_path(parent).delete(null);
            } catch {
                /* a leftover empty temp dir is harmless; failing the create over it is not */
            }
        }
    }
    return cachedUmask;
}

/**
 * Apply an EXPLICITLY REQUESTED mode to a path this call just created, emulating the umask that
 * open(2)/mkdir(2) would have applied.
 *
 * Call ONLY for a path this process just created, and only when the caller actually passed a
 * mode: open(2) and mkdir(2) ignore `mode` for a path that already existed, and re-applying it
 * to one would be a silent permission change on someone else's data.
 *
 * Never throws. A create that succeeded must not be turned into a failure because the mode
 * could not be adjusted afterwards — the caller already has their file.
 */
export function applyCreationMode(path: string, requested: number): void {
    const actual = currentMode(path);
    if (actual === null) return;

    const target = requested & ~processUmask() & PERMISSION_BITS;
    // Preserve setuid/setgid/sticky exactly as the kernel left them.
    const special = actual & ~PERMISSION_BITS;
    if (target === (actual & PERMISSION_BITS)) return;

    try {
        Gio.File.new_for_path(path).set_attribute_uint32(
            'unix::mode',
            special | target,
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
    } catch {
        /* see above — a best-effort narrowing, not a reason to fail the create */
    }
}

/**
 * Normalize Node's `mode` argument to a number, or null when none was given.
 *
 * Node documents `mode` as `string | integer` and parses a string as OCTAL (`'600'` → 0o600).
 * Treating it as a JS number instead reads it as DECIMAL, so `'600'` would become 0o1130 —
 * sticky plus `--x-wx---` — and the caller could no longer read its own new file.
 */
export function normalizeMode(mode: string | number | null | undefined): number | null {
    if (mode === null || mode === undefined) return null;
    if (typeof mode === 'number') return Number.isFinite(mode) ? mode & 0o7777 : null;
    const parsed = Number.parseInt(mode, 8);
    return Number.isNaN(parsed) ? null : parsed & 0o7777;
}
