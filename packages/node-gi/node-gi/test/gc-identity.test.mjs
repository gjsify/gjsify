// SPDX-License-Identifier: MIT
// GC + wrapper-identity tests for @gjsify/node-gi (the toggle-ref bridge).
//
// These exercise the load-bearing GC dance that normal CI never stresses:
//   * wrapper IDENTITY — the same GObject round-tripped through C yields the
//     SAME JS wrapper (=== and Map-key stable);
//   * COLLECTABILITY — a wrapper with no C owner is collected after GC;
//   * toggle-up ROOTING — a C-owned object keeps its wrapper (and JS-side
//     expando state) alive across GC;
//   * RESURRECTION — a collected-then-re-fetched object re-wraps safely;
//   * vfunc-INSTANCE integration (#647) — a vfunc's `this` is the construct
//     wrapper, so a field set in a vfunc is visible afterwards;
//   * SOAK — thousands of create/round-trip/GC cycles stay crash-free + bounded.
//
// Run with `node --test --expose-gc`. Without --expose-gc the gc-requiring
// cases self-skip (global.gc is undefined) so plain `node --test` stays green.
//
// Round-trip vehicle: Gio.SimpleActionGroup (a plain GObject, no display) —
// add_action(action) stores it C-side, lookup_action(name) hands the SAME
// GObject back. Pure GObject, headless. Reference: the toggle-ref design.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newObject, callMethod, isGObjectHandle, registerClass, constructType, requireNamespace } from '../index.js';
import { requireGi } from '../gi.js';

requireNamespace('Gio', '2.0');
requireNamespace('GObject', '2.0');

const hasGc = typeof globalThis.gc === 'function';
const gcOpts = hasGc ? {} : { skip: 'run with --expose-gc for the GC cases' };

// Force collection deterministically: a few gc() passes with a microtask/timer
// drain between them so N-API finalizers AND the GLib idle teardown queue run.
async function settle(passes = 4) {
    for (let i = 0; i < passes; i++) {
        globalThis.gc();
        await new Promise((r) => setImmediate(r));
        // Let any g_idle_add(teardown) drain on the GLib default context too.
        await new Promise((r) => setTimeout(r, 0));
    }
}

// ---- Case 1: identity (the headline) — L0 canonical handle ----
test('L0: same GObject round-tripped through C is the SAME handle (===)', () => {
    const group = newObject('Gio', 'SimpleActionGroup', {});
    const action = newObject('Gio', 'SimpleAction', { name: 'foo', enabled: true });
    callMethod(group, 'add_action', [action]);
    const back = callMethod(group, 'lookup_action', ['foo']);
    assert.equal(isGObjectHandle(back), true);
    assert.strictEqual(back, action, 'the round-tripped GObject must be the identical handle');
});

test('L0: a handle is stable as a Map key across a round-trip', () => {
    const group = newObject('Gio', 'SimpleActionGroup', {});
    const action = newObject('Gio', 'SimpleAction', { name: 'bar', enabled: false });
    const map = new Map();
    map.set(action, 'sentinel');
    callMethod(group, 'add_action', [action]);
    const back = callMethod(group, 'lookup_action', ['bar']);
    assert.equal(map.get(back), 'sentinel', 'the round-tripped handle must hit the same Map entry');
});

// ---- Case 1b: identity at L1 (the ergonomic proxy) ----
test('L1: same GObject round-tripped through C is the SAME proxy (===)', () => {
    const Gio = requireGi('Gio', '2.0');
    const group = new Gio.SimpleActionGroup();
    const action = new Gio.SimpleAction({ name: 'l1', enabled: true });
    group.add_action(action);
    const back = group.lookup_action('l1');
    assert.strictEqual(back, action, 'the round-tripped proxy must be the identical wrapper');
});

