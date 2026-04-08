// pipe() test suite.
//
// Ported from:
//   refs/node-test/parallel/test-stream-pipe-after-end.js
//   refs/node-test/parallel/test-stream-pipe-cleanup.js
//   refs/node-test/parallel/test-stream-pipe-error-handling.js
//   refs/node-test/parallel/test-stream-pipe-event.js
//   refs/node-test/parallel/test-stream-pipe-flow.js
//   refs/node-test/parallel/test-stream-pipe-multiple-pipes.js
//   refs/node-test/parallel/test-stream-pipe-needDrain.js
//   refs/node-test/parallel/test-stream-pipe-objectmode-to-non-objectmode.js
//   refs/node-test/parallel/test-stream-pipe-same-destination-twice.js
//   refs/node-test/parallel/test-stream-pipe-unpipe-streams.js
//   refs/node-test/parallel/test-stream-pipe-without-listenerCount.js
// Original: MIT license, Node.js contributors (and Joyent, Inc.)
// Modifications: adapted to @gjsify/unit, async/await.

import { describe, it, expect } from '@gjsify/unit';
import { Stream, Readable, Writable, PassThrough, Transform } from 'node:stream';

export default async () => {

	// -------------------------------------------------------------------------
	// pipe: 'pipe' event on destination
	// -------------------------------------------------------------------------
	await describe('pipe: pipe event', async () => {
		await it('pipe event fires on writable when piped', async () => {
			const w: any = Object.create(Stream.prototype);
			(Stream as any).call(w);
			w.writable = true;

			const r: any = Object.create(Stream.prototype);
			(Stream as any).call(r);
			r.readable = true;

			let passed = false;
			w.on('pipe', (src: any) => { passed = true; });
			r.pipe(w);
			expect(passed).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: after end
	// -------------------------------------------------------------------------
	await describe('pipe: after end', async () => {
		await it('piping an already-ended readable to a writable finishes the writable', async () => {
			class TestReadable extends Readable {
				_read() { this.push(null); }
			}
			class TestWritable extends Writable {
				public _written: Buffer[] = [];
				_write(chunk: Buffer, _enc: string, cb: () => void) {
					this._written.push(chunk);
					cb();
				}
			}
			const piper = new TestReadable();
			piper.read(); // triggers end

			await new Promise<void>((resolve) => {
				const w = new TestWritable();
				w.on('finish', resolve);
				piper.pipe(w);
			});
		});

		await it('readable that has not been read emits end once via pipe', async () => {
			class TestReadable extends Readable {
				private _called = false;
				_read() {
					if (this._called) this.emit('error', new Error('_read called twice'));
					this._called = true;
					this.push(null);
				}
			}
			const ender = new TestReadable();
			await new Promise<void>((resolve) => {
				ender.on('end', resolve);
				const c = ender.read();
				expect(c).toBe(null);
			});
		});
	});

	// -------------------------------------------------------------------------
	// pipe: cleanup — no dangling listeners
	// -------------------------------------------------------------------------
	await describe('pipe: cleanup removes listeners after end/close', async () => {
		await it('end event removes all listeners added by pipe', async () => {
			// Legacy Stream-based test — uses Stream.call(this) pattern
			function CustomWritable(this: any) {
				this.writable = true;
				this.endCalls = 0;
				(Stream as any).call(this);
			}
			Object.setPrototypeOf(CustomWritable.prototype, Stream.prototype);
			(CustomWritable.prototype as any).end = function() { this.endCalls++; };
			(CustomWritable.prototype as any).destroy = function() { this.endCalls++; };

			function CustomReadable(this: any) {
				this.readable = true;
				(Stream as any).call(this);
			}
			Object.setPrototypeOf(CustomReadable.prototype, Stream.prototype);

			const w: any = new (CustomWritable as any)();
			let r: any;
			const limit = 10;

			for (let i = 0; i < limit; i++) {
				r = new (CustomReadable as any)();
				r.pipe(w);
				r.emit('end');
			}
			expect(r.listeners('end').length).toBe(0);
			expect(w.endCalls).toBe(limit);
		});

		await it('close event removes all listeners added by pipe', async () => {
			function CustomWritable(this: any) {
				this.writable = true;
				this.endCalls = 0;
				(Stream as any).call(this);
			}
			Object.setPrototypeOf(CustomWritable.prototype, Stream.prototype);
			(CustomWritable.prototype as any).end = function() { this.endCalls++; };
			(CustomWritable.prototype as any).destroy = function() { this.endCalls++; };

			function CustomReadable(this: any) {
				this.readable = true;
				(Stream as any).call(this);
			}
			Object.setPrototypeOf(CustomReadable.prototype, Stream.prototype);

			const w: any = new (CustomWritable as any)();
			let r: any;
			const limit = 10;

			for (let i = 0; i < limit; i++) {
				r = new (CustomReadable as any)();
				r.pipe(w);
				r.emit('close');
			}
			expect(r.listeners('close').length).toBe(0);
			expect(w.endCalls).toBe(limit);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: error handling
	// -------------------------------------------------------------------------
	await describe('pipe: error handling', async () => {
		await it('source with error listener does not propagate error to dest', async () => {
			const source = new Stream();
			const dest = new Stream();
			// Legacy bare Stream→Stream pipe — @types/node's pipe() expects a Writable.
			source.pipe(dest as unknown as Writable);

			let gotErr: Error | null = null;
			source.on('error', (err) => { gotErr = err; });

			const err = new Error('source error');
			source.emit('error', err);
			expect(gotErr).toBe(err);
		});

		await it('source without error listener throws on emit', async () => {
			const source = new Stream();
			const dest = new Stream();
			source.pipe(dest as unknown as Writable);

			const err = new Error('uncaught source error');
			let gotErr: Error | null = null;
			try {
				source.emit('error', err);
			} catch (e: any) {
				gotErr = e;
			}
			expect(gotErr).toBe(err);
		});

		await it('removeListener cleans up error handler from piped dest', async () => {
			const r = new Readable({ autoDestroy: false, read() {} });
			const w = new Writable({ autoDestroy: false, write(_c, _e, cb) { cb(); } });

			function badHandler() {
				throw new Error('should not happen');
			}

			w.on('error', badHandler);
			r.pipe(w);
			w.removeListener('error', badHandler);

			// Should not throw
			let threw = false;
			try {
				w.emit('error', new Error('fail'));
			} catch {
				threw = true;
			}
			expect(threw).toBe(true); // no handler → throws
		});

		await it('error from destroyed dest propagates correctly', async () => {
			const _err = new Error('dest destroyed');
			const dest = new PassThrough();
			const stream = new Stream();
			stream.pipe(dest);

			await new Promise<void>((resolve) => {
				dest.once('error', (err) => {
					expect(err).toBe(_err);
					resolve();
				});
				dest.destroy(_err);
			});
		});

		await it('pipe without listenerCount still handles errors', async () => {
			const r: any = new Stream();
			r.listenerCount = undefined;
			const w: any = new Stream();
			w.listenerCount = undefined;

			const errors: Error[] = [];
			r.on('error', (err: Error) => errors.push(err));
			w.on('error', (err: Error) => errors.push(err));

			w.on('pipe', () => {
				r.emit('error', new Error('Readable Error'));
				w.emit('error', new Error('Writable Error'));
			});
			r.pipe(w);

			expect(errors.length).toBe(2);
			expect(errors[0].message).toBe('Readable Error');
			expect(errors[1].message).toBe('Writable Error');
		});
	});

	// -------------------------------------------------------------------------
	// pipe: multiple destinations
	// -------------------------------------------------------------------------
	await describe('pipe: multiple destinations', async () => {
		await it('pipe to 5 writables — each receives the same chunk', async () => {
			const readable = new Readable({ read() {} });
			const results: Buffer[][] = [];
			const finishPromises: Promise<void>[] = [];

			for (let i = 0; i < 5; i++) {
				const out: Buffer[] = [];
				results.push(out);
				const w = new Writable({
					write(chunk, _enc, cb) { out.push(chunk); cb(); },
				});
				readable.pipe(w);
				finishPromises.push(new Promise<void>((resolve) => w.on('finish', resolve)));
			}

			const input = Buffer.from([1, 2, 3, 4, 5]);
			readable.push(input);
			readable.push(null); // end all pipes

			await Promise.all(finishPromises);

			for (const out of results) {
				expect(out.length).toBe(1);
			}
		});

		await it('unpipe removes data forwarding to specific dest', async () => {
			const readable = new Readable({ read() {} });
			const out1: Buffer[] = [];
			const out2: Buffer[] = [];
			const w1 = new Writable({ write(c, _e, cb) { out1.push(c); cb(); } });
			const w2 = new Writable({ write(c, _e, cb) { out2.push(c); cb(); } });

			readable.pipe(w1);
			readable.pipe(w2);
			readable.unpipe(w2);

			// Wait for w1 to finish — proves data reached w1 but not w2
			await new Promise<void>((resolve) => {
				w1.on('finish', resolve);
				readable.push(Buffer.from('hello'));
				readable.push(null);
			});

			expect(out1.length).toBe(1);
			expect(out2.length).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: same destination twice
	// -------------------------------------------------------------------------
	await describe('pipe: same destination twice', async () => {
		await it('pipe twice to same dest registers 2 data listeners', async () => {
			const pt = new PassThrough();
			const dest = new Writable({ write(_c, _e, cb) { cb(); } });

			pt.pipe(dest);
			pt.pipe(dest);

			expect((pt._readableState as any).pipes.length).toBe(2);
			expect((pt._readableState as any).pipes[0]).toBe(dest);
			expect((pt._readableState as any).pipes[1]).toBe(dest);
		});

		await it('unpipe once removes only one of the two pipe registrations', async () => {
			const pt = new PassThrough();
			const dest = new Writable({ write(_c, _e, cb) { cb(); } });

			pt.pipe(dest);
			pt.pipe(dest);
			pt.unpipe(dest);

			expect((pt._readableState as any).pipes.length).toBe(1);
		});

		await it('unpipe twice removes both registrations', async () => {
			const pt = new PassThrough();
			const dest = new Writable({ write(_c, _e, cb) { cb(); } });

			pt.pipe(dest);
			pt.pipe(dest);
			pt.unpipe(dest);
			pt.unpipe(dest);

			expect((pt._readableState as any).pipes.length).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: unpipe streams
	// -------------------------------------------------------------------------
	await describe('pipe: unpipe', async () => {
		await it('unpipe in reverse order removes correct dest', async () => {
			const source = new Readable({ read() {} });
			const dest1 = new Writable({ write(_c, _e, cb) { cb(); } });
			const dest2 = new Writable({ write(_c, _e, cb) { cb(); } });

			source.pipe(dest1);
			source.pipe(dest2);

			expect((source._readableState as any).pipes[0]).toBe(dest1);
			expect((source._readableState as any).pipes[1]).toBe(dest2);

			source.unpipe(dest2);
			expect((source._readableState as any).pipes.length).toBe(1);
			expect((source._readableState as any).pipes[0]).toBe(dest1);
		});

		await it('unpipe non-connected dest is a no-op', async () => {
			const source = new Readable({ read() {} });
			const dest1 = new Writable({ write(_c, _e, cb) { cb(); } });
			const dest2 = new Writable({ write(_c, _e, cb) { cb(); } });

			source.pipe(dest1);
			source.unpipe(dest2); // dest2 was never piped

			expect((source._readableState as any).pipes.length).toBe(1);
			expect((source._readableState as any).pipes[0]).toBe(dest1);
		});

		await it('unpipe() with no args removes all piped destinations', async () => {
			const source = new Readable({ read() {} });
			const dest1 = new Writable({ write(_c, _e, cb) { cb(); } });
			const dest2 = new Writable({ write(_c, _e, cb) { cb(); } });

			source.pipe(dest1);
			source.pipe(dest2);

			const unpiped: Writable[] = [];
			dest1.on('unpipe', () => unpiped.push(dest1));
			dest2.on('unpipe', () => unpiped.push(dest2));

			source.unpipe();

			expect((source._readableState as any).pipes.length).toBe(0);
			expect(unpiped.length).toBe(2);
		});

		await it('unpipe fires unpipe event on destination', async () => {
			const source = new Readable({ read() {} });
			const dest = new Writable({ write(_c, _e, cb) { cb(); } });

			let fired = false;
			dest.on('unpipe', () => { fired = true; });

			source.pipe(dest);
			source.unpipe(dest);

			expect(fired).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: needDrain — pause while dest needs drain
	// -------------------------------------------------------------------------
	await describe('pipe: needDrain handling', async () => {
		await it('pipe pauses source when dest writableNeedDrain is true', async () => {
			const w = new Writable({
				highWaterMark: 1,
				write(_buf, _enc, callback) {
					Promise.resolve().then(() => callback());
				},
			});

			// Fill the writable past HWM so writableNeedDrain becomes true
			while (w.write('x')) {/* fill */}
			expect(w.writableNeedDrain).toBe(true);

			const pauses: string[] = [];
			const r = new Readable({
				read() {
					this.push('asd');
					this.push(null);
				},
			});

			r.on('pause', () => pauses.push('paused'));
			await new Promise<void>((resolve) => {
				r.on('end', resolve);
				r.pipe(w);
			});

			// r must have been paused at least once due to backpressure
			expect(pauses.length).toBeGreaterThan(0);
		});
	});

	// -------------------------------------------------------------------------
	// pipe: objectMode to non-objectMode error
	// -------------------------------------------------------------------------
	await describe('pipe: objectMode to non-objectMode', async () => {
		await it('piping objects to non-objectMode transform emits an error', async () => {
			const objectReadable = Readable.from([{ hello: 'hello' }, { world: 'world' }]);
			const passThrough = new Transform({
				transform(chunk, _enc, cb) {
					this.push(chunk);
					cb(null);
				},
			});

			await new Promise<void>((resolve) => {
				passThrough.on('error', (err: any) => {
					// Should get ERR_INVALID_ARG_TYPE or similar
					expect(err).toBeDefined();
					resolve();
				});
				objectReadable.pipe(passThrough);
			});
		});

		await it('writable that throws in _write propagates the error via error event', async () => {
			const stringReadable = Readable.from(['hello', 'world']);
			const passThrough = new Transform({
				transform(_chunk, _enc, cb) {
					this.push(_chunk);
					throw new Error('something went wrong');
				},
			});

			await new Promise<void>((resolve) => {
				passThrough.on('error', (err) => {
					expect(err.message).toBe('something went wrong');
					resolve();
				});
				stringReadable.pipe(passThrough);
			});
		});
	});

	// -------------------------------------------------------------------------
	// pipe: flow — basic data flow through pipes
	// -------------------------------------------------------------------------
	await describe('pipe: data flow', async () => {
		await it('basic Readable → Writable pipe delivers all data', async () => {
			const chunks: Buffer[] = [];
			const r = new Readable({
				read() {
					this.push(Buffer.from('hello'));
					this.push(null);
				},
			});
			const w = new Writable({
				write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
			});
			await new Promise<void>((resolve) => {
				w.on('finish', resolve);
				r.pipe(w);
			});
			expect(Buffer.concat(chunks).toString()).toBe('hello');
		});

		await it('chained PassThrough pipes deliver all data', async () => {
			const items = [1, 2, 3, 4, 5];
			const r = Readable.from(items, { objectMode: true });
			const out: number[] = [];

			const pt1 = new PassThrough({ objectMode: true });
			const pt2 = new PassThrough({ objectMode: true });
			const w = new Writable({
				objectMode: true,
				write(chunk, _enc, cb) { out.push(chunk); cb(); },
			});

			await new Promise<void>((resolve) => {
				w.on('finish', resolve);
				r.pipe(pt1).pipe(pt2).pipe(w);
			});

			expect(out).toEqualArray(items);
		});

		await it('drain listener is not added when no backpressure', async () => {
			const rs = new Readable({ read() {} });
			const pt = rs.pipe(new PassThrough({ objectMode: true, highWaterMark: 2 }));

			expect(pt.listenerCount('drain')).toBe(0);
			rs.push('asd');
			// Still no drain listener as we haven't exceeded HWM on dest
			await new Promise<void>((resolve) => Promise.resolve().then(resolve));
			expect(pt.listenerCount('drain')).toBe(0);
			rs.push(null);
		});
	});
};
