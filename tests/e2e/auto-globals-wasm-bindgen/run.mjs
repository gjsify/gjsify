// E2E test for the wasm-bindgen marker hook in `detectFreeGlobals`.
//
// Validates that the `--globals auto` detector picks up `crypto` from
// the wasm-bindgen-generated function-name pattern
// (`__wbg_crypto_<hash>`, `__wbg_getRandomValues_<hash>`) without
// relying on the user passing `--globals auto,crypto` explicitly.
//
// Background: wasm-bindgen emits its host-API import bindings as
// top-level functions that look like
//
//     function __wbg_crypto_574e78ad8b13b65f(arg0) {
//         const ret = getObject(arg0).crypto;
//         return addHeapObject(ret);
//     }
//
// `getObject(arg0)` is an unfollowable runtime heap dereference, so the
// MemberExpression visitor can't see `.crypto`. We match on the
// function name instead — `__wbg_<jsName>_<hash>` is a wasm-bindgen-
// reserved shape; high precision, high recall.
//
// The driving real-world consumer is loro-crdt (see
// `tests/integration/loro-crdt/`). Before this fix, every wasm-bindgen-
// built npm package needed `--globals auto,crypto` on the command line.
// After: bare `--globals auto` is enough.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/auto-globals-wasm-bindgen/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const DETECTOR_LIB = join(
    MONOREPO_ROOT,
    'packages',
    'infra',
    'rolldown-plugin-gjsify',
    'lib',
    'utils',
    'detect-free-globals.js',
);

const { detectFreeGlobals } = await import(DETECTOR_LIB);

describe('detectFreeGlobals — wasm-bindgen function-name markers', () => {
    it('catches __wbg_crypto_<hash> as crypto', () => {
        const code = `
            function __wbg_crypto_574e78ad8b13b65f(arg0) {
                const ret = getObject(arg0).crypto;
                return addHeapObject(ret);
            }
        `;
        const globals = detectFreeGlobals(code);
        assert.ok(globals.has('crypto'), `expected crypto in: ${[...globals].join(', ')}`);
    });

    it('catches __wbg_getRandomValues_<hash> as crypto', () => {
        const code = `
            function __wbg_getRandomValues_b8f5dbd5f3995a9e() {
                return handleError(function (arg0, arg1) {
                    getObject(arg0).getRandomValues(getObject(arg1));
                }, arguments);
            }
        `;
        const globals = detectFreeGlobals(code);
        assert.ok(globals.has('crypto'), `expected crypto in: ${[...globals].join(', ')}`);
    });

    it('catches __wbg_msCrypto_<hash> as crypto (legacy IE fallback shape)', () => {
        const code = `
            function __wbg_msCrypto_a61aeb35a24c1329(arg0) {
                const ret = getObject(arg0).msCrypto;
                return addHeapObject(ret);
            }
        `;
        const globals = detectFreeGlobals(code);
        assert.ok(globals.has('crypto'), `expected crypto in: ${[...globals].join(', ')}`);
    });

    it('does NOT match `__wbg_` prefix with an unknown jsName', () => {
        // wasm-bindgen has many bindings we don't care about (`__wbg_log_*`,
        // `__wbg_cursor_new`, etc.). Only entries listed in
        // WASM_BINDGEN_MARKERS should trigger injection.
        const code = `
            function __wbg_cursor_new(arg0) { return arg0; }
            function __wbg_log_0cc1b7768397bcfe(arg0) { return arg0; }
        `;
        const globals = detectFreeGlobals(code);
        assert.equal(globals.has('crypto'), false, 'unexpected crypto injection');
    });

    it('does NOT match non-wasm-bindgen functions with similar shape', () => {
        // Function names not starting with `__wbg_` are excluded — some
        // library could have an unrelated `wbg_crypto_helper` that
        // shouldn't trigger crypto injection.
        const code = `
            function wbg_crypto_helper() { return null; }
            function fn_crypto_thing() { return null; }
        `;
        const globals = detectFreeGlobals(code);
        assert.equal(globals.has('crypto'), false, 'unexpected crypto injection');
    });

    it('triggers on the realistic loro-crdt bundle excerpt', () => {
        // Both crypto-related wasm-bindgen functions present in the
        // actual loro-crdt 1.12.1 bundle. Either alone would be enough
        // to inject crypto; together they prove the marker is robust to
        // the "binding for crypto, binding for getRandomValues" pattern.
        const code = `
            var addHeapObject, getObject, handleError;
            function __wbg_crypto_574e78ad8b13b65f(arg0) {
                const ret = getObject(arg0).crypto;
                return addHeapObject(ret);
            }
            function __wbg_getRandomValues_b8f5dbd5f3995a9e() {
                return handleError(function (arg0, arg1) {
                    getObject(arg0).getRandomValues(getObject(arg1));
                }, arguments);
            }
            function __wbg_cursor_new(arg0) { return arg0; }
        `;
        const globals = detectFreeGlobals(code);
        assert.ok(globals.has('crypto'), `expected crypto in: ${[...globals].join(', ')}`);
    });
});

describe('detectFreeGlobals — pre-existing direct-detection paths still work', () => {
    it('catches a bare free identifier', () => {
        const globals = detectFreeGlobals('fetch("/api");');
        assert.ok(globals.has('fetch'));
    });

    it('catches globalThis.X member access', () => {
        const globals = detectFreeGlobals('globalThis.fetch("/api");');
        assert.ok(globals.has('fetch'));
    });

    it('ignores locally-shadowed names', () => {
        const code = 'function outer() { const fetch = 1; fetch + 1; }';
        const globals = detectFreeGlobals(code);
        assert.equal(globals.has('fetch'), false);
    });
});