// ---- Case 2: plain collection (toggle-down → weak → collect) ----
test('plain collection: unowned wrappers are collected after GC', { ...gcOpts }, async () => {
    const reg = new FinalizationRegistry(() => {
        collected++;
    });
    let collected = 0;
    const N = 200;
    (() => {
        for (let i = 0; i < N; i++) {
            const a = newObject('Gio', 'SimpleAction', { name: 'tmp' + i, enabled: true });
            reg.register(a, i);
        }
    })();
    await settle();
    assert.ok(collected >= N * 0.8, `expected most of ${N} unowned wrappers collected, got ${collected}`);
});

// ---- Case 3: C-owned object survives GC, JS expando preserved (toggle-up) ----
test('toggle-up: a C-owned object keeps its wrapper + expando across GC', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    const group = new Gio.SimpleActionGroup();
    let collected = 0;
    const reg = new FinalizationRegistry(() => {
        collected++;
    });

    (() => {
        const action = new Gio.SimpleAction({ name: 'kept', enabled: true });
        action.__tag = 'survivor';
        reg.register(action, 'kept');
        group.add_action(action);
    })();

    await settle();
    assert.equal(collected, 0, 'a C-owned (rooted) wrapper must NOT be collected');
    const back = group.lookup_action('kept');
    assert.equal(back.__tag, 'survivor', 'JS expando state must survive GC while C owns the object');
});

// ---- Case 4: a C-owned wrapper is ROOTED, so it can never be resurrected ----
// This was called "resurrection: re-fetching a collected-wrapper object is safe"
// and measured none of that: add_action takes a C ref, the 1→2 refcount crossing
// toggles the wrapper UP, and a rooted wrapper is never collected — so the
// re-fetch was a live identity-cache hit, i.e. Case 3 again. The premise is
// UNREACHABLE, not merely untested: the binding holds exactly ONE toggle ref, so
// any C owner roots the wrapper, and a wrapper only goes weak when that toggle ref
// is the last one — at which point the teardown takes the GObject with it.
// Resurrection is therefore reachable ONLY through the pending-finalizer window,
// which is Case 4b. (Measured while landing #1475: handing this case a borrowed-
// pointer vehicle plus a full settle() segfaults in the TEST, because the drained
// teardown frees the object out from under g_cancellable_get_current.)
test('C-owned: the re-fetched wrapper is the LIVE one, never a resurrection', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    const group = new Gio.SimpleActionGroup();
    let weak;
    (() => {
        const a = new Gio.SimpleAction({ name: 'res', enabled: true });
        group.add_action(a);
        weak = new WeakRef(a);
    })();
    await settle();
    const back = group.lookup_action('res');
    assert.equal(back.name, 'res', 'the re-fetched wrapper is valid and usable');
    assert.strictEqual(back, weak.deref(), 'and is the SAME wrapper — rooted, never collected');
});

// ---- Case 4b: resurrection RACING the External's pending finalizer (#1475) ----
// An EMPTY napi_ref proves the wrapper was COLLECTED, not that its finalizer has
// RUN: V8 resets the weak persistent inside the first-pass weak callback (during
// gc()), and Node defers the finalizer to a SetImmediate. Resurrecting inside that
// window used to free the old wrapper record; the allocator handed the identical
// block straight to the fresh wrapper, and the stale finalizer then queued a
// teardown for the LIVE one — removing its toggle ref, freeing the GObject under a
// reachable JS wrapper, and double-freeing the record (STATUS_HEAP_CORRUPTION on
// Windows, SIGSEGV on Linux).
//
// Two details make this reach the window Case 4 above cannot:
//   * NO await between gc() and the re-fetch — any loop turn drains the finalizer
//     queue first, so no `await settle()`-shaped case can ever reach this window;
//   * g_cancellable_push_current stores a BORROWED pointer (no ref), so the GObject
//     stays reachable from C at refcount 1 — the only shape whose wrapper is weak
//     (collectable) while C can still hand the object back. A container that refs
//     its member toggles the wrapper UP and pins it, so it can never be collected.
//
// The WeakRef is the WITNESS, not decoration: a re-fetch that hits a still-live
// identity-cache entry is indistinguishable from a resurrection at every assertion
// below. Measured — with both gc() calls deleted this case still passed, so without
// the witness any future GC that stops collecting here turns it green-and-blind.
// Collected-but-not-finalized then follows for free: N-API defers a complex
// finalizer to a SetImmediate, so no finalizer can have run inside the synchronous
// stretch between the gc() and the re-fetch.
test('resurrection: re-fetch while the old finalizer is still pending', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    let weak;
    (() => {
        const c = new Gio.Cancellable();
        c.push_current();
        weak = new WeakRef(c);
    })();
    // `new WeakRef(t)` pins t for the rest of the current job (AddToKeptObjects,
    // released at the microtask checkpoint), so the collection MUST be attempted a
    // turn later — in-job it is pinned and deref() stays truthy (measured).
    await new Promise((r) => setImmediate(r));

    globalThis.gc();
    globalThis.gc();
    assert.equal(weak.deref(), undefined, 'the predecessor wrapper must really be collected');

    const back = Gio.Cancellable.get_current();
    assert.ok(back, 'the borrowed cancellable is handed back from C');
    assert.equal(back.is_cancelled(), false, 'the resurrected wrapper is immediately usable');

    await settle(); // the predecessor's finalizer runs HERE

    assert.equal(back.is_cancelled(), false, 'the resurrected wrapper outlives its predecessor');
    back.cancel();
    assert.equal(back.is_cancelled(), true, 'and is still a live GObject afterwards');
    back.pop_current();
});

