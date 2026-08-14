// Tell GI where a bundle's own typelibs and their backing libraries are — from
// INSIDE the process, so a `--app gjs` bundle needs no launcher and no environment.
// Why it exists, what it does NOT cover (a dylib reached through another dylib's
// link closure never passes through GI, so only `@rpath`/`$ORIGIN` reaches it) and
// the macOS measurements behind it: `status/open-todos.md` § "A globally installed
// GJS launcher still cannot load a system GTK on macOS", ADR 0023 § 4.

/**
 * The byte-1 prologue that prepends `dirs` to the default repository's typelib
 * search path and library path. Empty list → `''`: a no-op prologue in every
 * bundle is a guard that can never fire, and a banner that is not there cannot
 * drift.
 *
 * @param dirs directories RELATIVE to the program's own directory, `/`-separated —
 *   an absolute path baked at build time is the BUILD machine's
 */
export function giRuntimePathsStub(dirs: readonly string[]): string {
    if (dirs.length === 0) return '';
    const list = dirs.map((d) => JSON.stringify(d)).join(',');
    // Four rules, each pinned with its incident by `gi-runtime-paths-banner.spec.ts`:
    // every ambient global through `globalThis.` (a bare `imports` at byte 1 binds to
    // a bundled module's own top-level `const imports`, still in its TDZ); guarded
    // probes, not try/catch (no call here has a throw path, so a catch would hide a
    // real absence); one line (the banner precedes source-map-aware machinery); both
    // prepends (search path alone finds the typelib, then fails the dlopen).
    return (
        `(function(){var i=globalThis.imports;if(!i||!i.gi||!i.system)return;` +
        `var R=i.gi.GIRepository;if(!R||!R.Repository||!R.Repository.dup_default)return;` +
        `var r=R.Repository.dup_default();if(!r||!r.prepend_search_path||!r.prepend_library_path)return;` +
        `var p=i.system.programPath||i.system.programInvocationName||'';` +
        // Both separators: the program path is the HOST's, and on win32 a `/`-only
        // cut matches nothing (same rule as `lastPathSeparatorIndex`, #1143).
        `var m=/^(.*)[\\/\\\\][^\\/\\\\]*$/.exec(p);if(!m)return;` +
        // Absolute stays absolute: joining a system libdir under the program dir names nothing.
        `var b=m[1];for(var d of [${list}]){var f=/^([A-Za-z]:[\\/\\\\]|[\\/\\\\])/.test(d)?d:b+'/'+d;` +
        `r.prepend_search_path(f);r.prepend_library_path(f)}` +
        `})();`
    );
}
