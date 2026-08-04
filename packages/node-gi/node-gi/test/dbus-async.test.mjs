// SPDX-License-Identifier: MIT
// @gjsify/node-gi — async (Promise-returning) DBus method handlers reply while
// a BLOCKING GLib main loop owns the thread — on Node, Bun AND Deno.
//
// Regression for the cross-runtime microtask checkpoint (src/loop.cc
// NodeGiMaybeDrainMicrotasks): sync exported methods always replied on all
// three runtimes, but an async handler's reply rides
// `retval.then(_handleDBusReply, …)` (overrides/gio-dbus.js) — a Promise
// continuation. Node's napi_make_callback drains the microtask queue when its
// callback scope closes; Bun's and Deno's perform NO checkpoint, and with the
// runtime's own event loop paused for the blocking run()'s lifetime the
// continuation never ran: the reply never went out and the DBus client timed
// out (the `@gjsify/devtools` Screenshot method — async — on bun/deno, while
// GetStatus/DumpTree — sync — worked). The engine now invokes the runtime's
// own drain primitive (`bun:jsc` drainMicrotasks / Deno core.runMicrotasks) at
// the outermost loop-dispatched callback boundary, so the replies below arrive
// DURING the blocking run on every runtime, matching Node and GJS.
//
// Needs a session bus like dbus.test.mjs; self-skips without one (never fails
// for lack of a bus):
//   dbus-run-session --config-file=test/session.conf -- \
//     node --test test/dbus-async.test.mjs                     (npm run test:dbus)
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';

import { requireGi } from '../gi.js';

// Detect a reachable session bus once (same probe as dbus.test.mjs).
let Gio;
let GLib;
let busSkip = false;
try {
    Gio = requireGi('Gio', '2.0');
    GLib = requireGi('GLib', '2.0');
    Gio.bus_get_sync(Gio.BusType.SESSION, null);
} catch (e) {
    busSkip = `no session bus (${e.message}) — run under dbus-run-session (npm run test:dbus)`;
}

const IFACE = 'org.gjsify.NodeGiDbusAsyncTest';
const OBJ = '/org/gjsify/NodeGiDbusAsyncTest';
const XML = `<node><interface name="${IFACE}">
<method name="SyncEcho"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="AsyncMicro"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="AsyncTimeout"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
</interface></node>`;

test('async exported methods reply during a blocking MainLoop.run()', { skip: busSkip }, async () => {
    // Bun's node:test shim ignores the `skip` option and runs the body anyway —
    // bail imperatively when no session bus is reachable.
    if (busSkip) return;

    const service = {
        SyncEcho(s) {
            return `sync:${s}`;
        },
        async AsyncMicro(s) {
            // Pure microtask — isolates the checkpoint from any GLib timer.
            await Promise.resolve();
            return `micro:${s}`;
        },
        async AsyncTimeout(s) {
            // The reply's `.then` is queued by a GLib-timeout GI callback — the
            // calls.cc trampoline boundary (the signals.cc closure boundary is
            // covered by AsyncMicro).
            await new Promise((resolve) => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                    resolve();
                    return false;
                });
            });
            return `timer:${s}`;
        },
    };

    // The whole scenario runs from a MACROTASK: a blocking run() entered inside a
    // live async scope defers V8's microtask checkpoint on Node (node-gtk
    // #442/#121 — see mainloop.test.mjs), which would fail this test for an
    // unrelated, Node-only reason. setImmediate is exactly how runAsync defers
    // its blocking run.
    const results = await new Promise((resolveOuter) => {
        setImmediate(() => {
            const out = {};
            const conn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
            const impl = Gio.DBusExportedObject.wrapJSObject(XML, service);
            impl.export(conn, OBJ);
            const dest = conn.get_unique_name();
            const loop = GLib.MainLoop.new(null, false);
            const ProxyClass = Gio.DBusProxy.makeProxyWrapper(XML);
            // Async proxy + Remote calls throughout — a sync self-call would deadlock
            // the single main loop that must also service the incoming request.
            new ProxyClass(conn, dest, OBJ, (proxy, err) => {
                if (err) {
                    out.proxyError = String(err);
                    loop.quit();
                    return;
                }
                proxy.SyncEchoRemote('a', (r, e) => {
                    out.sync = e ? `error:${e}` : r[0];
                    proxy.AsyncMicroRemote('b', (r2, e2) => {
                        out.micro = e2 ? `error:${e2}` : r2[0];
                        proxy.AsyncTimeoutRemote('c', (r3, e3) => {
                            out.timer = e3 ? `error:${e3}` : r3[0];
                            loop.quit();
                        });
                    });
                });
            });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
                out.timedOut = true;
                loop.quit();
                return false;
            });
            loop.run(); // BLOCKING — every reply must arrive while this owns the thread
            impl.unexport();
            resolveOuter(out);
        });
    });

    assert.equal(results.proxyError, undefined);
    assert.equal(results.timedOut, undefined, 'every reply must arrive before the safety timeout');
    assert.equal(results.sync, 'sync:a');
    assert.equal(results.micro, 'micro:b', 'a pure-microtask async reply must drain during the blocking run');
    assert.equal(results.timer, 'timer:c', 'a timer-backed async reply must drain during the blocking run');
});
