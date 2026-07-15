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

test('Gio.DBusExportedObject.wrapJSObject throws a clear "not supported" error (export deferred)', () => {
  // No bus needed — this asserts the deferred export side fails loudly, not silently.
  const gio = requireGi('Gio', '2.0');
  assert.throws(
    () => gio.DBusExportedObject.wrapJSObject('<node/>', {}),
    /not yet supported/,
  );
});
