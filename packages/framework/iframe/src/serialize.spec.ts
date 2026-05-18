// Tests for the GJS ↔ WebView wire-encoder pair. Round-trips every
// binary type the bridge supports plus nested object/array shapes,
// preserving constructor identity, byteLength, and element semantics.
// Pure JS — runs on both Node and GJS without WebKit.

import { describe, it, expect } from '@gjsify/unit';
import { encodeBinariesForJson, decodeBinariesFromJson } from './serialize.js';
import { normaliseTargetOrigin, GJS_HOST_ORIGIN, BOOTSTRAP_SCRIPT_FOR_TEST } from './message-bridge.js';

function roundTrip(value: unknown): unknown {
  const encoded = encodeBinariesForJson(value);
  const json = JSON.stringify(encoded);
  return decodeBinariesFromJson(JSON.parse(json));
}

export default async () => {

  await describe('serialize — binary round-trip', async () => {

    await it('Uint8Array survives byte-perfect', async () => {
      const src = new Uint8Array(1024);
      for (let i = 0; i < src.length; i++) src[i] = (i * 31 + 7) & 0xff;
      const back = roundTrip(src) as Uint8Array;
      expect(back instanceof Uint8Array).toBe(true);
      expect(back.length).toBe(1024);
      for (let i = 0; i < src.length; i++) {
        if (back[i] !== src[i]) throw new Error(`mismatch at index ${i}: ${back[i]} != ${src[i]}`);
      }
    });

    await it('ArrayBuffer survives byte-perfect', async () => {
      const src = new ArrayBuffer(64);
      const view = new Uint8Array(src);
      for (let i = 0; i < 64; i++) view[i] = i ^ 0x5A;
      const back = roundTrip(src) as ArrayBuffer;
      expect(back instanceof ArrayBuffer).toBe(true);
      expect(back.byteLength).toBe(64);
      const backView = new Uint8Array(back);
      for (let i = 0; i < 64; i++) expect(backView[i]).toBe(i ^ 0x5A);
    });

    await it('Int32Array survives sign + element semantics', async () => {
      const src = new Int32Array([-2147483648, -1, 0, 1, 2147483647]);
      const back = roundTrip(src) as Int32Array;
      expect(back instanceof Int32Array).toBe(true);
      expect(back.length).toBe(5);
      expect(back[0]).toBe(-2147483648);
      expect(back[1]).toBe(-1);
      expect(back[4]).toBe(2147483647);
    });

    await it('Float32Array preserves precision', async () => {
      const src = new Float32Array([Math.PI, Math.E, -1.5, 0, Number.MAX_VALUE]);
      const back = roundTrip(src) as Float32Array;
      expect(back instanceof Float32Array).toBe(true);
      // Float32 precision: PI and E lose digits but the round-trip is identity.
      for (let i = 0; i < src.length; i++) expect(back[i]).toBe(src[i]);
    });

    await it('Uint16Array / Uint32Array preserve element width', async () => {
      const u16 = new Uint16Array([0, 0xFFFF, 0x1234, 0xABCD]);
      const back16 = roundTrip(u16) as Uint16Array;
      expect(back16 instanceof Uint16Array).toBe(true);
      expect(back16.length).toBe(4);
      expect(back16[1]).toBe(0xFFFF);
      expect(back16[3]).toBe(0xABCD);

      const u32 = new Uint32Array([0xDEADBEEF, 0, 1, 0xFFFFFFFF]);
      const back32 = roundTrip(u32) as Uint32Array;
      expect(back32 instanceof Uint32Array).toBe(true);
      expect(back32[0]).toBe(0xDEADBEEF);
      expect(back32[3]).toBe(0xFFFFFFFF);
    });

    await it('DataView round-trips with same byteLength', async () => {
      const buf = new ArrayBuffer(32);
      const writer = new DataView(buf);
      writer.setUint32(0, 0xCAFEBABE, false);
      writer.setFloat64(8, Math.PI, true);
      writer.setInt16(20, -12345, false);
      const dv = new DataView(buf);
      const back = roundTrip(dv) as DataView;
      expect(back instanceof DataView).toBe(true);
      expect(back.byteLength).toBe(32);
      expect(back.getUint32(0, false)).toBe(0xCAFEBABE);
      expect(back.getFloat64(8, true)).toBe(Math.PI);
      expect(back.getInt16(20, false)).toBe(-12345);
    });

    await it('typed-array view inside a plain object', async () => {
      const src = {
        header: { version: 1, flags: 0x0F },
        payload: new Uint8Array([1, 2, 3, 4, 5]),
        meta: 'hello',
      };
      const back = roundTrip(src) as typeof src;
      expect(back.header.version).toBe(1);
      expect(back.header.flags).toBe(0x0F);
      expect(back.payload instanceof Uint8Array).toBe(true);
      expect(back.payload.length).toBe(5);
      expect(back.payload[4]).toBe(5);
      expect(back.meta).toBe('hello');
    });

    await it('typed arrays inside nested arrays', async () => {
      const src = [
        new Uint8Array([10, 20, 30]),
        new Uint8Array([40, 50, 60]),
        new Uint8Array([70, 80, 90]),
      ];
      const back = roundTrip(src) as Uint8Array[];
      expect(back.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(back[i] instanceof Uint8Array).toBe(true);
        expect(back[i]!.length).toBe(3);
      }
      expect(back[2]![2]).toBe(90);
    });

    await it('non-binary leaves pass through untouched', async () => {
      const src = { a: 1, b: 'hello', c: true, d: null, e: [1, 2, 3] };
      const back = roundTrip(src) as typeof src;
      expect(back.a).toBe(1);
      expect(back.b).toBe('hello');
      expect(back.c).toBe(true);
      expect(back.d).toBe(null);
      expect(back.e[2]).toBe(3);
    });

    await it('empty typed array', async () => {
      const src = new Uint8Array(0);
      const back = roundTrip(src) as Uint8Array;
      expect(back instanceof Uint8Array).toBe(true);
      expect(back.length).toBe(0);
    });

    await it('TypedArray view on a larger buffer — only the view window survives', async () => {
      const buf = new ArrayBuffer(64);
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < 64; i++) u8[i] = i;
      // 16-byte window starting at offset 8.
      const view = new Uint8Array(buf, 8, 16);
      const back = roundTrip(view) as Uint8Array;
      expect(back.length).toBe(16);
      // Receiver-side buffer is fresh (no shared backing — postMessage clones);
      // values 8..23 of the original.
      for (let i = 0; i < 16; i++) expect(back[i]).toBe(8 + i);
    });
  });

  await describe('normaliseTargetOrigin (W3C postMessage spec)', async () => {
    await it("'*' returns '*' (no origin restriction)", async () => {
      expect(normaliseTargetOrigin('*')).toBe('*');
    });

    await it("'/' returns null (sentinel for source-own-origin)", async () => {
      expect(normaliseTargetOrigin('/')).toBe(null);
    });

    await it('http URL returns canonical origin (no trailing slash, no path)', async () => {
      expect(normaliseTargetOrigin('https://example.com/path?query=1')).toBe('https://example.com');
    });

    await it('http URL with port preserves port in origin', async () => {
      expect(normaliseTargetOrigin('http://localhost:8080/foo')).toBe('http://localhost:8080');
    });

    await it('our synthetic GJS_HOST_ORIGIN parses cleanly', async () => {
      expect(normaliseTargetOrigin(GJS_HOST_ORIGIN)).toBe(GJS_HOST_ORIGIN);
    });

    await it('malformed input throws SyntaxError', async () => {
      let threw: Error | null = null;
      try { normaliseTargetOrigin('not a valid url'); }
      catch (e) { threw = e as Error; }
      expect(threw !== null).toBe(true);
      expect(threw!.name).toBe('SyntaxError');
    });

    await it("empty string throws SyntaxError (not interpreted as '*')", async () => {
      let threw = false;
      try { normaliseTargetOrigin(''); } catch { threw = true; }
      expect(threw).toBe(true);
    });

    await it('GJS_HOST_ORIGIN constant matches expected value', async () => {
      // Pinning the contract: changing this string would silently break
      // WebView code that filters incoming origins.
      expect(GJS_HOST_ORIGIN).toBe('https://gjsify.local');
    });
  });

  await describe('bootstrap script — re-injection safety', async () => {
    await it('contains the __bridgeVersion idempotency marker', async () => {
      // Refactor canary: if the version marker disappears, double-injection
      // during rapid navigation would lose the real window.postMessage.
      const src = BOOTSTRAP_SCRIPT_FOR_TEST();
      expect(src.includes('__bridgeVersion')).toBe(true);
      expect(src.includes('__gjsifyBridge')).toBe(true);
    });

    await it('runs idempotently against a simulated window', async () => {
      // Build a fake window + webkit-message-handler, run the bootstrap
      // twice, verify postMessage is only wrapped once.
      const handlerCalls: string[] = [];
      const realPostMessage = function (this: unknown, _data: unknown) { /* stand-in */ };
      const fakeWindow: Record<string, unknown> = {
        webkit: { messageHandlers: { 'gjsify-iframe': { postMessage: (s: string) => handlerCalls.push(s) } } },
        postMessage: realPostMessage,
      };
      const fakeLocation = { origin: 'https://example.com' };
      const sandbox = { window: fakeWindow, location: fakeLocation };
      const src = BOOTSTRAP_SCRIPT_FOR_TEST();
      // The bootstrap is a top-level IIFE; wrap it in a function that
      // takes `window` + `location` as locals to simulate the
      // WebView's global scope.
      const runner = new Function('window', 'location', 'URL', src);
      // First injection.
      runner(sandbox.window, sandbox.location, URL);
      const afterFirst = sandbox.window.postMessage;
      expect(afterFirst !== realPostMessage).toBe(true);            // overridden
      const bridgeAfterFirst = sandbox.window.__gjsifyBridge as { origPostMessage: unknown; __bridgeVersion: number };
      expect(bridgeAfterFirst.__bridgeVersion).toBe(1);
      expect(bridgeAfterFirst.origPostMessage).toBe(realPostMessage); // real one captured

      // Second injection: should be a no-op (idempotency guard).
      runner(sandbox.window, sandbox.location, URL);
      const afterSecond = sandbox.window.postMessage;
      expect(afterSecond).toBe(afterFirst);                          // same override, not double-wrapped
      const bridgeAfterSecond = sandbox.window.__gjsifyBridge as { origPostMessage: unknown };
      expect(bridgeAfterSecond.origPostMessage).toBe(realPostMessage); // real one still captured (not our override)
    });

    await it('respects targetOrigin filter when sending to GJS host', async () => {
      // The bootstrap-side normaliseOrigin should drop a message whose
      // targetOrigin doesn't match the GJS host. We simulate by running
      // bootstrap, calling our override with mismatched origin, and
      // asserting the handler.postMessage was NOT called.
      const calls: string[] = [];
      const fakeWindow: Record<string, unknown> = {
        webkit: { messageHandlers: { 'gjsify-iframe': { postMessage: (s: string) => calls.push(s) } } },
        postMessage: () => { /* placeholder */ },
      };
      const fakeLocation = { origin: 'https://example.com' };
      const runner = new Function('window', 'location', 'URL', BOOTSTRAP_SCRIPT_FOR_TEST());
      runner(fakeWindow, fakeLocation, URL);
      // Wildcard: delivers.
      (fakeWindow.postMessage as (d: unknown, o: string) => void)({ hello: 1 }, '*');
      expect(calls.length).toBe(1);
      // Mismatched origin: dropped.
      (fakeWindow.postMessage as (d: unknown, o: string) => void)({ hello: 2 }, 'https://attacker.example');
      expect(calls.length).toBe(1);
      // Exact GJS host: delivers.
      (fakeWindow.postMessage as (d: unknown, o: string) => void)({ hello: 3 }, GJS_HOST_ORIGIN);
      expect(calls.length).toBe(2);
    });
  });
};
