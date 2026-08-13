// Tell GI where a bundle's own typelibs and their backing libraries are — from
// INSIDE the process, so a `--app gjs` bundle needs no launcher and no environment.
//
// WHAT THIS REPLACES
//
// `@gjsify/cli`'s launcher preamble globs `node_modules/**/prebuilds/<target>/` in
// SHELL and exports `GI_TYPELIB_PATH` + `LD_LIBRARY_PATH`/`DYLD_FALLBACK_LIBRARY_PATH`
// for the child. That works and costs a launcher: a bundle handed to a bare
// `gjs -m bundle.mjs` gets none of it, and on macOS dies at the first widget because
// gjs's own rpath points into glib's keg alone.
//
// MEASURED, not assumed (macOS 15.7.9 x86_64 VM + linux, gjs 1.88.1), under
// `env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`:
//
//   no prepend                    → Failed to load shared library 'libgtk-4.1.dylib'
//   prepend_search_path only      → typelib found, then the SAME dlopen failure
//   both prepends                 → OK gtype: GtkWidget
//
// So both calls are load-bearing and neither is redundant. This is the same repair
// `activateGiLibraryPath()` (#1132) makes in C for node-gi — `dup_default()` is its
// `DupDefaultRepository()` — reached from JS instead. Details + the remaining gap in
// `status/open-todos.md` § "A globally installed GJS launcher still cannot load a
// system GTK on macOS".
//
// WHAT IT DOES NOT COVER
//
// A library pulled in through ANOTHER library's link closure (`LC_LOAD_DYLIB` /
// `NEEDED`). The loader resolves those and GI never sees them, so only
// `@rpath`/`$ORIGIN` in the binaries reaches them (ADR 0023 § 4).
//
// WHY RELATIVE PATHS, RESOLVED AT RUNTIME
//
// A baked absolute path is the build machine's, so a shipped app would carry
// directories that do not exist on the user's disk. The dirs are therefore emitted
// relative to the PROGRAM, and joined against `system.programPath`'s directory when
// the bundle starts.

/**
 * The byte-1 prologue that prepends `dirs` to the default repository's typelib
 * search path and library path.
 *
 * Returns `''` for an empty list: emitting a no-op prologue would put a guard in
 * every bundle that can never do anything, and a banner that is not there cannot
 * drift.
 *
 * @param dirs directories RELATIVE to the program's own directory, `/`-separated
 */
export function giRuntimePathsStub(dirs: readonly string[]): string {
    if (dirs.length === 0) return '';
    const list = dirs.map((d) => JSON.stringify(d)).join(',');
    // Every ambient global goes through `globalThis.` — a BARE `imports` at byte 1
    // binds to any top-level `const imports` a bundled module declares, which is
    // still in its temporal dead zone there, and the bundle dies at load with
    // `ReferenceError: can't access lexical declaration 'imports'`. The generated
    // `@girs/gjs` shim declares exactly that, so this is not hypothetical —
    // `process-stub-banner.spec.ts` pins the same rule for the process stub.
    //
    // Guarded probes rather than try/catch: none of these calls has a throw path
    // (no `throws` in the GIR), so a catch here would have nothing to catch and
    // would hide a real absence instead. What IS genuinely optional is the API
    // itself — `Repository.dup_default` + the two prepends need GIRepository to be
    // introspectable, and a host without it must degrade to a no-op rather than
    // fail to start.
    //
    // Single line: the banner runs before any source-map-aware machinery, so a
    // newline here shifts every bundle line number by one.
    return (
        `(function(){var i=globalThis.imports;if(!i||!i.gi||!i.system)return;` +
        `var R=i.gi.GIRepository;if(!R||!R.Repository||!R.Repository.dup_default)return;` +
        `var r=R.Repository.dup_default();if(!r||!r.prepend_search_path||!r.prepend_library_path)return;` +
        `var p=i.system.programPath||i.system.programInvocationName||'';` +
        // Both separators, because the program path is the HOST's: on win32 it is
        // `C:\…\main.js`, where a `/`-only cut yields nothing and the join below
        // would silently produce a relative path. Same rule as
        // `@gjsify/utils/core`'s `lastPathSeparatorIndex` (#1143).
        `var m=/^(.*)[\\/\\\\][^\\/\\\\]*$/.exec(p);if(!m)return;` +
        `var b=m[1];for(var d of [${list}]){var f=b+'/'+d;r.prepend_search_path(f);r.prepend_library_path(f)}` +
        `})();`
    );
}
