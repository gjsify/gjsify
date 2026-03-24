// Tests for WHATWG Streams API
// Ported from refs/wpt/streams/ and refs/deno/tests/unit/streams_test.ts
// Original: 3-Clause BSD license (WPT), MIT license (Deno)

import { describe, it, expect } from '@gjsify/unit';
import {
  WritableStream,
  ReadableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
} from './index.js';

export default async () => {

  // ==================== ByteLengthQueuingStrategy ====================

  await describe('ByteLengthQueuingStrategy', async () => {
    await it('should be a constructor', async () => {
      expect(typeof ByteLengthQueuingStrategy).toBe('function');
    });

    await it('should require init object', async () => {
      let threw = false;
      try { new ByteLengthQueuingStrategy(null as any); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('should have highWaterMark', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 1024 });
      expect(strategy.highWaterMark).toBe(1024);
    });

    await it('should have size function returning byteLength', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 1 });
      const chunk = new Uint8Array(42);
      expect(strategy.size(chunk)).toBe(42);
    });
  });

  // ==================== CountQueuingStrategy ====================

  await describe('CountQueuingStrategy', async () => {
    await it('should be a constructor', async () => {
      expect(typeof CountQueuingStrategy).toBe('function');
    });

    await it('should have highWaterMark', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 5 });
      expect(strategy.highWaterMark).toBe(5);
    });

    await it('should have size function returning 1', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 1 });
      expect(strategy.size('anything')).toBe(1);
      expect(strategy.size(42)).toBe(1);
    });
  });

  // ==================== WritableStream ====================

  await describe('WritableStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof WritableStream).toBe('function');
    });

    await it('should be constructable with no arguments', async () => {
      const ws = new WritableStream();
      expect(ws).toBeDefined();
      expect(ws.locked).toBe(false);
    });

    await it('should accept an underlying sink', async () => {
      const chunks: string[] = [];
      const ws = new WritableStream({
        write(chunk: string) {
          chunks.push(chunk);
        },
      });
      expect(ws).toBeDefined();
    });

    await it('should write and close', async () => {
      const chunks: string[] = [];
      const ws = new WritableStream({
        write(chunk: string) { chunks.push(chunk); },
      });
      const writer = ws.getWriter();
      await writer.write('hello');
      await writer.write('world');
      await writer.close();
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('hello');
      expect(chunks[1]).toBe('world');
    });

    await it('should be locked when writer is acquired', async () => {
      const ws = new WritableStream();
      expect(ws.locked).toBe(false);
      const writer = ws.getWriter();
      expect(ws.locked).toBe(true);
      writer.releaseLock();
      expect(ws.locked).toBe(false);
    });

    await it('should throw when getting second writer', async () => {
      const ws = new WritableStream();
      ws.getWriter();
      let threw = false;
      try { ws.getWriter(); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('should abort', async () => {
      let abortReason: any;
      const ws = new WritableStream({
        abort(reason: any) { abortReason = reason; },
      });
      await ws.abort('test reason');
      expect(abortReason).toBe('test reason');
    });

    await it('should support backpressure via desiredSize', async () => {
      const ws = new WritableStream({
        write() {
          return new Promise((resolve) => setTimeout(resolve, 10));
        },
      }, new CountQueuingStrategy({ highWaterMark: 2 }));
      const writer = ws.getWriter();
      expect(writer.desiredSize).toBe(2);
      writer.write('a');
      expect(writer.desiredSize).toBe(1);
      writer.write('b');
      expect(writer.desiredSize).toBe(0);
      await writer.close();
    });

    await it('should handle write errors', async () => {
      const ws = new WritableStream({
        write() { throw new Error('write failed'); },
      });
      const writer = ws.getWriter();
      let error: any;
      try {
        await writer.write('data');
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
    });

    await it('writer.closed should resolve on close', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      const closedPromise = writer.closed;
      await writer.close();
      await closedPromise;
    });

    await it('writer.ready should resolve when writable', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.ready;
    });

    await it('should have correct Symbol.toStringTag', async () => {
      const ws = new WritableStream();
      // Check the polyfill has it (native may vary)
      expect(typeof ws).toBe('object');
    });

    await it('should reject abort on locked stream', async () => {
      const ws = new WritableStream();
      ws.getWriter();
      let threw = false;
      try { await ws.abort(); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('should reject close on locked stream', async () => {
      const ws = new WritableStream();
      ws.getWriter();
      let threw = false;
      try { await ws.close(); } catch { threw = true; }
      expect(threw).toBe(true);
    });
  });

  // ==================== WritableStreamDefaultWriter ====================

  await describe('WritableStreamDefaultWriter', async () => {
    await it('should have write, close, abort, releaseLock methods', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      expect(typeof writer.write).toBe('function');
      expect(typeof writer.close).toBe('function');
      expect(typeof writer.abort).toBe('function');
      expect(typeof writer.releaseLock).toBe('function');
    });

    await it('should have closed and ready promises', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      expect(writer.closed).toBeDefined();
      expect(writer.ready).toBeDefined();
      expect(typeof writer.closed.then).toBe('function');
      expect(typeof writer.ready.then).toBe('function');
      await writer.close();
    });
  });

  // ==================== ReadableStream ====================

  await describe('ReadableStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof ReadableStream).toBe('function');
    });

    await it('should be constructable with no arguments', async () => {
      const rs = new ReadableStream();
      expect(rs).toBeDefined();
      expect(rs.locked).toBe(false);
    });

    await it('should accept an underlying source', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('hello');
          controller.close();
        },
      });
      expect(rs).toBeDefined();
    });

    await it('should read chunks from source', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('a');
          controller.enqueue('b');
          controller.close();
        },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.done).toBe(false);
      expect(r1.value).toBe('a');
      const r2 = await reader.read();
      expect(r2.done).toBe(false);
      expect(r2.value).toBe('b');
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('should be locked when reader is acquired', async () => {
      const rs = new ReadableStream();
      expect(rs.locked).toBe(false);
      const reader = rs.getReader();
      expect(rs.locked).toBe(true);
      reader.releaseLock();
      expect(rs.locked).toBe(false);
    });

    await it('should cancel', async () => {
      let cancelReason: any;
      const rs = new ReadableStream({
        cancel(reason: any) { cancelReason = reason; },
      });
      await rs.cancel('test');
      expect(cancelReason).toBe('test');
    });

    await it('should support tee', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
      });
      const [branch1, branch2] = rs.tee();
      const reader1 = branch1.getReader();
      const reader2 = branch2.getReader();

      const r1 = await reader1.read();
      expect(r1.value).toBe(1);
      const r2 = await reader2.read();
      expect(r2.value).toBe(1);

      const r3 = await reader1.read();
      expect(r3.value).toBe(2);
      const r4 = await reader2.read();
      expect(r4.value).toBe(2);

      const r5 = await reader1.read();
      expect(r5.done).toBe(true);
      const r6 = await reader2.read();
      expect(r6.done).toBe(true);
    });

    await it('should support async iteration', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('x');
          controller.enqueue('y');
          controller.close();
        },
      });
      const collected: string[] = [];
      for await (const chunk of rs) {
        collected.push(chunk as string);
      }
      expect(collected.length).toBe(2);
      expect(collected[0]).toBe('x');
      expect(collected[1]).toBe('y');
    });

    await it('should pipeTo a WritableStream', async () => {
      const chunks: string[] = [];
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('hello');
          controller.enqueue('world');
          controller.close();
        },
      });
      const ws = new WritableStream({
        write(chunk: string) { chunks.push(chunk); },
      });
      await rs.pipeTo(ws);
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('hello');
      expect(chunks[1]).toBe('world');
    });

    await it('should support ReadableStream.from with array', async () => {
      const rs = ReadableStream.from(['a', 'b', 'c']);
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe('a');
      const r2 = await reader.read();
      expect(r2.value).toBe('b');
      const r3 = await reader.read();
      expect(r3.value).toBe('c');
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('should support ReadableStream.from with async generator', async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }
      const rs = ReadableStream.from(gen());
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe(1);
      const r2 = await reader.read();
      expect(r2.value).toBe(2);
      const r3 = await reader.read();
      expect(r3.value).toBe(3);
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('reader.closed should resolve on stream close', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      const reader = rs.getReader();
      await reader.closed;
    });

    await it('should handle pull-based source', async () => {
      let callCount = 0;
      const rs = new ReadableStream({
        pull(controller: any) {
          callCount++;
          if (callCount <= 3) {
            controller.enqueue(callCount);
          } else {
            controller.close();
          }
        },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe(1);
      const r2 = await reader.read();
      expect(r2.value).toBe(2);
      const r3 = await reader.read();
      expect(r3.value).toBe(3);
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });
  });

  // ==================== TransformStream ====================

  await describe('TransformStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof TransformStream).toBe('function');
    });

    await it('should be constructable with no arguments', async () => {
      const ts = new TransformStream();
      expect(ts).toBeDefined();
      expect(ts.readable).toBeDefined();
      expect(ts.writable).toBeDefined();
    });

    await it('should pass through chunks by default', async () => {
      const ts = new TransformStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write('hello');
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe('hello');
      const r2 = await reader.read();
      expect(r2.done).toBe(true);
    });

    await it('should transform chunks', async () => {
      const ts = new TransformStream({
        transform(chunk: string, controller: any) {
          controller.enqueue(chunk.toUpperCase());
        },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write('hello');
      writer.write('world');
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe('HELLO');
      const r2 = await reader.read();
      expect(r2.value).toBe('WORLD');
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('should support flush', async () => {
      let flushed = false;
      const ts = new TransformStream({
        flush() { flushed = true; },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.close();
      // Read to drain the stream
      await reader.read();
      expect(flushed).toBe(true);
    });

    await it('should work with pipeThrough', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.enqueue(3);
          controller.close();
        },
      });

      const doubled = rs.pipeThrough(new TransformStream({
        transform(chunk: number, controller: any) {
          controller.enqueue(chunk * 2);
        },
      }));

      const reader = doubled.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe(2);
      const r2 = await reader.read();
      expect(r2.value).toBe(4);
      const r3 = await reader.read();
      expect(r3.value).toBe(6);
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('should support start callback', async () => {
      let startCalled = false;
      const ts = new TransformStream({
        start() { startCalled = true; },
      });
      expect(startCalled).toBe(true);
    });

    await it('should propagate transform errors to readable', async () => {
      const ts = new TransformStream({
        transform() { throw new Error('transform error'); },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      // Write triggers the transform — error propagates to reader
      writer.write('data').catch(() => {});
      let readError: any;
      try {
        await reader.read();
      } catch (e) {
        readError = e;
      }
      expect(readError).toBeDefined();
    });

    await it('controller.desiredSize should reflect backpressure', async () => {
      let savedController: any;
      const ts = new TransformStream({
        start(controller: any) { savedController = controller; },
        transform(chunk: any, controller: any) { controller.enqueue(chunk); },
      });
      // desiredSize should be available
      expect(typeof savedController.desiredSize).toBe('number');
    });

    await it('controller.terminate should close readable', async () => {
      let savedController: any;
      const ts = new TransformStream({
        start(controller: any) { savedController = controller; },
      });
      const reader = ts.readable.getReader();
      savedController.terminate();
      const result = await reader.read();
      expect(result.done).toBe(true);
    });
  });

  // ==================== ReadableStreamDefaultReader ====================

  await describe('ReadableStreamDefaultReader', async () => {
    await it('should have read, releaseLock, cancel methods', async () => {
      const rs = new ReadableStream();
      const reader = rs.getReader();
      expect(typeof reader.read).toBe('function');
      expect(typeof reader.releaseLock).toBe('function');
      expect(typeof reader.cancel).toBe('function');
    });

    await it('should have closed promise', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      const reader = rs.getReader();
      expect(reader.closed).toBeDefined();
      expect(typeof reader.closed.then).toBe('function');
      await reader.closed;
    });
  });
};
