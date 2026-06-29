// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gio.Application.runAsync test (G5).
//
// Proves the GJS `Gio.Application.prototype.runAsync` override
// (refs/gjs/modules/core/overrides/Gio.js → `GLib.MainLoop.prototype.runAsync`
// in GLib.js) works UNCHANGED on Node: `await app.runAsync([...])` runs the app
// and resolves with the integer exit status when it quits, WITHOUT blocking the
// Node microtask/event loop the way a bare blocking `app.run()` would.
//
// HOW IT WORKS: GJS defers the blocking run() via `setMainLoopHook`; on Node the
// faithful analogue is to defer it to a MACROTASK (setImmediate). runAsync returns
// the Promise immediately, the caller's already-queued microtasks/promises drain
// first, and run() executes OUTSIDE the caller's async/await scope — so the
// node-gtk #442/#121 nested-microtask-checkpoint caveat (see mainloop.test.mjs)
// does NOT bite: a Promise continuation queued before runAsync drains WHILE the
// app runs. The libuv↔GLib bridge co-pumps Node timers/promises/I/O for the
// lifetime of the run (it attaches its GSource to the DEFAULT GMainContext, which
// g_application_run iterates).
//
// HEADLESS: a plain `Gio.Application` (NON_UNIQUE) needs no display, so these run
// in the fast `node --test` / `test:gc` gate. Mirrors GJS: the `argv` argument is
// ignored (GJS's runAsync calls `this.run()` with an empty command-line), so an
// `app.runAsync([programInvocationName, ...ARGV])` source behaves identically on
// gjs and node.
//
// Reference: refs/gjs (Gio.js/GLib.js runAsync), refs/node-gtk src/loop.cc
// (romgrk and contributors, MIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

// GLib/Gio are node-gi's core target libs (always present on the CI host); the
// try/catch only guards a degenerate headless dev box with no typelibs at all.
let GLib;
let Gio;
let loadError = null;
try {
  GLib = requireGi('GLib', '2.0');
  Gio = requireGi('Gio', '2.0');
} catch (err) {
  loadError = err;
}
const skip = loadError ? `GLib/Gio typelib unavailable: ${loadError.message}` : false;

// A fresh NON_UNIQUE application per test (unique id → no session-bus collisions).
let idCounter = 0;
function makeApp() {
  return new Gio.Application({
    application_id: `eu.jumplink.NodeGiRunAsync${idCounter++}`,
    flags: Gio.ApplicationFlags.NON_UNIQUE,
  });
}

test('runAsync returns a Promise that resolves with the exit status', { skip }, async () => {
  const app = makeApp();
  let activated = false;
  app.connect('activate', () => {
    activated = true;
    app.hold(); // keep g_application_run iterating until the timeout quits it
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      app.quit();
      return GLib.SOURCE_REMOVE;
    });
  });

  const pending = app.runAsync([]);
  assert.equal(typeof pending.then, 'function', 'runAsync returns a Promise (does not block)');

  const status = await pending;
  assert.equal(status, 0, 'resolves with the integer exit status (0)');
  assert.equal(activated, true, 'the activate handler ran during the run');
});

test('runAsync keeps the Node event loop pumped while the app runs', { skip }, async () => {
  const app = makeApp();
  let appQuit = false;
  let timerFiredDuringRun = false;
  let promiseSettledDuringRun = false;

  // Scheduled BEFORE runAsync — both must run WHILE the app is running (before the
  // 150ms GLib timeout quits it). If the blocking run() starved Node (the bare
  // run() caveat), neither would settle until run() returned (after appQuit).
  setTimeout(() => {
    timerFiredDuringRun = !appQuit;
  }, 15);
  const continuation = new Promise((resolve) => setTimeout(resolve, 25)).then(() => {
    promiseSettledDuringRun = !appQuit;
  });

  app.connect('activate', () => {
    app.hold();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      appQuit = true;
      app.quit();
      return GLib.SOURCE_REMOVE;
    });
  });

  const status = await app.runAsync([]);
  await continuation;

  assert.equal(status, 0);
  assert.equal(timerFiredDuringRun, true, 'a setTimeout scheduled before runAsync fired DURING the run');
  assert.equal(
    promiseSettledDuringRun,
    true,
    'a Promise continuation scheduled before runAsync settled DURING the run (loop not starved)',
  );
});

test('the blocking run() is unchanged', { skip }, () => {
  const app = makeApp();
  let fired = false;
  // Scheduled before the synchronous, top-level blocking run() — the bridge
  // co-pumps libuv so this timer fires during the run, exactly as before.
  setTimeout(() => {
    fired = true;
  }, 10);
  app.connect('activate', () => {
    app.hold();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      app.quit();
      return GLib.SOURCE_REMOVE;
    });
  });

  const status = app.run([]); // top-level blocking run (no async wrapper)
  assert.equal(status, 0, 'blocking run([]) still exits 0');
  assert.equal(fired, true, 'libuv timer fired during the blocking run() (bridge unchanged)');
});
