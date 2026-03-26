// Ported from refs/node-test/parallel/test-stream-pipeline.js,
// test-stream-finished.js, test-stream-transform-flush.js,
// test-stream-readable-from.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { Readable, Writable, Transform, PassThrough, Duplex, pipeline, finished, addAbortSignal } from 'node:stream';
import { pipeline as pipelinePromise, finished as finishedPromise } from 'node:stream/promises';
import { Buffer } from 'node:buffer';

export default async () => {

  // ===================== pipeline =====================
  await describe('stream.pipeline', async () => {
    await it('should pipe data through multiple streams', async () => {
      const chunks: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const source = new Readable({
          read() {
            this.push('hello');
            this.push(null);
          },
        });
        const transform = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, chunk.toString().toUpperCase());
          },
        });
        const sink = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
          },
        });
        pipeline(source, transform, sink, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      expect(chunks).toContain('HELLO');
    });

    await it('should propagate errors from source', async () => {
      const expectedError = new Error('source error');
      const result = await new Promise<Error | null>((resolve) => {
        const source = new Readable({
          read() {
            this.destroy(expectedError);
          },
        });
        const sink = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        pipeline(source, sink, (err) => {
          resolve(err);
        });
      });
      expect(result).toBe(expectedError);
    });

    await it('should propagate errors from transform', async () => {
      const expectedError = new Error('transform error');
      const result = await new Promise<Error | null>((resolve) => {
        const source = new Readable({
          read() {
            this.push('data');
            this.push(null);
          },
        });
        const transform = new Transform({
          transform(_chunk, _enc, cb) {
            cb(expectedError);
          },
        });
        const sink = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        pipeline(source, transform, sink, (err) => {
          resolve(err);
        });
      });
      expect(result).toBe(expectedError);
    });

    await it('should propagate errors from sink', async () => {
      const expectedError = new Error('sink error');
      const result = await new Promise<Error | null>((resolve) => {
        const source = new Readable({
          read() {
            this.push('data');
            this.push(null);
          },
        });
        const sink = new Writable({
          write(_chunk, _enc, cb) {
            cb(expectedError);
          },
        });
        pipeline(source, sink, (err) => {
          resolve(err);
        });
      });
      expect(result).toBe(expectedError);
    });

    await it('should call callback without error on success', async () => {
      const result = await new Promise<boolean>((resolve) => {
        const source = new Readable({
          read() {
            this.push('ok');
            this.push(null);
          },
        });
        const sink = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        pipeline(source, sink, (err) => {
          resolve(!err);
        });
      });
      expect(result).toBe(true);
    });
  });

  // ===================== pipeline (promises) =====================
  await describe('stream/promises pipeline', async () => {
    await it('should resolve on success', async () => {
      const chunks: string[] = [];
      await pipelinePromise(
        new Readable({
          read() {
            this.push('hello');
            this.push(null);
          },
        }),
        new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
          },
        }),
      );
      expect(chunks).toContain('hello');
    });

    await it('should reject on error', async () => {
      let caught = false;
      try {
        await pipelinePromise(
          new Readable({
            read() {
              this.destroy(new Error('fail'));
            },
          }),
          new Writable({
            write(_chunk, _enc, cb) { cb(); },
          }),
        );
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });

  // ===================== finished =====================
  await describe('stream.finished', async () => {
    await it('should call callback when writable finishes', async () => {
      const done = await new Promise<boolean>((resolve) => {
        const writable = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        finished(writable, (err) => {
          resolve(!err);
        });
        writable.end('data');
      });
      expect(done).toBe(true);
    });

    await it('should call callback when readable ends', async () => {
      const done = await new Promise<boolean>((resolve) => {
        const readable = new Readable({
          read() {
            this.push('data');
            this.push(null);
          },
        });
        finished(readable, (err) => {
          resolve(!err);
        });
        readable.resume();
      });
      expect(done).toBe(true);
    });

    await it('should call callback with error when stream errors', async () => {
      const expectedError = new Error('stream error');
      const result = await new Promise<Error | null | undefined>((resolve) => {
        const readable = new Readable({
          read() {
            this.destroy(expectedError);
          },
        });
        finished(readable, (err) => {
          resolve(err);
        });
        readable.resume();
      });
      expect(result).toBe(expectedError);
    });

    await it('should call callback with premature close error', async () => {
      const result = await new Promise<boolean>((resolve) => {
        const writable = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        finished(writable, (err) => {
          // Premature close: closed without finishing
          resolve(err != null);
        });
        writable.destroy();
      });
      expect(result).toBe(true);
    });

    await it('should return cleanup function', async () => {
      const writable = new Writable({
        write(_chunk, _enc, cb) { cb(); },
      });
      const cleanup = finished(writable, () => {});
      expect(typeof cleanup).toBe('function');
      cleanup();
      writable.end();
    });
  });

  // ===================== finished (promises) =====================
  await describe('stream/promises finished', async () => {
    await it('should resolve when stream finishes', async () => {
      const writable = new Writable({
        write(_chunk, _enc, cb) { cb(); },
      });
      const promise = finishedPromise(writable);
      writable.end('data');
      await promise;
    });

    await it('should reject when stream errors', async () => {
      let caught = false;
      const writable = new Writable({
        write(_chunk, _enc, cb) { cb(); },
      });
      const promise = finishedPromise(writable);
      writable.destroy(new Error('fail'));
      try {
        await promise;
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });

  // ===================== Transform flush =====================
  await describe('Transform _flush', async () => {
    await it('should call _flush before finishing', async () => {
      const chunks: string[] = [];
      const transform = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
        flush(cb) {
          chunks.push('FLUSHED');
          cb();
        },
      });
      const result = await new Promise<string[]>((resolve) => {
        const output: string[] = [];
        transform.on('data', (chunk: Buffer) => output.push(chunk.toString()));
        transform.on('end', () => resolve(output));
        transform.write('a');
        transform.write('b');
        transform.end();
      });
      // Flush should have been called
      expect(chunks).toContain('FLUSHED');
    });

    await it('should push data from flush', async () => {
      const transform = new Transform({
        transform(chunk, _enc, cb) {
          cb(null, chunk);
        },
        flush(cb) {
          this.push(Buffer.from('TAIL'));
          cb();
        },
      });
      const result = await new Promise<string>((resolve) => {
        let data = '';
        transform.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        transform.on('end', () => resolve(data));
        transform.write('HEAD');
        transform.end();
      });
      expect(result).toBe('HEADTAIL');
    });

    await it('should propagate flush errors', async () => {
      const expectedError = new Error('flush error');
      const result = await new Promise<Error | null>((resolve) => {
        const transform = new Transform({
          transform(_chunk, _enc, cb) { cb(); },
          flush(cb) { cb(expectedError); },
        });
        transform.on('error', (err) => resolve(err));
        transform.write('data');
        transform.end();
      });
      expect(result).toBe(expectedError);
    });
  });

  // ===================== Readable.from =====================
  await describe('Readable.from', async () => {
    await it('should create Readable from array', async () => {
      const readable = Readable.from(['a', 'b', 'c']);
      const chunks: string[] = [];
      for await (const chunk of readable) {
        chunks.push(String(chunk));
      }
      expect(chunks.length).toBe(3);
      expect(chunks[0]).toBe('a');
      expect(chunks[1]).toBe('b');
      expect(chunks[2]).toBe('c');
    });

    await it('should create Readable from generator', async () => {
      function* gen() {
        yield 'x';
        yield 'y';
      }
      const readable = Readable.from(gen());
      const chunks: string[] = [];
      for await (const chunk of readable) {
        chunks.push(String(chunk));
      }
      expect(chunks.length).toBe(2);
    });

    await it('should create Readable from async generator', async () => {
      async function* asyncGen() {
        yield 'one';
        yield 'two';
        yield 'three';
      }
      const readable = Readable.from(asyncGen());
      const chunks: string[] = [];
      for await (const chunk of readable) {
        chunks.push(String(chunk));
      }
      expect(chunks.length).toBe(3);
      expect(chunks[2]).toBe('three');
    });

    await it('should create Readable from string', async () => {
      const readable = Readable.from('hello');
      const chunks: string[] = [];
      for await (const chunk of readable) {
        chunks.push(String(chunk));
      }
      // String is treated as a single chunk
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('hello');
    });

    await it('should create Readable from Buffer', async () => {
      const readable = Readable.from(Buffer.from('test'));
      const chunks: Buffer[] = [];
      for await (const chunk of readable) {
        chunks.push(Buffer.from(chunk as any));
      }
      expect(chunks.length).toBe(1);
    });
  });

  // ===================== addAbortSignal =====================
  await describe('stream.addAbortSignal', async () => {
    await it('should destroy stream when signal is aborted', async () => {
      const ac = new AbortController();
      const readable = new Readable({ read() {} });
      readable.on('error', () => { /* expected abort error */ });
      addAbortSignal(ac.signal, readable);
      ac.abort();
      // Stream should be destroyed
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(readable.destroyed).toBe(true);
    });

    await it('should handle already-aborted signal', async () => {
      const ac = new AbortController();
      ac.abort();
      const readable = new Readable({ read() {} });
      readable.on('error', () => { /* expected abort error */ });
      addAbortSignal(ac.signal, readable);
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(readable.destroyed).toBe(true);
    });

    await it('should throw for non-AbortSignal first arg', async () => {
      let threw = false;
      try {
        addAbortSignal('not a signal' as any, new Readable({ read() {} }));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ===================== Backpressure =====================
  await describe('stream backpressure', async () => {
    await it('write() should return false when buffer is full', async () => {
      const writable = new Writable({
        highWaterMark: 1,
        write(_chunk, _enc, cb) {
          // Delay callback to simulate slow consumer
          setTimeout(cb, 10);
        },
      });
      // First write fills buffer
      const first = writable.write('a');
      // Second write should signal backpressure
      const second = writable.write('b');
      // At least one should be false (backpressure)
      expect(first === false || second === false).toBe(true);
      writable.end();
      await new Promise<void>((r) => writable.on('finish', r));
    });

    await it('should emit drain after buffer empties', async () => {
      const writable = new Writable({
        highWaterMark: 1,
        write(_chunk, _enc, cb) {
          setTimeout(cb, 10);
        },
      });
      const drainEmitted = new Promise<boolean>((resolve) => {
        writable.on('drain', () => resolve(true));
        setTimeout(() => resolve(false), 2000);
      });
      writable.write('x');
      writable.write('y');
      const result = await drainEmitted;
      expect(result).toBe(true);
      writable.end();
    });
  });

  // ===================== PassThrough =====================
  await describe('PassThrough', async () => {
    await it('should pass data through unchanged', async () => {
      const pt = new PassThrough();
      const chunks: string[] = [];
      pt.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
      const done = new Promise<void>((r) => pt.on('end', r));
      pt.write('hello');
      pt.write(' world');
      pt.end();
      await done;
      expect(chunks.join('')).toBe('hello world');
    });
  });

  // ===================== Duplex =====================
  await describe('Duplex', async () => {
    await it('should support both read and write', async () => {
      let readCalled = false;
      let writeCalled = false;
      const duplex = new Duplex({
        read() {
          readCalled = true;
          this.push('from-read');
          this.push(null);
        },
        write(_chunk, _enc, cb) {
          writeCalled = true;
          cb();
        },
      });
      // Write side
      duplex.write('to-write');
      duplex.end();
      // Read side
      const chunks: string[] = [];
      for await (const chunk of duplex) {
        chunks.push(String(chunk));
      }
      expect(readCalled).toBe(true);
      expect(writeCalled).toBe(true);
      expect(chunks).toContain('from-read');
    });
  });

  // ===================== Object mode =====================
  await describe('stream objectMode', async () => {
    await it('should pass objects through Transform', async () => {
      const transform = new Transform({
        objectMode: true,
        transform(obj, _enc, cb) {
          cb(null, { ...obj, transformed: true });
        },
      });
      const results: any[] = [];
      transform.on('data', (obj) => results.push(obj));
      const done = new Promise<void>((r) => transform.on('end', r));
      transform.write({ name: 'test' });
      transform.end();
      await done;
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('test');
      expect(results[0].transformed).toBe(true);
    });

    await it('should handle mixed types in objectMode Readable', async () => {
      const items = [42, 'hello', { key: 'value' }, [1, 2, 3], true, null];
      const readable = Readable.from(items.filter(x => x !== null));
      const chunks: unknown[] = [];
      for await (const chunk of readable) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(5); // null terminates, so 5 items
    });
  });

  // ===================== Stream utility functions =====================
  await describe('stream utility functions', async () => {
    await it('Readable.isDisturbed should return false for undisturbed', async () => {
      const readable = new Readable({ read() {} });
      // isDisturbed may not exist on all platforms — test if available
      if (typeof (Readable as any).isDisturbed === 'function') {
        expect((Readable as any).isDisturbed(readable)).toBe(false);
      }
    });
  });

  // ===================== Async iteration =====================
  await describe('stream async iteration', async () => {
    await it('should support for-await-of on Readable', async () => {
      let pushed = false;
      const readable = new Readable({
        read() {
          if (!pushed) {
            pushed = true;
            this.push('chunk1');
            this.push('chunk2');
            this.push(null);
          }
        },
      });
      let content = '';
      for await (const chunk of readable) {
        content += chunk.toString();
      }
      expect(content).toBe('chunk1chunk2');
    });

    await it('should handle errors during async iteration', async () => {
      const expectedError = new Error('iteration error');
      let pushed = false;
      const readable = new Readable({
        read() {
          if (!pushed) {
            pushed = true;
            this.push('data');
            setTimeout(() => this.destroy(expectedError), 10);
          }
        },
      });
      let caught = false;
      try {
        for await (const _chunk of readable) {
          // First chunk should arrive, then error
        }
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });
};
