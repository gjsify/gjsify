// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/stream.
//
// Imports the package's OWN browser entry directly (`./browser.js`) — the thin
// EventEmitter + queue adapter the bundler picks via the `"browser"` export
// condition under `gjsify build --app browser`. It must NOT re-export
// `./test.mjs` (that drags in the full GJS impl + `@gjsify/node-globals`
// register side-effects, which have no browser equivalent) and must NOT import
// `@gjsify/stream` (the bare specifier routes back through the GJS impl).
//
// Asserts the browser-safe surface: Readable/Writable/Transform/PassThrough
// construct; a Readable emits 'data' + 'end'; pipe / pipeline / finished work;
// basic write-side backpressure. The adapter is microtask-scheduled, so the
// event-driven assertions resolve via Promises.

import { describe, it, expect } from '@gjsify/unit';
import { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished } from './browser.js';

export default async () => {
    await describe('stream (browser)', async () => {
        // ==================== construction ====================
        await describe('construction', async () => {
            await it('should construct each public class', async () => {
                expect(new Stream() instanceof Stream).toBe(true);
                expect(new Readable() instanceof Readable).toBe(true);
                expect(new Writable() instanceof Writable).toBe(true);
                expect(new Duplex() instanceof Duplex).toBe(true);
                expect(new Transform() instanceof Transform).toBe(true);
                expect(new PassThrough() instanceof PassThrough).toBe(true);
            });

            await it('should expose helpers as functions', async () => {
                expect(typeof pipeline).toBe('function');
                expect(typeof finished).toBe('function');
            });

            await it('should set readable/writable flags', async () => {
                expect(new Readable().readable).toBe(true);
                expect(new Writable().writable).toBe(true);
            });
        });

        // ==================== Readable emits 'data' + 'end' ====================
        await describe('Readable data + end', async () => {
            await it('should emit pushed chunks as data then end', async () => {
                const r = new Readable();
                const chunks: unknown[] = [];
                await new Promise<void>((res, rej) => {
                    r.on('data', (chunk) => chunks.push(chunk));
                    r.on('end', () => {
                        try {
                            expect(chunks).toStrictEqual(['a', 'b', 'c']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    r.push('a');
                    r.push('b');
                    r.push('c');
                    r.push(null);
                });
            });

            await it('should yield chunks via the async iterator', async () => {
                const r = new Readable();
                r.push(1);
                r.push(2);
                r.push(null);
                const out: unknown[] = [];
                for await (const chunk of r) out.push(chunk);
                expect(out).toStrictEqual([1, 2]);
            });

            await it('Readable.from should drain an iterable', async () => {
                const r = Readable.from([10, 20, 30]);
                const out: unknown[] = [];
                await new Promise<void>((res, rej) => {
                    r.on('data', (c) => out.push(c));
                    r.on('end', () => {
                        try {
                            expect(out).toStrictEqual([10, 20, 30]);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });
        });

        // ==================== Writable ====================
        await describe('Writable', async () => {
            await it('should collect writes via the _write hook', async () => {
                const written: unknown[] = [];
                const w = new Writable();
                w._write = (chunk, _enc, cb) => {
                    written.push(chunk);
                    cb();
                };
                await new Promise<void>((res, rej) => {
                    w.on('finish', () => {
                        try {
                            expect(written).toStrictEqual(['x', 'y']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    w.write('x');
                    w.write('y');
                    w.end();
                });
            });

            await it('should error on write after end', async () => {
                const w = new Writable();
                w._write = (_chunk, _enc, cb) => cb();
                await new Promise<void>((res, rej) => {
                    w.on('error', (err) => {
                        try {
                            expect((err as Error).message).toBe('write after end');
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    w.end();
                    w.write('late');
                });
            });
        });

        // ==================== Transform / PassThrough ====================
        await describe('Transform + PassThrough', async () => {
            await it('Transform should map chunks through _transform', async () => {
                const t = new Transform({
                    transform(chunk, _enc, cb) {
                        cb(null, String(chunk).toUpperCase());
                    },
                });
                const out: unknown[] = [];
                await new Promise<void>((res, rej) => {
                    t.on('data', (c) => out.push(c));
                    t.on('end', () => {
                        try {
                            expect(out).toStrictEqual(['AB', 'CD']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    t.write('ab');
                    t.write('cd');
                    t.end();
                });
            });

            await it('PassThrough should forward chunks unchanged', async () => {
                const p = new PassThrough();
                const out: unknown[] = [];
                await new Promise<void>((res, rej) => {
                    p.on('data', (c) => out.push(c));
                    p.on('end', () => {
                        try {
                            expect(out).toStrictEqual(['one', 'two']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    p.write('one');
                    p.write('two');
                    p.end();
                });
            });
        });

        // ==================== pipe ====================
        await describe('pipe', async () => {
            await it('should pipe Readable → PassThrough and forward data', async () => {
                const src = new Readable();
                const dst = new PassThrough();
                const out: unknown[] = [];
                await new Promise<void>((res, rej) => {
                    dst.on('data', (c) => out.push(c));
                    dst.on('end', () => {
                        try {
                            expect(out).toStrictEqual(['p', 'q']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    src.pipe(dst);
                    src.push('p');
                    src.push('q');
                    src.push(null);
                });
            });
        });

        // ==================== pipeline ====================
        await describe('pipeline', async () => {
            await it('should run source → transform → sink and call back', async () => {
                const src = new Readable();
                const through = new PassThrough();
                const out: unknown[] = [];
                const sink = new Writable();
                sink._write = (chunk, _enc, cb) => {
                    out.push(chunk);
                    cb();
                };
                await new Promise<void>((res, rej) => {
                    pipeline(src, through, sink, (err) => {
                        try {
                            expect(err).toBeFalsy();
                            expect(out).toStrictEqual(['1', '2']);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    src.push('1');
                    src.push('2');
                    src.push(null);
                });
            });
        });

        // ==================== finished ====================
        await describe('finished', async () => {
            await it('should call back when a Readable ends', async () => {
                const r = new Readable();
                await new Promise<void>((res, rej) => {
                    finished(r, (err) => {
                        try {
                            expect(err).toBeFalsy();
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                    r.push('done');
                    r.push(null);
                    r.resume();
                });
            });
        });

        // ==================== backpressure ====================
        await describe('backpressure', async () => {
            await it('write should report not-ready while a slow _write is in flight', async () => {
                const w = new Writable();
                let release: (() => void) | undefined;
                w._write = (_chunk, _enc, cb) => {
                    release = () => cb();
                };
                // First write starts the in-flight _write that never calls back yet.
                const ready = w.write('chunk');
                expect(ready).toBe(false);
                // Drain it so the stream can settle and no error leaks.
                release?.();
                await new Promise<void>((res, rej) => {
                    w.on('drain', () => res());
                    w.on('error', (e) => rej(e));
                });
            });
        });
    });
};
