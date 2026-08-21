// SPDX-License-Identifier: MIT
// The GI runtime search-path prologue for `--app gjs` bundles: the only repair shape
// that survives macOS (a typelib names its library by bare leaf, and the link closure
// never passes through GI, so only `@rpath`/`$ORIGIN` reaches it). Measurements:
// `status/open-todos.md` § "A globally installed GJS launcher still cannot load a
// system GTK on macOS", ADR 0023 § 4.
//
// WHAT IT REACHES, MEASURED (gjs 1.88.1, linux; pinned by the `gi-runtime-prologue`
// e2e): a banner is the entry chunk's BODY and ESM evaluates imports first, so a
// STATIC `import … from 'gi://Ns'` has already loaded its typelib before this runs.
// What is left is what loads LATER — `await import('gi://Soup')` and the other
// optional namespaces. Reaching the static ones changes how a bundle acquires GI
// namespaces at all; that is an ADR, filed in the same entry.
//
// TWO KINDS OF DIRECTORY, split by WHOSE FACT each is. `dirs` describe the SHIPPED
// TREE, so they are baked, relative to the program. `systemProbes` describe the host
// that will RUN it, which the build machine cannot know — so the candidate travels
// and is dropped on the host when it names nothing.

/**
 * An absolute candidate library dir, the path that proves it IS one, and the path
 * that proves the running host is the PLATFORM the candidate belongs to.
 *
 * Both gates, because they answer different questions and only one of them travels
 * well. `/usr/local/lib` holding a `girepository-1.0/` says "a GI stack is installed
 * here"; it does NOT say "this host's loader needs help finding it" — on Linux
 * `ld.so`'s system-wide cache already resolves those leaves, and a `meson setup
 * --prefix=/usr/local` or jhbuild tree is a normal shape there. Prepending it anyway
 * puts a second GI stack ahead of the distro's for every bundle on that host, which
 * is the two-registries failure ADR 0023 § 4 / #910 describe. The bundle cannot ask
 * `process.platform` (it is platform-neutral JavaScript built on a machine that is
 * not the host), so the platform scope travels as a marker path too.
 */
export type GiSystemProbe = readonly [libDir: string, marker: string, hostMarker: string];

/**
 * The byte-1 prologue that prepends directories to the default repository's typelib
 * search path and library path. Nothing to prepend → `''`: a no-op prologue in every
 * bundle is a guard that can never fire, and a banner that is not there cannot drift.
 *
 * Prepending REVERSES a list, so both loops count down and the emitted order is the
 * order given. `systemProbes` are applied first and therefore end up BEHIND `dirs`:
 * ADR 0023's bundle-before-system precedence, which #910 paid for.
 *
 * @param dirs directories RELATIVE to the program's own directory, `/`-separated —
 *   an absolute path baked at build time is the BUILD machine's
 * @param systemProbes absolute directories prepended only where BOTH of a probe's
 *   marker paths exist on the RUNNING host; the markers are passed in so the
 *   `girepository-1.0` layout rule and the platform scope around it keep their single
 *   definition in the caller
 */
export function giRuntimePathsStub(dirs: readonly string[], systemProbes: readonly GiSystemProbe[] = []): string {
    if (dirs.length === 0 && systemProbes.length === 0) return '';
    const list = dirs.map((d) => JSON.stringify(d)).join(',');
    const probes = systemProbes.map((probe) => `[${probe.map((v) => JSON.stringify(v)).join(',')}]`).join(',');
    // Four rules, each pinned with its incident by `gi-runtime-paths-banner.spec.ts`:
    // every ambient global through `globalThis.` (a bare `imports` at byte 1 binds to a
    // bundled module's own top-level `const imports`, still in its TDZ); capability
    // guards rather than try/catch for every CALL, since none has a throw path in the
    // GIR; one line (the banner precedes source-map-aware machinery); both prepends
    // (search path alone finds the typelib, then fails the dlopen).
    //
    // The ONE try wraps a namespace LOAD, the only operation here that does throw:
    // distributions ship the GIRepository typelib separately from the girepository
    // library GJS links against (Debian's `gir1.2-girepository-3.0` vs
    // `libgirepository-2.0-0`), so a host with only the second raises "Typelib file
    // for namespace 'GIRepository' (any version) not found" — measured, and why
    // `activateNativePrebuilds()` wraps the same access. At byte 1 that throw takes
    // down a program that ran fine while this prologue was the empty string. Not
    // logged, for that function's reason: every outcome leaves the caller where it
    // was before the prologue existed, so no host is made worse.
    const head =
        `(function(){var i=globalThis.imports;if(!i||!i.gi)return;` +
        `var R;try{R=i.gi.GIRepository}catch(e){return}` +
        `if(!R||!R.Repository||!R.Repository.dup_default)return;` +
        `var r=R.Repository.dup_default();if(!r||!r.prepend_search_path||!r.prepend_library_path)return;` +
        `var a=function(f){r.prepend_search_path(f);r.prepend_library_path(f)};`;
    // GLib gets its own try for the same reason, separate so a host that cannot
    // introspect it still gets the relative half.
    //
    // The HOST marker is tested first and short-circuits: on a host the candidate does
    // not belong to, the whole table costs one `stat` per entry and changes nothing.
    const probeHalf =
        probes.length === 0
            ? ''
            : `var G;try{G=i.gi.GLib}catch(e){}` +
              `if(G&&G.file_test&&G.FileTest){var S=[${probes}];` +
              `for(var j=S.length;j--;)` +
              `if(G.file_test(S[j][2],G.FileTest.EXISTS)&&G.file_test(S[j][1],G.FileTest.IS_DIR))a(S[j][0])}`;
    // Guards rather than returns, so a program path with no separator (`gjs -c`) still
    // leaves the system half applied.
    const relativeHalf =
        list.length === 0
            ? ''
            : `var p=(i.system&&(i.system.programPath||i.system.programInvocationName))||'';` +
              // Both separators: the program path is the HOST's, and on win32 a `/`-only
              // cut matches nothing (same rule as `lastPathSeparatorIndex`, #1143).
              `var m=/^(.*)[\\/\\\\][^\\/\\\\]*$/.exec(p);if(m){var b=m[1];var D=[${list}];` +
              `for(var k=D.length;k--;){var d=D[k];` +
              // Absolute stays absolute: joining a system libdir under the program dir names nothing.
              `var q=/^([A-Za-z]:[\\/\\\\]|[\\/\\\\])/.test(d)?d:b+'/'+d;a(q)}}`;
    return `${head}${probeHalf}${relativeHalf}})();`;
}
