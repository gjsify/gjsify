// Registers: structuredClone

import { structuredClone as structuredClonePolyfill } from '@gjsify/utils';

if (typeof globalThis.structuredClone !== 'function') {
  Object.defineProperty(globalThis, 'structuredClone', {
    value: structuredClonePolyfill,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
