// SPDX-License-Identifier: MIT
// Build @gjsify/gi-runtime-android-gtk's payload: the GTK 4 / libadwaita / Pango / Graphene
// libraries and typelibs that @gjsify/gi-runtime-android does not carry (ADR 0117 § 1).
//
// This is the core's builder with the add-on switch on, not a second builder: the closure
// walk, the typelib gate, the notice and the AAR writer are all in
// ../../gi-runtime-android/scripts/build-gi-runtime-android.mjs, so the two packages cannot
// disagree about what "the closure" means. Same flags; `--help` lists them.
import { run } from '../../gi-runtime-android/scripts/build-gi-runtime-android.mjs';

/** Namespaces this add-on exists to provide. Resolved against the sysroot's typelibs. */
export const NAMESPACES = [
    'Gtk',
    'Adw',
    'Gdk',
    'Gsk',
    'Pango',
    'PangoCairo',
    'HarfBuzz',
    'Graphene',
    'GdkPixbuf',
    'cairo',
];

run({
    pkgDir: new URL('..', import.meta.url).pathname,
    addOn: {
        namespaces: NAMESPACES,
        aarName: 'gi-runtime-android-gtk.aar',
        aarPackage: 'studio.artandcode.gjsify.gi_runtime_gtk',
        coreName: '@gjsify/gi-runtime-android',
    },
});
