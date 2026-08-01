// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gio.DBus client + object-export round-trips on a private
// session bus.
//
// Runs the SHARED scenarios (../dbus/scenario.mjs client half,
// ../dbus/export-scenario.mjs export half) on node-gi and asserts each equals
// its golden result AND the output of the SAME scenario under `gjs -m`
// (../dbus/gjs-harness.js) — the byte-for-byte gjs cross-check. Requires a session
// bus; wrap the invocation in `dbus-run-session` for isolation:
//   dbus-run-session -- node --test --expose-gc test/dbus.test.mjs   (npm run test:dbus)
// When no session bus is reachable (the default `npm test` in a headless CI
// container), every case self-skips — it never fails for lack of a bus.
//
// Coverage: makeProxyWrapper (sync + async-raw + Promise methods, the proxy
// surface, a live NameOwnerChanged signal), Gio.DBus.session, name owning
// (own_name → onNameAcquired), object export (Gio.DBusExportedObject.wrapJSObject
// over the GClosure vtable — method call / property get+set / error / signal /
// PropertiesChanged / unexport), and the export registration's GC lifetime
// (closures rooted while exported, released after unregister — the --expose-gc
// leg).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { requireGi } from '../gi.js';
import { runScenario, EXPECTED } from '../dbus/scenario.mjs';
import { runExportScenario, EXPORT_EXPECTED } from '../dbus/export-scenario.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(HERE, '..', 'dbus', 'gjs-harness.js');
const HEX32 = /^[0-9a-f]{32}$/;

const PROXY_XML = `<node><interface name="org.freedesktop.DBus">
<method name="GetId"><arg type="s" direction="out"/></method>
</interface></node>`;

// Detect a reachable session bus once. bus_get_sync throws fast (no hang) when the
// address is unset and autolaunch is unavailable — the headless-CI default.
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

function haveCommand(cmd) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    return !r.error;
}

const gjsSkip = busSkip
    ? busSkip
    : !haveCommand('gjs')
      ? 'gjs not on PATH'
      : !haveCommand('dbus-run-session')
        ? 'dbus-run-session not on PATH'
        : false;

// Block the default GLib main context for `ms` so pending GIO async replies fire
// (their GI callbacks settle any awaited Promise). node-gtk #442/#121: a Promise
// `.then` does not drain WHILE the loop blocks, but the reply DOES fire, so the
// Promise is settled by the time run() returns and a subsequent `await` resolves.
function pumpFor(ms) {
    const loop = GLib.MainLoop.new(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return false;
    });
    loop.run();
}

test('DBus client round-trip matches the golden result', { skip: busSkip }, () => {
    const result = runScenario({ Gio, GLib });
    assert.deepEqual(result, EXPECTED);
});

test('the same round-trip under `gjs -m` is byte-identical (gold standard)', { skip: gjsSkip }, () => {
    // Give gjs its own private bus so it never races the node run's names.
    const r = spawnSync('dbus-run-session', ['--', 'gjs', '-m', HARNESS], {
        encoding: 'utf8',
        timeout: 60000,
    });
    assert.equal(r.status, 0, `gjs harness failed: ${r.stderr || r.error}`);
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT='));
    assert.ok(line, `no RESULT= line in gjs output:\n${r.stdout}\n${r.stderr}`);
    const gjsResult = JSON.parse(line.slice('RESULT='.length));
    assert.deepEqual(gjsResult, EXPECTED, 'gjs golden result diverged from EXPECTED');
    // The export half rides the same harness run: gjs's native wrapJSObject
    // (GjsPrivate.DBusImplementation) must produce the SAME normalized result as
    // node-gi's GClosure-vtable port (asserted against EXPORT_EXPECTED below).
    const exportLine = (r.stdout || '').split('\n').find((l) => l.startsWith('EXPORT_RESULT='));
    assert.ok(exportLine, `no EXPORT_RESULT= line in gjs output:\n${r.stdout}\n${r.stderr}`);
    const gjsExportResult = JSON.parse(exportLine.slice('EXPORT_RESULT='.length));
    assert.deepEqual(gjsExportResult, EXPORT_EXPECTED, 'gjs export result diverged from EXPORT_EXPECTED');
});

