// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/webassembly.
//
// Uses the browser-native `WebAssembly` global directly. The GJS polyfill
// only adds the Promise-API wrappers (`compile`/`instantiate`/`validate`)
// around SpiderMonkey's synchronous constructors — in the browser those
// Promise APIs are already native, so this entry validates them straight off
// the `WebAssembly` global.

import { run, describe, it, expect } from '@gjsify/unit';

// Minimal wasm module exporting `add(a: i32, b: i32) -> i32`.
// Hand-encoded per https://webassembly.github.io/spec/core/binary/.
const ADD_WASM = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x03, 0x02,
    0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20,
    0x01, 0x6a, 0x0b,
]);
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const GARBAGE = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

run({
    async WebAssemblyTest() {
        await describe('WebAssembly.validate', async () => {
            await it('returns true for a valid module', async () => {
                expect(WebAssembly.validate(EMPTY_WASM)).toBe(true);
                expect(WebAssembly.validate(ADD_WASM)).toBe(true);
            });

            await it('returns false for invalid bytes', async () => {
                expect(WebAssembly.validate(GARBAGE)).toBe(false);
            });
        });

        await describe('WebAssembly.compile', async () => {
            await it('resolves a Module', async () => {
                const module = await WebAssembly.compile(ADD_WASM);
                expect(module instanceof WebAssembly.Module).toBe(true);
            });

            await it('rejects on invalid bytes', async () => {
                let threw = false;
                try {
                    await WebAssembly.compile(GARBAGE);
                } catch {
                    threw = true;
                }
                expect(threw).toBe(true);
            });
        });

        await describe('WebAssembly.instantiate', async () => {
            await it('instantiate(buffer) resolves { module, instance }', async () => {
                const result = (await WebAssembly.instantiate(ADD_WASM)) as WebAssembly.WebAssemblyInstantiatedSource;
                expect(result.module instanceof WebAssembly.Module).toBe(true);
                expect(result.instance instanceof WebAssembly.Instance).toBe(true);
                const add = result.instance.exports.add as (a: number, b: number) => number;
                expect(add(2, 3)).toBe(5);
            });

            await it('instantiate(module) resolves an Instance', async () => {
                const module = new WebAssembly.Module(ADD_WASM);
                const instance = (await WebAssembly.instantiate(module)) as WebAssembly.Instance;
                expect(instance instanceof WebAssembly.Instance).toBe(true);
                const add = instance.exports.add as (a: number, b: number) => number;
                expect(add(7, 8)).toBe(15);
            });
        });

        await describe('WebAssembly synchronous constructors', async () => {
            await it('new Module / new Instance work', async () => {
                const module = new WebAssembly.Module(ADD_WASM);
                expect(module instanceof WebAssembly.Module).toBe(true);
                const instance = new WebAssembly.Instance(module);
                expect(instance instanceof WebAssembly.Instance).toBe(true);
                const add = instance.exports.add as (a: number, b: number) => number;
                expect(add(10, 20)).toBe(30);
            });
        });
    },
});
