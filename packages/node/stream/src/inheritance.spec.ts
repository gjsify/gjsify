// oxlint-disable typescript/no-explicit-any -- spec tests CJS/util.inherits patterns that require dynamic `this: any` function constructors
// Stream and util.inherits inheritance tests.
//
// Ported from:
//   refs/node-test/parallel/test-stream-inheritance.js
//   refs/node-test/parallel/test-util-inherits.js
// Original: MIT license, Node.js contributors
// Modifications: adapted to @gjsify/unit, async/await.

import { describe, it, expect } from '@gjsify/unit';
import { Readable, Writable, Duplex, Transform, PassThrough } from 'node:stream';
import { inherits } from 'node:util';
// CJS fixture doing `class extends require('stream')` + `util.inherits(X, require('stream'))`
// (and the same for `events`). Bundled into this suite, its module init crashes under
// `--app gjs` if the `@gjsify/{stream,events}` `"module.exports"` string-export interop
// regresses — so importing it at all is the guard.
import cjsInterop from './cjs-interop.fixture.cjs';

export default async () => {
    // instanceof hierarchy
    await describe('stream inheritance: instanceof checks', async () => {
        await it('Readable is instanceof Readable only', async () => {
            const r = new Readable({ read() {} });
            expect(r instanceof Readable).toBe(true);
            expect(r instanceof Writable).toBe(false);
            expect(r instanceof Duplex).toBe(false);
            expect(r instanceof Transform).toBe(false);
        });

        await it('Writable is instanceof Writable only', async () => {
            const w = new Writable({
                write(_c, _e, cb) {
                    cb();
                },
            });
            expect(w instanceof Readable).toBe(false);
            expect(w instanceof Writable).toBe(true);
            expect(w instanceof Duplex).toBe(false);
            expect(w instanceof Transform).toBe(false);
        });

        await it('Duplex is instanceof Readable and Writable and Duplex', async () => {
            const d = new Duplex({
                read() {},
                write(_c, _e, cb) {
                    cb();
                },
            });
            expect(d instanceof Readable).toBe(true);
            expect(d instanceof Writable).toBe(true);
            expect(d instanceof Duplex).toBe(true);
            expect(d instanceof Transform).toBe(false);
        });

        await it('Transform is instanceof Readable, Writable, Duplex, and Transform', async () => {
            const t = new Transform({
                transform(_c, _e, cb) {
                    cb();
                },
            });
            expect(t instanceof Readable).toBe(true);
            expect(t instanceof Writable).toBe(true);
            expect(t instanceof Duplex).toBe(true);
            expect(t instanceof Transform).toBe(true);
        });

        await it('null and undefined are not instanceof Writable', async () => {
            // Cast through unknown — TS rejects `null instanceof X` directly.
            expect((null as unknown as object) instanceof Writable).toBe(false);
            expect((undefined as unknown as object) instanceof Writable).toBe(false);
        });

        await it('PassThrough is instanceof Transform, Duplex, Readable, Writable', async () => {
            const pt = new PassThrough();
            expect(pt instanceof PassThrough).toBe(true);
            expect(pt instanceof Transform).toBe(true);
            expect(pt instanceof Duplex).toBe(true);
            expect(pt instanceof Readable).toBe(true);
            expect(pt instanceof Writable).toBe(true);
        });
    });

    // Object.setPrototypeOf-based subclass
    await describe('stream inheritance: Object.setPrototypeOf subclassing', async () => {
        await it('subclass via setPrototypeOf is instanceof parent', async () => {
            function CustomWritable(this: any) {}
            Object.setPrototypeOf(CustomWritable, Writable);
            Object.setPrototypeOf((CustomWritable as any).prototype, Writable.prototype);

            const cw: any = new (CustomWritable as any)();
            expect(cw instanceof CustomWritable).toBe(true);
            expect(cw instanceof Writable).toBe(true);
        });

        await it('ES6 class extending Writable is instanceof Writable', async () => {
            class MyWritable extends Writable {
                _write(_c: any, _e: any, cb: () => void) {
                    cb();
                }
            }
            const mw = new MyWritable();
            expect(mw instanceof Writable).toBe(true);
            expect(mw instanceof MyWritable).toBe(true);
        });

        await it('different Writable subclasses are not cross-instanceof', async () => {
            function CustomWritable(this: any) {}
            Object.setPrototypeOf(CustomWritable, Writable);
            Object.setPrototypeOf((CustomWritable as any).prototype, Writable.prototype);

            class OtherWritable extends Writable {
                _write(_c: any, _e: any, cb: () => void) {
                    cb();
                }
            }

            expect(new OtherWritable() instanceof (CustomWritable as any)).toBe(false);
            expect(new (CustomWritable as any)() instanceof OtherWritable).toBe(false);
        });
    });

    // util.inherits — single and multi-level
    await describe('util.inherits: single-level inheritance', async () => {
        await it('sets B.super_ to A', async () => {
            function A(this: any) {
                this._a = 'a';
            }
            (A.prototype as any).a = function () {
                return this._a;
            };

            function B(this: any, value: string) {
                (A as any).call(this);
                this._b = value;
            }
            inherits(B as any, A as any);

            const desc = Object.getOwnPropertyDescriptor(B, 'super_');
            expect(desc).toBeDefined();
            expect((desc as any).value).toBe(A);
            expect((desc as any).enumerable).toBe(false);
            expect((desc as any).configurable).toBe(true);
            expect((desc as any).writable).toBe(true);
        });

        await it('instance methods from parent are accessible on child', async () => {
            function A(this: any) {
                this._a = 'a';
            }
            (A.prototype as any).a = function () {
                return this._a;
            };

            function B(this: any, value: string) {
                (A as any).call(this);
                this._b = value;
            }
            inherits(B as any, A as any);
            (B.prototype as any).b = function () {
                return this._b;
            };

            const b: any = new (B as any)('hello');
            expect(b.a()).toBe('a');
            expect(b.b()).toBe('hello');
            expect(b.constructor).toBe(B);
        });
    });

    await describe('util.inherits: two-level inheritance', async () => {
        await it('C inherits from B inherits from A — all methods accessible', async () => {
            function A(this: any) {
                this._a = 'a';
            }
            (A.prototype as any).a = function () {
                return this._a;
            };

            function B(this: any) {
                (A as any).call(this);
                this._b = 'b';
            }
            inherits(B as any, A as any);
            (B.prototype as any).b = function () {
                return this._b;
            };

            function C(this: any) {
                (B as any).call(this);
                this._c = 'c';
            }
            inherits(C as any, B as any);
            (C.prototype as any).c = function () {
                return this._c;
            };
            (C.prototype as any).getValue = function () {
                return this.a() + this.b() + this.c();
            };

            expect((C as any).super_).toBe(B);

            const c: any = new (C as any)();
            expect(c.getValue()).toBe('abc');
            expect(c.constructor).toBe(C);
        });
    });

    await describe('util.inherits: prototype methods set before inherits()', async () => {
        await it('prototype methods defined before inherits() are preserved', async () => {
            function A(this: any) {
                this._a = 'a';
            }
            (A.prototype as any).a = function () {
                return this._a;
            };

            function B(this: any) {
                (A as any).call(this);
                this._b = 'b';
            }
            inherits(B as any, A as any);
            (B.prototype as any).b = function () {
                return this._b;
            };

            function D(this: any) {
                (B as any).call(this);
                this._d = 'd';
            }
            // Set method BEFORE calling inherits
            (D.prototype as any).d = function () {
                return this._d;
            };
            inherits(D as any, B as any);

            expect((D as any).super_).toBe(B);
            const d: any = new (D as any)();
            expect(d.b()).toBe('b');
            expect(d.d()).toBe('d');
            expect(d.constructor).toBe(D);
        });
    });

    await describe('util.inherits: invalid arguments', async () => {
        await it('throws ERR_INVALID_ARG_TYPE when superCtor has no prototype', async () => {
            function A(this: any) {}
            let threw = false;
            let code = '';
            try {
                inherits(A as any, {} as any);
            } catch (e: any) {
                threw = true;
                code = e.code;
            }
            expect(threw).toBe(true);
            expect(code).toBe('ERR_INVALID_ARG_TYPE');
        });

        await it('throws ERR_INVALID_ARG_TYPE when superCtor is null', async () => {
            function A(this: any) {}
            let threw = false;
            let code = '';
            try {
                inherits(A as any, null as any);
            } catch (e: any) {
                threw = true;
                code = e.code;
            }
            expect(threw).toBe(true);
            expect(code).toBe('ERR_INVALID_ARG_TYPE');
        });

        await it('throws ERR_INVALID_ARG_TYPE when ctor is null', async () => {
            function A(this: any) {}
            (A.prototype as any).a = function () {};
            let threw = false;
            let code = '';
            try {
                inherits(null as any, A as any);
            } catch (e: any) {
                threw = true;
                code = e.code;
            }
            expect(threw).toBe(true);
            expect(code).toBe('ERR_INVALID_ARG_TYPE');
        });
    });

    // util.inherits + stream classes — integration
    await describe('util.inherits + stream: practical subclassing', async () => {
        await it('function-based Readable subclass via inherits works', async () => {
            function NumberSource(this: any, numbers: number[]) {
                Readable.call(this, { objectMode: true });
                this._numbers = numbers.slice();
            }
            inherits(NumberSource as any, Readable as any);
            (NumberSource.prototype as any)._read = function () {
                const n = this._numbers.shift();
                this.push(n !== undefined ? n : null);
            };

            const collected: number[] = [];
            const src: any = new (NumberSource as any)([10, 20, 30]);
            await new Promise<void>((resolve, reject) => {
                src.on('data', (n: number) => collected.push(n));
                src.on('end', resolve);
                src.on('error', reject);
            });
            expect(collected).toEqualArray([10, 20, 30]);
            expect(src instanceof Readable).toBe(true);
        });

        await it('function-based Writable subclass via inherits works', async () => {
            function CollectWritable(this: any) {
                Writable.call(this);
                this.collected = [];
            }
            inherits(CollectWritable as any, Writable as any);
            (CollectWritable.prototype as any)._write = function (chunk: Buffer, _enc: string, cb: () => void) {
                this.collected.push(chunk.toString());
                cb();
            };

            const cw: any = new (CollectWritable as any)();
            await new Promise<void>((resolve, reject) => {
                cw.on('finish', resolve);
                cw.on('error', reject);
                cw.write('hello');
                cw.write('world');
                cw.end();
            });
            expect(cw.collected).toEqualArray(['hello', 'world']);
            expect(cw instanceof Writable).toBe(true);
        });

        await it('function-based Transform subclass via inherits works', async () => {
            function UpperCase(this: any) {
                Transform.call(this);
            }
            inherits(UpperCase as any, Transform as any);
            (UpperCase.prototype as any)._transform = function (
                chunk: Buffer,
                _enc: string,
                cb: (err: null, data: Buffer) => void,
            ) {
                cb(null, Buffer.from(chunk.toString().toUpperCase()));
            };

            const out: string[] = [];
            const uc: any = new (UpperCase as any)();
            await new Promise<void>((resolve, reject) => {
                uc.on('data', (chunk: Buffer) => out.push(chunk.toString()));
                uc.on('end', resolve);
                uc.on('error', reject);
                uc.write('hello');
                uc.write('world');
                uc.end();
            });
            expect(out).toEqualArray(['HELLO', 'WORLD']);
            expect(uc instanceof Transform).toBe(true);
            expect(uc instanceof Readable).toBe(true);
            expect(uc instanceof Writable).toBe(true);
        });
    });

    // CJS `require('stream')` / `require('events')` interop — the bundler
    // `__toCommonJS` + `"module.exports"` string-export path (regression guard).
    // refs/node/lib/internal/streams/destroy.js: destroy() calls `this._destroy`
    // virtually, the constructor stores `opts.destroy` ON THE INSTANCE, and the
    // callback is once-only (a throw counts as the error).
    await describe('stream destroy(): _destroy dispatch', async () => {
        const closed = (s: Readable | Writable) => new Promise<void>((resolve) => s.once('close', () => resolve()));

        await it('Readable and Duplex subclasses run their prototype _destroy', async () => {
            const calls: string[] = [];
            class R extends Readable {
                override _read() {}
                override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
                    calls.push('readable');
                    cb(err);
                }
            }
            class D extends Duplex {
                override _read() {}
                override _write(_c: unknown, _e: BufferEncoding, cb: () => void) {
                    cb();
                }
                override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
                    calls.push('duplex');
                    cb(err);
                }
            }
            const r = new R();
            const d = new D();
            r.destroy();
            d.destroy();
            await Promise.all([closed(r), closed(d)]);
            expect(calls).toStrictEqual(['readable', 'duplex']);
        });

        await it('options.destroy shadows a subclass prototype _destroy', async () => {
            const calls: string[] = [];
            class R extends Readable {
                override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
                    calls.push('prototype');
                    cb(err);
                }
            }
            class W extends Writable {
                override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
                    calls.push('prototype');
                    cb(err);
                }
            }
            const opts = {
                destroy(err: Error | null, cb: (err?: Error | null) => void) {
                    calls.push('option');
                    cb(err);
                },
            };
            const r = new R({ read() {}, ...opts });
            const w = new W({
                write(_c, _e, cb) {
                    cb();
                },
                ...opts,
            });
            r.destroy();
            w.destroy();
            await Promise.all([closed(r), closed(w)]);
            expect(calls).toStrictEqual(['option', 'option']);
        });

        await it('a _destroy that calls back twice emits error and close once', async () => {
            const boom = new Error('boom');
            for (const s of [
                new Readable({
                    read() {},
                    destroy: (_e, cb) => {
                        cb(boom);
                        cb(boom);
                    },
                }),
                new Writable({
                    write: (_c, _e, cb) => cb(),
                    destroy: (_e, cb) => {
                        cb(boom);
                        cb(boom);
                    },
                }),
            ]) {
                let errors = 0;
                let closes = 0;
                s.on('error', () => errors++);
                s.on('close', () => closes++);
                s.destroy();
                await new Promise((resolve) => setTimeout(resolve, 10));
                expect(errors).toBe(1);
                expect(closes).toBe(1);
            }
        });

        await it('a throwing _destroy is reported as the error, then close', async () => {
            const boom = new Error('thrown');
            const r = new Readable({
                read() {},
                destroy() {
                    throw boom;
                },
            });
            const events: unknown[] = [];
            r.on('error', (err) => events.push(err));
            r.on('close', () => events.push('close'));
            r.destroy();
            await closed(r);
            expect(events).toStrictEqual([boom, 'close']);
        });
    });

    await describe('CJS require() interop: class extends require("stream")/("events")', async () => {
        await it('require("stream") yields the callable Stream constructor', async () => {
            expect(typeof cjsInterop.Stream).toBe('function');
            const s = new cjsInterop.ClassExtendsStream();
            expect(s instanceof cjsInterop.ClassExtendsStream).toBe(true);
        });

        await it('require("events") yields the callable EventEmitter constructor', async () => {
            expect(typeof cjsInterop.EventEmitter).toBe('function');
            const e = new cjsInterop.ClassExtendsEmitter();
            expect(e instanceof cjsInterop.ClassExtendsEmitter).toBe(true);
        });

        await it('util.inherits(X, require("stream")) produces a working subclass', async () => {
            const i = new cjsInterop.InheritsStream();
            expect(i instanceof cjsInterop.InheritsStream).toBe(true);
        });
    });
};
