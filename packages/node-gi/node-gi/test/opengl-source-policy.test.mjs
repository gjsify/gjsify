// SPDX-License-Identifier: MIT
// decideOpenGLSource — which OpenGL serves GTK on win32 (#1097). PURE, so every branch runs
// here on any host; the Windows leg's win32-opengl.test.mjs proves the preload it drives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOpenGLSource } from '../gtk-runtime.js';

const bundled = 'C:\\app\\gtk\\bin\\opengl32.dll';
const none = { wddmIcd: '', registryIcd: '', loadedFrom: '' };

test('a GPU-less host gets the bundled Mesa', () => {
    assert.equal(decideOpenGLSource({ bundled, host: none }).source, 'bundle');
});

test('a bundle without a GL implementation leaves the host in charge', () => {
    assert.equal(decideOpenGLSource({ bundled: null, host: none }).source, 'system');
    assert.equal(decideOpenGLSource({ bundled: null, host: none, override: 'bundle' }).source, 'system');
});

test("a vendor driver's ICD wins by default, from either place Windows looks", () => {
    const wddm = decideOpenGLSource({ bundled, host: { ...none, wddmIcd: 'nvoglv64.dll' } });
    assert.deepEqual([wddm.source, /nvoglv64/.test(wddm.reason)], ['system', true]);
    const registry = decideOpenGLSource({ bundled, host: { ...none, registryIcd: 'MSOGL' } });
    assert.deepEqual([registry.source, /MSOGL/.test(registry.reason)], ['system', true]);
});

test('GJSIFY_OPENGL overrides the probe in both directions', () => {
    assert.equal(decideOpenGLSource({ bundled, host: none, override: 'system' }).source, 'system');
    const forced = decideOpenGLSource({ bundled, host: { ...none, wddmIcd: 'nvoglv64.dll' }, override: 'bundle' });
    assert.equal(forced.source, 'bundle');
});

test('an opengl32 already in the process cannot be replaced, whatever was asked', () => {
    const host = { ...none, loadedFrom: 'C:\\Windows\\SYSTEM32\\opengl32.dll' };
    const decision = decideOpenGLSource({ bundled, host, override: 'bundle' });
    assert.equal(decision.source, 'system');
    assert.match(decision.reason, /already loaded/);
});
