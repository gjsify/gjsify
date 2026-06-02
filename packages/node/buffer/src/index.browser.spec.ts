// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/buffer.
//
// Imports the package's OWN entry directly (`./index.js`) — `Buffer` is a
// portable pure-TS impl over Uint8Array + Blob/atob/btoa, so the same file the
// bundler picks under `gjsify build --app browser` runs in a browser. It must
// NOT re-export `./test.mjs` (that re-export tree-shakes the browser bundle to
// 0 bytes and pulls in `@gjsify/node-globals` register side-effects) and must
// NOT import `@gjsify/buffer`.
//
// Asserts the browser-safe Buffer surface: from / alloc, toString('utf8' |
// 'base64' | 'hex'), Buffer.concat, and Buffer.byteLength.

import { describe, it, expect } from '@gjsify/unit';
import { Buffer } from './index.js';

export default async () => {
    await describe('buffer (browser)', async () => {
        // ==================== Buffer.from ====================
        await describe('Buffer.from', async () => {
            await it('should build from a utf8 string', async () => {
                const buf = Buffer.from('hi');
                expect(buf.length).toBe(2);
                expect(buf[0]).toBe(0x68);
                expect(buf[1]).toBe(0x69);
            });

            await it('should build from a byte array', async () => {
                const buf = Buffer.from([1, 2, 3]);
                expect(buf.length).toBe(3);
                expect(buf[0]).toBe(1);
                expect(buf[2]).toBe(3);
            });

            await it('should decode a base64 string', async () => {
                const buf = Buffer.from('aGVsbG8=', 'base64');
                expect(buf.toString('utf8')).toBe('hello');
            });

            await it('should decode a hex string', async () => {
                const buf = Buffer.from('48656c6c6f', 'hex');
                expect(buf.toString('utf8')).toBe('Hello');
            });
        });

        // ==================== Buffer.alloc ====================
        await describe('Buffer.alloc', async () => {
            await it('should zero-fill by default', async () => {
                const buf = Buffer.alloc(4);
                expect(buf.length).toBe(4);
                expect(buf[0]).toBe(0);
                expect(buf[3]).toBe(0);
            });

            await it('should fill with a numeric value', async () => {
                const buf = Buffer.alloc(3, 7);
                expect(Array.from(buf)).toStrictEqual([7, 7, 7]);
            });
        });

        // ==================== toString encodings ====================
        await describe('toString', async () => {
            await it('should round-trip utf8', async () => {
                expect(Buffer.from('héllo', 'utf8').toString('utf8')).toBe('héllo');
            });

            await it('should encode to base64', async () => {
                expect(Buffer.from('hello').toString('base64')).toBe('aGVsbG8=');
            });

            await it('should encode to hex', async () => {
                expect(Buffer.from('Hello').toString('hex')).toBe('48656c6c6f');
            });

            await it('should honor start / end offsets', async () => {
                expect(Buffer.from('abcdef').toString('utf8', 1, 4)).toBe('bcd');
            });
        });

        // ==================== Buffer.concat ====================
        await describe('Buffer.concat', async () => {
            await it('should join multiple buffers', async () => {
                const out = Buffer.concat([Buffer.from('foo'), Buffer.from('bar')]);
                expect(out.length).toBe(6);
                expect(out.toString('utf8')).toBe('foobar');
            });

            await it('should respect an explicit total length', async () => {
                const out = Buffer.concat([Buffer.from('abc'), Buffer.from('def')], 4);
                expect(out.length).toBe(4);
                expect(out.toString('utf8')).toBe('abcd');
            });

            await it('should return an empty buffer for an empty list', async () => {
                expect(Buffer.concat([]).length).toBe(0);
            });
        });

        // ==================== Buffer.byteLength ====================
        await describe('Buffer.byteLength', async () => {
            await it('should count ascii bytes', async () => {
                expect(Buffer.byteLength('hello', 'utf8')).toBe(5);
            });

            await it('should count multibyte utf8 bytes', async () => {
                // 'é' is 2 bytes in UTF-8.
                expect(Buffer.byteLength('é', 'utf8')).toBe(2);
            });

            await it('should count hex-decoded bytes', async () => {
                expect(Buffer.byteLength('deadbeef', 'hex')).toBe(4);
            });
        });
    });
};
