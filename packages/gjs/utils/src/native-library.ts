// SPDX-License-Identifier: MIT
// "The library lives beside its typelib" — the one fact every optional native
// bridge loader (`@gjsify/terminal-native`, `tls-native`, `http2-native`,
// `http-soup-bridge`) can rely on, made true inside the running process.
//
// A prebuild ships `<Ns>-<v>.typelib` and its library side by side, and the
// typelib names that library by bare leaf. girepository finds the TYPELIB via
// `GI_TYPELIB_PATH` but the LIBRARY via its own library path, then the host
// loader's (`DYLD_*` / `LD_LIBRARY_PATH`). On macOS with SIP on — every stock Mac;
// CI runners have it off — `/bin/sh` strips every `DYLD_*` variable and keeps
// `GI_TYPELIB_PATH`, so any GJS process started through a shell (each clause of
// `gjsify run a && gjsify run b`) finds the typelib and cannot open the library:
// every class access then throws the nameless "Unsupported type void, deriving
// from fundamental void". The typelib's location is the one fact that survives
// the shell, so it names the library directory — the in-process repair ADR 0021
// applies to the CLI's engines, keyed here by the namespace instead of a
// node_modules sweep.

/** The girepository calls {@link colocateNativeLibrary} makes. */
interface GiRepositoryView {
    get_typelib_path(namespace: string): string | null;
    prepend_library_path(directory: string): void;
}

/** Structural view of `imports.gi` — only the slot this module reads. */
export interface GiImportsView {
    readonly GIRepository?: { Repository?: { dup_default?: () => GiRepositoryView | null } };
}

/**
 * Put the directory `namespace`'s typelib was loaded from on girepository's
 * library path.
 *
 * Call it AFTER resolving the namespace (`imports.gi.<Ns>` or a `gi://` import —
 * that loads the typelib only) and BEFORE the first class or function access,
 * which is what opens the library. Prepending a directory that already resolves
 * changes nothing, so no caller has to know whether the environment was intact.
 *
 * Capability-probed rather than assumed: `dup_default()` is GLib >= 2.86, and an
 * older host keeps the environment-only behaviour. Never throws.
 *
 * @param gi the `imports.gi` to use — defaults to the running GJS host's; a
 *   parameter so the spec can drive every branch with a stub
 * @returns whether a directory was prepended
 */
export function colocateNativeLibrary(
    namespace: string,
    gi: GiImportsView | undefined = (globalThis as { imports?: { gi?: GiImportsView } }).imports?.gi,
): boolean {
    try {
        const repository = gi?.GIRepository?.Repository?.dup_default?.();
        const typelib = repository?.get_typelib_path(namespace);
        // Both separators: the path is the HOST's, and on win32 it uses `\`.
        const dir = typelib ? /^(.*)[\\/][^\\/]*$/.exec(typelib)?.[1] : undefined;
        if (!repository || !dir) return false;
        repository.prepend_library_path(dir);
        return true;
    } catch {
        // `imports.gi.GIRepository` LOADS a namespace, and distributions ship that
        // typelib apart from the girepository library GJS links against (Debian's
        // `gir1.2-girepository-3.0` vs `libgirepository-2.0-0`): the environment
        // is all there is, exactly as before this helper existed.
        return false;
    }
}
