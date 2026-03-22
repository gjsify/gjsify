import { initErrorV8Methods } from "@gjsify/utils";
import "@gjsify/require";

import process from '@gjsify/process';
import { Buffer } from '@gjsify/buffer';

// queueMicrotask polyfill for GJS (SpiderMonkey does not provide it)
if (typeof queueMicrotask !== 'function') {
  Object.defineProperty(globalThis, "queueMicrotask", {
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
  Object.defineProperty(globalThis, "global", {
    value: globalThis,
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

if (!('process' in globalThis)) {
  Object.defineProperty(globalThis, "process", {
    value: process,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

if (!('Buffer' in globalThis)) {
  Object.defineProperty(globalThis, "Buffer", {
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
  Object.defineProperty(globalThis, "setImmediate", {
    value: setImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

if (!('clearImmediate' in globalThis)) {
  Object.defineProperty(globalThis, "clearImmediate", {
    value: clearImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export {};
