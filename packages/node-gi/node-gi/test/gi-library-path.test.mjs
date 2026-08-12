// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `activateGiLibraryPath()`: telling GI where the shared library
// a typelib names by BARE LEAF actually is, without an environment variable.
//
// THE DEFECT UNDER TEST, measured on the macOS 15.7.9 x86_64 VM against the
// published 0.37.0. `maybeReexecForGtkRuntime()` repairs the loader path by
// re-execing with `DYLD_FALLBACK_LIBRARY_PATH` set — and that re-exec reconstructs
// a Node-shaped `execPath + execArgv + argv`, so it returns early on bun and deno.
// Those two got NO loader repair at all, and every GTK showcase died at the first
// widget in three ways that all point away from the loader:
//
//   node-gi: GtkWidget is not registered in this process's GObject type registry
//   TypeError: Adw.Application has no property 'application-id'
//   TypeError: Gtk.GLArea is not a subclassable GObject type
//
// `DYLD_PRINT_LIBRARIES=1` refuted the duplicate-GLib reading that first warning
// offers: exactly ONE GLib was loaded, and what failed was a `g_module_open` of
// `libgtk-4.1.dylib` that found nothing. A/B through the real teapot showcase on
// bun with every DYLD variable unset: 2 loader errors before, 0 after, plus
// `GtkWidget registered: true` and a constructed `Adw.Application` on bun AND deno.
//
// ASSERTED HERE is the platform-agnostic half — the DECISION: which directories
// are handed to GI, that they come from `gtkSource()` rather than a second
// opinion, the prepend ORDER, idempotence, and that an addon without the binding
// changes nothing. That GI then resolves the leaf is provable only on a real
// macOS host, and is what the A/B above did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateGiLibraryPath, resetGiLibraryPathForTests } from '../gtk-runtime.js';

/** An addon stub recording what the activation handed to GI. */
function recordingNative() {
    const calls = [];
    return { calls, prependLibraryPath: (p) => calls.push(p) };
}

test('an addon without the binding is left completely alone', () => {
    resetGiLibraryPathForTests();
    // Predates the binding — the env paths elsewhere in the module still cover
    // Node and win32, which is exactly the state before it existed.
    assert.deepEqual(activateGiLibraryPath({}), []);
    resetGiLibraryPathForTests();
    assert.deepEqual(activateGiLibraryPath(undefined), []);
});

test('it runs at most once', () => {
    resetGiLibraryPathForTests();
    const native = recordingNative();
    activateGiLibraryPath(native);
    const afterFirst = native.calls.length;
    // A second call must add nothing: index.js activates at import time, and a
    // consumer that calls it again would otherwise grow GI's search path per call.
    assert.deepEqual(activateGiLibraryPath(native), []);
    assert.equal(native.calls.length, afterFirst);
});

test('every directory it reports was actually handed to GI', () => {
    resetGiLibraryPathForTests();
    const native = recordingNative();
    const applied = activateGiLibraryPath(native);
    // The return value is the claim; `calls` is what happened. A drift between
    // them would make the linux no-op indistinguishable from a silent failure.
    assert.deepEqual([...native.calls].sort(), [...applied].sort());
    for (const dir of applied) assert.equal(typeof dir, 'string');
});

test('the reported order survives the prepend', () => {
    resetGiLibraryPathForTests();
    const native = recordingNative();
    const applied = activateGiLibraryPath(native);
    if (applied.length < 2) return; // linux, or a host with one GI libdir
    // LAST prepend wins, so the implementation walks in reverse; what GI ends up
    // searching first must still be `applied[0]`.
    assert.deepEqual([...native.calls].reverse(), applied);
});

test('on linux it asks GI for nothing', () => {
    // `ld.so`'s configured cache already resolves these leaves, which is why
    // `systemGiLibraryDirs()` is empty there — so this is a statement about the
    // LOADER, not a platform guard bolted onto the test.
    if (process.platform !== 'linux') return;
    resetGiLibraryPathForTests();
    const native = recordingNative();
    assert.deepEqual(activateGiLibraryPath(native), []);
    assert.deepEqual(native.calls, []);
});
