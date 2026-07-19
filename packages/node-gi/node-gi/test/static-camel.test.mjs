// SPDX-License-Identifier: MIT
// L1 static-method + camelCase tests for @gjsify/node-gi (milestone 1). The
// wrapper exposes type-level constructor/static functions (Ns.Class.method) and
// accepts both snake_case and camelCase for static + instance methods. Headless:
// Gio.File (interface) static `new_for_path` returns a GLocalFile whose GFile
// interface methods resolve through the live-GType interface scan, and
// Gio.SimpleAction instance methods.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import { callStaticMethod, requireNamespace } from '../index.js';

test('static/constructor method: Gio.File.new_for_path', () => {
  const Gio = requireGi('Gio', '2.0');
  const f = Gio.File.new_for_path('/usr/bin/gjs');
  // GIO normalizes to the platform separator, so get_path() is `\usr\bin\gjs` on
  // Windows; normalize separators before comparing (node-gi returns exactly what GIO
  // returns — the test's point is that the static new_for_path resolves + returns a path).
  assert.equal(f.get_path().replaceAll('\\', '/'), '/usr/bin/gjs');
  assert.equal(f.get_basename(), 'gjs');
});

test('camelCase static alias: Gio.File.newForPath', () => {
  const Gio = requireGi('Gio', '2.0');
  const f = Gio.File.newForPath('/etc/hosts');
  assert.equal(f.get_basename(), 'hosts');
});

test('camelCase instance method alias: file.getPath()', () => {
  const Gio = requireGi('Gio', '2.0');
  const f = Gio.File.new_for_path('/usr/share');
  assert.equal(f.getPath(), f.get_path());
  assert.equal(f.getBasename(), 'share');
});

test('camelCase + snake_case agree on a GObject instance method', () => {
  const Gio = requireGi('Gio', '2.0');
  const action = new Gio.SimpleAction({ name: 'go', enabled: true });
  assert.equal(action.getName(), action.get_name());
  assert.equal(action.getEnabled(), true);
});

test('interface methods resolve on a no-introspection concrete type', () => {
  // GLocalFile has no introspection info; get_uri is a GFile interface method
  // reached via the live-GType interface scan.
  const Gio = requireGi('Gio', '2.0');
  const f = Gio.File.new_for_path('/tmp');
  assert.match(f.get_uri(), /^file:\/\//);
});

test('low-level callStaticMethod returns a wrappable handle', () => {
  requireNamespace('Gio', '2.0');
  const handle = callStaticMethod('Gio', 'File', 'new_for_path', ['/var']);
  assert.equal(typeof handle, 'object');
});

test('error: new on an interface throws not-constructible', () => {
  const Gio = requireGi('Gio', '2.0');
  assert.throws(() => new Gio.File(), /not a constructible GObject type/);
});

test('error: unknown static method', () => {
  assert.throws(
    () => callStaticMethod('Gio', 'File', 'no_such_static'),
    /no static method 'no_such_static'/,
  );
});
