// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `activateGiLibraryPath()`: telling GI where the shared library
// a typelib names by BARE LEAF actually is, without an environment variable.
//
// THE DEFECT UNDER TEST, measured on the macOS 15.7.9 x86_64 VM against 0.37.0.
// `maybeReexecForGtkRuntime()` repairs the loader path by re-execing with
// `DYLD_FALLBACK_LIBRARY_PATH` set, and that re-exec reconstructs a Node-shaped
// argv — so it returns early on bun and deno, which got no repair at all and died
// at the first widget with `GtkWidget is not registered in this process's GObject
// type registry`, `Adw.Application has no property 'application-id'` and
// `Gtk.GLArea is not a subclassable GObject type`. `DYLD_PRINT_LIBRARIES=1`
// refuted the duplicate-GLib reading the first one offers: ONE GLib was loaded,
// and what failed was a `g_module_open` of `libgtk-4.1.dylib`. A/B on the real
// teapot showcase with every DYLD variable unset: 2 loader errors before, 0 after.
//
// ASSERTED HERE is the platform-agnostic half — the DECISION: which directories
// go to GI, that they come from `gtkSource()` rather than a second opinion, the
// prepend ORDER, idempotence, and the older-addon no-op. That GI then resolves the
// leaf is provable only on a real macOS host, which is what the A/B did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateGiLibraryPath, appGiLibraryDirs, resetGiLibraryPathForTests } from '../gtk-runtime.js';

/** An addon stub recording what the activation handed to GI. */
function recordingNative() {
    const calls = [];
    return { calls, prependLibraryPath: (p) => calls.push(p) };
}

/** Run `body` with `GJSIFY_GI_LIBRARY_PATH` set to `value`, then restore it. */
function withAppLibraryPath(value, body) {
    const before = process.env.GJSIFY_GI_LIBRARY_PATH;
    if (value === undefined) delete process.env.GJSIFY_GI_LIBRARY_PATH;
    else process.env.GJSIFY_GI_LIBRARY_PATH = value;
    try {
        return body();
    } finally {
        if (before === undefined) delete process.env.GJSIFY_GI_LIBRARY_PATH;
        else process.env.GJSIFY_GI_LIBRARY_PATH = before;
    }
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

// ---------------------------------------------------------------------------
// GJSIFY_GI_LIBRARY_PATH — where an APPLICATION carries its OWN GI libraries.
//
// A shipped app stages its typelib and that typelib's backer into ONE directory
// and points `GI_TYPELIB_PATH` there, so GI resolves the typelib and then
// `g_module_open`s a bare leaf nothing has located. The launcher's
// `LD_LIBRARY_PATH` covers that on linux; on macOS nothing can, because dyld
// strips every `DYLD_*` from a signed, hardened process. Neither the GTK dirs the
// block above asserts nor `systemGiLibraryDirs()` cover it — the full record is in
// `gtk-runtime.js` and docs/node-gi-platform-notes.md.

test('the app dirs reach GI, ahead of whatever the policy found', () => {
    resetGiLibraryPathForTests();
    const native = recordingNative();
    const applied = withAppLibraryPath('/opt/MyApp/gi:/opt/MyApp/extra', () => activateGiLibraryPath(native));
    assert.deepEqual(applied.slice(0, 2), ['/opt/MyApp/gi', '/opt/MyApp/extra']);
    // Same claim at the call level: prepend is LAST-wins, so GI's first entry is
    // the addon's last call.
    assert.deepEqual([...native.calls].reverse().slice(0, 2), ['/opt/MyApp/gi', '/opt/MyApp/extra']);
});

test('the CONTROL: with the variable unset, those dirs are absent', () => {
    // Without this, an empty result is indistinguishable between "the app supplied
    // nothing" and "the app supplied dirs that were silently discarded" — the
    // ambiguity that lets a wired-up-looking fix ship doing nothing. Run against the
    // SAME host state as the test above, so the only difference is the variable.
    resetGiLibraryPathForTests();
    const withVar = withAppLibraryPath('/opt/MyApp/gi', () => activateGiLibraryPath(recordingNative()));
    resetGiLibraryPathForTests();
    const withoutVar = withAppLibraryPath(undefined, () => activateGiLibraryPath(recordingNative()));
    assert.ok(withVar.includes('/opt/MyApp/gi'), 'the variable must add its dir');
    assert.ok(!withoutVar.includes('/opt/MyApp/gi'), 'and nothing else may invent it');
    assert.deepEqual(withVar.slice(1), withoutVar, 'the policy dirs must be untouched by the variable');
});

test('a dir the policy already found is not prepended twice', () => {
    resetGiLibraryPathForTests();
    const policy = activateGiLibraryPath(recordingNative());
    if (policy.length === 0) return; // linux: no policy dirs to collide with
    resetGiLibraryPathForTests();
    const native = recordingNative();
    const applied = withAppLibraryPath(policy[0], () => activateGiLibraryPath(native));
    assert.deepEqual(applied, policy, "a duplicate must collapse, not grow GI's search path");
    assert.equal(native.calls.length, policy.length);
});

test('the separator is the OS search-path separator', () => {
    const env = { GJSIFY_GI_LIBRARY_PATH: 'C:\\App\\gi;C:\\App\\extra' };
    assert.deepEqual(appGiLibraryDirs({ platform: 'win32', env }), ['C:\\App\\gi', 'C:\\App\\extra']);
    // `:` on win32 would split a drive letter off its path, which is why the
    // dialect is a parameter rather than a constant.
    assert.deepEqual(appGiLibraryDirs({ platform: 'linux', env: { GJSIFY_GI_LIBRARY_PATH: '/a:/b' } }), ['/a', '/b']);
    assert.deepEqual(appGiLibraryDirs({ platform: 'darwin', env: {} }), []);
});

test('relative entries are dropped, empties too, duplicates collapse', () => {
    // A relative entry resolves against the process working directory — `/` for a
    // double-clicked `.app`. That is the trailing-colon bug the ship launcher
    // already refuses to emit, and it must not arrive through this door instead.
    const env = { GJSIFY_GI_LIBRARY_PATH: '/abs:rel:./also-rel::/abs' };
    assert.deepEqual(appGiLibraryDirs({ platform: 'linux', env }), ['/abs']);
});
