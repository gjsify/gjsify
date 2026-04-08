// Side-effect module: registers core Node.js globals on GJS — process,
// Buffer, setImmediate/clearImmediate, btoa/atob, structuredClone,
// queueMicrotask, global, URL, URLSearchParams — plus the
// Error.captureStackTrace V8 compatibility shim and Promise.withResolvers
// polyfill for older GJS builds.
//
// Web APIs like fetch, AbortController, Headers, Request, Response are NOT
// registered here — import `@gjsify/web-globals/register` (or the specific
// package like `@gjsify/fetch/register`) if you need them.
//
// On Node.js the alias layer maps this subpath to @gjsify/empty because all
// of these globals are already native.

import { initErrorV8Methods, structuredClone as structuredClonePolyfill } from '@gjsify/utils';

import process from '@gjsify/process';
import { Buffer } from '@gjsify/buffer';
// @gjsify/buffer/register adds Blob + File globals — since Node.js 18 these
// are exposed by `node:buffer`, so conceptually they belong to node-globals too.
import '@gjsify/buffer/register';
import { URL, URLSearchParams } from '@gjsify/url';
import GLib from '@girs/glib-2.0';

// Promise.withResolvers polyfill for SpiderMonkey < 121 (ES2024, not in GJS < 1.81.2)
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// queueMicrotask polyfill for GJS (SpiderMonkey does not provide it)
if (typeof queueMicrotask !== 'function') {
  Object.defineProperty(globalThis, 'queueMicrotask', {
    value: function queueMicrotask(callback: VoidFunction): void {
      Promise.resolve().then(callback).catch((err) => {
        setTimeout(() => { throw err; }, 0);
      });
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// Error.captureStackTrace polyfill for SpiderMonkey (V8-only API)
initErrorV8Methods(Error);

if (!('global' in globalThis)) {
  Object.defineProperty(globalThis, 'global', {
    value: globalThis,
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

if (!('process' in globalThis)) {
  Object.defineProperty(globalThis, 'process', {
    value: process,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

if (!('Buffer' in globalThis)) {
  Object.defineProperty(globalThis, 'Buffer', {
    value: Buffer,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

// setImmediate/clearImmediate polyfill via setTimeout
function setImmediate<T extends any[]>(callback: (...args: T) => void, ...args: T): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0, ...args);
}

function clearImmediate(id: ReturnType<typeof setTimeout>): void {
  clearTimeout(id);
}

if (!('setImmediate' in globalThis)) {
  Object.defineProperty(globalThis, 'setImmediate', {
    value: setImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

if (!('clearImmediate' in globalThis)) {
  Object.defineProperty(globalThis, 'clearImmediate', {
    value: clearImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// btoa/atob polyfill via GLib.base64_encode/decode
if (typeof globalThis.btoa !== 'function') {
  Object.defineProperty(globalThis, 'btoa', {
    value: function btoa(data: string): string {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      return GLib.base64_encode(bytes);
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.atob !== 'function') {
  Object.defineProperty(globalThis, 'atob', {
    value: function atob(data: string): string {
      const bytes = GLib.base64_decode(data);
      let result = '';
      for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
      }
      return result;
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// structuredClone polyfill (SpiderMonkey 128 has it, but GJS ESM doesn't expose it as global)
if (typeof globalThis.structuredClone !== 'function') {
  Object.defineProperty(globalThis, 'structuredClone', {
    value: structuredClonePolyfill,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// URL / URLSearchParams globals via @gjsify/url (GLib.Uri-based)
if (typeof globalThis.URL !== 'function') {
  Object.defineProperty(globalThis, 'URL', {
    value: URL,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.URLSearchParams !== 'function') {
  Object.defineProperty(globalThis, 'URLSearchParams', {
    value: URLSearchParams,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}
