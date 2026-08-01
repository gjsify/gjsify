// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the pure-JS `_signals` mixin (addSignalMethods) + the legacy
// `imports.signals` / `imports.mainloop` script modules. No GObject / no bus: the
// mixin is plain JS (it also backs the DBus proxy signal surface), and the mainloop
// wrapper drives a GLib main loop (headless, no display).
//
// Importing ../globals.js installs the GJS ambient globals (print/log/logError +
// the `imports` object) on this per-file test process — the entry point a real
// `--app node` GJS source gets. `imports.signals` IS the mixin module.
import test from 'node:test';
import assert from 'node:assert/strict';

import '../globals.js';

const { addSignalMethods } = globalThis.imports.signals;

test('addSignalMethods installs the GObject-shaped signal API', () => {
    const obj = {};
    addSignalMethods(obj);
    for (const m of ['connect', 'connectAfter', 'disconnect', 'emit', 'signalHandlerIsConnected', 'disconnectAll']) {
        assert.equal(typeof obj[m], 'function', `missing ${m}`);
    }
});

test('emit passes the emitter as the first handler arg (GObject parity), then the payload', () => {
    const obj = {};
    addSignalMethods(obj);
    let seenEmitter;
    let seenArgs;
    obj.connect('changed', (emitter, ...args) => {
        seenEmitter = emitter;
        seenArgs = args;
    });
    obj.emit('changed', 'a', 42);
    assert.equal(seenEmitter, obj, 'first arg is the emitter');
    assert.deepEqual(seenArgs, ['a', 42]);
});

test('connect returns a rising id; disconnect stops the handler', () => {
    const obj = {};
    addSignalMethods(obj);
    let count = 0;
    const id = obj.connect('ping', () => {
        count++;
    });
    assert.equal(typeof id, 'number');
    obj.emit('ping');
    obj.emit('ping');
    assert.equal(count, 2);
    obj.disconnect(id);
    obj.emit('ping');
    assert.equal(count, 2);
    assert.equal(obj.signalHandlerIsConnected(id), false);
});

test('connectAfter handlers run after the before handlers', () => {
    const obj = {};
    addSignalMethods(obj);
    const order = [];
    obj.connectAfter('go', () => order.push('after'));
    obj.connect('go', () => order.push('before'));
    obj.emit('go');
    assert.deepEqual(order, ['before', 'after']);
});

test('a before handler returning true stops the emission (later before AND after handlers)', () => {
    // The mixin's `_emit` is `if (!_callHandlers(before)) _callHandlers(after)`, so a
    // true-returning before handler short-circuits the whole emission.
    const obj = {};
    addSignalMethods(obj);
    const order = [];
    obj.connect('go', () => {
        order.push('first');
        return true;
    });
    obj.connect('go', () => order.push('second-should-not-run'));
    obj.connectAfter('go', () => order.push('after-should-not-run'));
    obj.emit('go');
    assert.deepEqual(order, ['first']);
});

test('a throwing handler is caught (logged) and does not disrupt emission', () => {
    const obj = {};
    addSignalMethods(obj);
    let reached = false;
    obj.connect('go', () => {
        throw new Error('boom');
    });
    obj.connect('go', () => {
        reached = true;
    });
    // Must not throw out of emit; the second handler still runs.
    obj.emit('go');
    assert.equal(reached, true);
});

test('disconnectAll drops every handler', () => {
    const obj = {};
    addSignalMethods(obj);
    let count = 0;
    obj.connect('a', () => count++);
    obj.connect('b', () => count++);
    obj.disconnectAll();
    obj.emit('a');
    obj.emit('b');
    assert.equal(count, 0);
});

test('imports.signals exposes the private primitives too', () => {
    const s = globalThis.imports.signals;
    for (const k of [
        '_connect',
        '_connectAfter',
        '_disconnect',
        '_emit',
        '_signalHandlerIsConnected',
        '_disconnectAll',
    ]) {
        assert.equal(typeof s[k], 'function', `missing ${k}`);
    }
});

test('imports.mainloop: timeout_add fires under run(), quit() stops the loop', () => {
    const mainloop = globalThis.imports.mainloop;
    let fired = false;
    mainloop.timeout_add(10, () => {
        fired = true;
        mainloop.quit();
        return false; // G_SOURCE_REMOVE
    });
    mainloop.run(); // blocks until quit()
    assert.equal(fired, true);
});

test('imports.mainloop: idle_add fires, source_remove cancels a pending timeout', () => {
    const mainloop = globalThis.imports.mainloop;
    let idleFired = false;
    let cancelledFired = false;
    const cancelledId = mainloop.timeout_add(5, () => {
        cancelledFired = true;
        return false;
    });
    mainloop.source_remove(cancelledId);
    mainloop.idle_add(() => {
        idleFired = true;
        // Give the (removed) timeout a chance to have NOT fired, then stop.
        mainloop.timeout_add(30, () => {
            mainloop.quit();
            return false;
        });
        return false;
    });
    mainloop.run();
    assert.equal(idleFired, true);
    assert.equal(cancelledFired, false, 'source_remove cancelled the timeout');
});
