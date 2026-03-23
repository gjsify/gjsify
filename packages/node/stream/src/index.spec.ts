import { describe, it, expect } from '@gjsify/unit';
import { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished } from 'stream';

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
	});
};
