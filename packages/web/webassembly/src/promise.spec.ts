// SPDX-License-Identifier: MIT
// Test the WebAssembly Promise-API polyfill.
//
// Uses an inline minimal valid wasm module exporting a single `add(i32, i32) -> i32`
// function. Hand-encoded so the test is self-contained (no fs / fixtures).

import { describe, it, expect } from '@gjsify/unit';
import {
    compile,
    instantiate,
    validate,
} from '@gjsify/webassembly';

// Minimal wasm module exporting `add(a: i32, b: i32) -> i32`.
// Hand-encoded per https://webassembly.github.io/spec/core/binary/.
//   magic + version
//   type section: (func (param i32 i32) (result i32))
//   function section: function 0 has type 0
//   export section: "add" → func 0
//   code section: local.get 0; local.get 1; i32.add; end
const ADD_WASM = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
    0x03, 0x02, 0x01, 0x00,
    0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
    0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const GARBAGE = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

export default async () => {
    await describe('WebAssembly Promise APIs', async () => {
        await it('validate returns true for valid module', async () => {
            expect(validate(EMPTY_WASM)).toBe(true);
            expect(validate(ADD_WASM)).toBe(true);
        });

        await it('validate returns false for invalid bytes', async () => {
            expect(validate(GARBAGE)).toBe(false);
        });

        await it('compile resolves a Module', async () => {
            const module = await compile(ADD_WASM);
            expect(module).toBeDefined();
            expect(module instanceof WebAssembly.Module).toBe(true);
        });

        await it('compile rejects on invalid bytes', async () => {
            let threw = false;
            try {
                await compile(GARBAGE);
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('instantiate(buffer) resolves { module, instance }', async () => {
            const result = await instantiate(ADD_WASM);
            expect(result.module instanceof WebAssembly.Module).toBe(true);
            expect(result.instance instanceof WebAssembly.Instance).toBe(true);
            const add = result.instance.exports.add as (a: number, b: number) => number;
            expect(add(2, 3)).toBe(5);
        });

        await it('instantiate(module) resolves an Instance', async () => {
            const module = new WebAssembly.Module(ADD_WASM);
            const instance = (await instantiate(module)) as WebAssembly.Instance;
            expect(instance instanceof WebAssembly.Instance).toBe(true);
            const add = instance.exports.add as (a: number, b: number) => number;
            expect(add(7, 8)).toBe(15);
        });

        await it('register installs WebAssembly.compile globally', async () => {
            // /register/promise replaces the runtime stubs with our wrappers.
            // Verify global API matches our exports.
            const module = await WebAssembly.compile(ADD_WASM);
            expect(module instanceof WebAssembly.Module).toBe(true);
            const result = await WebAssembly.instantiate(ADD_WASM);
            const add = (result as WebAssembly.WebAssemblyInstantiatedSource).instance.exports.add as (a: number, b: number) => number;
            expect(add(10, 20)).toBe(30);
            expect(WebAssembly.validate(EMPTY_WASM)).toBe(true);
            expect(WebAssembly.validate(GARBAGE)).toBe(false);
        });
    });
};
