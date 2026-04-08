// Legacy `.call(this)` + `util.inherits(Sub, Parent)` compatibility tests.
//
// Ported from refs/node-test/parallel/test-util-inherits.js
// Original: MIT license, Node.js contributors
// Modifications: adapted to @gjsify/unit and extended to cover all six stream
// classes that are wrapped by `makeCallable` in `./callable.ts`.
//
// Regression coverage for the npm `send` (express.static) bug and for our own
// `@gjsify/crypto` `Hash.copy()` path which both do `Stream.call(this)` /
// `Transform.call(copy)` on pre-ES2015 CJS-style constructors.

import { describe, it, expect } from '@gjsify/unit';
import { Stream, Readable, Writable, Duplex, Transform, PassThrough } from 'node:stream';
import { inherits } from 'node:util';

export default async () => {
	await describe('makeCallable: new invocation still works', async () => {
		await it('new Stream() returns a valid instance', async () => {
			const s = new Stream();
			expect(typeof (s as any).pipe).toBe('function');
			expect(s instanceof Stream).toBe(true);
		});

		await it('new Readable() initialises readable state', async () => {
			const r = new Readable({ read() {} });
			expect(r.readable).toBe(true);
			expect(r instanceof Readable).toBe(true);
			expect(r instanceof Stream).toBe(true);
		});

		await it('new Transform() initialises both readable + writable state', async () => {
			const t = new Transform({ transform(chunk, _enc, cb) { cb(null, chunk); } });
			expect(t.readable).toBe(true);
			expect(t.writable).toBe(true);
			expect(t instanceof Transform).toBe(true);
			expect(t instanceof Duplex).toBe(true);
			expect(t instanceof Readable).toBe(true);
		});

		await it('Stream.prototype is accessible via the wrapper', async () => {
			expect(typeof (Stream as any).prototype).toBe('object');
			expect(typeof (Stream as any).prototype.pipe).toBe('function');
		});
	});

	await describe('makeCallable: legacy Stream.call(this) + util.inherits', async () => {
		await it('Stream.call(plainObject) assigns EventEmitter bookkeeping', async () => {
			// Plain object promoted to a Stream via .call()
			const plain: any = Object.create(Stream.prototype);
			(Stream as any).call(plain);
			// EventEmitter state is now present
			plain.on('ping', function(this: any, msg: string) { this.received = msg; });
			plain.emit('ping', 'hi');
			expect(plain.received).toBe('hi');
		});

		await it('legacy subclass pattern (function + inherits + .call) works', async () => {
			function SubStream(this: any) {
				(Stream as any).call(this);
				this.foo = 42;
			}
			inherits(SubStream as any, Stream as any);
			(SubStream.prototype as any).greet = function() { return 'hello'; };

			const s: any = new (SubStream as any)();
			expect(s.foo).toBe(42);
			expect(s.greet()).toBe('hello');
			// Inherited from Stream.prototype
			expect(typeof s.pipe).toBe('function');
			expect(s instanceof Stream).toBe(true);
		});

		await it('multi-level inherits (A.call -> B.call -> C) works', async () => {
			function A(this: any) {
				(Stream as any).call(this);
				this._a = 'a';
			}
			inherits(A as any, Stream as any);
			(A.prototype as any).a = function() { return this._a; };

			function B(this: any) {
				(A as any).call(this);
				this._b = 'b';
			}
			inherits(B as any, A as any);
			(B.prototype as any).b = function() { return this._b; };

			const b: any = new (B as any)();
			expect(b.a()).toBe('a');
			expect(b.b()).toBe('b');
			expect(b instanceof A).toBe(true);
			expect(b instanceof Stream).toBe(true);
		});
	});

	await describe('makeCallable: Readable / Writable / Transform .call(this)', async () => {
		await it('Readable.call(plain) sets up readable state', async () => {
			const r: any = Object.create(Readable.prototype);
			(Readable as any).call(r, { read() {} });
			expect(r.readable).toBe(true);
			expect(typeof r.readableHighWaterMark).toBe('number');
			// pipe is inherited from Stream.prototype through Readable.prototype
			expect(typeof r.pipe).toBe('function');
		});

		await it('Writable.call(plain) sets up writable state', async () => {
			const w: any = Object.create(Writable.prototype);
			(Writable as any).call(w, { write(_c: any, _e: any, cb: any) { cb(); } });
			expect(w.writable).toBe(true);
			expect(typeof w.writableHighWaterMark).toBe('number');
		});

		await it('Transform.call(plain) sets up both readable and writable state', async () => {
			// This is the exact pattern used by @gjsify/crypto Hash.copy():
			//   const copy = Object.create(Hash.prototype);
			//   Transform.call(copy);
			const copy: any = Object.create(Transform.prototype);
			(Transform as any).call(copy);
			expect(copy.readable).toBe(true);
			expect(copy.writable).toBe(true);
			// The Transform should be usable after .call() initialization —
			// field initializers from all ancestors ran on copy.
			expect(typeof copy.readableHighWaterMark).toBe('number');
			expect(typeof copy.writableHighWaterMark).toBe('number');
		});

		await it('PassThrough.call(plain) inherits the full chain', async () => {
			const pt: any = Object.create(PassThrough.prototype);
			(PassThrough as any).call(pt);
			expect(pt.readable).toBe(true);
			expect(pt.writable).toBe(true);
		});
	});

	await describe('makeCallable: integration with util.inherits', async () => {
		await it('inherits(Sub, Readable) + Readable.call(this) yields a working Readable subclass', async () => {
			function SimpleSrc(this: any, items: number[]) {
				(Readable as any).call(this, { objectMode: true });
				this._items = items;
			}
			inherits(SimpleSrc as any, Readable as any);
			(SimpleSrc.prototype as any)._read = function() {
				const item = this._items.shift();
				this.push(item !== undefined ? item : null);
			};

			const src: any = new (SimpleSrc as any)([1, 2, 3]);
			const out: number[] = [];
			await new Promise<void>((resolve, reject) => {
				src.on('data', (chunk: number) => out.push(chunk));
				src.on('end', resolve);
				src.on('error', reject);
			});
			expect(out).toEqualArray([1, 2, 3]);
		});
	});
};
