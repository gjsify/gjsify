// SPDX-License-Identifier: MIT
// WHAT a `--app gjs` bundle's byte-1 GI prologue is told. The prologue itself is
// `rolldown-plugin-gjsify`'s `giRuntimePathsStub`; this is the only production caller
// that fills it, and until it did, every bundle carried the empty string that stub
// returns for nothing-to-say.
//
// WHY A BUNDLE NEEDS IT. On macOS a typelib names its library by bare leaf
// (`libgtk-4.1.dylib`), and SIP strips an inherited `DYLD_*` at the `/bin/sh` exec a
// launcher goes through, so the only repair that survives is one the process makes to
// girepository's own search paths from the inside. Measurements, and what this reaches
// (loads AFTER module evaluation starts, not a static `gi://` import):
// `status/open-todos.md` § "A globally installed GJS launcher still cannot load a
// system GTK on macOS".
//
// A SHIPPED BUNDLE RUNS ON A MACHINE THE BUILD NEVER SAW, which rules out both
// tempting sources. `systemGiLibraryDirs()` MEASURES the build host and answers `[]`
// on the Linux runner that builds most releases — so what travels is the CANDIDATE
// table it probes, with the probe moved into the bundle. `detectNativePackages()`
// answers with the build tree's `node_modules/@gjsify/<pkg>-<target>/prebuilds/
// <target>`: the build host's target twice over (ADR 0017), at the build tree's depth,
// so it names nothing on an installed macOS host — and baking it would make
// `dist/affected.gjs.mjs`, a `--app gjs` bundle `scripts/verify-committed-bundles.mjs`
// compares byte for byte, encode which platform siblings the committing machine had.
// `activateNativePrebuilds()` already covers those from inside the running process.
//
// DELIBERATELY NOT INCLUDED: a `@gjsify/gtk-runtime-<target>` bundle's `gtk/lib`. That
// is node-gi's mechanism, for a host process that brings no GTK of its own; a `--app
// gjs` bundle runs under a `gjs` already linked against a system GLib, so a second GTK
// stack in that process is the two-registries failure #910 paid for (ADR 0023 § 4).

import type { GiSystemProbe } from '@gjsify/rolldown-plugin-gjsify';

import { PROBED_GI_LIBDIRS, TYPELIB_SUBDIR } from './system-gi.js';

/**
 * A path that proves the RUNNING host is the platform whose candidates it keys, for
 * every platform `PROBED_GI_LIBDIRS` names.
 *
 * The bundle cannot read `process.platform` — it is platform-neutral JavaScript, built
 * on a machine that is not the host — so the darwin scope `systemGiLibraryDirs()`
 * enforces with `PROBED_GI_LIBDIRS[platform]` has to travel as a marker path.
 * Same probe, same spelling as `@gjsify/child_process`'s `detectPlatform()` and
 * `@gjsify/v8`'s `detectHeapPlatform()`: macOS has no procfs, and this plist is
 * present on every install.
 */
const HOST_MARKERS: Record<string, string> = {
    darwin: '/System/Library/CoreServices/SystemVersion.plist',
};

/**
 * The system libdir candidates a `--app gjs` bundle carries — every platform the
 * table names, not the building host's.
 *
 * A build-time platform gate would be exactly the snapshot the note above exists to
 * avoid: `--app gjs` emits platform-neutral JavaScript, so the bundle a Linux runner
 * produces is the bundle a Mac runs. What travels instead is the RUNTIME gate, and it
 * is two markers, not one, because the `girepository-1.0` marker alone answers the
 * wrong question. It says "a GI stack is installed under this prefix" — true on a
 * Linux box built with `meson setup --prefix=/usr/local` or jhbuild, a normal shape
 * for this project's own audience — while the rule this mirrors is about LOADERS:
 * `systemGiLibraryDirs()` is empty off darwin because `ld.so`'s system-wide cache
 * already resolves these leaves. Without the host marker every such Linux host would
 * get `/usr/local/lib` prepended ahead of the distro's typelibs AND libraries, which
 * is the two-stacks precedence ADR 0023 § 4 / #910 paid for — measured against a
 * stand-in host in `gi-runtime-paths-banner.spec.ts`.
 *
 * A platform in the table with no {@link HOST_MARKERS} entry THROWS rather than
 * shipping an ungated candidate: an unknown-host default of "prepend" is the bug
 * above, on every platform at once.
 *
 * SORTED and deduplicated: the result is emitted into a bundle two machines must be
 * able to build byte-for-byte identically, and `Object.entries()` order is the
 * table's, which is a source-edit away from changing.
 */
export function giSystemProbes(): GiSystemProbe[] {
    const probes = new Map<string, GiSystemProbe>();
    for (const [platform, dirs] of Object.entries(PROBED_GI_LIBDIRS)) {
        const hostMarker = HOST_MARKERS[platform];
        if (!hostMarker) {
            throw new Error(
                `[gjsify] PROBED_GI_LIBDIRS names '${platform}' but HOST_MARKERS does not: ` +
                    'a bundle cannot ask process.platform, so an ungated candidate would be ' +
                    'prepended on every host that happens to have the directory.',
            );
        }
        for (const dir of dirs) {
            probes.set(`${dir}\u0000${hostMarker}`, [dir, `${dir}/${TYPELIB_SUBDIR}`, hostMarker]);
        }
    }
    return [...probes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, probe]) => probe);
}
