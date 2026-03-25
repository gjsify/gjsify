// W3C WebCrypto API for GJS
// Reference: refs/deno/ext/crypto/00_crypto.js
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS using @gjsify/crypto primitives.
//
// On Node.js (and any environment with native WebCrypto), this module
// re-exports the native globals for zero overhead.
// On GJS, it provides a polyfill and registers globals.

import { SubtleCrypto } from './subtle.js';
import { CryptoKey } from './crypto-key.js';
export type { CryptoKeyPair, KeyUsage, KeyAlgorithm, KeyType } from './crypto-key.js';

// Save reference to native crypto BEFORE any overwriting to avoid recursion
const _nativeCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : null;

/**
 * Crypto object per the W3C WebCrypto API.
 * Provides getRandomValues(), randomUUID(), and subtle (SubtleCrypto).
 */
class CryptoPolyfill {
  readonly subtle = new SubtleCrypto();

  getRandomValues<T extends ArrayBufferView>(array: T): T {
    if (!(array instanceof Int8Array || array instanceof Uint8Array ||
          array instanceof Int16Array || array instanceof Uint16Array ||
          array instanceof Int32Array || array instanceof Uint32Array ||
          array instanceof Uint8ClampedArray || array instanceof BigInt64Array ||
          array instanceof BigUint64Array)) {
      throw new DOMException('The provided value is not of type \'(Int8Array or Int16Array or Int32Array or Uint8Array or Uint8ClampedArray or Uint16Array or Uint32Array or BigInt64Array or BigUint64Array)\'', 'TypeMismatchError');
    }
    if (array.byteLength > 65536) {
      throw new DOMException('The ArrayBufferView\'s byte length exceeds the number of bytes of entropy available via this API (65536)', 'QuotaExceededError');
    }
    const bytes = new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength);
    // Use saved reference to native crypto (NOT globalThis.crypto which may be this polyfill)
    if (_nativeCrypto && typeof _nativeCrypto.getRandomValues === 'function') {
      _nativeCrypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    } else {
      // Fallback: use GLib or Math.random
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return array;
  }

  randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    if (_nativeCrypto && typeof _nativeCrypto.randomUUID === 'function') {
      return _nativeCrypto.randomUUID();
    }
    // Manual UUID v4 generation
    const bytes = new Uint8Array(16);
    this.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
  }
}

// Use native if available (Node.js, browser), polyfill otherwise
const hasNativeSubtle = _nativeCrypto !== null
  && typeof _nativeCrypto.subtle !== 'undefined'
  && typeof _nativeCrypto.subtle.digest === 'function';

const cryptoInstance = hasNativeSubtle ? _nativeCrypto! : new CryptoPolyfill();
const subtleInstance = hasNativeSubtle ? _nativeCrypto!.subtle : new SubtleCrypto();

// Register globals on GJS if needed
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).crypto = cryptoInstance;
}

export { CryptoKey, SubtleCrypto, CryptoPolyfill as Crypto };
export { subtleInstance as subtle, cryptoInstance as crypto };

export default cryptoInstance;
