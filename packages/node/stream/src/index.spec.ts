import { describe, it, expect } from '@gjsify/unit';
import Stream, {
	Readable, Writable, Duplex, Transform, PassThrough,
	pipeline, finished, addAbortSignal,
	isReadable, isWritable,
	getDefaultHighWaterMark, setDefaultHighWaterMark,
} from 'node:stream';

// These are exported from our implementation but not in @types/node's stream module,
// so we access them via the default export.
const { isDestroyed, isDisturbed, isErrored } = Stream as any;

// Ported from refs/node/test/parallel/test-stream-*.js
// Original: MIT license, Node.js contributors

export default async () => {
	// ==================== Stream base ====================

	await describe('Stream', async () => {
		await it('should create an instance', async () => {
			const stream = new Stream();
			expect(stream).toBeDefined();
		});

		await it('should be an EventEmitter', async () => {
			const stream = new Stream();
			expect(typeof stream.on).toBe('function');
			expect(typeof stream.emit).toBe('function');
			expect(typeof stream.removeListener).toBe('function');
		});
	});

	// ==================== Readable ====================

	await describe('Readable: properties', async () => {
		await it('should create an instance', async () => {
			const readable = new Readable({ read() {} });
			expect(readable).toBeDefined();
			expect(readable.readable).toBeTruthy();
		});

		await it('should accept custom highWaterMark', async () => {
			const readable = new Readable({ read() {}, highWaterMark: 42 });
			expect(readable.readableHighWaterMark).toBe(42);
		});

		await it('should default readableFlowing to null', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.readableFlowing).toBeNull();
		});

		await it('should default readableEnded to false', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.readableEnded).toBeFalsy();
		});

		await it('should default destroyed to false', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.destroyed).toBeFalsy();
		});

		await it('should support objectMode', async () => {
			const readable = new Readable({ read() {}, objectMode: true });
			expect(readable.readableObjectMode).toBeTruthy();
		});

		await it('should support setEncoding', async () => {
			const readable = new Readable({ read() {} });
			readable.setEncoding('utf8');
			expect(readable.readableEncoding).toBe('utf8');
		});

		await it('should support pause/resume/isPaused', async () => {
			const readable = new Readable({ read() {} });
			readable.pause();
			expect(readable.isPaused()).toBeTruthy();
			readable.resume();
			expect(readable.isPaused()).toBeFalsy();
		});

		await it('should use getDefaultHighWaterMark when no hwm specified', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.readableHighWaterMark).toBe(getDefaultHighWaterMark(false));
		});
	});

	await describe('Readable: data and end events', async () => {
		await it('should emit data event on push', async () => {
			const readable = new Readable({ read() {} });
			const received = await new Promise<string>((resolve) => {
				readable.on('data', (chunk) => resolve(String(chunk)));
				readable.push('test');
			});
			expect(received).toBe('test');
		});

		await it('should emit end when all data consumed after push(null)', async () => {
			const readable = new Readable({
				read() {
					this.push('data');
					this.push(null);
				}
			});
			const ended = await new Promise<boolean>((resolve) => {
				readable.on('end', () => resolve(true));
				readable.resume();
			});
			expect(ended).toBeTruthy();
			expect(readable.readableEnded).toBeTruthy();
		});

		await it('push(null) should return false', async () => {
			const readable = new Readable({ read() {} });
			const result = readable.push(null);
			expect(result).toBeFalsy();
		});

		await it('should emit multiple data events', async () => {
			const readable = new Readable({
				read() {
					this.push('a');
					this.push('b');
					this.push('c');
					this.push(null);
				}
			});
			const chunks: string[] = [];
			await new Promise<void>((resolve) => {
				readable.on('data', (chunk) => chunks.push(String(chunk)));
				readable.on('end', () => resolve());
			});
			expect(chunks.length).toBe(3);
			expect(chunks[0]).toBe('a');
			expect(chunks[1]).toBe('b');
			expect(chunks[2]).toBe('c');
		});
	});

	await describe('Readable: destroy', async () => {
		await it('should emit close on destroy', async () => {
			const readable = new Readable({ read() {} });
			const closed = await new Promise<boolean>((resolve) => {
				readable.on('close', () => resolve(true));
				readable.destroy();
			});
			expect(closed).toBeTruthy();
			expect(readable.destroyed).toBeTruthy();
			expect(readable.readable).toBeFalsy();
		});

		await it('should emit error on destroy with error', async () => {
			const readable = new Readable({ read() {} });
			const err = await new Promise<Error>((resolve) => {
				readable.on('error', (e) => resolve(e));
				readable.destroy(new Error('test error'));
			});
			expect(err.message).toBe('test error');
		});

		await it('should be idempotent on double destroy', async () => {
			const readable = new Readable({ read() {} });
			let closeCount = 0;
			readable.on('close', () => { closeCount++; });
			await new Promise<void>((resolve) => {
				readable.on('close', () => resolve());
				readable.destroy();
			});
			readable.destroy();
			// Give time for any spurious second close
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(closeCount).toBe(1);
		});

		await it('should set readableAborted when destroyed before end', async () => {
			const readable = new Readable({ read() {} });
			readable.push('data');
			await new Promise<void>((resolve) => {
				readable.on('close', () => resolve());
				readable.destroy();
			});
			expect(readable.readableAborted).toBeTruthy();
		});
	});

	await describe('Readable: _construct', async () => {
		await it('should call _construct before first read', async () => {
			let constructCalled = false;
			const readable = new Readable({
				construct(callback) {
					constructCalled = true;
					callback();
				},
				read() {
					this.push('data');
					this.push(null);
				}
			});
			// construct is async, should be called on next tick
			expect(constructCalled).toBeFalsy();
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(constructCalled).toBeTruthy();
		});

		await it('should delay flowing until construct completes', async () => {
			const chunks: string[] = [];
			const readable = new Readable({
				construct(callback) {
					setTimeout(() => callback(), 20);
				},
				read() {
					this.push('hello');
					this.push(null);
				}
			});
			readable.on('data', (chunk) => chunks.push(String(chunk)));
			// Data should not flow yet
			expect(chunks.length).toBe(0);
			await new Promise<void>((resolve) => {
				readable.on('end', () => resolve());
			});
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('hello');
		});

		await it('should destroy stream if construct errors', async () => {
			const readable = new Readable({
				construct(callback) {
					callback(new Error('construct failed'));
				},
				read() {}
			});
			const err = await new Promise<Error>((resolve) => {
				readable.on('error', (e) => resolve(e));
			});
			expect(err.message).toBe('construct failed');
			expect(readable.destroyed).toBeTruthy();
		});
	});

	await describe('Readable.from', async () => {
		await it('should create readable from array', async () => {
			const readable = Readable.from(['a', 'b', 'c']);
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBe(3);
		});

		await it('should create readable from async generator', async () => {
			async function* gen() {
				yield 1;
				yield 2;
				yield 3;
			}
			const readable = Readable.from(gen());
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBe(3);
		});
	});

	await describe('Readable: async iterator', async () => {
		await it('should iterate over pushed chunks', async () => {
			let i = 0;
			const data = ['chunk1', 'chunk2', null];
			const readable = new Readable({
				read() {
					this.push(data[i++] ?? null);
				}
			});
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length > 0).toBeTruthy();
		});
	});

	await describe('Readable: unshift', async () => {
		await it('should put data back at the front of the buffer', async () => {
			const readable = new Readable({ read() {} });
			readable.push('second');
			readable.unshift('first');
			const chunks: string[] = [];
			readable.on('data', (chunk) => chunks.push(String(chunk)));
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(chunks[0]).toBe('first');
			expect(chunks[1]).toBe('second');
		});
	});

	await describe('Readable: unpipe', async () => {
		await it('should remove specific piped destination', async () => {
			const readable = new Readable({ read() {} });
			const chunks1: string[] = [];
			const chunks2: string[] = [];
			const w1 = new Writable({ write(chunk, _enc, cb) { chunks1.push(String(chunk)); cb(); } });
			const w2 = new Writable({ write(chunk, _enc, cb) { chunks2.push(String(chunk)); cb(); } });

			readable.pipe(w1);
			readable.pipe(w2);
			readable.unpipe(w1);

			readable.push('data');
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(chunks1.length).toBe(0);
			expect(chunks2.length).toBe(1);
		});

		await it('should emit unpipe event on destination', async () => {
			const readable = new Readable({ read() {} });
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			readable.pipe(writable);

			const unpiped = await new Promise<boolean>((resolve) => {
				writable.on('unpipe', () => resolve(true));
				readable.unpipe(writable);
			});
			expect(unpiped).toBeTruthy();
		});

		await it('should remove all destinations when called without args', async () => {
			const readable = new Readable({ read() {} });
			const w1 = new Writable({ write(_c, _e, cb) { cb(); } });
			const w2 = new Writable({ write(_c, _e, cb) { cb(); } });

			readable.pipe(w1);
			readable.pipe(w2);

			let unpipeCount = 0;
			w1.on('unpipe', () => unpipeCount++);
			w2.on('unpipe', () => unpipeCount++);
			readable.unpipe();

			expect(unpipeCount).toBe(2);
		});
	});

	// ==================== Writable ====================

	await describe('Writable: properties', async () => {
		await it('should create an instance', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			expect(writable).toBeDefined();
			expect(writable.writable).toBeTruthy();
		});

		await it('should default writableEnded to false', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			expect(writable.writableEnded).toBeFalsy();
		});

		await it('should default destroyed to false', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			expect(writable.destroyed).toBeFalsy();
		});

		await it('should expose writableCorked', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			expect(writable.writableCorked).toBe(0);
			writable.cork();
			expect(writable.writableCorked).toBe(1);
			writable.uncork();
			expect(writable.writableCorked).toBe(0);
		});

		await it('should use getDefaultHighWaterMark when no hwm specified', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			expect(writable.writableHighWaterMark).toBe(getDefaultHighWaterMark(false));
		});
	});

	await describe('Writable: write and end', async () => {
		await it('should call _write with chunk', async () => {
			const chunks: string[] = [];
			const writable = new Writable({
				write(chunk, _encoding, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			writable.write('hello');
			// _write is called synchronously, but drain/callback is async
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('hello');
		});

		await it('should emit finish on end()', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const finished = await new Promise<boolean>((resolve) => {
				writable.on('finish', () => resolve(true));
				writable.end();
			});
			expect(finished).toBeTruthy();
		});

		await it('should set writableEnded after end()', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			writable.end();
			expect(writable.writableEnded).toBeTruthy();
		});

		await it('should set writableFinished after finish event', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			await new Promise<void>((resolve) => {
				writable.on('finish', () => resolve());
				writable.end();
			});
			expect(writable.writableFinished).toBeTruthy();
		});

		await it('should write chunk passed to end()', async () => {
			const chunks: string[] = [];
			const writable = new Writable({
				write(chunk, _encoding, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			await new Promise<void>((resolve) => {
				writable.on('finish', () => resolve());
				writable.end('final');
			});
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('final');
		});

		await it('should support cork and uncork', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			writable.cork();
			writable.uncork();
			expect(true).toBeTruthy();
		});

		await it('should invoke write callback', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const called = await new Promise<boolean>((resolve) => {
				writable.write('data', () => resolve(true));
			});
			expect(called).toBeTruthy();
		});
	});

	await describe('Writable: _construct', async () => {
		await it('should call _construct before first write', async () => {
			let constructCalled = false;
			const chunks: string[] = [];
			const writable = new Writable({
				construct(callback) {
					constructCalled = true;
					callback();
				},
				write(chunk, _enc, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			expect(constructCalled).toBeFalsy();
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(constructCalled).toBeTruthy();
		});

		await it('should destroy stream if construct errors', async () => {
			const writable = new Writable({
				construct(callback) {
					callback(new Error('construct failed'));
				},
				write(_c, _e, cb) { cb(); }
			});
			const err = await new Promise<Error>((resolve) => {
				writable.on('error', (e) => resolve(e));
			});
			expect(err.message).toBe('construct failed');
			expect(writable.destroyed).toBeTruthy();
		});
	});

	await describe('Writable: cork/uncork buffering', async () => {
		await it('should buffer writes while corked', async () => {
			const chunks: string[] = [];
			const writable = new Writable({
				write(chunk, _enc, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			writable.cork();
			writable.write('a');
			writable.write('b');
			// Writes should be buffered, not yet passed to _write
			expect(chunks.length).toBe(0);
			writable.uncork();
			// After uncork, buffered writes should flush
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(chunks.length).toBe(2);
			expect(chunks[0]).toBe('a');
			expect(chunks[1]).toBe('b');
		});

		await it('should support nested cork/uncork', async () => {
			const chunks: string[] = [];
			const writable = new Writable({
				write(chunk, _enc, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			writable.cork();
			writable.cork();
			writable.write('x');
			writable.uncork();
			// Still corked (count = 1)
			expect(chunks.length).toBe(0);
			writable.uncork();
			// Now fully uncorked
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(chunks.length).toBe(1);
		});

		await it('should use _writev for batched writes when available', async () => {
			let writevCalled = false;
			let batchSize = 0;
			const writable = new Writable({
				write(_c, _e, cb) { cb(); },
				writev(chunks, cb) {
					writevCalled = true;
					batchSize = chunks.length;
					cb();
				}
			});
			writable.cork();
			writable.write('a');
			writable.write('b');
			writable.write('c');
			writable.uncork();
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(writevCalled).toBeTruthy();
			expect(batchSize).toBe(3);
		});
	});

	await describe('Writable: destroy', async () => {
		await it('should emit close on destroy', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const closed = await new Promise<boolean>((resolve) => {
				writable.on('close', () => resolve(true));
				writable.destroy();
			});
			expect(closed).toBeTruthy();
			expect(writable.destroyed).toBeTruthy();
			expect(writable.writable).toBeFalsy();
		});
	});

	await describe('Writable: write-after-end', async () => {
		await it('should error on write after end', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			writable.end();
			const errorEmitted = await new Promise<boolean>((resolve) => {
				writable.on('error', () => resolve(true));
				writable.write('after-end');
			});
			expect(errorEmitted).toBeTruthy();
		});
	});

	await describe('Writable: _final', async () => {
		await it('should call _final on end', async () => {
			let finalCalled = false;
			const writable = new Writable({
				write(_c, _e, cb) { cb(); },
				final(cb) {
					finalCalled = true;
					cb();
				}
			});
			await new Promise<void>((resolve) => {
				writable.on('finish', () => resolve());
				writable.end();
			});
			expect(finalCalled).toBeTruthy();
		});

		await it('should emit error if _final fails', async () => {
			const writable = new Writable({
				write(_c, _e, cb) { cb(); },
				final(cb) {
					cb(new Error('final error'));
				}
			});
			const err = await new Promise<Error>((resolve) => {
				writable.on('error', (e) => resolve(e));
				writable.end();
			});
			expect(err.message).toBe('final error');
		});
	});

	// ==================== Duplex ====================

	await describe('Duplex', async () => {
		await it('should create an instance', async () => {
			const duplex = new Duplex({
				read() {},
				write(_chunk, _encoding, callback) { callback(); }
			});
			expect(duplex).toBeDefined();
			expect(duplex.readable).toBeTruthy();
			expect(duplex.writable).toBeTruthy();
		});

		await it('should accept writes', async () => {
			const received: string[] = [];
			const duplex = new Duplex({
				read() {},
				write(chunk, _encoding, callback) {
					received.push(String(chunk));
					callback();
				}
			});
			duplex.write('data');
			expect(received.length).toBe(1);
			expect(received[0]).toBe('data');
		});

		await it('should emit finish on end()', async () => {
			const duplex = new Duplex({
				read() {},
				write(_chunk, _encoding, callback) { callback(); }
			});
			const finished = await new Promise<boolean>((resolve) => {
				duplex.on('finish', () => resolve(true));
				duplex.end();
			});
			expect(finished).toBeTruthy();
		});

		await it('should support cork/uncork', async () => {
			const chunks: string[] = [];
			const duplex = new Duplex({
				read() {},
				write(chunk, _enc, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			duplex.cork();
			duplex.write('a');
			duplex.write('b');
			expect(chunks.length).toBe(0);
			duplex.uncork();
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(chunks.length).toBe(2);
		});

		await it('should expose writableCorked', async () => {
			const duplex = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
			expect(duplex.writableCorked).toBe(0);
			duplex.cork();
			expect(duplex.writableCorked).toBe(1);
		});
	});

	// ==================== Transform ====================

	await describe('Transform', async () => {
		await it('should create an instance', async () => {
			const transform = new Transform({
				transform(chunk, _encoding, callback) { callback(null, chunk); }
			});
			expect(transform).toBeDefined();
		});

		await it('should transform data through _transform', async () => {
			const transform = new Transform({
				transform(chunk, _encoding, callback) {
					callback(null, String(chunk).toUpperCase());
				}
			});
			const output = await new Promise<string>((resolve) => {
				transform.on('data', (chunk) => resolve(String(chunk)));
				transform.write('hello');
			});
			expect(output).toBe('HELLO');
		});

		await it('should call _flush on end', async () => {
			let flushed = false;
			const transform = new Transform({
				transform(chunk, _encoding, callback) { callback(null, chunk); },
				flush(callback) {
					flushed = true;
					callback();
				}
			});
			transform.on('data', () => {}); // consume
			await new Promise<void>((resolve) => {
				transform.on('finish', () => resolve());
				transform.end();
			});
			expect(flushed).toBeTruthy();
		});

		await it('should emit finish after flush', async () => {
			const transform = new Transform({
				transform(chunk, _encoding, callback) { callback(null, chunk); }
			});
			transform.on('data', () => {});
			const finished = await new Promise<boolean>((resolve) => {
				transform.on('finish', () => resolve(true));
				transform.end('last');
			});
			expect(finished).toBeTruthy();
		});

		await it('should propagate transform errors', async () => {
			const transform = new Transform({
				transform(_chunk, _encoding, callback) {
					callback(new Error('transform error'));
				}
			});
			const err = await new Promise<Error>((resolve) => {
				transform.on('error', (e) => resolve(e));
				transform.write('data');
			});
			expect(err.message).toBe('transform error');
		});

		await it('should flush extra data on end', async () => {
			const chunks: string[] = [];
			const transform = new Transform({
				transform(chunk, _encoding, callback) {
					callback(null, chunk);
				},
				flush(callback) {
					this.push('flushed');
					callback();
				}
			});
			transform.on('data', (chunk) => chunks.push(String(chunk)));
			await new Promise<void>((resolve) => {
				transform.on('end', () => resolve());
				transform.write('regular');
				transform.end();
			});
			expect(chunks).toContain('regular');
			expect(chunks).toContain('flushed');
		});
	});

	// ==================== PassThrough ====================

	await describe('PassThrough', async () => {
		await it('should create an instance', async () => {
			const pt = new PassThrough();
			expect(pt).toBeDefined();
		});

		await it('should pass data through unchanged', async () => {
			const pt = new PassThrough();
			const output = await new Promise<string>((resolve) => {
				pt.on('data', (chunk) => resolve(String(chunk)));
				pt.write('unchanged');
			});
			expect(output).toBe('unchanged');
		});

		await it('should emit finish on end', async () => {
			const pt = new PassThrough();
			pt.on('data', () => {}); // consume
			const finished = await new Promise<boolean>((resolve) => {
				pt.on('finish', () => resolve(true));
				pt.end();
			});
			expect(finished).toBeTruthy();
		});

		await it('should support multiple writes', async () => {
			const pt = new PassThrough();
			const chunks: string[] = [];
			pt.on('data', (chunk) => chunks.push(String(chunk)));
			pt.write('a');
			pt.write('b');
			pt.write('c');
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(chunks.length).toBe(3);
		});
	});

	// ==================== pipe ====================

	await describe('Stream.pipe', async () => {
		await it('should emit pipe event on destination', async () => {
			const readable = new Readable({ read() {} });
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const pipeSource = await new Promise<unknown>((resolve) => {
				writable.on('pipe', (src) => resolve(src));
				readable.pipe(writable);
			});
			expect(pipeSource).toBe(readable);
		});

		await it('should return the destination', async () => {
			const readable = new Readable({ read() {} });
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const result = readable.pipe(writable);
			expect(result === writable).toBeTruthy();
		});

		await it('should pipe data and finish', async () => {
			const chunks: string[] = [];
			const readable = new Readable({
				read() {
					this.push('piped');
					this.push(null);
				}
			});
			const writable = new Writable({
				write(chunk, _encoding, callback) {
					chunks.push(String(chunk));
					callback();
				}
			});
			await new Promise<void>((resolve) => {
				writable.on('finish', () => resolve());
				readable.pipe(writable);
			});
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('piped');
		});

		await it('should not end destination when end: false', async () => {
			const readable = new Readable({
				read() {
					this.push('data');
					this.push(null);
				}
			});
			const writable = new Writable({
				write(_c, _e, cb) { cb(); }
			});
			readable.pipe(writable, { end: false });
			await new Promise<void>((resolve) => {
				readable.on('end', () => resolve());
				readable.resume();
			});
			// Writable should NOT be ended
			expect(writable.writableEnded).toBeFalsy();
		});
	});

	// ==================== pipeline ====================

	await describe('pipeline', async () => {
		await it('should pipe through a transform', async () => {
			const readable = new Readable({
				read() {
					this.push('hello');
					this.push(null);
				}
			});
			const transform = new Transform({
				transform(chunk, _encoding, callback) {
					callback(null, String(chunk).toUpperCase());
				}
			});
			const output: string[] = [];
			const writable = new Writable({
				write(chunk, _encoding, callback) {
					output.push(String(chunk));
					callback();
				}
			});

			await new Promise<void>((resolve, reject) => {
				pipeline(readable, transform, writable, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			expect(output.length).toBe(1);
			expect(output[0]).toBe('HELLO');
		});

		await it('should throw with less than 2 streams', async () => {
			expect(() => {
				(pipeline as any)(new Readable({ read() {} }), () => {});
			}).toThrow();
		});

		await it('should callback with error on stream error', async () => {
			const readable = new Readable({
				read() {
					this.destroy(new Error('read error'));
				}
			});
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });

			const err = await new Promise<Error>((resolve) => {
				pipeline(readable, writable, (e) => {
					if (e) resolve(e);
				});
			});
			expect(err.message).toBe('read error');
		});
	});

	// ==================== finished ====================

	await describe('finished', async () => {
		await it('should callback on writable finish', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const done = await new Promise<boolean>((resolve) => {
				finished(writable, () => resolve(true));
				writable.end();
			});
			expect(done).toBeTruthy();
		});

		await it('should callback on readable end', async () => {
			const readable = new Readable({
				read() {
					this.push(null);
				}
			});
			const done = await new Promise<boolean>((resolve) => {
				finished(readable, () => resolve(true));
				readable.resume();
			});
			expect(done).toBeTruthy();
		});

		await it('should return cleanup function', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const cleanup = finished(writable, () => {});
			expect(typeof cleanup).toBe('function');
			cleanup();
		});

		await it('should callback with error on stream error', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const err = await new Promise<Error>((resolve) => {
				finished(writable, (e) => {
					if (e) resolve(e);
				});
				writable.emit('error', new Error('stream error'));
			});
			expect(err.message).toBe('stream error');
		});

		await it('should detect premature close', async () => {
			const writable = new Writable({
				write(_chunk, _encoding, callback) { callback(); }
			});
			const err = await new Promise<Error>((resolve) => {
				finished(writable, (e) => {
					if (e) resolve(e);
				});
				writable.destroy();
			});
			expect(err.message.toLowerCase()).toBe('premature close');
		});
	});

	// ==================== addAbortSignal ====================
	await describe('addAbortSignal', async () => {
		await it('should destroy stream when signal aborts', async () => {
			const ac = new AbortController();
			const readable = new Readable({ read() {} });
			addAbortSignal(ac.signal, readable);

			const errPromise = new Promise<Error>((resolve) => {
				readable.on('error', (e) => resolve(e));
			});
			ac.abort();
			const err = await errPromise;
			expect(err.message.toLowerCase().includes('aborted')).toBeTruthy();
			expect(readable.destroyed).toBeTruthy();
		});

		await it('should destroy immediately if signal already aborted', async () => {
			const ac = new AbortController();
			ac.abort();
			const readable = new Readable({ read() {} });
			// Must listen for error to prevent unhandled error crash on Node.js
			readable.on('error', () => {});
			addAbortSignal(ac.signal, readable);

			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(readable.destroyed).toBeTruthy();
		});

		await it('should throw if first arg is not AbortSignal', async () => {
			expect(() => {
				addAbortSignal({} as any, new Readable({ read() {} }));
			}).toThrow();
		});

		await it('should throw if second arg is not a Stream', async () => {
			const ac = new AbortController();
			expect(() => {
				addAbortSignal(ac.signal, {} as any);
			}).toThrow();
		});

		await it('should work with Writable', async () => {
			const ac = new AbortController();
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			addAbortSignal(ac.signal, writable);
			ac.abort();

			await new Promise<void>((resolve) => {
				writable.on('close', () => resolve());
			});
			expect(writable.destroyed).toBeTruthy();
		});
	});

	// ==================== Utility functions ====================

	await describe('isReadable', async () => {
		await it('should return true for a readable stream', async () => {
			const readable = new Readable({ read() {} });
			expect(isReadable(readable)).toBeTruthy();
		});

		await it('should return false for a destroyed stream', async () => {
			const readable = new Readable({ read() {} });
			readable.destroy();
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(isReadable(readable)).toBeFalsy();
		});

		await it('should return false for an ended stream', async () => {
			const readable = new Readable({ read() { this.push(null); } });
			readable.resume();
			await new Promise<void>((resolve) => readable.on('end', () => resolve()));
			expect(isReadable(readable)).toBeFalsy();
		});

		await it('should return false for null', async () => {
			expect(isReadable(null as any)).toBeFalsy();
		});

		await it('should return false for plain objects', async () => {
			expect(isReadable({} as any)).toBeFalsy();
		});
	});

	await describe('isWritable', async () => {
		await it('should return true for a writable stream', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			expect(isWritable(writable)).toBeTruthy();
		});

		await it('should return false for an ended writable', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			writable.end();
			expect(isWritable(writable)).toBeFalsy();
		});

		await it('should return false for null', async () => {
			expect(isWritable(null as any)).toBeFalsy();
		});
	});

	await describe('isDestroyed', async () => {
		await it('should return false for a new stream', async () => {
			const readable = new Readable({ read() {} });
			expect(isDestroyed(readable)).toBeFalsy();
		});

		await it('should return true for a destroyed stream', async () => {
			const readable = new Readable({ read() {} });
			readable.destroy();
			expect(isDestroyed(readable)).toBeTruthy();
		});

		await it('should return false for null', async () => {
			expect(isDestroyed(null)).toBeFalsy();
		});
	});

	await describe('isDisturbed', async () => {
		await it('should return false for a new stream', async () => {
			const readable = new Readable({ read() {} });
			expect(isDisturbed(readable)).toBeFalsy();
		});

		await it('should return true after data is read', async () => {
			const readable = new Readable({
				read() {
					this.push('data');
					this.push(null);
				}
			});
			const chunks: unknown[] = [];
			readable.on('data', (chunk) => chunks.push(chunk));
			await new Promise<void>((resolve) => readable.on('end', () => resolve()));
			expect(isDisturbed(readable)).toBeTruthy();
		});

		await it('should return false for null', async () => {
			expect(isDisturbed(null)).toBeFalsy();
		});
	});

	await describe('isErrored', async () => {
		await it('should return false for a new stream', async () => {
			const readable = new Readable({ read() {} });
			expect(isErrored(readable)).toBeFalsy();
		});

		await it('should return false for null', async () => {
			expect(isErrored(null)).toBeFalsy();
		});
	});

	// ==================== getDefaultHighWaterMark / setDefaultHighWaterMark ====================

	await describe('getDefaultHighWaterMark / setDefaultHighWaterMark', async () => {
		await it('should return a positive number for non-object mode by default', async () => {
			const hwm = getDefaultHighWaterMark(false);
			expect(typeof hwm).toBe('number');
			expect(hwm > 0).toBeTruthy();
		});

		await it('should return 16 for object mode by default', async () => {
			expect(getDefaultHighWaterMark(true)).toBe(16);
		});

		await it('should allow setting custom default', async () => {
			const original = getDefaultHighWaterMark(false);
			setDefaultHighWaterMark(false, 32768);
			expect(getDefaultHighWaterMark(false)).toBe(32768);
			// Restore
			setDefaultHighWaterMark(false, original);
		});

		await it('should reject invalid values', async () => {
			expect(() => setDefaultHighWaterMark(false, -1)).toThrow();
			expect(() => setDefaultHighWaterMark(false, NaN)).toThrow();
		});
	});

	// ==================== Writable (backpressure & state) ====================

	await describe('Writable (backpressure)', async () => {
		await it('write should return false when HWM reached', async () => {
			const writable = new Writable({
				highWaterMark: 5,
				write(_chunk, _enc, cb) { setTimeout(cb, 5); },
			});
			const result = writable.write('123456'); // > HWM
			expect(result).toBe(false);
			writable.destroy();
		});

		await it('write should return true when below HWM', async () => {
			const writable = new Writable({
				highWaterMark: 100,
				write(_chunk, _enc, cb) { cb(); },
			});
			const result = writable.write('hi');
			expect(result).toBe(true);
		});

		await it('should emit drain after write returns false', async () => {
			const writable = new Writable({
				highWaterMark: 1,
				write(_chunk, _enc, cb) { setTimeout(cb, 5); },
			});
			writable.write('x');
			const drained = await new Promise<boolean>((resolve) => {
				writable.on('drain', () => resolve(true));
				setTimeout(() => resolve(false), 2000);
			});
			expect(drained).toBe(true);
			writable.destroy();
		});

		await it('writableEnded should be true after end()', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			expect(writable.writableEnded).toBe(false);
			writable.end();
			expect(writable.writableEnded).toBe(true);
		});

		await it('writableFinished should be true after finish event', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			expect(writable.writableFinished).toBe(false);
			writable.end();
			await new Promise<void>((resolve) => writable.on('finish', () => resolve()));
			expect(writable.writableFinished).toBe(true);
		});

		await it('writableLength should track buffered bytes', async () => {
			const writable = new Writable({
				highWaterMark: 100,
				write(_chunk, _enc, cb) { setTimeout(cb, 50); },
			});
			writable.write('abc');
			expect(writable.writableLength).toBeGreaterThan(0);
			writable.destroy();
		});
	});

	// ==================== Transform (objectMode) ====================

	await describe('Transform (objectMode)', async () => {
		await it('should pass objects through in objectMode', async () => {
			const transform = new Transform({
				objectMode: true,
				transform(chunk, _enc, cb) { cb(null, chunk); },
			});
			const obj = { key: 'value' };
			const result = await new Promise<unknown>((resolve) => {
				transform.on('data', (chunk) => resolve(chunk));
				transform.write(obj);
			});
			expect(result).toBe(obj);
		});

		await it('should transform objects', async () => {
			const transform = new Transform({
				objectMode: true,
				transform(chunk: any, _enc, cb) {
					cb(null, { ...chunk, transformed: true });
				},
			});
			const result = await new Promise<any>((resolve) => {
				transform.on('data', (chunk) => resolve(chunk));
				transform.write({ id: 1 });
			});
			expect(result.id).toBe(1);
			expect(result.transformed).toBe(true);
		});
	});

	// ==================== Readable (objectMode) ====================

	await describe('Readable (objectMode)', async () => {
		await it('should read objects in objectMode', async () => {
			const objects = [{ a: 1 }, { b: 2 }, { c: 3 }];
			let i = 0;
			const readable = new Readable({
				objectMode: true,
				read() {
					if (i < objects.length) {
						this.push(objects[i++]);
					} else {
						this.push(null);
					}
				}
			});
			const results: unknown[] = [];
			readable.on('data', (chunk) => results.push(chunk));
			await new Promise<void>((resolve) => readable.on('end', () => resolve()));
			expect(results.length).toBe(3);
			expect((results[0] as any).a).toBe(1);
		});

		await it('readableObjectMode should return true', async () => {
			const readable = new Readable({ objectMode: true, read() {} });
			expect(readable.readableObjectMode).toBe(true);
		});

		await it('readableObjectMode should return false by default', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.readableObjectMode).toBe(false);
		});
	});

	// ==================== Destroy behavior ====================

	await describe('Stream destroy', async () => {
		await it('destroy should be idempotent', async () => {
			const readable = new Readable({ read() {} });
			readable.destroy();
			readable.destroy(); // Should not throw
			expect(readable.destroyed).toBe(true);
		});

		await it('destroy with error should emit error event', async () => {
			const readable = new Readable({ read() {} });
			const err = await new Promise<Error>((resolve) => {
				readable.on('error', (e) => resolve(e));
				readable.destroy(new Error('test destroy'));
			});
			expect(err.message).toBe('test destroy');
		});

		await it('destroy should emit close event', async () => {
			const readable = new Readable({ read() {} });
			const closed = await new Promise<boolean>((resolve) => {
				readable.on('close', () => resolve(true));
				readable.destroy();
			});
			expect(closed).toBe(true);
		});

		await it('writable destroy should emit close', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			const closed = await new Promise<boolean>((resolve) => {
				writable.on('close', () => resolve(true));
				writable.destroy();
			});
			expect(closed).toBe(true);
		});
	});

	// ==================== Stream.pipe error handling ====================

	await describe('Stream.pipe (error handling)', async () => {
		await it('pipe should not destroy writable on readable error by default', async () => {
			const readable = new Readable({ read() {} });
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			readable.pipe(writable);
			readable.on('error', () => {}); // Prevent unhandled error
			readable.destroy(new Error('source error'));
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			// The writable should NOT be destroyed by default
			// (pipe only calls end() on normal EOF, not on error)
			expect(writable.destroyed).toBe(false);
			writable.destroy();
		});

		await it('unpipe should stop data flow', async () => {
			const chunks: string[] = [];
			const readable = new Readable({ read() {} });
			const writable = new Writable({
				write(chunk, _e, cb) {
					chunks.push(String(chunk));
					cb();
				}
			});
			readable.pipe(writable);
			readable.push('before');
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			readable.unpipe(writable);
			readable.push('after');
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			// 'after' should NOT reach writable
			expect(chunks).toContain('before');
			expect(chunks.indexOf('after')).toBe(-1);
			readable.destroy();
			writable.destroy();
		});
	});

	// ==================== stream/promises ====================

	await describe('stream/promises', async () => {
		await it('pipeline should return a promise', async () => {
			// Import dynamically to test the sub-module
			const { pipeline: pipelineP } = await import('node:stream/promises');

			const readable = new Readable({
				read() {
					this.push('data');
					this.push(null);
				}
			});
			const chunks: string[] = [];
			const writable = new Writable({
				write(chunk, _enc, cb) {
					chunks.push(String(chunk));
					cb();
				}
			});

			await pipelineP(readable, writable);
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('data');
		});

		await it('finished should return a promise', async () => {
			const { finished: finishedP } = await import('node:stream/promises');

			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			writable.end();
			await finishedP(writable);
			expect(writable.writableFinished).toBeTruthy();
		});
	});

	// ==================== Readable: readable event ====================
	// Ported from refs/node-test/parallel/test-stream-readable-event.js
	// Original: MIT license, Node.js contributors

	await describe('Readable: readable event', async () => {
		await it('should emit readable when data is available', async () => {
			const r = new Readable({ read() {} });
			let readableEmitted = false;
			r.on('readable', () => { readableEmitted = true; });
			r.push('data');
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(readableEmitted).toBeTruthy();
		});

		await it('should allow read() in readable handler', async () => {
			const r = new Readable({ read() {} });
			const chunks: string[] = [];
			r.on('readable', () => {
				let chunk;
				while ((chunk = r.read()) !== null) {
					chunks.push(String(chunk));
				}
			});
			r.push('hello');
			r.push('world');
			r.push(null);
			await new Promise<void>((resolve) => r.on('end', () => resolve()));
			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.join('')).toBe('helloworld');
		});

		await it('should emit readable on push(null) when data buffered', async () => {
			const r = new Readable({ highWaterMark: 30, read() {} });
			r.push('small');
			r.push(null);

			const result = await new Promise<string | null>((resolve) => {
				r.on('readable', () => {
					const data = r.read();
					resolve(data !== null ? String(data) : null);
				});
			});
			expect(result).toBe('small');
		});
	});

	// ==================== Readable: read() method ====================

	await describe('Readable: read(size)', async () => {
		await it('should read specific number of bytes', async () => {
			const r = new Readable({ read() {} });
			r.push('hello world');
			const chunk = r.read(5);
			expect(String(chunk)).toBe('hello');
		});

		await it('should return null when not enough data', async () => {
			const r = new Readable({ read() {} });
			r.push('hi');
			const chunk = r.read(10);
			expect(chunk).toBeNull();
		});

		await it('read(0) should not consume data', async () => {
			const r = new Readable({ read() {} });
			r.push('data');
			const result = r.read(0);
			expect(result).toBeNull();
			// Data should still be buffered
			expect(r.readableLength).toBe(4);
		});
	});

	// ==================== Readable.from variants ====================
	// Ported from refs/node-test/parallel/test-stream-readable-from.js
	// Original: MIT license, Node.js contributors

	await describe('Readable.from (extended)', async () => {
		await it('should create readable from sync generator', async () => {
			function* gen() {
				yield 'a';
				yield 'b';
				yield 'c';
			}
			const readable = Readable.from(gen());
			const chunks: string[] = [];
			for await (const chunk of readable) {
				chunks.push(String(chunk));
			}
			expect(chunks.length).toBe(3);
			expect(chunks[0]).toBe('a');
			expect(chunks[2]).toBe('c');
		});

		await it('should create readable from iterable (Set)', async () => {
			const set = new Set([1, 2, 3]);
			const readable = Readable.from(set);
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBe(3);
		});

		await it('should support objectMode by default', async () => {
			const readable = Readable.from([{ id: 1 }, { id: 2 }]);
			expect(readable.readableObjectMode).toBeTruthy();
			const chunks: any[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks[0].id).toBe(1);
			expect(chunks[1].id).toBe(2);
		});

		await it('should create readable from string', async () => {
			const readable = Readable.from('hello');
			const chunks: string[] = [];
			for await (const chunk of readable) {
				chunks.push(String(chunk));
			}
			expect(chunks.join('')).toBe('hello');
		});

		await it('should create readable from Buffer', async () => {
			const buf = Buffer.from('test data');
			const readable = Readable.from(buf);
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBeGreaterThan(0);
		});
	});

	// ==================== Readable: async iterator (extended) ====================
	// Ported from refs/node-test/parallel/test-stream-readable-async-iterators.js
	// Original: MIT license, Node.js contributors

	await describe('Readable: async iterator (extended)', async () => {
		await it('should iterate in objectMode with falsey values', async () => {
			const readable = new Readable({ objectMode: true, read() {} });
			readable.push(0);
			readable.push('');
			readable.push(false);
			readable.push(null);

			const values: unknown[] = [];
			for await (const chunk of readable) {
				values.push(chunk);
			}
			expect(values.length).toBe(3);
			expect(values[0]).toBe(0);
			expect(values[1]).toBe('');
			expect(values[2]).toBe(false);
		});

		await it('should handle break in for-await loop', async () => {
			const readable = new Readable({
				read() {
					this.push('data');
				}
			});
			let count = 0;
			for await (const _chunk of readable) {
				count++;
				if (count >= 3) break;
			}
			expect(count).toBe(3);
			expect(readable.destroyed).toBeTruthy();
		});

		await it('should handle error during async iteration', async () => {
			const readable = new Readable({
				read() {
					this.push('data');
					this.destroy(new Error('iter error'));
				}
			});
			let caughtError: Error | null = null;
			try {
				for await (const _chunk of readable) {
					// Should throw
				}
			} catch (e) {
				caughtError = e as Error;
			}
			expect(caughtError).toBeDefined();
			expect(caughtError!.message).toBe('iter error');
		});
	});

	// ==================== Pipeline (extended) ====================
	// Ported from refs/node-test/parallel/test-stream-pipeline.js
	// Original: MIT license, Node.js contributors

	await describe('pipeline (extended)', async () => {
		await it('should pipe data through multiple transforms', async () => {
			const readable = new Readable({
				read() { this.push('hello'); this.push(null); }
			});
			const upper = new Transform({
				transform(chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); }
			});
			const exclaim = new Transform({
				transform(chunk, _enc, cb) { cb(null, String(chunk) + '!'); }
			});
			const output: string[] = [];
			const writable = new Writable({
				write(chunk, _enc, cb) { output.push(String(chunk)); cb(); }
			});

			await new Promise<void>((resolve, reject) => {
				pipeline(readable, upper, exclaim, writable, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			expect(output[0]).toBe('HELLO!');
		});

		await it('should destroy all streams on error in source', async () => {
			const readable = new Readable({
				read() { this.destroy(new Error('src err')); }
			});
			const transform = new Transform({
				transform(chunk, _enc, cb) { cb(null, chunk); }
			});
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });

			const err = await new Promise<Error>((resolve) => {
				pipeline(readable, transform, writable, (e) => {
					if (e) resolve(e);
				});
			});
			expect(err.message).toBe('src err');
			// All streams should be destroyed
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(readable.destroyed).toBeTruthy();
			expect(transform.destroyed).toBeTruthy();
			expect(writable.destroyed).toBeTruthy();
		});

		await it('should destroy all streams on error in middle transform', async () => {
			const readable = new Readable({
				read() { this.push('data'); this.push(null); }
			});
			const transform = new Transform({
				transform(_chunk, _enc, cb) { cb(new Error('transform err')); }
			});
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });

			const err = await new Promise<Error>((resolve) => {
				pipeline(readable, transform, writable, (e) => {
					if (e) resolve(e);
				});
			});
			expect(err.message).toBe('transform err');
		});

		await it('should complete pipeline even with empty string push', async () => {
			const readable = new Readable({
				read() { this.push(''); this.push(null); }
			});
			const writable = new Writable({
				write(chunk, _enc, cb) { cb(); }
			});

			// Pipeline should complete without error
			await new Promise<void>((resolve, reject) => {
				pipeline(readable, writable, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			expect(writable.writableFinished).toBeTruthy();
		});

		await it('pipeline with aborted signal via addAbortSignal should abort', async () => {
			const ac = new AbortController();
			const readable = addAbortSignal(ac.signal, new Readable({ read() {} }));
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });

			// Must listen for error to prevent unhandled error
			readable.on('error', () => {});

			const errPromise = new Promise<Error>((resolve) => {
				pipeline(readable, writable, (err) => {
					if (err) resolve(err);
				});
			});
			ac.abort();
			const err = await errPromise;
			expect(err.message.toLowerCase().includes('abort')).toBeTruthy();
		});
	});

	// ==================== Duplex (extended) ====================
	// Ported from refs/node-test/parallel/test-stream-duplex.js
	// Original: MIT license, Node.js contributors

	await describe('Duplex (extended)', async () => {
		await it('should support objectMode on both sides', async () => {
			const duplex = new Duplex({
				objectMode: true,
				read() {},
				write(_chunk, _enc, cb) { cb(); }
			});
			expect(duplex.readableObjectMode).toBeTruthy();
			expect(duplex.writableObjectMode).toBeTruthy();
		});

		await it('allowHalfOpen should default to true', async () => {
			const duplex = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
			expect(duplex.allowHalfOpen).toBeTruthy();
		});

		await it('should allow reading and writing independently', async () => {
			const received: string[] = [];
			const duplex = new Duplex({
				read() {},
				write(chunk, _enc, cb) {
					received.push(String(chunk));
					cb();
				}
			});

			// Write side
			duplex.write('hello');
			expect(received[0]).toBe('hello');

			// Read side
			duplex.push('world');
			const readData = await new Promise<string>((resolve) => {
				duplex.on('data', (chunk) => resolve(String(chunk)));
			});
			expect(readData).toBe('world');
		});

		await it('should not end writable when readable ends (allowHalfOpen=true)', async () => {
			const duplex = new Duplex({
				allowHalfOpen: true,
				read() {},
				write(_c, _e, cb) { cb(); }
			});
			duplex.push(null);
			duplex.resume();
			await new Promise<void>((resolve) => duplex.on('end', () => resolve()));
			// Writable side should still be open
			expect(duplex.writable).toBeTruthy();
			duplex.end();
		});

		await it('should end both when allowHalfOpen=false', async () => {
			const duplex = new Duplex({
				allowHalfOpen: false,
				read() {},
				write(_c, _e, cb) { cb(); }
			});
			duplex.push(null);
			duplex.resume();

			await new Promise<void>((resolve) => {
				duplex.on('finish', () => resolve());
			});
			expect(duplex.writableEnded).toBeTruthy();
		});

		await it('should support destroy', async () => {
			const duplex = new Duplex({
				read() {},
				write(_c, _e, cb) { cb(); }
			});
			await new Promise<void>((resolve) => {
				duplex.on('close', () => resolve());
				duplex.destroy();
			});
			expect(duplex.destroyed).toBeTruthy();
			expect(duplex.readable).toBeFalsy();
			expect(duplex.writable).toBeFalsy();
		});
	});

	// ==================== Transform (extended) ====================

	await describe('Transform (extended)', async () => {
		await it('should handle objectMode with falsey values', async () => {
			const transform = new Transform({
				objectMode: true,
				transform(chunk, _enc, cb) { cb(null, chunk); }
			});
			const results: unknown[] = [];
			transform.on('data', (chunk) => results.push(chunk));

			transform.write(0);
			transform.write('');
			transform.write(false);
			transform.end();

			await new Promise<void>((resolve) => transform.on('end', () => resolve()));
			expect(results.length).toBe(3);
			expect(results[0]).toBe(0);
			expect(results[1]).toBe('');
			expect(results[2]).toBe(false);
		});

		await it('should handle multiple pushes in _transform', async () => {
			const transform = new Transform({
				transform(chunk, _enc, cb) {
					const str = String(chunk);
					for (const ch of str) {
						this.push(ch);
					}
					cb();
				}
			});
			const results: string[] = [];
			transform.on('data', (chunk) => results.push(String(chunk)));
			transform.write('abc');
			transform.end();
			await new Promise<void>((resolve) => transform.on('end', () => resolve()));
			expect(results.length).toBe(3);
			expect(results[0]).toBe('a');
			expect(results[1]).toBe('b');
			expect(results[2]).toBe('c');
		});

		await it('should handle async _transform', async () => {
			const transform = new Transform({
				transform(chunk, _enc, cb) {
					setTimeout(() => cb(null, String(chunk).toUpperCase()), 5);
				}
			});
			const results: string[] = [];
			transform.on('data', (chunk) => results.push(String(chunk)));
			transform.write('hello');
			transform.end();
			await new Promise<void>((resolve) => transform.on('end', () => resolve()));
			expect(results.length).toBe(1);
			expect(results[0]).toBe('HELLO');
		});

		await it('should propagate flush errors', async () => {
			const transform = new Transform({
				transform(chunk, _enc, cb) { cb(null, chunk); },
				flush(cb) { cb(new Error('flush error')); }
			});
			transform.on('data', () => {}); // consume
			const err = await new Promise<Error>((resolve) => {
				transform.on('error', (e) => resolve(e));
				transform.end();
			});
			expect(err.message).toBe('flush error');
		});
	});

	// ==================== Writable: _final (extended) ====================
	// Ported from refs/node-test/parallel/test-stream-writable-final-async.js
	// Original: MIT license, Node.js contributors

	await describe('Writable: _final (extended)', async () => {
		await it('should support async _final', async () => {
			let finalCalled = false;
			const order: string[] = [];
			const writable = new Writable({
				write(_c, _e, cb) { order.push('write'); cb(); },
				final(cb) {
					setTimeout(() => {
						finalCalled = true;
						order.push('final');
						cb();
					}, 10);
				}
			});
			writable.write('data');
			writable.end();
			await new Promise<void>((resolve) => writable.on('finish', () => {
				order.push('finish');
				resolve();
			}));
			expect(finalCalled).toBeTruthy();
			expect(order[0]).toBe('write');
			expect(order[1]).toBe('final');
			expect(order[2]).toBe('finish');
		});

		await it('_final should be called after all writes complete', async () => {
			const order: string[] = [];
			const writable = new Writable({
				write(_c, _e, cb) {
					setTimeout(() => { order.push('write-done'); cb(); }, 5);
				},
				final(cb) {
					order.push('final');
					cb();
				}
			});
			writable.write('a');
			writable.write('b');
			writable.end();
			await new Promise<void>((resolve) => writable.on('finish', () => resolve()));
			// Final must come after both writes complete
			expect(order[order.length - 1]).toBe('final');
		});
	});

	// ==================== Pipe backpressure ====================

	await describe('Pipe backpressure', async () => {
		await it('should respect writable backpressure during pipe', async () => {
			let writeCount = 0;
			const readable = new Readable({
				read() {
					this.push('x'.repeat(100));
					if (++writeCount >= 5) this.push(null);
				}
			});
			const chunks: string[] = [];
			const writable = new Writable({
				highWaterMark: 50,
				write(chunk, _enc, cb) {
					chunks.push(String(chunk));
					setTimeout(cb, 5); // Slow consumer
				}
			});

			await new Promise<void>((resolve) => {
				writable.on('finish', () => resolve());
				readable.pipe(writable);
			});
			// All data should eventually arrive
			expect(chunks.length).toBe(5);
		});

		await it('should emit drain after backpressure resolves', async () => {
			const writable = new Writable({
				highWaterMark: 1,
				write(_chunk, _enc, cb) { setTimeout(cb, 10); }
			});
			const result = writable.write('x'.repeat(10));
			expect(result).toBe(false);

			const drained = await new Promise<boolean>((resolve) => {
				writable.on('drain', () => resolve(true));
				setTimeout(() => resolve(false), 2000);
			});
			expect(drained).toBeTruthy();
			writable.destroy();
		});
	});

	// ==================== Uint8Array handling ====================
	// Ported from refs/node-test/parallel/test-stream-uint8array.js
	// Original: MIT license, Node.js contributors

	await describe('Uint8Array handling', async () => {
		await it('Writable should accept Uint8Array', async () => {
			const received: unknown[] = [];
			const writable = new Writable({
				write(chunk, _enc, cb) {
					received.push(chunk);
					cb();
				}
			});
			const data = new Uint8Array([1, 2, 3]);
			writable.write(data);
			expect(received.length).toBe(1);
		});

		await it('Readable should push Uint8Array', async () => {
			const data = new Uint8Array([65, 66, 67]); // ABC
			const readable = new Readable({
				read() {
					this.push(data);
					this.push(null);
				}
			});
			const chunks: unknown[] = [];
			for await (const chunk of readable) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBe(1);
		});

		await it('Transform should handle Uint8Array passthrough', async () => {
			const transform = new Transform({
				transform(chunk, _enc, cb) { cb(null, chunk); }
			});
			const data = new Uint8Array([10, 20, 30]);
			const result = await new Promise<unknown>((resolve) => {
				transform.on('data', (chunk) => resolve(chunk));
				transform.write(data);
			});
			expect(result).toBeDefined();
		});
	});

	// ==================== Destroy event order ====================
	// Ported from refs/node-test/parallel/test-stream-destroy-event-order.js
	// Original: MIT license, Node.js contributors

	await describe('Destroy event order', async () => {
		await it('error should be emitted before close on Readable', async () => {
			const order: string[] = [];
			const readable = new Readable({ read() {} });
			readable.on('error', () => order.push('error'));
			readable.on('close', () => order.push('close'));
			readable.destroy(new Error('test'));
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(order[0]).toBe('error');
			expect(order[1]).toBe('close');
		});

		await it('error should be emitted before close on Writable', async () => {
			const order: string[] = [];
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			writable.on('error', () => order.push('error'));
			writable.on('close', () => order.push('close'));
			writable.destroy(new Error('test'));
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(order[0]).toBe('error');
			expect(order[1]).toBe('close');
		});

		await it('close should be emitted after finish on normal end', async () => {
			const order: string[] = [];
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			writable.on('finish', () => order.push('finish'));
			writable.on('close', () => order.push('close'));
			writable.end();
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(order[0]).toBe('finish');
			expect(order[1]).toBe('close');
		});

		await it('close should be emitted after end on Readable', async () => {
			const order: string[] = [];
			const readable = new Readable({
				read() { this.push(null); }
			});
			readable.on('end', () => order.push('end'));
			readable.on('close', () => order.push('close'));
			readable.resume();
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(order[0]).toBe('end');
			expect(order[1]).toBe('close');
		});
	});

	// ==================== Readable: readableLength ====================

	await describe('Readable: readableLength', async () => {
		await it('should track buffered bytes', async () => {
			const readable = new Readable({ read() {} });
			expect(readable.readableLength).toBe(0);
			readable.push('hello'); // 5 bytes
			expect(readable.readableLength).toBe(5);
		});

		await it('should decrease after read()', async () => {
			const readable = new Readable({ read() {} });
			readable.push('hello world');
			expect(readable.readableLength).toBe(11);
			readable.read(5);
			expect(readable.readableLength).toBe(6);
		});

		await it('should count objects as 1 in objectMode', async () => {
			const readable = new Readable({ objectMode: true, read() {} });
			readable.push({ a: 1 });
			readable.push({ b: 2 });
			expect(readable.readableLength).toBe(2);
		});
	});

	// ==================== Writable: encoding ====================

	await describe('Writable: encoding', async () => {
		await it('should pass encoding to _write when decodeStrings=false', async () => {
			let receivedEncoding: string = '';
			const writable = new Writable({
				decodeStrings: false,
				write(_chunk, encoding, cb) {
					receivedEncoding = encoding;
					cb();
				}
			});
			writable.write('data', 'utf8');
			expect(receivedEncoding).toBe('utf8');
		});

		await it('should default encoding to utf8 when decodeStrings=false', async () => {
			let receivedEncoding: string = '';
			const writable = new Writable({
				decodeStrings: false,
				write(_chunk, encoding, cb) {
					receivedEncoding = encoding;
					cb();
				}
			});
			writable.write('data');
			expect(receivedEncoding).toBe('utf8');
		});

		await it('should use buffer encoding for Buffers', async () => {
			let receivedEncoding: string = '';
			const writable = new Writable({
				write(_chunk, encoding, cb) {
					receivedEncoding = encoding;
					cb();
				}
			});
			writable.write(Buffer.from('data'));
			expect(receivedEncoding).toBe('buffer');
		});

		await it('with decodeStrings=true (default) encoding should be buffer for strings', async () => {
			let receivedEncoding: string = '';
			const writable = new Writable({
				write(_chunk, encoding, cb) {
					receivedEncoding = encoding;
					cb();
				}
			});
			writable.write('data', 'utf8');
			// When decodeStrings=true, strings are converted to Buffers
			expect(receivedEncoding).toBe('buffer');
		});

		await it('setDefaultEncoding should set encoding when decodeStrings=false', async () => {
			let receivedEncoding: string = '';
			const writable = new Writable({
				decodeStrings: false,
				write(_chunk, encoding, cb) {
					receivedEncoding = encoding;
					cb();
				}
			});
			writable.setDefaultEncoding('ascii');
			writable.write('data');
			expect(receivedEncoding).toBe('ascii');
		});
	});

	// ==================== finished (extended) ====================

	await describe('finished (extended)', async () => {
		await it('should work with already-destroyed stream', async () => {
			const readable = new Readable({ read() {} });
			readable.destroy();
			const err = await new Promise<Error | undefined>((resolve) => {
				finished(readable, (e) => resolve(e || undefined));
			});
			expect(err).toBeDefined();
		});

		await it('should work with already-ended readable', async () => {
			const readable = new Readable({
				read() { this.push(null); }
			});
			readable.resume();
			await new Promise<void>((resolve) => readable.on('end', () => resolve()));

			// Stream is already ended
			await new Promise<void>((resolve) => {
				finished(readable, () => resolve());
			});
			expect(readable.readableEnded).toBeTruthy();
		});

		await it('should work with already-finished writable', async () => {
			const writable = new Writable({ write(_c, _e, cb) { cb(); } });
			writable.end();
			await new Promise<void>((resolve) => writable.on('finish', () => resolve()));

			// Stream is already finished
			await new Promise<void>((resolve) => {
				finished(writable, () => resolve());
			});
			expect(writable.writableFinished).toBeTruthy();
		});

		await it('should handle error on Duplex', async () => {
			const duplex = new Duplex({
				read() {},
				write(_c, _e, cb) { cb(); }
			});
			const err = await new Promise<Error>((resolve) => {
				finished(duplex, (e) => { if (e) resolve(e); });
				duplex.destroy(new Error('duplex error'));
			});
			expect(err.message).toBe('duplex error');
		});
	});

	// ==================== PassThrough (extended) ====================

	await describe('PassThrough (extended)', async () => {
		await it('should preserve encoding', async () => {
			const pt = new PassThrough();
			pt.setEncoding('utf8');
			const result = await new Promise<string>((resolve) => {
				pt.on('data', (chunk) => resolve(chunk));
				pt.write(Buffer.from('hello'));
			});
			expect(typeof result).toBe('string');
			expect(result).toBe('hello');
		});

		await it('should be pipeable in a chain', async () => {
			const pt1 = new PassThrough();
			const pt2 = new PassThrough();
			const pt3 = new PassThrough();
			const chunks: string[] = [];
			pt3.on('data', (chunk) => chunks.push(String(chunk)));

			pt1.pipe(pt2).pipe(pt3);
			pt1.write('chained');
			pt1.end();

			await new Promise<void>((resolve) => pt3.on('end', () => resolve()));
			expect(chunks.length).toBe(1);
			expect(chunks[0]).toBe('chained');
		});

		await it('should handle highWaterMark', async () => {
			const pt = new PassThrough({ highWaterMark: 2 });
			const result = pt.write('abc'); // 3 bytes > HWM 2
			expect(result).toBe(false); // Should signal backpressure
		});
	});
};
