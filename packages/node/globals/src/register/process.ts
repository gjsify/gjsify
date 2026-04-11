// Registers: process, global + Error.captureStackTrace polyfill + Promise.withResolvers

import { initErrorV8Methods } from '@gjsify/utils';
import process from '@gjsify/process';

// Promise.withResolvers polyfill for SpiderMonkey < 121
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

// Error.captureStackTrace polyfill for SpiderMonkey
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
