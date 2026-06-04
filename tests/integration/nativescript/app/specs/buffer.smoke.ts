// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/buffer (nativescript:'polyfill' slot) on NS V8.
// Behaviour cross-checked against refs/node/test/parallel/test-buffer-*.js
// and refs/llrt/tests/unit/buffer.test.ts.
import { Buffer } from '@gjsify/buffer';
import { describe, it, expect } from '../reporter.js';

export default async function bufferSmoke(): Promise<void> {
    await describe('@gjsify/buffer', async () => {
        await it('from(string) utf8 round-trip', () => {
            const b = Buffer.from('héllo');
            expect(b.toString('utf8')).toBe('héllo');
        });
        await it('byteLength counts utf8 bytes', () => {
            expect(Buffer.byteLength('héllo', 'utf8')).toBe(6);
        });
        await it('base64 round-trip', () => {
            const b = Buffer.from('hello world');
            expect(b.toString('base64')).toBe('aGVsbG8gd29ybGQ=');
            expect(Buffer.from('aGVsbG8gd29ybGQ=', 'base64').toString('utf8')).toBe('hello world');
        });
        await it('hex round-trip', () => {
            expect(Buffer.from('ff00aa', 'hex').toString('hex')).toBe('ff00aa');
        });
        await it('concat joins buffers', () => {
            const out = Buffer.concat([Buffer.from('foo'), Buffer.from('bar')]);
            expect(out.toString()).toBe('foobar');
        });
        await it('alloc zero-fills', () => {
            const b = Buffer.alloc(4);
            expect(b.length).toBe(4);
            expect(b[0]).toBe(0);
            expect(b[3]).toBe(0);
        });
        await it('write + read round-trips bytes', () => {
            const b = Buffer.alloc(2);
            b.writeUInt8(0x12, 0);
            b.writeUInt8(0x34, 1);
            expect(b.readUInt8(0)).toBe(0x12);
            expect(b.toString('hex')).toBe('1234');
        });
    });
}
