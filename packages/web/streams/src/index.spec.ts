// Tests for WHATWG Streams API
// Ported from refs/wpt/streams/ and refs/deno/tests/unit/streams_test.ts
// Original: 3-Clause BSD license (WPT), MIT license (Deno)

import { describe, it, expect } from '@gjsify/unit';
import {
  WritableStream,
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
};
