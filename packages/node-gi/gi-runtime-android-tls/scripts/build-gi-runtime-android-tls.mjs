// SPDX-License-Identifier: MIT
// Builds @gjsify/gi-runtime-android-tls's AAR: glib-networking's OpenSSL GIO module and the
// OpenSSL it links, minus everything the core already ships. Same builder as the core and the
// GTK add-on, so the pin, the licence table and the closure rules stay one truth.
//
// The add-on selects no GI namespace — Gio is the core's. Its payload enters the closure walk
// only through `gioModules`: the sysroot's `lib/<abi>/gio/modules`, which nothing links.
import { run } from '../../gi-runtime-android/scripts/build-gi-runtime-android.mjs';

run({
    pkgDir: new URL('..', import.meta.url).pathname,
    addOn: {
        namespaces: [],
        gioModules: true,
        aarName: 'gi-runtime-android-tls.aar',
        manifestName: 'gi-runtime-tls.json',
        aarPackage: 'studio.artandcode.gjsify.gi_runtime_tls',
        coreName: '@gjsify/gi-runtime-android',
    },
});
