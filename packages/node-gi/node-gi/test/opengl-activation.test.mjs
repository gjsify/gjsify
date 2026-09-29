// SPDX-License-Identifier: MIT
// activateBundledOpenGL — turning the OpenGL decision into what this process DOES (#1097).
// opengl-source-policy.test.mjs covers which source wins; this covers the three actions that
// decision drives, none of which ran anywhere before: the GJSIFY_OPENGL_MISSING warning, the
// preload, and the fallback when the loader refuses.
//
// The WIRING is asserted here, not the win32 facts behind it. Every one of them is a host
// reading — process.platform, the GL package on disk, the bundle's windowing marker — so they
// arrive through the `deps` argument instead of being faked into the environment, the way the
// sibling specs pass a recording `native` rather than a real addon. What is provable only on
// Windows is what the preload actually loads: test/win32-opengl.test.mjs, on the
// windows-gtk-windowing runner, A/Bs that against GJSIFY_OPENGL=system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateBundledOpenGL, resetOpenGLForTests } from '../gtk-runtime.js';

const GL_DLL = 'C:\\app\\node_modules\\@gjsify\\gl-runtime-win32-x64\\bin\\opengl32.dll';
/** What the C++ probe reports for a host with no OpenGL driver at all. */
const noDriver = { wddmIcd: '', registryIcd: '', loadedFrom: '' };

/**
 * The addon surface this function uses, with both halves counted: a spec that asserts the
 * warning fired must also be able to see that NOTHING was preloaded, and vice versa.
 */
function recordingNative({ host = noDriver, preload } = {}) {
    const calls = { probes: 0, preloads: [] };
    return {
        calls,
        probeHostOpenGL: () => {
            calls.probes += 1;
            return host;
        },
        preloadOpenGL: (p) => {
            calls.preloads.push(p);
            if (preload) throw preload;
            return p;
        },
    };
}

/** The warnings process.emitWarning schedules, once they have actually fired. */
async function warningsDuring(body) {
    const seen = [];
    const onWarning = (w) => seen.push(w);
    process.on('warning', onWarning);
    try {
        await body();
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        process.off('warning', onWarning);
    }
    return seen;
}

/** Run `body` with GJSIFY_OPENGL unset, then restore it — a developer's shell must not decide. */
async function withNoOverride(body) {
    const before = process.env.GJSIFY_OPENGL;
    delete process.env.GJSIFY_OPENGL;
    try {
        return await body();
    } finally {
        if (before === undefined) delete process.env.GJSIFY_OPENGL;
        else process.env.GJSIFY_OPENGL = before;
    }
}

test('off win32 the activation does nothing at all — no probe, no preload, no advice', async () => {
    for (const platform of ['linux', 'darwin']) {
        resetOpenGLForTests();
        const native = recordingNative();
        const warnings = await withNoOverride(() =>
            warningsDuring(() => {
                assert.equal(activateBundledOpenGL(native, { platform, bundled: GL_DLL, windowing: true }), null);
            }),
        );
        assert.deepEqual(native.calls, { probes: 0, preloads: [] }, platform);
        assert.deepEqual(
            warnings.map((w) => w.code),
            [],
            platform,
        );
    }
});

test('an addon built before the probe existed is left alone, on win32 too', () => {
    resetOpenGLForTests();
    assert.equal(activateBundledOpenGL({ preloadOpenGL: (p) => p }, { platform: 'win32', windowing: true }), null);
});

test('a driverless host with a WINDOWING bundle is told once which package to add', async () => {
    resetOpenGLForTests();
    const native = recordingNative();
    const warnings = await withNoOverride(() =>
        warningsDuring(() => {
            // The package is absent, and the activation is idempotent — so this runs twice and
            // the advice must still be ONE warning, not one per call.
            const first = activateBundledOpenGL(native, { platform: 'win32', bundled: null, windowing: true });
            const second = activateBundledOpenGL(native, { platform: 'win32', bundled: null, windowing: true });
            assert.deepEqual(first, second);
            assert.equal(first.source, 'system');
            assert.equal(first.missing, true);
        }),
    );
    const advice = warnings.filter((w) => w.code === 'GJSIFY_OPENGL_MISSING');
    assert.equal(advice.length, 1, warnings.map((w) => w.name + ':' + w.code).join(', '));
    assert.match(advice[0].message, /@gjsify\/gl-runtime-win32-x64/);
    // Advice, not a preload: there is nothing to preload.
    assert.deepEqual(native.calls.preloads, []);
    // And the second call was the memo, not a second probe.
    assert.equal(native.calls.probes, 1);
});

test('a headless process is not advised — it never asks for GL', async () => {
    resetOpenGLForTests();
    const warnings = await withNoOverride(() =>
        warningsDuring(() => {
            const result = activateBundledOpenGL(recordingNative(), {
                platform: 'win32',
                bundled: null,
                windowing: false,
            });
            assert.equal(result.source, 'system');
        }),
    );
    assert.deepEqual(
        warnings.map((w) => w.code),
        [],
    );
});

test('a package that IS present is preloaded by absolute path', async () => {
    resetOpenGLForTests();
    const native = recordingNative();
    const result = await withNoOverride(() => {
        assert.deepEqual(native.calls.preloads, []);
        return activateBundledOpenGL(native, { platform: 'win32', bundled: GL_DLL, windowing: true });
    });
    assert.equal(result.source, 'bundle');
    assert.equal(result.loadedFrom, GL_DLL);
    assert.deepEqual(native.calls.preloads, [GL_DLL]);
});

test('a preload the loader refuses falls back to the system instead of throwing', async () => {
    resetOpenGLForTests();
    const native = recordingNative({ preload: new Error('LoadLibraryExW(...) failed: 126 (module not found)') });
    const warnings = await withNoOverride(() =>
        warningsDuring(() => {
            const result = activateBundledOpenGL(native, { platform: 'win32', bundled: GL_DLL, windowing: true });
            // GTK renders with cairo either way; the process must survive to do that.
            assert.equal(result.source, 'system');
            assert.equal(result.loadedFrom, null);
            assert.match(result.reason, /preloading the bundled OpenGL failed/);
            assert.match(result.reason, /126/);
        }),
    );
    assert.deepEqual(native.calls.preloads, [GL_DLL]);
    const reported = warnings.filter((w) => w.code === 'GJSIFY_OPENGL_PRELOAD');
    assert.equal(reported.length, 1, warnings.map((w) => w.name + ':' + w.code).join(', '));
    assert.match(reported[0].message, /126/);
});

test('resetOpenGLForTests lets a later activation decide again', async () => {
    resetOpenGLForTests();
    const native = recordingNative();
    await withNoOverride(() => {
        activateBundledOpenGL(native, { platform: 'win32', bundled: null, windowing: false });
        activateBundledOpenGL(native, { platform: 'win32', bundled: null, windowing: false });
        assert.equal(native.calls.probes, 1);
        resetOpenGLForTests();
        activateBundledOpenGL(native, { platform: 'win32', bundled: null, windowing: false });
    });
    assert.equal(native.calls.probes, 2);
});
