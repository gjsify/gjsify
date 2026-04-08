// Transform stream test suite.
//
// Ported from:
//   refs/node-test/parallel/test-stream-transform-constructor-set-methods.js
//   refs/node-test/parallel/test-stream-transform-flush-data.js
//   refs/node-test/parallel/test-stream-transform-objectmode-falsey-value.js
//   refs/node-test/parallel/test-stream-transform-split-highwatermark.js
//   refs/node-test/parallel/test-stream-transform-split-objectmode.js
//   refs/node-test/parallel/test-stream-transform-hwm0.js
//   refs/node-test/parallel/test-stream-transform-callback-twice.js
//   refs/node-test/parallel/test-stream-transform-destroy.js
//   refs/node-test/parallel/test-stream-transform-final.js
//   refs/node-test/parallel/test-stream-transform-final-sync.js
// Original: MIT license, Node.js contributors
// Modifications: adapted to @gjsify/unit, async/await, removed common/mustCall.

import { describe, it, expect } from '@gjsify/unit';
import { Transform, Readable, Writable, PassThrough } from 'node:stream';

export default async () => {

	// -------------------------------------------------------------------------
	// Constructor: set methods via options
	// -------------------------------------------------------------------------
	await describe('Transform: constructor options set _transform/_flush/_final', async () => {
		await it('throws ERR_METHOD_NOT_IMPLEMENTED when _transform is not set', async () => {
			const t = new Transform();
			let threw = false;
			let errCode = '';
			try {
				t.end(Buffer.from('blerg'));
			} catch (e: any) {
				threw = true;
				errCode = e.code;
			}
			expect(threw).toBe(true);
			expect(errCode).toBe('ERR_METHOD_NOT_IMPLEMENTED');
		});

		await it('options.transform / flush / final are assigned to instance', async () => {
			const _transform = (_chunk: any, _enc: any, next: () => void) => next();
			const _flush = (next: () => void) => next();
			const _final = (next: () => void) => next();
			const t = new Transform({ transform: _transform, flush: _flush, final: _final });
			expect(t._transform).toBe(_transform);
			expect(t._flush).toBe(_flush);
			expect(t._final).toBe(_final);
		});

		await it('end + resume works after options.transform is set', async () => {
			await new Promise<void>((resolve) => {
				const t = new Transform({
					transform(_chunk, _enc, next) { next(); },
					flush(next) { next(); },
					final(next) { next(); },
				});
				t.on('finish', resolve);
				t.end(Buffer.from('blerg'));
				t.resume();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Flush can push data
	// -------------------------------------------------------------------------
	await describe('Transform: flush can push data', async () => {
		await it('data pushed in _flush is received as a data event', async () => {
			const expected = 'asdf';
			const t = new Transform({
				transform(_d, _e, n) { n(); },
				flush(n) { n(null, expected); },
			});

			const received: string[] = [];
			await new Promise<void>((resolve, reject) => {
				t.on('data', (chunk: Buffer) => received.push(chunk.toString()));
				t.on('end', resolve);
				t.on('error', reject);
				t.end(Buffer.from('blerg'));
			});
			expect(received).toEqualArray([expected]);
		});
	});

	// -------------------------------------------------------------------------
	// ObjectMode: falsy values pass through
	// -------------------------------------------------------------------------
	await describe('Transform: objectMode passes falsy values', async () => {
		await it('pipes -1, 0, 1..10 through objectMode PassThrough streams', async () => {
			const expected = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
			const src = new PassThrough({ objectMode: true });
			const tx = new PassThrough({ objectMode: true });
			const dest = new PassThrough({ objectMode: true });

			const results: number[] = [];
			src.pipe(tx).pipe(dest);

			await new Promise<void>((resolve, reject) => {
				dest.on('data', (x: number) => results.push(x));
				dest.on('end', () => {
					try {
						expect(results).toEqualArray(expected);
						resolve();
					} catch (e) {
						reject(e);
					}
				});
				dest.on('error', reject);

				// Write all values then end
				for (const v of expected) {
					src.write(v);
				}
				src.end();
			});
		});

		await it('objectMode PassThrough passes null-equivalent numbers without blocking', async () => {
			const pt = new PassThrough({ objectMode: true });
			const out: number[] = [];
			await new Promise<void>((resolve, reject) => {
				pt.on('data', (v: number) => out.push(v));
				pt.on('end', resolve);
				pt.on('error', reject);
				pt.write(0);
				pt.write(-1);
				pt.write(false as any);
				pt.end();
			});
			expect(out).toEqualArray([0, -1, false]);
		});
	});

	// -------------------------------------------------------------------------
	// Split highWaterMark options
	// -------------------------------------------------------------------------
	await describe('Transform: readableHighWaterMark / writableHighWaterMark options', async () => {
		await it('readableHighWaterMark sets _readableState.highWaterMark independently', async () => {
			const t = new Transform({
				readableHighWaterMark: 666,
				transform(_c, _e, cb) { cb(); },
			});
			expect(t._readableState.highWaterMark).toBe(666);
		});

		await it('writableHighWaterMark sets _writableState.highWaterMark independently', async () => {
			const t = new Transform({
				writableHighWaterMark: 777,
				transform(_c, _e, cb) { cb(); },
			});
			expect(t._writableState.highWaterMark).toBe(777);
		});

		await it('both readable and writable HWM can be set independently', async () => {
			const t = new Transform({
				readableHighWaterMark: 666,
				writableHighWaterMark: 777,
				transform(_c, _e, cb) { cb(); },
			});
			expect(t._readableState.highWaterMark).toBe(666);
			expect(t._writableState.highWaterMark).toBe(777);
		});

		await it('highWaterMark overrides both readable and writable HWM', async () => {
			const t = new Transform({
				highWaterMark: 555,
				readableHighWaterMark: 666,
				writableHighWaterMark: 777,
				transform(_c, _e, cb) { cb(); },
			});
			expect(t._readableState.highWaterMark).toBe(555);
			expect(t._writableState.highWaterMark).toBe(555);
		});

		await it('NaN readableHighWaterMark throws ERR_INVALID_ARG_VALUE', async () => {
			let threw = false;
			let code = '';
			try {
				new Transform({ readableHighWaterMark: NaN, transform(_c, _e, cb) { cb(); } });
			} catch (e: any) {
				threw = true;
				code = e.code;
			}
			expect(threw).toBe(true);
			expect(code).toBe('ERR_INVALID_ARG_VALUE');
		});

		await it('NaN writableHighWaterMark throws ERR_INVALID_ARG_VALUE', async () => {
			let threw = false;
			let code = '';
			try {
				new Transform({ writableHighWaterMark: NaN, transform(_c, _e, cb) { cb(); } });
			} catch (e: any) {
				threw = true;
				code = e.code;
			}
			expect(threw).toBe(true);
			expect(code).toBe('ERR_INVALID_ARG_VALUE');
		});

		await it('Readable ignores readableHighWaterMark option (uses default)', async () => {
			const DEFAULT = new Readable({ read() {} })._readableState.highWaterMark;
			// readableHighWaterMark is a Duplex/Transform-only option; passing it
			// to Readable should be silently ignored. Cast to bypass strict types.
			const r = new Readable({ readableHighWaterMark: 666, read() {} } as any);
			expect(r._readableState.highWaterMark).toBe(DEFAULT);
		});

		await it('Writable ignores writableHighWaterMark option (uses default)', async () => {
			const DEFAULT = new Writable({ write(_c, _e, cb) { cb(); } })._writableState.highWaterMark;
			// writableHighWaterMark is a Duplex/Transform-only option.
			const w = new Writable({ writableHighWaterMark: 777, write(_c, _e, cb) { cb(); } } as any);
			expect(w._writableState.highWaterMark).toBe(DEFAULT);
		});
	});

	// -------------------------------------------------------------------------
	// Split objectMode: readableObjectMode / writableObjectMode
	// -------------------------------------------------------------------------
	await describe('Transform: readableObjectMode / writableObjectMode', async () => {
		await it('readableObjectMode enables objectMode only on readable side', async () => {
			const parser = new Transform({
				readableObjectMode: true,
				transform(chunk, _enc, callback) {
					callback(null, { val: chunk[0] });
				},
			});
			expect(parser._readableState.objectMode).toBe(true);
			expect(parser._writableState.objectMode).toBe(false);
			// readableHWM is object-mode default (16)
			expect(parser.readableHighWaterMark).toBe(16);
		});

		await it('writableObjectMode enables objectMode only on writable side', async () => {
			const serializer = new Transform({
				writableObjectMode: true,
				transform(obj: any, _enc, callback) {
					callback(null, Buffer.from([obj.val]));
				},
			});
			expect(serializer._readableState.objectMode).toBe(false);
			expect(serializer._writableState.objectMode).toBe(true);
			// writableHWM is object-mode default (16)
			expect(serializer.writableHighWaterMark).toBe(16);
		});

		await it('readableObjectMode: parsed objects flow through', async () => {
			const parser = new Transform({
				readableObjectMode: true,
				transform(chunk, _enc, callback) {
					callback(null, { val: chunk[0] });
				},
			});
			const results: any[] = [];
			await new Promise<void>((resolve, reject) => {
				parser.on('data', (obj: any) => results.push(obj));
				parser.on('end', resolve);
				parser.on('error', reject);
				parser.end(Buffer.from([42]));
			});
			expect(results.length).toBe(1);
			expect(results[0].val).toBe(42);
		});
	});

	// -------------------------------------------------------------------------
	// highWaterMark: 0 — backpressure and drain
	// -------------------------------------------------------------------------
	await describe('Transform: highWaterMark 0', async () => {
		await it('write returns false when hwm is 0 (objectMode)', async () => {
			const t = new Transform({
				objectMode: true,
				highWaterMark: 0,
				transform(chunk, _enc, callback) {
					Promise.resolve().then(() => callback(null, chunk));
				},
			});
			const ret = t.write(1);
			expect(ret).toBe(false);
			// consume to avoid hanging
			t.resume();
			t.end();
			await new Promise<void>((resolve) => t.on('finish', resolve));
		});

		await it('drain event fires after hwm-0 backpressure resolves', async () => {
			const t = new Transform({
				objectMode: true,
				highWaterMark: 0,
				transform(chunk, _enc, callback) {
					Promise.resolve().then(() => callback(null, chunk));
				},
			});
			t.write(1); // returns false, triggers drain eventually
			await new Promise<void>((resolve) => {
				t.on('drain', () => {
					t.end();
					resolve();
				});
				t.resume(); // put in flowing mode so data is consumed
			});
		});
	});

	// -------------------------------------------------------------------------
	// Callback called twice — ERR_MULTIPLE_CALLBACK
	// -------------------------------------------------------------------------
	await describe('Transform: callback called twice', async () => {
		await it('emits error with ERR_MULTIPLE_CALLBACK when callback called twice', async () => {
			const stream = new Transform({
				transform(_chunk, _enc, cb) { cb(); cb(); },
			});
			await new Promise<void>((resolve) => {
				stream.on('error', (err: any) => {
					expect(err.code).toBe('ERR_MULTIPLE_CALLBACK');
					resolve();
				});
				stream.write('foo');
			});
		});
	});

	// -------------------------------------------------------------------------
	// destroy()
	// -------------------------------------------------------------------------
	await describe('Transform: destroy()', async () => {
		await it('destroy() emits close, not end or finish', async () => {
			await new Promise<void>((resolve) => {
				const transform = new Transform({ transform(_c, _e, cb) {} });
				transform.resume();
				let endFired = false;
				let finishFired = false;
				transform.on('end', () => { endFired = true; });
				transform.on('finish', () => { finishFired = true; });
				transform.on('close', () => {
					expect(endFired).toBe(false);
					expect(finishFired).toBe(false);
					resolve();
				});
				transform.destroy();
			});
		});

		await it('destroy(err) emits error then close', async () => {
			await new Promise<void>((resolve) => {
				const transform = new Transform({ transform(_c, _e, cb) {} });
				transform.resume();
				const expected = new Error('kaboom');
				let errorReceived: Error | null = null;
				transform.on('end', () => { throw new Error('end should not fire'); });
				transform.on('finish', () => { throw new Error('finish should not fire'); });
				transform.on('error', (err) => { errorReceived = err; });
				transform.on('close', () => {
					expect(errorReceived).toBe(expected);
					resolve();
				});
				transform.destroy(expected);
			});
		});

		await it('custom _destroy is called with the error', async () => {
			await new Promise<void>((resolve) => {
				const expected = new Error('kaboom');
				let destroyCalled = false;
				const transform = new Transform({ transform(_c, _e, cb) {} });
				transform._destroy = function(err, cb) {
					destroyCalled = true;
					expect(err).toBe(expected);
					cb(err);
				};
				transform.on('error', () => {});
				transform.on('close', () => {
					expect(destroyCalled).toBe(true);
					resolve();
				});
				transform.destroy(expected);
			});
		});

		await it('custom _destroy swallowing error suppresses error event', async () => {
			await new Promise<void>((resolve) => {
				const expected = new Error('kaboom');
				let errorFired = false;
				const transform = new Transform({
					transform(_c, _e, cb) {},
					destroy(_err, cb) { cb(); }, // swallow the error
				});
				transform.resume();
				transform.on('end', () => { throw new Error('no end event'); });
				transform.on('finish', () => { throw new Error('no finish event'); });
				transform.on('error', () => { errorFired = true; });
				transform.on('close', () => {
					expect(errorFired).toBe(false);
					resolve();
				});
				transform.destroy(expected);
			});
		});

		await it('_destroy with null error calls cb() cleanly', async () => {
			await new Promise<void>((resolve) => {
				let destroyCalled = false;
				const transform = new Transform({ transform(_c, _e, cb) {} });
				transform._destroy = function(err, cb) {
					destroyCalled = true;
					expect(err).toBe(null);
					cb();
				};
				transform.on('close', () => {
					expect(destroyCalled).toBe(true);
					resolve();
				});
				transform.destroy();
			});
		});
	});

	// -------------------------------------------------------------------------
	// final / flush ordering (async final)
	// -------------------------------------------------------------------------
	await describe('Transform: final/flush ordering (async final)', async () => {
		await it('data, final, flush and end events fire in the correct order', async () => {
			const order: string[] = [];

			await new Promise<void>((resolve, reject) => {
				const t = new Transform({
					objectMode: true,
					transform(chunk, _enc, next) {
						order.push(`transform:${chunk}`);
						this.push(chunk);
						Promise.resolve().then(() => { next(); });
					},
					final(done) {
						order.push('final:start');
						setTimeout(() => {
							order.push('final:done');
							done();
						}, 10);
					},
					flush(done) {
						order.push('flush:start');
						Promise.resolve().then(() => {
							order.push('flush:done');
							done();
						});
					},
				});

				t.on('data', (d: any) => order.push(`data:${d}`));
				t.on('finish', () => order.push('finish'));
				t.on('end', () => {
					order.push('end');
					try {
						// All transforms must have fired before final
						expect(order.indexOf('final:start')).toBeGreaterThan(order.indexOf('transform:3'));
						// final:done before flush:start
						expect(order.indexOf('flush:start')).toBeGreaterThan(order.indexOf('final:done'));
						// finish before end
						expect(order.indexOf('finish')).toBeLessThan(order.indexOf('end'));
						resolve();
					} catch (e) {
						reject(e);
					}
				});
				t.on('error', reject);

				t.write(1);
				t.write(2);
				t.end(3);
			});
		});
	});

	// -------------------------------------------------------------------------
	// final / flush ordering (sync final)
	// -------------------------------------------------------------------------
	await describe('Transform: final/flush ordering (sync final)', async () => {
		await it('sync final completes before flush', async () => {
			const order: string[] = [];

			await new Promise<void>((resolve, reject) => {
				const t = new Transform({
					objectMode: true,
					transform(chunk, _enc, next) {
						order.push(`transform:${chunk}`);
						this.push(chunk);
						Promise.resolve().then(() => { next(); });
					},
					final(done) {
						order.push('final');
						done(); // synchronous completion
					},
					flush(done) {
						order.push('flush');
						Promise.resolve().then(() => { done(); });
					},
				});

				t.on('data', (d: any) => order.push(`data:${d}`));
				t.on('finish', () => order.push('finish'));
				t.on('end', () => {
					order.push('end');
					try {
						expect(order.indexOf('final')).toBeGreaterThan(order.indexOf('transform:2'));
						expect(order.indexOf('flush')).toBeGreaterThan(order.indexOf('final'));
						expect(order.indexOf('finish')).toBeLessThan(order.indexOf('end'));
						resolve();
					} catch (e) {
						reject(e);
					}
				});
				t.on('error', reject);

				t.write(1);
				t.end(2);
			});
		});
	});
};
