// SPDX-License-Identifier: MIT
// @gjsify/node-gi — imports.package (the GJS application bootstrap) on node-gi.
//
// A real GNOME app (easy6502 packages/app-gnome) boots via:
//   imports.package.init({ name, version, prefix, libdir });
//   pkg.initGettext();   // wires globalThis._ / C_ / N_
//   pkg.initFormat();    // wires String.prototype.format
// node-gi previously exposed `imports` but not `imports.package`, so the app
// stopped at `imports.package.init` with "Cannot read properties of undefined".
// This proves that boot surface runs on node-gi (overrides/package.js).
//
// Reference: refs/gjs modules/script/{package,format}.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../globals.js';

test('imports.package.init sets globalThis.pkg + the dir fields + searchPath', () => {
  const pkg = globalThis.imports.package;
  assert.ok(pkg, 'imports.package exists');
  pkg.init({ name: 'eu.jumplink.Test', version: '1.2.3', prefix: '/usr', libdir: '/usr/lib' });
  assert.equal(globalThis.pkg, pkg, 'globalThis.pkg is set to the package module');
  assert.equal(pkg.name, 'eu.jumplink.Test');
  assert.equal(pkg.version, '1.2.3');
  assert.equal(pkg.datadir, '/usr/share');
  assert.equal(pkg.moduledir, '/usr/share/eu.jumplink.Test');
  assert.equal(pkg.localedir, '/usr/share/locale');
  assert.ok(Array.isArray(globalThis.imports.searchPath), 'imports.searchPath is an array');
  assert.ok(globalThis.imports.searchPath.includes('/usr/share/eu.jumplink.Test'), 'moduledir unshifted onto searchPath');
});

test('pkg.initGettext wires the _ / C_ / N_ globals (passthrough, no catalog)', () => {
  const pkg = globalThis.imports.package;
  pkg.init({ name: 'eu.jumplink.Test' });
  pkg.initGettext();
  assert.equal(typeof globalThis._, 'function');
  assert.equal(globalThis._('Hello'), 'Hello');
  assert.equal(globalThis.C_('some-context', 'Message'), 'Message');
  assert.equal(globalThis.N_('untranslated'), 'untranslated');
});

test('pkg.initFormat wires String.prototype.format (JS vprintf)', () => {
  const pkg = globalThis.imports.package;
  pkg.initFormat();
  assert.equal('by %s'.format('Pascal'), 'by Pascal');
  assert.equal('%d items'.format(3), '3 items');
  assert.equal('addr %04x'.format(0x0600), 'addr 0600'); // 0-padded hex — the Learn6502 gutter shape
  assert.equal('%.2f'.format(3.14159), '3.14');
  assert.equal('%5s|'.format('ab'), '   ab|'); // width, space-pad (right-align)
  assert.equal('100%% done'.format(), '100% done'); // %% -> literal %
  assert.equal('%s + %s'.format('a', 'b'), 'a + b'); // sequential args
});
