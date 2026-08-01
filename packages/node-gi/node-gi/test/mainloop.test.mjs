// SPDX-License-Identifier: MIT
// @gjsify/node-gi — mainloop bridge + boxed/struct (GMainLoop) tests.
//
// Proves the libuv↔GLib bridge: a blocking GLib main loop keeps Node's libuv
// timers (and I/O) alive, exactly as GJS runs the GLib loop as the process loop.
// Also exercises the boxed/struct slice the loop needs (GLib.MainLoop.new → a
// boxed handle → .run()/.quit() method routing, snake_case and camelCase).
//
// KNOWN LIMITATION (matches node-gtk #442/#121): promise continuations queued
// *before* a synchronous loop.run() do not drain while the loop blocks when the
// run() is itself nested inside another async callback scope (e.g. node:test, an
// await, a signal handler) — V8 refuses a nested microtask checkpoint, so the
// bridge's best-effort drain cannot run it. Timers/I/O scheduled synchronously
// before run(), and anything the loop itself dispatches, are unaffected. The L1
// fix (defer the blocking run to a macrotask when a microtask checkpoint is in
// progress) is tracked separately.
//
// Reference: refs/node-gtk src/loop.cc (romgrk and contributors, MIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

test('GLib.MainLoop.new returns a boxed handle, not a GObject', () => {
    const GLib = requireGi('GLib', '2.0');
    const loop = GLib.MainLoop.new(null, false);
    assert.equal(typeof loop, 'object');
    assert.equal(loop.is_running(), false); // boxed method routing
});

test('blocking GLib.MainLoop.run keeps a libuv timer firing', () => {
    const GLib = requireGi('GLib', '2.0');
    const loop = GLib.MainLoop.new(null, false);
    let fired = false;
    // Scheduled on libuv; without the bridge a blocking GLib loop would starve it
    // and run() would never return.
    setTimeout(() => {
        fired = true;
        loop.quit();
    }, 50);
    loop.run(); // blocks here until the timer above calls quit()
    assert.equal(fired, true);
});

test('new GLib.MainLoop(...) + camelCase aliases drive the same loop', () => {
    const GLib = requireGi('GLib', '2.0');
    // `new GLib.MainLoop(null, false)` maps to the `new` constructor.
    const loop = new GLib.MainLoop(null, false);
    assert.equal(loop.isRunning(), false); // camelCase alias for is_running()
    let fired = false;
    setTimeout(() => {
        fired = true;
        loop.quit();
    }, 10);
    loop.run();
    assert.equal(fired, true);
});
