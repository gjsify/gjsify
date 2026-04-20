// Registers: queueMicrotask
import { queueMicrotask as _queueMicrotask } from '@gjsify/utils';

if (typeof queueMicrotask !== 'function') {
  Object.defineProperty(globalThis, 'queueMicrotask', {
    value: _queueMicrotask,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
