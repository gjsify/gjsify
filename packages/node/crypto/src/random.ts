// Cryptographic random number generation for GJS
// Uses WebCrypto API (available in SpiderMonkey 128)
// Reference: Node.js lib/internal/crypto/random.js

import { Buffer } from 'buffer';

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
      // WebCrypto has a 65536-byte limit per call
      for (let offset = 0; offset < size; offset += 65536) {
        const length = Math.min(size - offset, 65536);
        const view = new Uint8Array(buf.buffer, buf.byteOffset + offset, length);
        globalThis.crypto.getRandomValues(view);
      }
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
    for (let i = 0; i < length; i += 65536) {
      const chunkSize = Math.min(length - i, 65536);
      const view = new Uint8Array(
        buffer instanceof Buffer ? buffer.buffer : buffer.buffer,
        (buffer instanceof Buffer ? buffer.byteOffset : buffer.byteOffset) + offset + i,
        chunkSize,
      );
      globalThis.crypto.getRandomValues(view);
    }
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
  // Handle overloaded signatures
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
  return globalThis.crypto.randomUUID();
}

/**
 * Generate a random integer between min (inclusive) and max (exclusive).
 */
export function randomInt(min: number, max?: number | ((err: Error | null, value: number) => void), callback?: (err: Error | null, value: number) => void): number | void {
  // Handle overloaded signatures
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
  globalThis.crypto.getRandomValues(bytes);
  const value = _min + (bytes[0] % range);

  if (_callback) {
    _callback(null, value);
  } else {
    return value;
  }
}
