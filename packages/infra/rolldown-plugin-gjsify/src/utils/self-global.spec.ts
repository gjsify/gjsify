// SPDX-License-Identifier: MIT
// `self` reaches a GJS bundle as an injected register, not as a `transform.define`.
//
// GJS defines `window` as a non-configurable alias of the global object but does NOT define
// `self`, the other half of the same web-platform identity (`typeof self` is 'undefined' on
// gjs 1.88.1). UMD is what finds the gap: webpack's `globalObject: 'self'` emits a factory
// invoked as `}(self, …)`, an UNGUARDED read that throws `ReferenceError: self is not defined`
// at import, before a line of the package runs. joi's browser build — which `mailauth` pulls in
// through joi's `browser` field — is exactly that shape.
//
// The tempting fix is `define: { self: 'globalThis' }` beside the existing `window` one. It is
// wrong for two independent reasons, and both are what this file pins:
//
//   1. A define rewrites `typeof self === 'undefined'` into `typeof globalThis === 'undefined'`,
//      false on every runtime, so every isomorphic guard in the bundle flips (ADR 0079 measured
//      this on @mtcute/web for `window`). The detector's typeof-guard exclusion keeps the
//      register honest instead: a name seen ONLY inside `typeof` is not injected.
//   2. A define rewrites the TARGET of a bare `self = …` into `globalThis = …` — the defect the
//      window-assign plugin exists to undo for `window`.
//
// The `window` define stays an identity on GJS because the host really does define `window`. For
// `self` there is nothing to be an identity of, which is the whole difference.

import { describe, expect, it } from '@gjsify/unit';

import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';
import { detectFreeGlobals } from './detect-free-globals.js';
import { setupForGjs } from '../app/gjs.js';

/** The shape webpack emits for `globalObject: 'self'`, reduced to its last line. */
const UMD_TAIL = '!function(e,t){e.joi=t()}(self,()=>({}));\n';

/** Same widening the production consumers apply — the map ships as untyped `.mjs`. */
const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;

export default async () => {
    await describe('`self` as an auto-injected global', async () => {
        await it('detects an unguarded UMD read of `self`', () => {
            expect(detectFreeGlobals(UMD_TAIL).has('self')).toBe(true);
        });

        await it('does not detect a lone `typeof self` guard', () => {
            // Pervasive in isomorphic packages. On GJS the guarded branch is dead either way, and
            // injecting for it would make the guard lie about the runtime.
            const code = 'export const isWeb = typeof self !== "undefined";\n';
            expect(detectFreeGlobals(code).has('self')).toBe(false);
        });

        await it('still detects `self` when a guard is followed by a real read', () => {
            const code = 'if (typeof self !== "undefined") { self.x = 1; }\n';
            expect(detectFreeGlobals(code).has('self')).toBe(true);
        });

        await it('detects `self` as the host of a member read, and the member too', () => {
            // `self.crypto` needs BOTH: the alias to exist and the property to be registered.
            const detected = detectFreeGlobals('const c = self.crypto;\n');
            expect(detected.has('self')).toBe(true);
            expect(detected.has('crypto')).toBe(true);
        });

        await it('does not flag a locally declared `self`', () => {
            // `const self = this` is the oldest idiom in the language. It is not the global.
            const code = 'function f() { const self = {}; return self; }\n';
            expect(detectFreeGlobals(code).has('self')).toBe(false);
        });

        await it('maps `self` to a register, so nothing rewrites the source', () => {
            expect(GLOBALS_MAP.self).toBe('@gjsify/web-globals/register/self');
        });

        await it('keeps `self` OUT of the --app gjs define table', async () => {
            // The guard against someone "completing" the table next to `window`. A define here
            // would silently defeat every assertion above.
            const { options } = await setupForGjs({ output: { file: 'out.gjs.mjs' }, pluginOptions: {} });
            const define = options.transform?.define ?? {};
            expect(Object.prototype.hasOwnProperty.call(define, 'self')).toBe(false);
            // The control: `window` IS defined, so a table read that returns nothing at all
            // cannot pass this test by accident.
            expect(define.window).toBe('globalThis');
        });
    });
};