test('proxy method Promise variant (FooAsync) resolves', { skip: busSkip }, async () => {
    const ProxyClass = Gio.DBusProxy.makeProxyWrapper(PROXY_XML);
    const proxy = new ProxyClass(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
    const promise = proxy.GetIdAsync();
    // Pump the loop so the DBus reply fires + settles the Promise, then await it
    // (the reply's GI callback runs during the pump; the `.then`/await drains after).
    pumpFor(400);
    const [id] = await promise;
    assert.match(id, HEX32);
});

test('makeProxyWrapper.newAsync builds an inited proxy', { skip: busSkip }, async () => {
    const ProxyClass = Gio.DBusProxy.makeProxyWrapper(PROXY_XML);
    const promise = ProxyClass.newAsync(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
    pumpFor(400);
    const proxy = await promise;
    assert.equal(typeof proxy.GetIdSync, 'function');
    const [id] = proxy.GetIdSync();
    assert.match(id, HEX32);
});

// Object export (wrapJSObject) — a JS object exported over DBus via the GClosure
// vtable (register_object_with_closures2). The SHARED scenario covers the full
// round-trip: impl surface, exported method, property get+set, throwing method →
// DBus error, emit_signal, emit_property_changed → proxy cache, and unexport →
// further calls error. The gjs harness runs the SAME source (gold standard test
// above). Async proxy + async calls throughout (a sync self-call would deadlock
// the single main loop that must also service the incoming request).
test('Gio.DBusExportedObject.wrapJSObject export round-trip (shared scenario)', { skip: busSkip }, () => {
    const result = runExportScenario({ Gio, GLib });
    assert.deepEqual(result, EXPORT_EXPECTED);
});

// node-gi-specific export surface not part of the shared scenario: the camelCase
// aliases the L1 layer adds (GJS's C skeleton has snake_case only).
test('wrapJSObject camelCase aliases mirror the snake_case surface', { skip: busSkip }, () => {
    const impl = Gio.DBusExportedObject.wrapJSObject(
        '<node><interface name="org.gjsify.NodeGiAliasTest"><method name="Noop"/></interface></node>',
        { Noop() {} },
    );
    assert.equal(impl.getInfo, impl.get_info);
    assert.equal(impl.getObjectPath, impl.get_object_path);
    assert.equal(impl.getConnection, impl.get_connection);
    assert.equal(impl.unexportFromConnection, impl.unexport_from_connection);
    assert.equal(impl.emitSignal, impl.emit_signal);
    assert.equal(impl.emitPropertyChanged, impl.emit_property_changed);
});

// GC/lifetime (the --expose-gc leg; self-skips otherwise): the method/property
// GClosures — and the service object they capture — must be rooted by NOTHING
// but the native registration (JsClosureData's strong napi_ref, ref+sunk by
// register_object_data), surviving a full GC with every JS reference dropped;
// and unregistering must release them (closure invalidate → JsClosureFinalize →
// napi_delete_reference) so the service becomes collectable — not a process-
// lifetime leak. This is the adversarial rooting test for a long-lived DBus
// registration outliving the call that created it.
const gcSkip = busSkip || (typeof globalThis.gc !== 'function' ? 'needs --expose-gc (npm run test:dbus)' : false);
test('export registration roots its closures across GC; unregister releases them', { skip: gcSkip }, async () => {
    const IFACE = 'org.gjsify.NodeGiExportGcTest';
    const OBJ = '/org/gjsify/NodeGiExportGcTest';
    const XML = `<node><interface name="${IFACE}">
<method name="Echo"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
</interface></node>`;

    const conn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    let collected = false;
    const registry = new FinalizationRegistry(() => {
        collected = true;
    });

    // Register, then drop EVERY JS reference — impl's own methods close over the
    // service, so impl must go too. Creation happens inside a helper so no live
    // frame slot can pin the service; only the registration id survives.
    const setupExport = () => {
        const service = {
            Echo(s) {
                return `gc:${s}`;
            },
        };
        registry.register(service, 'service');
        const impl = Gio.DBusExportedObject.wrapJSObject(XML, service);
        return impl.export(conn, OBJ);
    };
    const registrationId = setupExport();

    globalThis.gc();
    globalThis.gc();
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
    assert.equal(collected, false, 'the exported service must NOT be collected while registered');

    // The handler still works after the GC barrage — a use-after-free here would
    // crash or mis-reply.
    const dest = conn.get_unique_name();
    const loop = GLib.MainLoop.new(null, false);
    const result = {};
    const PW = Gio.DBusProxy.makeProxyWrapper(XML);
    new PW(conn, dest, OBJ, (proxy, err) => {
        if (err) {
            result.error = String(err);
            loop.quit();
            return;
        }
        proxy.EchoRemote('alive', (r, callErr) => {
            result.callErr = Boolean(callErr);
            result.echo = callErr ? null : r[0];
            loop.quit();
        });
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8000, () => {
        result.timedOut = true;
        loop.quit();
        return false;
    });
    loop.run();
    assert.equal(result.timedOut, undefined, 'call must complete before the safety timeout');
    assert.equal(result.error, undefined);
    assert.equal(result.callErr, false);
    assert.equal(result.echo, 'gc:alive', 'the closure-rooted handler still replies after GC');

    // Unregister: the registration drops its closure refs → finalize → the JS
    // service becomes collectable. GDBus may defer the release to the main
    // context, so pump the loop between GC passes; a service that NEVER becomes
    // collectable is a leak and fails here.
    assert.equal(conn.unregister_object(registrationId), true);
    for (let i = 0; i < 100 && !collected; i++) {
        globalThis.gc();
        pumpFor(10);
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(collected, true, 'the service must be collectable after unregister_object');
});
