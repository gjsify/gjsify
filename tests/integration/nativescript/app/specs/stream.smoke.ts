// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/stream (nativescript:'polyfill' slot) on NS V8.
// The stream polyfill is pure TS (no gi:// / GLib), so it should run unmodified
// on NativeScript's V8 — this confirms it actually does, not just that it
// bundles. Behaviour cross-checked against refs/node/test/parallel/test-stream-*.
import { Readable, Writable, Transform, PassThrough, pipeline } from '@gjsify/stream';
import { describe, it, expect } from '../reporter.js';

// Collect every chunk a readable emits into one utf8 string.
function collect(readable: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
        let out = '';
        readable.on('data', (chunk: unknown) => {
            out += typeof chunk === 'string' ? chunk : String(chunk);
        });
        readable.on('end', () => resolve(out));
        readable.on('error', reject);
    });
}

export default async function streamSmoke(): Promise<void> {
    await describe('@gjsify/stream', async () => {
        await it('Readable.from emits each item in order', async () => {
            const r = Readable.from(['a', 'b', 'c']);
            expect(await collect(r)).toBe('abc');
        });

        await it('PassThrough round-trips written data', async () => {
            const pt = new PassThrough();
            const collected = collect(pt);
            pt.write('hello ');
            pt.write('world');
            pt.end();
            expect(await collected).toBe('hello world');
        });

        await it('Transform maps each chunk', async () => {
            const upper = new Transform({
                transform(chunk: unknown, _enc: unknown, cb: (err?: Error | null, data?: unknown) => void) {
                    cb(null, String(chunk).toUpperCase());
                },
            });
            const collected = collect(upper);
            upper.write('ab');
            upper.write('cd');
            upper.end();
            expect(await collected).toBe('ABCD');
        });

        await it('pipeline streams source → transform → sink', async () => {
            const chunks: string[] = [];
            const sink = new Writable({
                write(chunk: unknown, _enc: unknown, cb: (err?: Error | null) => void) {
                    chunks.push(String(chunk));
                    cb();
                },
            });
            const upper = new Transform({
                transform(chunk: unknown, _enc: unknown, cb: (err?: Error | null, data?: unknown) => void) {
                    cb(null, String(chunk).toUpperCase());
                },
            });
            await new Promise<void>((resolve, reject) => {
                pipeline(Readable.from(['foo', 'bar']), upper, sink, (err?: Error | null) =>
                    err ? reject(err) : resolve(),
                );
            });
            expect(chunks.join('')).toBe('FOOBAR');
        });

        await it('readable async-iterates', async () => {
            const r = Readable.from(['x', 'y', 'z']);
            let out = '';
            for await (const chunk of r) {
                out += String(chunk);
            }
            expect(out).toBe('xyz');
        });
    });
}
