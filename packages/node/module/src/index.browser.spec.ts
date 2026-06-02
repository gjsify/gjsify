// oxlint-disable typescript/no-explicit-any -- spec inspects thrown error .code on the browser stub
// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/module.
//
// Imports the browser implementation directly (`./browser.js`) rather than
// `node:module` — the package's `exports` map has no `browser` condition, so a
// bare `node:module` import would not select the stub.
//
// Locks in the current honest browser behavior (slot: browser:partial):
//   - `builtinModules` is the real Node built-in catalog (a static list — a
//     browser's inability to resolve a built-in does not change which names ARE
//     built-ins).
//   - `isBuiltin` is subpath-aware: `fs`, `node:fs`, `fs/promises` → true; npm
//     names → false.
//   - `createRequire(url)` returns a `require`-shaped function that throws
//     ERR_REQUIRE_ESM for built-in specifiers and ERR_MODULE_NOT_FOUND for
//     everything else; its `cache` / `resolve` props are present so static
//     reads don't crash before the call.

import { describe, it, expect } from '@gjsify/unit';
import { builtinModules, isBuiltin, createRequire } from './browser.js';

function thrownCode(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (e) {
        return (e as any).code;
    }
    return undefined;
}

export default async () => {
    await describe('module (browser)', async () => {
        await describe('builtinModules', async () => {
            await it('is the real Node built-in catalog', async () => {
                expect(Array.isArray(builtinModules)).toBe(true);
                expect(builtinModules).toContain('fs');
                expect(builtinModules).toContain('path');
                expect(builtinModules).toContain('stream');
                expect(builtinModules).toContain('module');
            });

            await it('does not include npm package names', async () => {
                expect(builtinModules.includes('express')).toBe(false);
            });
        });

        await describe('isBuiltin', async () => {
            await it('returns true for a bare built-in name', async () => {
                expect(isBuiltin('fs')).toBe(true);
            });

            await it('returns true for the node: prefixed form', async () => {
                expect(isBuiltin('node:fs')).toBe(true);
            });

            await it('returns true for a built-in subpath', async () => {
                expect(isBuiltin('fs/promises')).toBe(true);
            });

            await it('returns false for an npm package name', async () => {
                expect(isBuiltin('lodash')).toBe(false);
            });

            await it('returns false for the empty string', async () => {
                expect(isBuiltin('')).toBe(false);
            });
        });

        await describe('createRequire', async () => {
            await it('returns a require-shaped function with cache/resolve props', async () => {
                const req = createRequire('file:///app/index.js');
                expect(typeof req).toBe('function');
                expect(typeof req.resolve).toBe('function');
                expect(typeof req.cache).toBe('object');
                expect(req.main).toBeUndefined();
            });

            await it('throws ERR_REQUIRE_ESM when requiring a built-in', async () => {
                const req = createRequire('file:///app/index.js');
                expect(thrownCode(() => req('fs'))).toBe('ERR_REQUIRE_ESM');
                expect(thrownCode(() => req('node:path'))).toBe('ERR_REQUIRE_ESM');
            });

            await it('throws ERR_MODULE_NOT_FOUND for a non-built-in specifier', async () => {
                const req = createRequire('file:///app/index.js');
                expect(thrownCode(() => req('lodash'))).toBe('ERR_MODULE_NOT_FOUND');
            });

            await it('require.resolve throws the same codes', async () => {
                const req = createRequire('file:///app/index.js');
                expect(thrownCode(() => req.resolve('fs'))).toBe('ERR_REQUIRE_ESM');
                expect(thrownCode(() => req.resolve('lodash'))).toBe('ERR_MODULE_NOT_FOUND');
            });
        });
    });
};