// ---- Case 4c: the weak-ref net fires on a LIVE object (g_object_run_dispose) ----
// `g_object_run_dispose` notifies every GWeakNotify — and clears every GWeakRef —
// on an object that goes on living (measured on glib 2.88.3), and it is not an
// exotic call: `gtk_window_destroy()` is one, so every GTK app that closes a window
// walks this path. The binding read that notify as "the GObject was finalized",
// nulled its cached pointer, and the teardown then skipped the
// `g_object_set_qdata(obj, quark, nullptr)` it does under that pointer — leaving a
// LIVE GObject holding a qdata pointer to the record the teardown went on to free.
// The next thing to hand that object back to JS read the freed record
// (`napi_get_reference_value` on its dead `handle_ref`), which is a SIGSEGV 10 runs
// out of 10 here; the same stale record reaching the drain instead is the
// `RunTeardown → g_object_get_qdata → g_type_check_instance_is_fundamentally_a`
// crash reported off a GTK application.
//
// Same borrowed-pointer vehicle as 4b, for the same reason: `push_current` stores
// the object WITHOUT a ref, so the wrapper stays weak (collectable) while C can
// still hand the object back. Anything that refs it toggles the wrapper UP and pins
// it, and the case becomes unreachable.
test('run_dispose: a surviving object keeps no freed record in its qdata', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    let weak;
    (() => {
        const c = new Gio.Cancellable();
        c.push_current();
        c.run_dispose(); // fires the GWeakNotify while the object is ALIVE
        assert.equal(c.is_cancelled(), false, 'the GObject survives its own run_dispose');
        weak = new WeakRef(c);
    })();
    // `new WeakRef(t)` pins t for the rest of the current job, so the collection has
    // to be attempted a turn later (same reason as 4b).
    await new Promise((r) => setImmediate(r));
    await settle();
    // The WITNESS: without a real collection + drained teardown nothing below can
    // reach a freed record, and the case would be green-and-blind.
    assert.equal(weak.deref(), undefined, 'the wrapper was collected and its teardown ran');

    const back = Gio.Cancellable.get_current();
    assert.ok(back, 'the borrowed cancellable is still handed back from C');
    assert.equal(back.is_cancelled(), false, 'and re-wraps into a usable fresh wrapper');
    back.cancel();
    assert.equal(back.is_cancelled(), true, 'which drives the live GObject');
    back.pop_current();
});

