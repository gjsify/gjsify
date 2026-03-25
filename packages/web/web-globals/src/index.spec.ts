// Tests for @gjsify/web-globals — verify all Web API globals are registered
import { describe, it, expect } from '@gjsify/unit';

// Side-effect import — registers all globals
import '@gjsify/web-globals';

export default async () => {
  await describe('web-globals', async () => {

    // ==================== DOMException ====================
    await describe('DOMException', async () => {
      await it('should be available as global', async () => {
        expect(typeof globalThis.DOMException).toBe('function');
      });

      await it('should be constructable with message and name', async () => {
        const err = new DOMException('test', 'AbortError');
        expect(err.message).toBe('test');
        expect(err.name).toBe('AbortError');
        expect(err.code).toBe(20);
      });

      await it('should have standard error codes', async () => {
        expect(new DOMException('', 'NotFoundError').code).toBe(8);
        expect(new DOMException('', 'NotSupportedError').code).toBe(9);
        expect(new DOMException('', 'InvalidStateError').code).toBe(11);
        expect(new DOMException('', 'SyntaxError').code).toBe(12);
        expect(new DOMException('', 'TimeoutError').code).toBe(23);
        expect(new DOMException('', 'DataCloneError').code).toBe(25);
      });

      await it('should be an instance of Error', async () => {
        const err = new DOMException('test');
        expect(err instanceof Error).toBe(true);
      });
    });

    // ==================== DOM Events ====================
    await describe('DOM Events', async () => {
      await it('Event should be available as global', async () => {
        expect(typeof globalThis.Event).toBe('function');
      });

      await it('EventTarget should be available as global', async () => {
        expect(typeof globalThis.EventTarget).toBe('function');
      });

      await it('Event should be constructable', async () => {
        const event = new Event('test');
        expect(event.type).toBe('test');
        expect(event.bubbles).toBe(false);
        expect(event.cancelable).toBe(false);
      });

      await it('EventTarget should dispatch events', async () => {
        const target = new EventTarget();
        let called = false;
        target.addEventListener('test', () => { called = true; });
        target.dispatchEvent(new Event('test'));
        expect(called).toBe(true);
      });
    });

    // ==================== AbortController / AbortSignal ====================
    await describe('AbortController', async () => {
      await it('AbortController should be available as global', async () => {
        expect(typeof globalThis.AbortController).toBe('function');
      });

      await it('AbortSignal should be available as global', async () => {
        expect(typeof globalThis.AbortSignal).toBe('function');
      });

      await it('should create controller with signal', async () => {
        const ac = new AbortController();
        expect(ac.signal).toBeDefined();
        expect(ac.signal.aborted).toBe(false);
      });

      await it('abort() should set signal.aborted to true', async () => {
        const ac = new AbortController();
        ac.abort();
        expect(ac.signal.aborted).toBe(true);
      });
    });

    // ==================== Web Streams ====================
    await describe('Web Streams', async () => {
      await it('ReadableStream should be available as global', async () => {
        expect(typeof globalThis.ReadableStream).toBe('function');
      });

      await it('WritableStream should be available as global', async () => {
        expect(typeof globalThis.WritableStream).toBe('function');
      });

      await it('TransformStream should be available as global', async () => {
        expect(typeof globalThis.TransformStream).toBe('function');
      });

      await it('ReadableStream should be constructable', async () => {
        const rs = new ReadableStream({
          start(controller) {
            controller.enqueue('test');
            controller.close();
          },
        });
        expect(rs).toBeDefined();
        const reader = rs.getReader();
        const { value } = await reader.read();
        expect(value).toBe('test');
      });

      await it('WritableStream should be constructable', async () => {
        let received = '';
        const ws = new WritableStream({
          write(chunk) { received += chunk; },
        });
        const writer = ws.getWriter();
        await writer.write('hello');
        await writer.close();
        expect(received).toBe('hello');
      });

      await it('TransformStream should be constructable', async () => {
        const ts = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(String(chunk).toUpperCase());
          },
        });
        expect(ts.readable).toBeDefined();
        expect(ts.writable).toBeDefined();
      });
    });

    // ==================== TextEncoderStream / TextDecoderStream ====================
    await describe('Encoding Streams', async () => {
      await it('TextEncoderStream should be available as global', async () => {
        expect(typeof globalThis.TextEncoderStream).toBe('function');
      });

      await it('TextDecoderStream should be available as global', async () => {
        expect(typeof globalThis.TextDecoderStream).toBe('function');
      });
    });

    // ==================== Compression Streams ====================
    await describe('Compression Streams', async () => {
      await it('CompressionStream should be available as global', async () => {
        expect(typeof globalThis.CompressionStream).toBe('function');
      });

      await it('DecompressionStream should be available as global', async () => {
        expect(typeof globalThis.DecompressionStream).toBe('function');
      });
    });

    // ==================== WebCrypto ====================
    await describe('WebCrypto', async () => {
      await it('crypto should be available as global', async () => {
        expect(typeof globalThis.crypto).toBe('object');
      });

      await it('crypto.subtle should be available', async () => {
        expect(globalThis.crypto.subtle).toBeDefined();
      });

      await it('crypto.getRandomValues should work', async () => {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        // At least one byte should be non-zero (statistically almost certain)
        expect(buf.some(b => b !== 0)).toBe(true);
      });

      await it('crypto.randomUUID should return a UUID string', async () => {
        const uuid = crypto.randomUUID();
        expect(typeof uuid).toBe('string');
        expect(uuid.length).toBe(36);
        expect(uuid[8]).toBe('-');
        expect(uuid[13]).toBe('-');
      });
    });

    // ==================== EventSource ====================
    await describe('EventSource', async () => {
      await it('EventSource should be available as global', async () => {
        expect(typeof globalThis.EventSource).toBe('function');
      });

      await it('EventSource should have readyState constants', async () => {
        expect(EventSource.CONNECTING).toBe(0);
        expect(EventSource.OPEN).toBe(1);
        expect(EventSource.CLOSED).toBe(2);
      });
    });
  });
};
