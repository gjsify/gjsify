// SPDX-License-Identifier: MIT
// @gjsify/node-gi — closure / signal exception hardening (the #675 review nits).
//
// These guard the GLib/libuv main-loop liveness when a JS exception escapes a
// C-invoked GClosure (a signal handler / notify:: / idle / timeout). All cases are
// fully headless (GLib + Gio, no display) so they run on every CI leg.
//
// FIX B1 — g_syncEmitDepth conflated "an emitSignal() is on the stack" with "THIS
// dispatch is synchronous". A synchronous handler that re-enters the GLib loop (a
// nested loop.run()) would make a loop-dispatched signal that throws during the
// nested iteration look synchronous (depth > 0) → its exception was left pending →
// DrainMicrotasks early-returns → the pump wedges. The depth is now reset to 0
// across the loop-dispatch boundary (the idle/timeout/async trampoline), so loop-
// dispatched closures evaluate at depth 0 while the suspended outer emit() — resumed
// once the nested loop returns — still propagates its OWN handler's throw.
//
// FIX B2 — SurfacePendingException read ex.stack / coerced ex to a string, both of
// which can run user JS (a throwing `stack` getter / `toString`) and leave a NEW
// pending exception that the caller never cleared → the env stayed dirty → the next
// loop-dispatched callback was skipped (its arg-marshal bails on a pending
// exception) → wedge. SurfacePendingException now re-checks + clears at the end.
//
// Reference: refs/gjs closure marshalling (gjs_log_exception reports an uncaught
// signal-handler exception, never wedging the loop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

test('B1: a nested loop inside a synchronous emit — no wedge + the sync throw propagates', () => {
    const action = new Gio.SimpleAction({ name: 'closure-exc-b1', enabled: true });
    let notifyRan = false;

    // A loop-dispatched notify:: handler that throws. It fires inside the NESTED loop
    // below, while a synchronous emit() is suspended on the stack — the depth must
    // read 0 there so this throw is surfaced + cleared (not left pending → wedge).
    action.connect('notify::enabled', () => {
        notifyRan = true;
        throw new Error('boom: loop-dispatched notify during a nested iteration');
    });

    const cancellable = new Gio.Cancellable();
    cancellable.connect('cancelled', () => {
        const nested = GLib.MainLoop.new(null, false);
        // A timeout (loop-dispatched via the trampoline) flips :enabled → emits the
        // throwing notify, then quits the nested loop.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
            action.set_enabled(false);
            nested.quit();
            return GLib.SOURCE_REMOVE;
        });
        // Backstop so a regression cannot hang the nested loop forever.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            nested.quit();
            return GLib.SOURCE_REMOVE;
        });
        nested.run(); // returns cleanly — the loop work left no exception pending
        // The synchronous handler now throws its OWN error; the depth was restored to
        // > 0 once the nested loop returned, so it MUST propagate to emit() below.
        throw new Error('boom: the synchronous handler');
    });

    assert.throws(
        () => cancellable.emit('cancelled'),
        /boom: the synchronous handler/,
        'the synchronous handler throw propagates out of emit()',
    );
    assert.equal(notifyRan, true, 'the loop-dispatched notify fired inside the nested iteration');

    // After the wedge-prone sequence, a fresh loop must still dispatch a timeout.
    const after = GLib.MainLoop.new(null, false);
    let laterFired = false;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
        laterFired = true;
        after.quit();
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        after.quit();
        return GLib.SOURCE_REMOVE;
    });
    after.run();
    assert.equal(laterFired, true, 'the loop survived → a later timeout still fired (no wedge)');
});

test('B2: a thrown error with a throwing `stack` getter does not wedge the loop', () => {
    const loop = GLib.MainLoop.new(null, false);
    let laterFired = false;

    // A timeout that throws an object whose `stack` getter ALSO throws. The
    // trampoline surfaces it via SurfacePendingException, which reads `.stack` →
    // re-throws → a NEW pending exception. Without the end-of-function re-clear that
    // would linger and skip the next callback (its arg-marshal bails on a pending
    // exception) → the loop never reaches `laterFired`.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
        const err = { message: 'b2-thrown' };
        Object.defineProperty(err, 'stack', {
            get() {
                throw new Error('boom: throwing stack getter');
            },
        });
        throw err;
    });

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
        laterFired = true;
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    // Backstop: a regression that wedges the loop hits this cap instead of hanging.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });

    loop.run();
    assert.equal(laterFired, true, 'the loop survived a handler whose error has a throwing stack getter');
});
