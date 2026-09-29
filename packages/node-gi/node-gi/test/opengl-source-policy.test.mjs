// SPDX-License-Identifier: MIT
// decideOpenGLSource — which OpenGL serves GTK on win32 (#1097). PURE, so every branch runs
// here on any host; the Windows leg's win32-opengl.test.mjs proves the preload it drives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOpenGLSource, glRuntimePackageName } from '../gtk-runtime.js';

const bundled = 'C:\\app\\node_modules\\@gjsify\\gl-runtime-win32-x64\\bin\\opengl32.dll';
const none = { wddmIcd: '', registryIcd: '', loadedFrom: '' };

test('a GPU-less host with the optional package gets Mesa', () => {
    assert.equal(decideOpenGLSource({ bundled, host: none }).source, 'bundle');
});

test('a GPU-less host WITHOUT the package is told which package to add', () => {
    const decision = decideOpenGLSource({ bundled: null, host: none });
    assert.equal(decision.source, 'system');
    assert.equal(decision.missing, true);
    assert.ok(decision.reason.includes('@gjsify/gl-runtime-win32-x64'), decision.reason);
    assert.equal(glRuntimePackageName('win32-x64'), '@gjsify/gl-runtime-win32-x64');
    // Accepting the gap is a choice, and it silences the advice.
    assert.equal(decideOpenGLSource({ bundled: null, host: none, override: 'system' }).missing, undefined);
    // `bundle` cannot conjure a package that is not installed.
    assert.equal(decideOpenGLSource({ bundled: null, host: none, override: 'bundle' }).source, 'system');
});

test("a vendor driver's ICD wins by default, from either place Windows looks — and needs no package", () => {
    for (const pkg of [bundled, null]) {
        const wddm = decideOpenGLSource({ bundled: pkg, host: { ...none, wddmIcd: 'nvoglv64.dll' } });
        assert.deepEqual([wddm.source, /nvoglv64/.test(wddm.reason), wddm.missing], ['system', true, undefined]);
        const registry = decideOpenGLSource({ bundled: pkg, host: { ...none, registryIcd: 'MSOGL' } });
        assert.deepEqual([registry.source, /MSOGL/.test(registry.reason)], ['system', true]);
    }
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
