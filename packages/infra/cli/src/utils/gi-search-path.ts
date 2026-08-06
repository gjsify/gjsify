// Make the native prebuilds this process can see resolvable to the RUNNING GJS
// process, with nothing exported into the environment beforehand. ADR 0021.
//
// THE MEASUREMENT (gjs 1.88.1 / GLib 2.88.3, importing `gi://GjsifyRolldown`
// from a bare `gjs -m`) — there are TWO lookups, not one, and they fail
// differently:
//
//   neither var       "Typelib file for namespace 'GjsifyRolldown' (any
//                      version) not found"
//   GI_TYPELIB_PATH   "Failed to load shared library 'libgjsifyrolldown.so'
//     only             referenced by the typelib" — reaching JS as the nameless
//                      "Unsupported type void, deriving from fundamental void"
//   both              loads
//
// The received answer was "the typelib lookup happens inside the GJS runtime,
// so those must be set BEFORE the process starts — the CLI cannot repair it
// from the inside". Half of that is permanently true: `LD_LIBRARY_PATH` cannot
// be changed in-process because ld.so freezes its search path at startup, which
// is an OS property and is why the `gjsify` launcher still exists for user
// bundles.
//
// It is the wrong frame, because girepository delegates NEITHER lookup to the
// loader's environment. It keeps a typelib search path AND a library search
// path of its own, consults both before falling back to the system loader, and
// both are writable at runtime. `prepend_library_path()` is the half nobody
// went looking for: `LD_LIBRARY_PATH` was assumed to BE the mechanism when it
// is only girepository's fallback — which is exactly what the middle row above
// proves, since girepository's own library path starts empty and no environment
// variable seeds it.
//
// NOT an rpath problem, and the rpath is not the fix. `libgjsifyrolldown.so`
// already carries `RUNPATH=$ORIGIN` (every bridge's `meson.build` sets it so
// the Vala library finds the Rust cdylib shipped beside it — on macOS nothing
// sets `DYLD_LIBRARY_PATH`, so it is the only thing that does). It structurally
// cannot help gjs FIND `libgjsifyrolldown.so` itself: the typelib names it by
// bare SONAME, and `dlopen()` of a bare name searches the RPATH/RUNPATH of the
// CALLING object — libgirepository, whose `$ORIGIN` is /usr/lib64. An rpath on
// the callee is never consulted to find the callee, so no artifact changes.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectNativePackages, type NativePackage } from './detect-native-packages.js';

/** The two girepository search paths a prebuild directory has to be on. */
interface GiRepository {
    prepend_search_path(directory: string): void;
    prepend_library_path(directory: string): void;
}

/**
 * girepository's process-global default repository — the one GJS's own `gi://`
 * importer resolves against — or `null` when there is none to write to.
 *
 * `globalThis.imports?.gi` is both the GJS probe (`.oxlintrc.json` sanctions
 * exactly this spelling for a runtime probe) and the correct CONDITION, which
 * is why there is no `isGjs()` beside it: the question is "is there a
 * GIRepository to prepend to", and a Node host answers no all by itself. That
 * is the required no-op — on Node the CLI uses the npm `rolldown` crate and
 * never wants a prebuild.
 *
 * `dup_default()` is GLib >= 2.86. A capability probe rather than a try/catch
 * because this is a KNOWN host property with a defined answer, not an
 * exceptional one: an older GLib simply keeps today's behaviour (the launcher's
 * environment, or an unchanged diagnosis), so the change cannot make any host
 * worse than it is.
 */
function defaultRepository(): GiRepository | null {
    const gi = (
        globalThis as unknown as {
            imports?: { gi?: { GIRepository?: { Repository?: { dup_default?: () => GiRepository } } } };
        }
    ).imports?.gi;
    const repository = gi?.GIRepository?.Repository;
    if (typeof repository?.dup_default !== 'function') return null;
    return repository.dup_default();
}

let activated: readonly NativePackage[] | null = null;

