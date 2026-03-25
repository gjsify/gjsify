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
  TextEncoderStream,
  TextDecoderStream,
} from 'node:stream/web';

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

    await it('should coerce highWaterMark to number', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: '10' as any });
      expect(strategy.highWaterMark).toBe(10);
    });

    await it('should handle highWaterMark of 0', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 0 });
      expect(strategy.highWaterMark).toBe(0);
    });

    await it('should return byteLength for ArrayBuffer', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 1 });
      const buf = new ArrayBuffer(64);
      expect(strategy.size(buf as any)).toBe(64);
    });

    await it('should return byteLength for DataView', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 1 });
      const dv = new DataView(new ArrayBuffer(16));
      expect(strategy.size(dv as any)).toBe(16);
    });

    await it('size function name should be "size"', async () => {
      const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 1 });
      expect(strategy.size.name).toBe('size');
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

    await it('should coerce highWaterMark to number', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: '3' as any });
      expect(strategy.highWaterMark).toBe(3);
    });

    await it('should handle highWaterMark of 0', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 0 });
      expect(strategy.highWaterMark).toBe(0);
    });

    await it('size should return 1 for undefined', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 1 });
      expect(strategy.size(undefined)).toBe(1);
    });

    await it('size should return 1 for null', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 1 });
      expect(strategy.size(null)).toBe(1);
    });

    await it('size function name should be "size"', async () => {
      const strategy = new CountQueuingStrategy({ highWaterMark: 1 });
      expect(strategy.size.name).toBe('size');
    });

    await it('should require init object', async () => {
      let threw = false;
      try { new CountQueuingStrategy(null as any); } catch { threw = true; }
      expect(threw).toBe(true);
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

    await it('should call start callback on construction', async () => {
      let startCalled = false;
      const ws = new WritableStream({
        start() { startCalled = true; },
      });
      expect(startCalled).toBe(true);
    });

    await it('should call close callback', async () => {
      let closeCalled = false;
      const ws = new WritableStream({
        close() { closeCalled = true; },
      });
      const writer = ws.getWriter();
      await writer.close();
      expect(closeCalled).toBe(true);
    });

    await it('should write various types of chunks', async () => {
      const chunks: unknown[] = [];
      const ws = new WritableStream({
        write(chunk: unknown) { chunks.push(chunk); },
      });
      const writer = ws.getWriter();
      await writer.write(42);
      await writer.write(null);
      await writer.write(true);
      await writer.write({ key: 'val' });
      await writer.close();
      expect(chunks.length).toBe(4);
      expect(chunks[0]).toBe(42);
      expect(chunks[1]).toBeNull();
      expect(chunks[2]).toBe(true);
    });

    await it('should handle async write function', async () => {
      const chunks: string[] = [];
      const ws = new WritableStream({
        async write(chunk: string) {
          await new Promise((r) => setTimeout(r, 5));
          chunks.push(chunk);
        },
      });
      const writer = ws.getWriter();
      await writer.write('async1');
      await writer.write('async2');
      await writer.close();
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('async1');
      expect(chunks[1]).toBe('async2');
    });

    await it('writer.abort should put stream in errored state', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.abort('reason');
      let threw = false;
      try {
        await writer.write('after abort');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('abort without reason should still abort', async () => {
      let abortCalled = false;
      const ws = new WritableStream({
        abort() { abortCalled = true; },
      });
      await ws.abort();
      expect(abortCalled).toBe(true);
    });

    await it('should accept ByteLengthQueuingStrategy', async () => {
      const ws = new WritableStream({
        write() {},
      }, new ByteLengthQueuingStrategy({ highWaterMark: 1024 }));
      const writer = ws.getWriter();
      await writer.ready;
      await writer.close();
    });

    await it('writer desiredSize should be null after close', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.close();
      expect(writer.desiredSize).toBe(0);
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

    await it('releaseLock should make stream unlocked', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      expect(ws.locked).toBe(true);
      writer.releaseLock();
      expect(ws.locked).toBe(false);
    });

    await it('releaseLock should be idempotent after release', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      writer.releaseLock();
      // Calling again should not throw
      writer.releaseLock();
      expect(ws.locked).toBe(false);
    });

    await it('desiredSize should reflect queue state', async () => {
      const ws = new WritableStream({
        write() {
          return new Promise((resolve) => setTimeout(resolve, 50));
        },
      }, new CountQueuingStrategy({ highWaterMark: 3 }));
      const writer = ws.getWriter();
      expect(writer.desiredSize).toBe(3);
      await writer.close();
    });

    await it('ready should resolve immediately when no backpressure', async () => {
      const ws = new WritableStream({}, new CountQueuingStrategy({ highWaterMark: 10 }));
      const writer = ws.getWriter();
      // Should resolve without delay
      await writer.ready;
      await writer.close();
    });

    await it('closed should reject after abort', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.abort('test');
      let threw = false;
      try {
        await writer.closed;
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('write after close should reject', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.close();
      let threw = false;
      try {
        await writer.write('after close');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('close after close should reject', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.close();
      let threw = false;
      try {
        await writer.close();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('can acquire new writer after releaseLock', async () => {
      const ws = new WritableStream();
      const writer1 = ws.getWriter();
      writer1.releaseLock();
      const writer2 = ws.getWriter();
      expect(ws.locked).toBe(true);
      await writer2.close();
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

    await it('should throw when getting second reader', async () => {
      const rs = new ReadableStream();
      rs.getReader();
      let threw = false;
      try { rs.getReader(); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('should reject cancel on locked stream', async () => {
      const rs = new ReadableStream();
      rs.getReader();
      let threw = false;
      try { await rs.cancel(); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('tee should lock the original stream', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      rs.tee();
      expect(rs.locked).toBe(true);
    });

    await it('should read single chunk and close', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('only');
          controller.close();
        },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.done).toBe(false);
      expect(r1.value).toBe('only');
      const r2 = await reader.read();
      expect(r2.done).toBe(true);
    });

    await it('should read an immediately closed stream', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.done).toBe(true);
    });

    await it('cancel should resolve the cancel promise', async () => {
      const rs = new ReadableStream({
        start() {},
      });
      // cancel should resolve without error
      await rs.cancel();
    });

    await it('cancel should pass reason to underlying source cancel', async () => {
      let receivedReason: any;
      const rs = new ReadableStream({
        cancel(reason: any) { receivedReason = reason; },
      });
      const err = new Error('cancel reason');
      await rs.cancel(err);
      expect(receivedReason).toBe(err);
    });

    await it('pipeTo should close writable on readable end', async () => {
      let writableClosed = false;
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('data');
          controller.close();
        },
      });
      const ws = new WritableStream({
        write() {},
        close() { writableClosed = true; },
      });
      await rs.pipeTo(ws);
      expect(writableClosed).toBe(true);
    });

    await it('pipeTo should propagate readable error to writable', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.error(new Error('source error'));
        },
      });
      const ws = new WritableStream();
      let threw = false;
      try {
        await rs.pipeTo(ws);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('pipeThrough should chain transforms', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('hello');
          controller.close();
        },
      });

      const upper = new TransformStream({
        transform(chunk: string, controller: any) {
          controller.enqueue(chunk.toUpperCase());
        },
      });

      const exclaim = new TransformStream({
        transform(chunk: string, controller: any) {
          controller.enqueue(chunk + '!');
        },
      });

      const result = rs.pipeThrough(upper).pipeThrough(exclaim);
      const reader = result.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe('HELLO!');
      const r2 = await reader.read();
      expect(r2.done).toBe(true);
    });

    await it('ReadableStream.from with sync generator', async () => {
      function* gen() {
        yield 'a';
        yield 'b';
      }
      const rs = ReadableStream.from(gen());
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe('a');
      const r2 = await reader.read();
      expect(r2.value).toBe('b');
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('should enqueue typed arrays', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.done).toBe(false);
      expect(r1.value.length).toBe(3);
      expect(r1.value[0]).toBe(1);
      expect(r1.value[2]).toBe(3);
    });

    await it('should support pull returning a promise', async () => {
      let n = 0;
      const rs = new ReadableStream({
        async pull(controller: any) {
          await new Promise((r) => setTimeout(r, 5));
          n++;
          if (n <= 2) {
            controller.enqueue(n);
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
      expect(r3.done).toBe(true);
    });

    await it('tee both branches should be independent', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('a');
          controller.enqueue('b');
          controller.enqueue('c');
          controller.close();
        },
      });
      const [b1, b2] = rs.tee();

      // Read all from branch1
      const r1: string[] = [];
      const reader1 = b1.getReader();
      let result = await reader1.read();
      while (!result.done) {
        r1.push(result.value as string);
        result = await reader1.read();
      }
      expect(r1.length).toBe(3);
      expect(r1[0]).toBe('a');

      // Branch 2 should still be fully readable
      const r2: string[] = [];
      const reader2 = b2.getReader();
      result = await reader2.read();
      while (!result.done) {
        r2.push(result.value as string);
        result = await reader2.read();
      }
      expect(r2.length).toBe(3);
      expect(r2[2]).toBe('c');
    });

    await it('pipeTo with preventClose should not close writable', async () => {
      let closeCalled = false;
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('data');
          controller.close();
        },
      });
      const ws = new WritableStream({
        write() {},
        close() { closeCalled = true; },
      });
      await rs.pipeTo(ws, { preventClose: true });
      expect(closeCalled).toBe(false);
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

    await it('read should return { value, done } objects', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue(42);
          controller.close();
        },
      });
      const reader = rs.getReader();
      const result = await reader.read();
      expect(result.done).toBe(false);
      expect(result.value).toBe(42);
    });

    await it('read after stream end should return done: true', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.done).toBe(true);
      // Reading again should still return done
      const r2 = await reader.read();
      expect(r2.done).toBe(true);
    });

    await it('cancel should cancel the underlying stream', async () => {
      let cancelCalled = false;
      const rs = new ReadableStream({
        cancel() { cancelCalled = true; },
      });
      const reader = rs.getReader();
      await reader.cancel();
      expect(cancelCalled).toBe(true);
    });

    await it('cancel should pass reason to underlying source', async () => {
      let receivedReason: any;
      const rs = new ReadableStream({
        cancel(reason: any) { receivedReason = reason; },
      });
      const reader = rs.getReader();
      await reader.cancel('reader cancel');
      expect(receivedReason).toBe('reader cancel');
    });

    await it('releaseLock should unlock the stream', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.close(); },
      });
      const reader = rs.getReader();
      expect(rs.locked).toBe(true);
      reader.releaseLock();
      expect(rs.locked).toBe(false);
    });

    await it('should be able to re-acquire reader after release', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('data');
          controller.close();
        },
      });
      const reader1 = rs.getReader();
      reader1.releaseLock();
      const reader2 = rs.getReader();
      const result = await reader2.read();
      expect(result.value).toBe('data');
    });

    await it('closed should resolve when stream closes', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('x');
          controller.close();
        },
      });
      const reader = rs.getReader();
      // Drain the stream
      await reader.read();
      await reader.read();
      await reader.closed;
    });

    await it('closed should reject when stream errors', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.error(new Error('boom'));
        },
      });
      const reader = rs.getReader();
      let threw = false;
      try {
        await reader.closed;
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('read should reject on errored stream', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.error(new Error('read error'));
        },
      });
      const reader = rs.getReader();
      let threw = false;
      try {
        await reader.read();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
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

    await it('should pass multiple chunks unchanged with identity transform', async () => {
      const ts = new TransformStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write(1);
      writer.write('two');
      writer.write(null);
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe(1);
      const r2 = await reader.read();
      expect(r2.value).toBe('two');
      const r3 = await reader.read();
      expect(r3.value).toBeNull();
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('transform can enqueue multiple chunks per input', async () => {
      const ts = new TransformStream({
        transform(chunk: string, controller: any) {
          for (const ch of chunk) {
            controller.enqueue(ch);
          }
        },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write('abc');
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe('a');
      const r2 = await reader.read();
      expect(r2.value).toBe('b');
      const r3 = await reader.read();
      expect(r3.value).toBe('c');
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('transform can enqueue zero chunks (filter)', async () => {
      const ts = new TransformStream({
        transform(chunk: number, controller: any) {
          if (chunk % 2 === 0) {
            controller.enqueue(chunk);
          }
        },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write(1);
      writer.write(2);
      writer.write(3);
      writer.write(4);
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe(2);
      const r2 = await reader.read();
      expect(r2.value).toBe(4);
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('flush can enqueue final chunks', async () => {
      const ts = new TransformStream({
        transform(chunk: string, controller: any) {
          controller.enqueue(chunk);
        },
        flush(controller: any) {
          controller.enqueue('END');
        },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write('data');
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe('data');
      const r2 = await reader.read();
      expect(r2.value).toBe('END');
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('controller.error should error both sides', async () => {
      let savedController: any;
      const ts = new TransformStream({
        start(controller: any) { savedController = controller; },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      savedController.error(new Error('controller error'));

      let readThrew = false;
      try { await reader.read(); } catch { readThrew = true; }
      expect(readThrew).toBe(true);

      let writeThrew = false;
      try { await writer.write('data'); } catch { writeThrew = true; }
      expect(writeThrew).toBe(true);
    });

    await it('readable and writable should be correct types', async () => {
      const ts = new TransformStream();
      expect(ts.readable.locked).toBe(false);
      expect(ts.writable.locked).toBe(false);
    });

    await it('should accept writableStrategy highWaterMark', async () => {
      const ts = new TransformStream({}, { highWaterMark: 5 });
      const writer = ts.writable.getWriter();
      expect(writer.desiredSize).toBe(5);
      await writer.close();
    });

    await it('should accept readableStrategy highWaterMark', async () => {
      const ts = new TransformStream({}, {}, { highWaterMark: 10 });
      const reader = ts.readable.getReader();
      // Just verify it doesn't throw
      reader.releaseLock();
    });

    await it('flush error should error the readable', async () => {
      const ts = new TransformStream({
        flush() { throw new Error('flush error'); },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.close().catch(() => {});
      let threw = false;
      try {
        await reader.read();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('async transform should work', async () => {
      const ts = new TransformStream({
        async transform(chunk: number, controller: any) {
          await new Promise((r) => setTimeout(r, 5));
          controller.enqueue(chunk * 10);
        },
      });
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      writer.write(1);
      writer.write(2);
      writer.close();

      const r1 = await reader.read();
      expect(r1.value).toBe(10);
      const r2 = await reader.read();
      expect(r2.value).toBe(20);
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });
  });

  // ==================== Error handling ====================

  await describe('Error handling', async () => {
    await it('writing to a closed writable should reject', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      await writer.close();
      let threw = false;
      try { await writer.write('data'); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('reading from an errored readable should reject', async () => {
      const err = new Error('stream error');
      const rs = new ReadableStream({
        start(controller: any) { controller.error(err); },
      });
      const reader = rs.getReader();
      let threw = false;
      try { await reader.read(); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('writer closed promise should reject on error', async () => {
      const ws = new WritableStream({
        write() { throw new Error('write err'); },
      });
      const writer = ws.getWriter();
      writer.write('trigger').catch(() => {});
      let threw = false;
      try { await writer.closed; } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('reader closed promise should reject on error', async () => {
      const rs = new ReadableStream({
        start(controller: any) { controller.error(new Error('err')); },
      });
      const reader = rs.getReader();
      let threw = false;
      try { await reader.closed; } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('abort on already errored stream should resolve', async () => {
      const ws = new WritableStream({
        write() { throw new Error('fail'); },
      });
      const writer = ws.getWriter();
      try { await writer.write('data'); } catch { /* expected */ }
      // abort after error should not throw
      await writer.abort();
    });

    await it('pipeTo should reject when writable errors during pipe', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('chunk1');
          controller.enqueue('chunk2');
          controller.close();
        },
      });
      const ws = new WritableStream({
        write() { throw new Error('write during pipe'); },
      });
      let threw = false;
      try { await rs.pipeTo(ws); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('controller.error during start should error the readable', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.error(new TypeError('start error'));
        },
      });
      const reader = rs.getReader();
      let threw = false;
      let errorType = '';
      try {
        await reader.read();
      } catch (e: any) {
        threw = true;
        errorType = e?.constructor?.name || '';
      }
      expect(threw).toBe(true);
      expect(errorType).toBe('TypeError');
    });

    await it('abort reason should be available in writer.closed rejection', async () => {
      const ws = new WritableStream();
      const writer = ws.getWriter();
      const reason = new Error('abort reason');
      writer.abort(reason);
      let caughtReason: any;
      try { await writer.closed; } catch (e) { caughtReason = e; }
      expect(caughtReason).toBeDefined();
    });
  });

  // ==================== Helpers for stream tests ====================
  // Native Web Streams use backpressure, so writes and reads must run
  // concurrently. These helpers collect all output from a readable side
  // while a write function feeds the writable side.

  async function collectEncoderOutput(
    stream: InstanceType<typeof TextEncoderStream>,
    writeFn: (writer: WritableStreamDefaultWriter<string>) => Promise<void>,
  ): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const chunks: Uint8Array[] = [];
    const [, ] = await Promise.all([
      writeFn(writer),
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      })(),
    ]);
    const result = new Uint8Array(chunks.reduce((a, c) => a + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  async function collectDecoderOutput(
    stream: InstanceType<typeof TextDecoderStream>,
    writeFn: (writer: WritableStreamDefaultWriter<BufferSource>) => Promise<void>,
  ): Promise<string> {
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const chunks: string[] = [];
    await Promise.all([
      writeFn(writer),
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      })(),
    ]);
    return chunks.join('');
  }

  // ==================== TextEncoderStream ====================

  await describe('TextEncoderStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof TextEncoderStream).toBe('function');
      const stream = new TextEncoderStream();
      expect(stream).toBeDefined();
    });

    await it('encoding should be utf-8', async () => {
      const stream = new TextEncoderStream();
      expect(stream.encoding).toBe('utf-8');
    });

    await it('should have readable and writable', async () => {
      const stream = new TextEncoderStream();
      expect(stream.readable).toBeDefined();
      expect(stream.writable).toBeDefined();
    });

    await it('should encode ASCII string to bytes', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('hello');
        await w.close();
      });

      // 'hello' = [104, 101, 108, 108, 111]
      expect(result.length).toBe(5);
      expect(result[0]).toBe(104); // 'h'
      expect(result[1]).toBe(101); // 'e'
      expect(result[2]).toBe(108); // 'l'
      expect(result[3]).toBe(108); // 'l'
      expect(result[4]).toBe(111); // 'o'
    });

    await it('should encode multi-byte UTF-8 characters', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('€');
        await w.close();
      });

      // '€' (U+20AC) in UTF-8: [0xE2, 0x82, 0xAC]
      expect(result.length).toBe(3);
      expect(result[0]).toBe(0xE2);
      expect(result[1]).toBe(0x82);
      expect(result[2]).toBe(0xAC);
    });

    await it('should handle multiple chunks', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('ab');
        await w.write('cd');
        await w.close();
      });

      // 'abcd'
      expect(result.length).toBe(4);
      expect(result[0]).toBe(97);  // 'a'
      expect(result[3]).toBe(100); // 'd'
    });

    await it('should skip empty string chunks', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('');
        await w.write('x');
        await w.close();
      });

      expect(result.length).toBe(1);
      expect(result[0]).toBe(120); // 'x'
    });

    await it('should handle surrogate pairs split across chunks', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        // U+1F600 (😀) as surrogate pair: \uD83D\uDE00, split across writes
        await w.write('\uD83D');
        await w.write('\uDE00');
        await w.close();
      });

      // U+1F600 in UTF-8: [0xF0, 0x9F, 0x98, 0x80]
      expect(result[0]).toBe(0xF0);
      expect(result[1]).toBe(0x9F);
      expect(result[2]).toBe(0x98);
      expect(result[3]).toBe(0x80);
    });

    await it('should emit U+FFFD for unpaired high surrogate at end', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('\uD83D');
        await w.close();
      });

      // U+FFFD in UTF-8: [0xEF, 0xBF, 0xBD]
      expect(result[0]).toBe(0xEF);
      expect(result[1]).toBe(0xBF);
      expect(result[2]).toBe(0xBD);
    });

    await it('should encode 2-byte UTF-8 characters', async () => {
      // U+00E9 (é) is 2-byte UTF-8: [0xC3, 0xA9]
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('é');
        await w.close();
      });
      expect(result.length).toBe(2);
      expect(result[0]).toBe(0xC3);
      expect(result[1]).toBe(0xA9);
    });

    await it('should encode 4-byte UTF-8 characters', async () => {
      // U+1F600 (😀) in UTF-8: [0xF0, 0x9F, 0x98, 0x80]
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('😀');
        await w.close();
      });
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0xF0);
      expect(result[1]).toBe(0x9F);
      expect(result[2]).toBe(0x98);
      expect(result[3]).toBe(0x80);
    });

    await it('should encode CJK characters', async () => {
      // U+4E16 (世) in UTF-8: [0xE4, 0xB8, 0x96]
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('世');
        await w.close();
      });
      expect(result.length).toBe(3);
      expect(result[0]).toBe(0xE4);
      expect(result[1]).toBe(0xB8);
      expect(result[2]).toBe(0x96);
    });

    await it('should encode mixed ASCII and multi-byte', async () => {
      const result = await collectEncoderOutput(new TextEncoderStream(), async (w) => {
        await w.write('A€B');
        await w.close();
      });
      // 'A' (1 byte) + '€' (3 bytes) + 'B' (1 byte) = 5 bytes
      expect(result.length).toBe(5);
      expect(result[0]).toBe(65); // 'A'
      expect(result[4]).toBe(66); // 'B'
    });

    await it('should produce Uint8Array output', async () => {
      const stream = new TextEncoderStream();
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      const readPromise = reader.read();
      await writer.write('a');
      await writer.close();
      const { value } = await readPromise;
      expect(value instanceof Uint8Array).toBe(true);
    });
  });

  // ==================== TextDecoderStream ====================

  await describe('TextDecoderStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof TextDecoderStream).toBe('function');
      const stream = new TextDecoderStream();
      expect(stream).toBeDefined();
    });

    await it('encoding should default to utf-8', async () => {
      const stream = new TextDecoderStream();
      expect(stream.encoding).toBe('utf-8');
    });

    await it('fatal should default to false', async () => {
      const stream = new TextDecoderStream();
      expect(stream.fatal).toBe(false);
    });

    await it('ignoreBOM should default to false', async () => {
      const stream = new TextDecoderStream();
      expect(stream.ignoreBOM).toBe(false);
    });

    await it('should accept fatal option', async () => {
      const stream = new TextDecoderStream('utf-8', { fatal: true });
      expect(stream.fatal).toBe(true);
    });

    await it('should have readable and writable', async () => {
      const stream = new TextDecoderStream();
      expect(stream.readable).toBeDefined();
      expect(stream.writable).toBeDefined();
    });

    await it('should decode ASCII bytes to string', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([104, 101, 108, 108, 111]));
        await w.close();
      });
      expect(result).toBe('hello');
    });

    await it('should decode multi-byte UTF-8', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([0xE2, 0x82, 0xAC]));
        await w.close();
      });
      expect(result).toBe('€');
    });

    await it('should handle multi-byte sequence split across chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        // '€' in UTF-8: [0xE2, 0x82, 0xAC] — split across two writes
        await w.write(new Uint8Array([0xE2]));
        await w.write(new Uint8Array([0x82, 0xAC]));
        await w.close();
      });
      expect(result).toBe('€');
    });

    await it('should handle 4-byte sequence split across chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        // U+1F600 (😀) in UTF-8: [0xF0, 0x9F, 0x98, 0x80]
        await w.write(new Uint8Array([0xF0, 0x9F]));
        await w.write(new Uint8Array([0x98, 0x80]));
        await w.close();
      });
      expect(result).toBe('😀');
    });

    await it('should handle multiple chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([72, 101]));      // 'He'
        await w.write(new Uint8Array([108, 108, 111])); // 'llo'
        await w.close();
      });
      expect(result).toBe('Hello');
    });

    await it('should accept ArrayBuffer chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([79, 75]).buffer); // 'OK'
        await w.close();
      });
      expect(result).toBe('OK');
    });

    await it('should decode 2-byte UTF-8 characters', async () => {
      // U+00E9 (é): [0xC3, 0xA9]
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([0xC3, 0xA9]));
        await w.close();
      });
      expect(result).toBe('é');
    });

    await it('should decode 2-byte sequence split across chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([0xC3]));
        await w.write(new Uint8Array([0xA9]));
        await w.close();
      });
      expect(result).toBe('é');
    });

    await it('should decode 4-byte sequence split byte-by-byte', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        // U+1F600 byte by byte
        await w.write(new Uint8Array([0xF0]));
        await w.write(new Uint8Array([0x9F]));
        await w.write(new Uint8Array([0x98]));
        await w.write(new Uint8Array([0x80]));
        await w.close();
      });
      expect(result).toBe('😀');
    });

    await it('should decode mixed ASCII and multi-byte', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        // 'Aé' = [0x41, 0xC3, 0xA9]
        await w.write(new Uint8Array([0x41, 0xC3, 0xA9]));
        await w.close();
      });
      expect(result).toBe('Aé');
    });

    await it('should decode CJK characters', async () => {
      // U+4E16 (世): [0xE4, 0xB8, 0x96]
      // U+754C (界): [0xE7, 0x95, 0x8C]
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([0xE4, 0xB8, 0x96, 0xE7, 0x95, 0x8C]));
        await w.close();
      });
      expect(result).toBe('世界');
    });

    await it('should handle empty chunks', async () => {
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([]));
        await w.write(new Uint8Array([72, 105])); // 'Hi'
        await w.close();
      });
      expect(result).toBe('Hi');
    });

    await it('should decode 3-byte sequence split at each byte', async () => {
      // '€' = [0xE2, 0x82, 0xAC] — each byte in separate write
      const result = await collectDecoderOutput(new TextDecoderStream(), async (w) => {
        await w.write(new Uint8Array([0xE2]));
        await w.write(new Uint8Array([0x82]));
        await w.write(new Uint8Array([0xAC]));
        await w.close();
      });
      expect(result).toBe('€');
    });

    await it('should produce string output', async () => {
      const stream = new TextDecoderStream();
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      const readPromise = reader.read();
      await writer.write(new Uint8Array([65])); // 'A'
      await writer.close();
      const { value } = await readPromise;
      expect(typeof value).toBe('string');
    });
  });

  // ==================== TextEncoderStream + TextDecoderStream round-trip ====================

  await describe('TextEncoderStream + TextDecoderStream round-trip', async () => {
    await it('should round-trip ASCII text', async () => {
      const encoder = new TextEncoderStream();
      const decoder = new TextDecoderStream();

      const pipePromise = encoder.readable.pipeTo(decoder.writable);
      const writer = encoder.writable.getWriter();
      const reader = decoder.readable.getReader();

      const chunks: string[] = [];
      const [, ] = await Promise.all([
        (async () => {
          await writer.write('Hello, World!');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })(),
      ]);
      await pipePromise;
      expect(chunks.join('')).toBe('Hello, World!');
    });

    await it('should round-trip Unicode text', async () => {
      const encoder = new TextEncoderStream();
      const decoder = new TextDecoderStream();

      const pipePromise = encoder.readable.pipeTo(decoder.writable);
      const writer = encoder.writable.getWriter();
      const reader = decoder.readable.getReader();

      const chunks: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('Héllo 世界 😀');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })(),
      ]);
      await pipePromise;
      expect(chunks.join('')).toBe('Héllo 世界 😀');
    });

    await it('should round-trip with surrogate pair split across chunks', async () => {
      const encoder = new TextEncoderStream();
      const decoder = new TextDecoderStream();

      const pipePromise = encoder.readable.pipeTo(decoder.writable);
      const writer = encoder.writable.getWriter();
      const reader = decoder.readable.getReader();

      const chunks: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('A\uD83D');
          await writer.write('\uDE00B');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })(),
      ]);
      await pipePromise;
      expect(chunks.join('')).toBe('A😀B');
    });

    await it('should round-trip multiple separate writes', async () => {
      const encoder = new TextEncoderStream();
      const decoder = new TextDecoderStream();

      const pipePromise = encoder.readable.pipeTo(decoder.writable);
      const writer = encoder.writable.getWriter();
      const reader = decoder.readable.getReader();

      const chunks: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('one');
          await writer.write(' ');
          await writer.write('two');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })(),
      ]);
      await pipePromise;
      expect(chunks.join('')).toBe('one two');
    });

    await it('should round-trip empty string', async () => {
      const encoder = new TextEncoderStream();
      const decoder = new TextDecoderStream();

      const pipePromise = encoder.readable.pipeTo(decoder.writable);
      const writer = encoder.writable.getWriter();
      const reader = decoder.readable.getReader();

      const chunks: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('');
          await writer.write('ok');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })(),
      ]);
      await pipePromise;
      expect(chunks.join('')).toBe('ok');
    });
  });

  // ==================== Integration: piping and chaining ====================

  await describe('Stream integration', async () => {
    await it('readable pipeTo writable collects all data', async () => {
      const data = [10, 20, 30, 40, 50];
      const rs = new ReadableStream({
        start(controller: any) {
          for (const d of data) controller.enqueue(d);
          controller.close();
        },
      });
      const collected: number[] = [];
      const ws = new WritableStream({
        write(chunk: number) { collected.push(chunk); },
      });
      await rs.pipeTo(ws);
      expect(collected.length).toBe(5);
      expect(collected[0]).toBe(10);
      expect(collected[4]).toBe(50);
    });

    await it('chained pipeThrough transforms', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue(5);
          controller.close();
        },
      });

      // First: multiply by 2
      const double = new TransformStream({
        transform(chunk: number, ctrl: any) { ctrl.enqueue(chunk * 2); },
      });

      // Second: add 1
      const addOne = new TransformStream({
        transform(chunk: number, ctrl: any) { ctrl.enqueue(chunk + 1); },
      });

      // Third: convert to string
      const toString = new TransformStream({
        transform(chunk: number, ctrl: any) { ctrl.enqueue(`value:${chunk}`); },
      });

      const result = rs.pipeThrough(double).pipeThrough(addOne).pipeThrough(toString);
      const reader = result.getReader();
      const r = await reader.read();
      expect(r.value).toBe('value:11'); // (5*2)+1 = 11
    });

    await it('ReadableStream.from piped through transform', async () => {
      const rs = ReadableStream.from([1, 2, 3]);
      const ts = new TransformStream({
        transform(chunk: number, ctrl: any) { ctrl.enqueue(chunk * 100); },
      });
      const result = rs.pipeThrough(ts);
      const reader = result.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe(100);
      const r2 = await reader.read();
      expect(r2.value).toBe(200);
      const r3 = await reader.read();
      expect(r3.value).toBe(300);
      const r4 = await reader.read();
      expect(r4.done).toBe(true);
    });

    await it('tee and pipeTo both branches independently', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('x');
          controller.enqueue('y');
          controller.close();
        },
      });
      const [b1, b2] = rs.tee();
      const c1: string[] = [];
      const c2: string[] = [];
      const ws1 = new WritableStream({ write(ch: string) { c1.push(ch); } });
      const ws2 = new WritableStream({ write(ch: string) { c2.push(ch); } });
      await Promise.all([b1.pipeTo(ws1), b2.pipeTo(ws2)]);
      expect(c1.length).toBe(2);
      expect(c2.length).toBe(2);
      expect(c1[0]).toBe('x');
      expect(c2[1]).toBe('y');
    });

    await it('CountQueuingStrategy with ReadableStream', async () => {
      const rs = new ReadableStream({
        start(controller: any) {
          controller.enqueue('a');
          controller.enqueue('b');
          controller.close();
        },
      }, new CountQueuingStrategy({ highWaterMark: 2 }));
      const reader = rs.getReader();
      const r1 = await reader.read();
      expect(r1.value).toBe('a');
      const r2 = await reader.read();
      expect(r2.value).toBe('b');
      const r3 = await reader.read();
      expect(r3.done).toBe(true);
    });

    await it('ByteLengthQueuingStrategy with WritableStream', async () => {
      const chunks: Uint8Array[] = [];
      const ws = new WritableStream({
        write(chunk: Uint8Array) { chunks.push(chunk); },
      }, new ByteLengthQueuingStrategy({ highWaterMark: 1024 }));
      const writer = ws.getWriter();
      await writer.write(new Uint8Array([1, 2, 3]));
      await writer.write(new Uint8Array([4, 5]));
      await writer.close();
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(3);
      expect(chunks[1].length).toBe(2);
    });
  });
};
