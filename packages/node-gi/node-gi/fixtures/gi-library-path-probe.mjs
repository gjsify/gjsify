// SPDX-License-Identifier: MIT
// Child half of `test/gi-library-path-loads.test.mjs` — reports WHICH FILE the
// dynamic loader actually opened for a typelib's bare-leaf backer.
//
// A child, because `activateGiLibraryPath()` runs once per process at import time
// and reads `GJSIFY_GI_LIBRARY_PATH` there; the variable cannot be varied twice in
// one process. `process.report` is the measurement: on linux it reads
// `/proc/self/maps`, on darwin `_dyld_get_image_name()` — the loader's own answer,
// not ours. Prints one JSON line: `{ loaded: string[], registered: boolean }`, or
// `{ skip }` when the namespace is unavailable at all.
import { basename } from 'node:path';
import { requireGi } from '../gi.js';

// GdkPixbuf, not Gtk: it is display-free, in its own package on every platform
// (its own Homebrew formula, its own Fedora RPM), and — unlike GLib/GObject/Gio —
// its library is NOT already in the addon's link closure, so the file the loader
// opens for it is a real, observable decision rather than a lookup that was
// settled before this process ran a line of JS.
const LIBRARY_PREFIX = 'libgdk_pixbuf';

let GObject;
let GdkPixbuf;
try {
    GObject = requireGi('GObject', '2.0');
    GdkPixbuf = requireGi('GdkPixbuf', '2.0');
} catch (err) {
    console.log(JSON.stringify({ skip: `GdkPixbuf-2.0 unavailable: ${err.message}` }));
    process.exit(0);
}

// registerClass resolves the parent's `get_type()`, which is what makes GI
// `g_module_open` the typelib's shared library. Without it the typelib can be
// resolved and the library never opened.
let registered = false;
try {
    GObject.registerClass({ GTypeName: 'NodeGiLibPathProbe' }, class NodeGiLibPathProbe extends GdkPixbuf.Pixbuf {});
    registered = GObject.type_from_name('NodeGiLibPathProbe') !== null;
} catch {
    registered = false;
}

const loaded = process.report.getReport().sharedObjects.filter((p) => basename(p).startsWith(LIBRARY_PREFIX));
console.log(JSON.stringify({ loaded, registered }));