/**
 * Put every detected prebuild directory on girepository's typelib AND library
 * search paths. Idempotent — the first call decides, later ones return it.
 *
 * This is THE LAUNCHER'S ENVIRONMENT, APPLIED TO THE PROCESS THAT IS ALREADY
 * RUNNING: it feeds on the same `detectNativePackages()` whose output the
 * `gjsify` bin turns into `GI_TYPELIB_PATH` + the host library-path variable
 * (`buildNativeEnv`), so the two mechanisms cannot resolve different sets. That
 * symmetry is also why this is not per-bridge: there is no list of covered
 * engines to maintain, and a bridge added later is covered without touching
 * this file. Today it covers all three the CLI loads in-process —
 * `rolldown-native`, `lightningcss-native` (via the `css-as-string` plugin) and
 * `oxfmt-native`.
 *
 * TWO ANCHORS, merged first-wins exactly as `computeNativeEnvForBundle()` does
 * it: the cwd, and the directory this module itself lives in. The second is not
 * redundant — with a GLOBAL CLI the engine sits next to the bundle while the cwd
 * is an unrelated project, which is the same case `tryLoadNative()` documents
 * needing its `bundleUrl` anchor for. After bundling, every CLI module collapses
 * into `dist/cli.gjs.mjs`, so `import.meta.url` is the bundle's own URL, which
 * is precisely the "where does the CLI live" question being asked.
 *
 * Called from the native-load paths, which are themselves memoized, so the
 * node_modules sweep (~65 ms per anchor on this 960-workspace tree, far less in
 * a consumer) is paid at most once per process and only by a command that
 * actually wants an engine. Deliberately NOT skipped when the launcher already
 * exported the same directories: that check can be wrong, prepending a
 * directory that already resolves changes nothing, and a guard whose job is
 * watching another mechanism is the shape `docs/governance.md` § simplicity
 * warns about.
 *
 * @returns the packages activated — empty when there is no repository to write
 *   to (Node, or GLib < 2.86), which every caller reads as "carry on".
 */
export function activateNativePrebuilds(): readonly NativePackage[] {
    if (activated) return activated;
    // Memoized BEFORE the work, so every outcome — including a throw — is
    // decided once and every later caller gets an answer instead of a repeat
    // attempt. `diagnoseNativeEngine()` depends on exactly that: it documents
    // that nothing it calls may throw while explaining a failure.
    activated = [];

    try {
        const repository = defaultRepository();
        if (!repository) return activated;

        const cwdPackages = detectNativePackages(process.cwd());
        const seen = new Set(cwdPackages.map((p) => p.name));
        const selfPackages = detectNativePackages(dirname(fileURLToPath(import.meta.url)));
        const packages = [...cwdPackages, ...selfPackages.filter((p) => !seen.has(p.name))];

        for (const pkg of packages) {
            repository.prepend_search_path(pkg.prebuildsDir);
            repository.prepend_library_path(pkg.prebuildsDir);
        }
        activated = packages;
    } catch {
        // TWO REAL THROW PATHS, named because a catch without one is the
        // anti-pattern this repo measures:
        //
        //   1. `imports.gi.GIRepository` LOADS the namespace. GJS raises
        //      "Requiring GIRepository, version none: Typelib file for namespace
        //      'GIRepository' (any version) not found" when that typelib is
        //      absent — verified by probe. It is a SEPARATE FILE from the
        //      girepository library GJS links against, and distributions split
        //      them (Debian ships `gir1.2-girepository-3.0` apart from
        //      `libgirepository-2.0-0`), so a lean host can have the second
        //      without the first.
        //   2. The two `detectNativePackages()` walks are filesystem I/O and can
        //      raise (EACCES on an unreadable node_modules, a dir removed
        //      mid-walk).
        //
        // Both mean the same thing — no activation — and swallowing is the
        // CORRECT handling rather than a hidden failure: the caller ends up
        // exactly where it was before this function existed (the launcher's
        // environment, and the unchanged diagnosis if that is absent too), so
        // no host can be made worse by it.
    }
    return activated;
}