// ---- Case 5: subclass vfunc-instance integration (#647) ----
// At L0 the wrapper is a non-extensible External (no JS expando possible), so the
// integration assertion is wrapper IDENTITY: the vfunc `this` is the very same
// canonical handle the constructor returns. (Plain-field persistence is an L1
// concern — see the L1 vfunc case below.)
test('L0 vfunc: `this` is the same canonical handle as the constructed instance', () => {
    let vfuncThis = null;
    const Type = registerClass('NodeGiGcVFuncIdentity', 'GObject', 'Object', {
        vfuncs: {
            constructed() {
                vfuncThis = this;
            },
        },
    });
    const inst = constructType(Type, {});
    assert.equal(isGObjectHandle(inst), true);
    assert.equal(isGObjectHandle(vfuncThis), true);
    assert.strictEqual(vfuncThis, inst, 'the vfunc `this` and the returned handle are the identical wrapper');
});

test('L1 vfunc: a field written in a vfunc is visible on the constructed instance', () => {
    const GObject = requireGi('GObject', '2.0');
    class Widget extends GObject.Object {
        vfunc_constructed() {
            this._marker = 42;
        }
    }
    const Klass = GObject.registerClass({ GTypeName: 'NodeGiGcL1VFunc' }, Widget);
    const inst = new Klass();
    assert.equal(inst._marker, 42, 'the L1 vfunc `this` is the constructed proxy');
});

// ---- Case 6: signal-cycle — narrowed-leak semantics ----
// A handler that closes over its own object forms a GObject → GClosure →
// napi_ref → callback → wrapper cycle the GC cannot break across C, so a
// connected self-referential handler keeps the object alive (GJS-faithful: a
// connected handler IS a reason to stay alive). Disconnect drops the closure's
// napi_ref → the cycle breaks → the next GC collects it.
test('signal-cycle: a self-referential handler pins until disconnect', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    let collected = 0;
    const reg = new FinalizationRegistry(() => {
        collected++;
    });
    let handlerId;
    let weak;

    (() => {
        const action = new Gio.SimpleAction({ name: 'sig', enabled: false });
        // The handler closes over `action` — the self-referential cycle.
        handlerId = action.connect('notify::enabled', () => {
            void action.name;
        });
        weak = new WeakRef(action);
        reg.register(action, 'sig');
    })();

    await settle();
    assert.equal(collected, 0, 'a connected self-referential handler keeps the object alive');

    // Disconnect (via the still-pinned wrapper) to break the cycle, then drop it.
    (() => {
        const a = weak.deref();
        assert.ok(a, 'the pinned wrapper is still alive while connected');
        a.disconnect(handlerId);
    })();

    await settle();
    assert.equal(collected, 1, 'after disconnect the cycle breaks and the object is collected');
});

// ---- Case 7: soak — bounded RSS, crash-free ----
test('soak: thousands of create/round-trip/GC cycles stay bounded', { ...gcOpts }, async () => {
    const iters = 20000;
    for (let i = 0; i < iters; i++) {
        const group = newObject('Gio', 'SimpleActionGroup', {});
        const a = newObject('Gio', 'SimpleAction', { name: 'x', enabled: (i & 1) === 0 });
        callMethod(group, 'add_action', [a]);
        const back = callMethod(group, 'lookup_action', ['x']);
        assert.strictEqual(back, a);
        if ((i & 0x7ff) === 0) {
            globalThis.gc();
            await new Promise((r) => setImmediate(r));
        }
    }
    await settle();
    const mb = process.memoryUsage().rss / (1024 * 1024);
    assert.ok(mb < 1024, `RSS should stay bounded after soak, was ${mb.toFixed(0)} MiB`);
});

// ---- Case 8: toggle interleaved with GC pressure ----
test('interleave: add/remove from a group under a tight gc loop', { ...gcOpts }, async () => {
    const Gio = requireGi('Gio', '2.0');
    const group = new Gio.SimpleActionGroup();
    for (let i = 0; i < 2000; i++) {
        const a = new Gio.SimpleAction({ name: 'n', enabled: true });
        group.add_action(a);
        const back = group.lookup_action('n');
        assert.strictEqual(back, a, 'identity holds while toggles fire near collections');
        group.remove_action('n');
        if ((i & 0xff) === 0) globalThis.gc();
    }
    await settle();
    assert.equal(group.lookup_action('n'), null, 'a removed action is gone');
});
