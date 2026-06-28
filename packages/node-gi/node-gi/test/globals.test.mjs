// SPDX-License-Identifier: MIT
// GJS ambient-globals shim (@gjsify/node-gi/globals): print/printerr/log/
// logError/ARGV + the legacy `imports` object (imports.gi.<Ns>, imports.system,
// imports.gettext). Importing the module seeds globalThis; the same node-gi
// backend `gi://` uses backs `imports.gi`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { installGjsGlobals } from '../globals.js'; // side effect: seeds globals
import { requireGi } from '../gi.js';

test('print/printerr/log/logError are installed and stringify GJS-style', () => {
  assert.equal(typeof globalThis.print, 'function');
  assert.equal(typeof globalThis.printerr, 'function');
  assert.equal(typeof globalThis.log, 'function');
  assert.equal(typeof globalThis.logError, 'function');

  const orig = console.log;
  let captured = null;
  console.log = (s) => {
    captured = s;
  };
  try {
    globalThis.print('a', 1, true);
  } finally {
    console.log = orig;
  }
  assert.equal(captured, 'a 1 true'); // String()-joined with spaces
});

test('ARGV is an array', () => {
  assert.ok(Array.isArray(globalThis.ARGV));
});

test('imports.gi resolves a namespace via the node-gi backend', () => {
  const GLib = globalThis.imports.gi.GLib;
  assert.equal(typeof GLib.get_host_name, 'function');
  // Same cached namespace object the gi:// path (requireGi) returns.
  assert.equal(GLib, requireGi('GLib'));
});

test('imports.gi.versions is a settable version map', () => {
  globalThis.imports.gi.versions.GLib = '2.0';
  assert.equal(globalThis.imports.gi.versions.GLib, '2.0');
  // Still resolves with the pinned version.
  assert.equal(typeof globalThis.imports.gi.GLib.get_host_name, 'function');
});

test('imports.system exposes a Node-backed subset', () => {
  assert.equal(typeof globalThis.imports.system.exit, 'function'); // not called
  assert.equal(typeof globalThis.imports.system.gc, 'function');
  assert.equal(typeof globalThis.imports.system.programInvocationName, 'string');
});

test('imports.gettext is a no-translation passthrough', () => {
  const { gettext, ngettext } = globalThis.imports.gettext;
  assert.equal(gettext('hello'), 'hello');
  assert.equal(ngettext('one', 'many', 1), 'one');
  assert.equal(ngettext('one', 'many', 5), 'many');
  assert.equal(globalThis.imports.gettext.domain('app').gettext('x'), 'x');
});

test('installGjsGlobals is idempotent and returns imports', () => {
  const a = installGjsGlobals();
  const b = installGjsGlobals();
  assert.equal(a, b);
  assert.equal(a, globalThis.imports);
});
