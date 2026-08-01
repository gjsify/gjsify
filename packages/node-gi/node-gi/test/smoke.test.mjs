// SPDX-License-Identifier: MIT
// Smoke test for the @gjsify/node-gi native addon (milestone 1, headless core).
// Uses node:test so it has zero build-pipeline dependencies — it runs against
// the freshly node-gyp-built binary on plain Node.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireNamespace, listInfoNames, prependSearchPath } from '../index.js';

test('requireNamespace(GLib, 2.0) resolves version + info count', () => {
    const result = requireNamespace('GLib', '2.0');
    assert.equal(result.namespace, 'GLib');
    assert.equal(result.version, '2.0');
    assert.ok(result.infoCount > 100, `expected GLib to expose many infos, got ${result.infoCount}`);
});

test('requireNamespace without version resolves a version', () => {
    const result = requireNamespace('Gio');
    assert.equal(result.namespace, 'Gio');
    assert.match(result.version, /^\d+\.\d+$/);
    assert.ok(result.infoCount > 100);
});

test('listInfoNames(GLib) includes well-known symbols', () => {
    requireNamespace('GLib', '2.0');
    const names = listInfoNames('GLib');
    assert.ok(Array.isArray(names));
    assert.ok(names.includes('MainLoop'), 'GLib should expose MainLoop');
    assert.ok(names.includes('Variant'), 'GLib should expose Variant');
});

test('requireNamespace throws a clear error for a missing namespace', () => {
    assert.throws(() => requireNamespace('NoSuchNamespaceXYZ', '9.9'), /Failed to require NoSuchNamespaceXYZ/);
});

test('prependSearchPath is callable', () => {
    assert.doesNotThrow(() => prependSearchPath('/tmp'));
});
