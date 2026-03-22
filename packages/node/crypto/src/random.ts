// Cryptographic random number generation for GJS
// Uses WebCrypto API when available, GLib.Random as fallback
// Reference: Node.js lib/internal/crypto/random.js

import { Buffer } from 'buffer';

const hasWebCrypto = typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function';

/**
 * Fill a Uint8Array with random bytes, using WebCrypto or GLib.Random fallback.
 */
function fillRandom(view: Uint8Array): void {
  if (hasWebCrypto) {
    // WebCrypto has a 65536-byte limit per call
    for (let offset = 0; offset < view.length; offset += 65536) {
      const length = Math.min(view.length - offset, 65536);
      const slice = new Uint8Array(view.buffer, view.byteOffset + offset, length);
      globalThis.crypto.getRandomValues(slice);
    }
  } else {
    // GLib.Random fallback for GJS environments without WebCrypto
    try {
      const GLib = imports.gi.GLib;
      for (let i = 0; i < view.length; i++) {
        view[i] = GLib.random_int_range(0, 256);
      }
    } catch {
      // Last resort: Math.random (not cryptographically secure)
      for (let i = 0; i < view.length; i++) {
        view[i] = Math.floor(Math.random() * 256);
      }
    }
  }
}

/**
 * Generate cryptographically strong pseudo-random data.
 */
export function randomBytes(size: number): Buffer;
export function randomBytes(size: number, callback: (err: Error | null, buf: Buffer) => void): void;
export function randomBytes(size: number, callback?: (err: Error | null, buf: Buffer) => void): Buffer | void {
  if (typeof size !== 'number' || size < 0 || !Number.isInteger(size)) {
    throw new TypeError(`The "size" argument must be a non-negative integer. Received ${size}`);
  }

  try {
    const buf = Buffer.alloc(size);
    if (size > 0) {
      fillRandom(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    }
    if (callback) {
      callback(null, buf);
    } else {
      return buf;
    }
  } catch (err) {
    if (callback) {
      callback(err as Error, Buffer.alloc(0));
    } else {
      throw err;
    }
  }
}

/**
 * Fill a buffer with cryptographically strong pseudo-random data (synchronous).
 */
export function randomFillSync(buffer: Buffer | Uint8Array, offset = 0, size?: number): Buffer | Uint8Array {
  const length = size ?? (buffer.length - offset);

  if (offset < 0 || offset > buffer.length) {
    throw new RangeError(`The value of "offset" is out of range. Received ${offset}`);
  }
  if (length < 0 || offset + length > buffer.length) {
    throw new RangeError(`The value of "size" is out of range. Received ${length}`);
  }

  if (length > 0) {
    const byteOffset = buffer instanceof Buffer ? buffer.byteOffset : buffer.byteOffset;
    const view = new Uint8Array(buffer.buffer as ArrayBuffer, byteOffset + offset, length);
    fillRandom(view);
  }

  return buffer;
}

/**
 * Fill a buffer with cryptographically strong pseudo-random data (async).
 */
export function randomFill(
  buffer: Buffer | Uint8Array,
  offset: number | ((err: Error | null, buf: Buffer | Uint8Array) => void),
  size?: number | ((err: Error | null, buf: Buffer | Uint8Array) => void),
  callback?: (err: Error | null, buf: Buffer | Uint8Array) => void,
): void {
  let _offset: number;
  let _size: number;
  let _callback: (err: Error | null, buf: Buffer | Uint8Array) => void;

  if (typeof offset === 'function') {
    _callback = offset;
    _offset = 0;
    _size = buffer.length;
  } else if (typeof size === 'function') {
    _callback = size;
    _offset = offset;
    _size = buffer.length - offset;
  } else {
    _callback = callback!;
    _offset = offset;
    _size = size!;
  }

  try {
    randomFillSync(buffer, _offset, _size);
    _callback(null, buffer);
  } catch (err) {
    _callback(err as Error, buffer);
  }
}

/**
 * Generate a random UUID v4 string.
 */
export function randomUUID(): string {
  if (hasWebCrypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Manual UUID v4 generation fallback
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  // Set version (4) and variant (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a random integer between min (inclusive) and max (exclusive).
 */
export function randomInt(min: number, max?: number | ((err: Error | null, value: number) => void), callback?: (err: Error | null, value: number) => void): number | void {
  let _min: number;
  let _max: number;
  let _callback: ((err: Error | null, value: number) => void) | undefined;

  if (typeof max === 'function') {
    _callback = max;
    _max = min;
    _min = 0;
  } else if (typeof max === 'number') {
    _min = min;
    _max = max;
    _callback = callback;
  } else {
    _max = min;
    _min = 0;
    _callback = callback;
  }

  if (!Number.isInteger(_min)) {
    throw new TypeError(`The "min" argument must be a safe integer. Received ${_min}`);
  }
  if (!Number.isInteger(_max)) {
    throw new TypeError(`The "max" argument must be a safe integer. Received ${_max}`);
  }
  if (_min >= _max) {
    throw new RangeError(`The value of "min" must be less than "max". Received min: ${_min}, max: ${_max}`);
  }

  const range = _max - _min;
  const bytes = new Uint32Array(1);
  const view = new Uint8Array(bytes.buffer);
  fillRandom(view);
  const value = _min + (bytes[0] % range);

  if (_callback) {
    _callback(null, value);
  } else {
    return value;
  }
}
