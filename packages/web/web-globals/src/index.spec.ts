// Tests for @gjsify/web-globals — verify all Web API globals are registered
import { describe, it, expect, on } from '@gjsify/unit';

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
    // AbortController is native on Node.js but not registered as global on GJS
    await describe('AbortController', async () => {
      await it('AbortController import should be available', async () => {
        const { AbortController: AC } = await import('@gjsify/abort-controller');
        expect(typeof AC).toBe('function');
      });

      await it('should create controller with signal via import', async () => {
        const { AbortController: AC } = await import('@gjsify/abort-controller');
        const ac = new AC();
        expect(ac.signal).toBeDefined();
        expect(ac.signal.aborted).toBe(false);
      });

      await it('abort() should set signal.aborted to true', async () => {
        const { AbortController: AC } = await import('@gjsify/abort-controller');
        const ac = new AC();
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
    // CompressionStream is native on Node.js but not registered as global on GJS
    await describe('Compression Streams', async () => {
      await it('CompressionStream import should be available', async () => {
        const cs = await import('@gjsify/compression-streams');
        expect(typeof cs.CompressionStream).toBe('function');
      });

      await it('DecompressionStream import should be available', async () => {
        const cs = await import('@gjsify/compression-streams');
        expect(typeof cs.DecompressionStream).toBe('function');
      });
    });

    // ==================== WebCrypto ====================
    await describe('WebCrypto', async () => {
      await it('webcrypto import should be available', async () => {
        const wc = await import('@gjsify/webcrypto');
        expect(wc.Crypto).toBeDefined();
      });

      // crypto global tests — Node.js only (GJS has recursion issues with the polyfill)
      await on('Node.js', async () => {
        await it('crypto should be available as global', async () => {
          expect(typeof globalThis.crypto).toBe('object');
        });

        await it('crypto.subtle should be available', async () => {
          expect(globalThis.crypto.subtle).toBeDefined();
        });

        await it('crypto.getRandomValues should work', async () => {
          const buf = new Uint8Array(16);
          crypto.getRandomValues(buf);
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
    });

    // ==================== EventSource ====================
    // EventSource is registered as global on GJS only (Node.js 24 does not have it as global)
    await describe('EventSource', async () => {
      await it('EventSource import should be available', async () => {
        const { EventSource: ES } = await import('@gjsify/eventsource');
        expect(typeof ES).toBe('function');
        expect(ES.CONNECTING).toBe(0);
        expect(ES.OPEN).toBe(1);
        expect(ES.CLOSED).toBe(2);
      });
    });
  });
};
