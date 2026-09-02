// Make the native prebuilds this process can see resolvable to the RUNNING GJS
// process, with nothing exported into the environment beforehand. ADR 0021.
//
// There are TWO lookups, not one, and they fail differently (measured on gjs
// 1.88.1 / GLib 2.88.3, importing `gi://GjsifyRolldown` from a bare `gjs -m`):
//
//   neither var       "Typelib file for namespace 'GjsifyRolldown' (any
//                      version) not found"
//   GI_TYPELIB_PATH   "Failed to load shared library 'libgjsifyrolldown.so'
//     only             referenced by the typelib" — reaching JS as the nameless
//                      "Unsupported type void, deriving from fundamental void"
//   both              loads
//
// girepository delegates NEITHER lookup to the loader's environment: it keeps a
// typelib search path AND a library search path of its own, consults both before
// falling back to the system loader, and both are writable at runtime.
// `LD_LIBRARY_PATH` is only girepository's fallback — which the middle row above
// proves, since girepository's own library path starts empty and no environment
// variable seeds it. That variable genuinely cannot be changed in-process (ld.so
// freezes its search path at startup), which is why the `gjsify` launcher still
// exists for user bundles — but it is not this lookup's mechanism.
//
// NOT an rpath problem, and the rpath is not the fix. `libgjsifyrolldown.so` already
// carries `RUNPATH=$ORIGIN` (every bridge's `meson.build` sets it so the Vala library
// finds the Rust cdylib beside it). That structurally cannot help gjs FIND
// `libgjsifyrolldown.so` itself: the typelib names it by bare SONAME, and `dlopen()`
// of a bare name searches the RPATH/RUNPATH of the CALLING object — libgirepository,
// whose `$ORIGIN` is /usr/lib64. An rpath on the callee is never consulted to find
// the callee, so no artifact changes.

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
 * `globalThis.imports?.gi` is both the sanctioned GJS probe spelling
 * (`.oxlintrc.json`) and the correct CONDITION, so no `isGjs()` beside it: the
 * question is "is there a GIRepository to prepend to", and a plain Node process has
 * none — nothing here to write to, which is the required no-op.
 *
 * NOT because a Node host wants no prebuild. That justification stood here and is
 * false exactly where it matters: on darwin `@gjsify/webkit-native`'s prebuild is
 * the ONLY WebKit any host has (ADR 0022), and ADR 0024 § 4 puts macOS and Windows
 * applications on Node + node-gi. What is true is narrower — the CLI on Node uses
 * the npm `rolldown` crate — and generalising it to "a Node host never wants a
 * prebuild" is what kept every OTHER Node prebuild env-bound until
 * `@gjsify/node-gi`'s `native-prebuilds.js` (ADR 0021 § The Node host). The Node
 * host is covered THERE, in the package that owns a GIRepository, not here.
 *
 * `dup_default()` is GLib >= 2.86, probed as a capability rather than caught:
 * an older GLib simply keeps today's behaviour (the launcher's environment, or
 * an unchanged diagnosis), so no host can be made worse.
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
 * The launcher's environment applied to the already-running process: it feeds on
 * the same `detectNativePackages()` whose output the `gjsify` bin turns into
 * `GI_TYPELIB_PATH` + the host library-path variable (`buildNativeEnv`), so the two
 * mechanisms cannot resolve different sets and a bridge added later needs no change
 * here.
 *
 * TWO ANCHORS, merged first-wins as `computeNativeEnvForBundle()` does: the cwd, and
 * this module's own directory. The second is not redundant — with a GLOBAL CLI the
 * engine sits next to the bundle while the cwd is an unrelated project (the case
 * `tryLoadNative()` needs its `bundleUrl` anchor for), and after bundling
 * `import.meta.url` is the bundle's own URL.
 *
 * Callers are memoized, so the node_modules sweep (~65 ms per anchor on this
 * 960-workspace tree) is paid at most once per process, by a command that wants an
 * engine. Deliberately NOT skipped when the launcher already exported the same
 * directories: that check can be wrong, prepending an already-resolving directory
 * changes nothing, and a guard watching another mechanism is the shape
 * `docs/governance.md` § simplicity warns about.
 *
 * @returns the packages activated — empty when there is no repository to write
 *   to (Node, or GLib < 2.86), which every caller reads as "carry on".
 */
export function activateNativePrebuilds(): readonly NativePackage[] {
    if (activated) return activated;
    // Memoized BEFORE the work, so every outcome — including a throw — is decided
    // once. `diagnoseNativeEngine()` depends on that: nothing it calls may throw
    // while explaining a failure.
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
        // Two real throw paths:
        //   1. `imports.gi.GIRepository` LOADS the namespace, and that typelib is
        //      a SEPARATE FILE from the girepository library GJS links against —
        //      distributions split them (Debian's `gir1.2-girepository-3.0` vs
        //      `libgirepository-2.0-0`), so a lean host can have the second
        //      without the first and GJS raises "Typelib file for namespace
        //      'GIRepository' (any version) not found".
        //   2. The two `detectNativePackages()` walks are filesystem I/O (EACCES
        //      on an unreadable node_modules, a dir removed mid-walk).
        //
        // Both mean no activation, and swallowing leaves the caller exactly where
        // it was before this function existed (the launcher's environment, or the
        // unchanged diagnosis), so no host can be made worse by it.
    }
    return activated;
}
