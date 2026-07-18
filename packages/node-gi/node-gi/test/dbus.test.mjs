// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gio.DBus client round-trip on a private session bus.
//
// Runs the SHARED scenario (../dbus/scenario.mjs) on node-gi and asserts it equals
// the golden result AND the output of the SAME scenario under `gjs -m`
// (../dbus/gjs-harness.js) — the byte-for-byte gjs cross-check. Requires a session
// bus; wrap the invocation in `dbus-run-session` for isolation:
//   dbus-run-session -- node --test test/dbus.test.mjs   (npm run test:dbus)
// When no session bus is reachable (the default `npm test` in a headless CI
// container), every case self-skips — it never fails for lack of a bus.
//
// Coverage: makeProxyWrapper (sync + async-raw + Promise methods, the proxy
// surface, a live NameOwnerChanged signal), Gio.DBus.session, name owning
// (own_name → onNameAcquired), and the DEFERRED export side (wrapJSObject throws a
// clear error, never crashes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { requireGi } from '../gi.js';
import { runScenario, EXPECTED } from '../dbus/scenario.mjs';

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
// vtable (register_object_with_closures2). Full round-trip: a proxy calls an
// exported method, gets/sets an exported property, and receives an emitted signal.
// Async proxy + async calls throughout (a sync self-call would deadlock the single
// main loop that must also service the incoming request). Needs a session bus.
test('Gio.DBusExportedObject.wrapJSObject export round-trip', { skip: busSkip }, async () => {
  const IFACE = 'org.gjsify.NodeGiExportTest';
  const OBJ = '/org/gjsify/NodeGiExportTest';
  const XML = `<node><interface name="${IFACE}">
<method name="Echo"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Boom"><arg type="s" direction="out"/></method>
<property name="Level" type="i" access="readwrite"/>
<signal name="Pinged"><arg type="s"/></signal>
</interface></node>`;

  const conn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
  const service = {
    Level: 7,
    Echo(s) {
      return `echo:${s}`;
    },
    Boom() {
      throw new Error('kaboom');
    },
  };
  const impl = Gio.DBusExportedObject.wrapJSObject(XML, service);
  impl.export(conn, OBJ);
  assert.equal(impl.get_object_path(), OBJ);

  const loop = GLib.MainLoop.new(null, false);
  const result = {};
  const ownId = Gio.DBus.own_name(
    Gio.BusType.SESSION,
    IFACE,
    Gio.BusNameOwnerFlags.NONE,
    () => {},
    () => {
      const PW = Gio.DBusProxy.makeProxyWrapper(XML);
      PW(conn, IFACE, OBJ, (proxy, err) => {
        if (err) {
          result.error = String(err);
          loop.quit();
          return;
        }
        let signal = null;
        proxy.connectSignal('Pinged', (_p, _s, args) => {
          signal = args[0];
        });
        proxy.EchoRemote('hi', ([echoed]) => {
          result.echo = echoed;
          // property get + set via org.freedesktop.DBus.Properties (async, no deadlock)
          conn.call(
            IFACE, OBJ, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [IFACE, 'Level']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, -1, null,
            (_s1, res1) => {
              result.levelBefore = conn.call_finish(res1).deepUnpack()[0].deepUnpack();
              conn.call(
                IFACE, OBJ, 'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', [IFACE, 'Level', new GLib.Variant('i', 99)]),
                null, Gio.DBusCallFlags.NONE, -1, null,
                (_s2, res2) => {
                  conn.call_finish(res2);
                  result.levelAfter = service.Level;
                  // error-return path: Boom throws → DBus error → proxy err
                  proxy.BoomRemote(([_v], boomErr) => {
                    result.boomErr = Boolean(boomErr);
                    impl.emit_signal('Pinged', new GLib.Variant('(s)', ['ping!']));
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                      result.signal = signal;
                      loop.quit();
                      return false;
                    });
                  });
                },
              );
            },
          );
        });
      });
    },
    () => {},
  );
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8000, () => {
    result.timedOut = true;
    loop.quit();
    return false;
  });
  loop.run();
  Gio.DBus.unown_name(ownId);
  impl.unexport();

  assert.equal(result.timedOut, undefined, 'round-trip must complete before the safety timeout');
  assert.equal(result.error, undefined);
  assert.equal(result.echo, 'echo:hi', 'exported method reply');
  assert.equal(result.levelBefore, 7, 'get-property closure');
  assert.equal(result.levelAfter, 99, 'set-property closure wrote through');
  assert.equal(result.boomErr, true, 'a throwing method returns a DBus error');
  assert.equal(result.signal, 'ping!', 'emit_signal reaches the proxy');
});
