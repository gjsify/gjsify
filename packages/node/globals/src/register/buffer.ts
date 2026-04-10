// Registers: Buffer (+ Blob, File via @gjsify/buffer/register)

import { Buffer } from '@gjsify/buffer';
import '@gjsify/buffer/register';

if (!('Buffer' in globalThis)) {
  Object.defineProperty(globalThis, 'Buffer', {
    value: Buffer,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}
