// SPDX-License-Identifier: MIT
// GI callback marshalling for @gjsify/node-gi. A JS function passed where a GI
// callback is expected (GLib.timeout_add / idle_add) is wrapped in an ffi
// closure; when the GLib main loop (pumped by the libuv↔GLib bridge) invokes it,
// the JS function runs and its boolean return drives source continuation. The
// function's hidden user_data + destroy-notify slots are filled automatically.
// Reference: refs/node-gtk src/callback.cc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

test('GLib.timeout_add fires from the loop; return drives repeat/stop', () => {
  const GLib = requireGi('GLib', '2.0');
  const loop = GLib.MainLoop.new(null, false);
  let ticks = 0;
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    ticks++;
    if (ticks >= 3) {
      loop.quit();
      return false; // G_SOURCE_REMOVE
    }
    return true; // G_SOURCE_CONTINUE
  });
  assert.equal(typeof id, 'number');
  assert.ok(id > 0);
  loop.run();
  assert.equal(ticks, 3);
});

test('GLib.idle_add one-shot callback runs', () => {
  const GLib = requireGi('GLib', '2.0');
  const loop = GLib.MainLoop.new(null, false);
  let ran = false;
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    ran = true;
    loop.quit();
    return false;
  });
  loop.run();
  assert.equal(ran, true);
});

test('a null callback argument is accepted (NULL function pointer)', () => {
  const GLib = requireGi('GLib', '2.0');
  // timeout_add with a null callback installs a source with a NULL func; remove
  // it immediately. This exercises the null-callback marshalling path.
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100000, null);
  assert.equal(typeof id, 'number');
  GLib.source_remove(id);
});

test('non-function, non-null callback argument throws', () => {
  const GLib = requireGi('GLib', '2.0');
  assert.throws(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, 42), /expected a function/);
});
