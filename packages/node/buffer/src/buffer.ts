// Native Buffer implementation for GJS
// Reference: Node.js lib/buffer.js, Deno ext/node/polyfills/buffer.ts

// BufferEncoding is a global type provided by @types/node

import { normalizeEncoding, checkEncoding } from '@gjsify/utils';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Base64 helpers — atob/btoa may not be available in GJS
const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64lookup = new Uint8Array(256);
for (let i = 0; i < b64chars.length; i++) b64lookup[b64chars.charCodeAt(i)] = i;

function _atob(str: string): string {
  if (typeof globalThis.atob === 'function') return globalThis.atob(str);
  // Manual base64 decode
  const cleaned = str.replace(/[=\s]/g, '');
  let result = '';
  let bits = 0;
  let collected = 0;
  for (let i = 0; i < cleaned.length; i++) {
    bits = (bits << 6) | b64lookup[cleaned.charCodeAt(i)];
    collected += 6;
    if (collected >= 8) {
      collected -= 8;
      result += String.fromCharCode((bits >> collected) & 0xff);
    }
  }
  return result;
}

function _btoa(str: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(str);
  // Manual base64 encode
  let result = '';
  let i = 0;
  for (; i + 2 < str.length; i += 3) {
    const n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8) | str.charCodeAt(i + 2);
    result += b64chars[(n >> 18) & 63] + b64chars[(n >> 12) & 63] + b64chars[(n >> 6) & 63] + b64chars[n & 63];
  }
  if (i + 1 === str.length) {
    const n = str.charCodeAt(i) << 16;
    result += b64chars[(n >> 18) & 63] + b64chars[(n >> 12) & 63] + '==';
  } else if (i + 2 === str.length) {
    const n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8);
    result += b64chars[(n >> 18) & 63] + b64chars[(n >> 12) & 63] + b64chars[(n >> 6) & 63] + '=';
  }
  return result;
}

// Direct base64 → Uint8Array decoding (avoids lossy atob string round-trip)
function base64Decode(str: string): Uint8Array {
  const cleaned = str.replace(/[=\s]/g, '');
  const bytes = new Uint8Array((cleaned.length * 3) >> 2);
  let bits = 0;
  let collected = 0;
  let pos = 0;
  for (let i = 0; i < cleaned.length; i++) {
    bits = (bits << 6) | b64lookup[cleaned.charCodeAt(i)];
    collected += 6;
    if (collected >= 8) {
      collected -= 8;
      bytes[pos++] = (bits >> collected) & 0xff;
    }
  }
  return bytes.subarray(0, pos);
}

// SharedArrayBuffer may not be available in GJS
const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

// normalizeEncoding and checkEncoding are imported from @gjsify/utils

// Encode string to Uint8Array
function encodeString(str: string, encoding: BufferEncoding): Uint8Array {
  switch (encoding) {
    case 'utf8':
      return textEncoder.encode(str);

    case 'ascii': {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 0x7f;
      }
      return buf;
    }

    case 'latin1': {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 0xff;
      }
      return buf;
    }

    case 'base64': {
      const standard = str.replace(/-/g, '+').replace(/_/g, '/');
      return base64Decode(standard);
    }

    case 'base64url': {
      const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
      return encodeString(base64, 'base64');
    }

    case 'hex': {
      const bytes = str.length >>> 1;
      const buf = new Uint8Array(bytes);
      for (let i = 0; i < bytes; i++) {
        const hi = parseInt(str[i * 2], 16);
        const lo = parseInt(str[i * 2 + 1], 16);
        if (Number.isNaN(hi) || Number.isNaN(lo)) break;
        buf[i] = (hi << 4) | lo;
      }
      return buf;
    }

    case 'utf16le': {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 0xff;
        buf[i * 2 + 1] = (code >> 8) & 0xff;
      }
      return buf;
    }

    default:
      return textEncoder.encode(str);
  }
}

// Decode Uint8Array to string
function decodeString(buf: Uint8Array, encoding: BufferEncoding, start?: number, end?: number): string {
  const slice = start !== undefined || end !== undefined
    ? buf.subarray(start ?? 0, end ?? buf.length)
    : buf;

  switch (encoding) {
    case 'utf8':
      return textDecoder.decode(slice);

    case 'ascii': {
      let result = '';
      for (let i = 0; i < slice.length; i++) {
        result += String.fromCharCode(slice[i] & 0x7f);
      }
      return result;
    }

    case 'latin1': {
      let result = '';
      for (let i = 0; i < slice.length; i++) {
        result += String.fromCharCode(slice[i]);
      }
      return result;
    }

    case 'base64': {
      let binary = '';
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]);
      }
      return _btoa(binary);
    }

    case 'base64url': {
      const base64 = decodeString(slice, 'base64');
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    case 'hex': {
      let result = '';
      for (let i = 0; i < slice.length; i++) {
        result += slice[i].toString(16).padStart(2, '0');
      }
      return result;
    }

    case 'utf16le': {
      let result = '';
      for (let i = 0; i + 1 < slice.length; i += 2) {
        result += String.fromCharCode(slice[i] | (slice[i + 1] << 8));
      }
      return result;
    }

    default:
      return textDecoder.decode(slice);
  }
}

function checkOffset(offset: number, ext: number, length: number): void {
  if (offset + ext > length) {
    throw new RangeError('Attempt to access memory outside buffer bounds');
  }
}

const INSPECT_MAX_BYTES = 50;

/**
 * Node.js-compatible Buffer class.
 */
export class Buffer extends Uint8Array {
  // Marker to identify Buffer instances
  private static readonly _isBuffer = true;

  // ---- Static constructors ----

  static alloc(size: number, fill?: number | string | Uint8Array | Buffer, encoding?: string): Buffer {
    if (typeof size !== 'number') {
      throw new TypeError(`The "size" argument must be of type number. Received type ${typeof size}`);
    }
    if (size < 0) {
      throw new RangeError(`The value "${size}" is invalid for option "size"`);
    }

    const buf = new Buffer(size);

    if (fill !== undefined && fill !== 0) {
      buf.fill(fill, 0, size, encoding);
    }

    return buf;
  }

  static allocUnsafe(size: number): Buffer {
    if (typeof size !== 'number') {
      throw new TypeError(`The "size" argument must be of type number. Received type ${typeof size}`);
    }
    return new Buffer(size);
  }

  static allocUnsafeSlow(size: number): Buffer {
    return Buffer.allocUnsafe(size);
  }

  static from(arrayLike: ArrayLike<number>): Buffer;
  static from<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: unknown): Buffer;
  static from(elements: Iterable<number>): Buffer;
  static from(value: string, encoding?: string): Buffer;
  static from(value: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, length?: number): Buffer;
  static from(value: Uint8Array | Buffer): Buffer;
  static from(
    value: ArrayBuffer | SharedArrayBuffer | ArrayLike<number> | Iterable<number> | Uint8Array | Buffer | string,
    encodingOrOffset?: string | number | ((v: unknown, k: number) => number),
    length?: number
  ): Buffer {
    if (typeof value === 'string') {
      const encoding = normalizeEncoding(encodingOrOffset as string);
      if (encodingOrOffset && typeof encodingOrOffset === 'string') {
        // Only check encoding for non-empty, non-falsy strings
        const lower = ('' + encodingOrOffset).toLowerCase().replace(/-/g, '');
        const valid = ['utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'ucs2', 'utf16le', ''];
        if (!valid.includes(lower)) {
          checkEncoding(encodingOrOffset);
        }
      }
      const encoded = encodeString(value as string, encoding);
      const buf = new Buffer(encoded.buffer as ArrayBuffer, encoded.byteOffset, encoded.byteLength);
      return buf;
    }

    if (ArrayBuffer.isView(value)) {
      const buf = new Buffer(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength);
      // Make a copy to avoid shared memory
      const copy = new Buffer(buf.length);
      copy.set(buf);
      return copy;
    }

    if (value instanceof ArrayBuffer) {
      const offset = (encodingOrOffset as number) || 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      return new Buffer(value, offset, len);
    }

    if (hasSharedArrayBuffer && value instanceof SharedArrayBuffer) {
      const offset = (encodingOrOffset as number) || 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      return new Buffer(new Uint8Array(value, offset, len));
    }

    if (Array.isArray(value)) {
      const buf = new Buffer(value.length);
      for (let i = 0; i < value.length; i++) {
        buf[i] = value[i] & 0xff;
      }
      return buf;
    }

    throw new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array');
  }

  // ---- Static methods ----

  static isBuffer(obj: unknown): obj is Buffer {
    return obj instanceof Buffer;
  }

  static isEncoding(encoding: unknown): encoding is BufferEncoding {
    if (typeof encoding !== 'string') return false;
    const lower = encoding.toLowerCase().replace(/-/g, '');
    return ['utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'ucs2', 'utf16le'].includes(lower);
  }

  static byteLength(string: string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView, encoding?: string): number {
    if (typeof string !== 'string') {
      if (ArrayBuffer.isView(string)) return string.byteLength;
      if (string instanceof ArrayBuffer) return string.byteLength;
      if (hasSharedArrayBuffer && string instanceof SharedArrayBuffer) return string.byteLength;
      throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer');
    }

    const enc = normalizeEncoding(encoding);
    switch (enc) {
      case 'utf8':
        return textEncoder.encode(string).byteLength;
      case 'ascii':
      case 'latin1':
        return string.length;
      case 'base64':
      case 'base64url': {
        // Calculate base64 decoded length
        let len = string.length;
        // Remove padding
        while (len > 0 && (string[len - 1] === '=' || string[len - 1] === ' ')) len--;
        return (len * 3) >>> 2;
      }
      case 'hex':
        return string.length >>> 1;
      case 'utf16le':
        return string.length * 2;
      default:
        return textEncoder.encode(string).byteLength;
    }
  }

  static compare(buf1: Buffer | Uint8Array, buf2: Buffer | Uint8Array): -1 | 0 | 1 {
    if (!(buf1 instanceof Uint8Array) || !(buf2 instanceof Uint8Array)) {
      throw new TypeError('Arguments must be Buffers or Uint8Arrays');
    }
    const len = Math.min(buf1.length, buf2.length);
    for (let i = 0; i < len; i++) {
      if (buf1[i] < buf2[i]) return -1;
      if (buf1[i] > buf2[i]) return 1;
    }
    if (buf1.length < buf2.length) return -1;
    if (buf1.length > buf2.length) return 1;
    return 0;
  }

  static concat(list: (Buffer | Uint8Array)[], totalLength?: number): Buffer {
    if (list.length === 0) return Buffer.alloc(0);

    if (totalLength === undefined) {
      totalLength = 0;
      for (let i = 0; i < list.length; i++) {
        totalLength += list[i].length;
      }
    }

    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      const toCopy = Math.min(buf.length, totalLength - offset);
      if (toCopy <= 0) break;
      result.set(buf.subarray(0, toCopy), offset);
      offset += toCopy;
    }
    return result;
  }

  static poolSize = 8192;

  // ---- Instance methods ----

  toString(encoding?: string, start?: number, end?: number): string {
    const enc = normalizeEncoding(encoding);
    return decodeString(this, enc, start, end);
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return {
      type: 'Buffer',
      data: Array.from(this),
    };
  }

  equals(otherBuffer: Buffer | Uint8Array): boolean {
    if (!(otherBuffer instanceof Uint8Array)) {
      throw new TypeError('Argument must be a Buffer or Uint8Array');
    }
    if (this.length !== otherBuffer.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== otherBuffer[i]) return false;
    }
    return true;
  }

  compare(target: Buffer | Uint8Array, targetStart?: number, targetEnd?: number, sourceStart?: number, sourceEnd?: number): -1 | 0 | 1 {
    if (!(target instanceof Uint8Array)) {
      throw new TypeError('Argument must be a Buffer or Uint8Array');
    }
    const src = sourceStart !== undefined || sourceEnd !== undefined
      ? this.subarray(sourceStart ?? 0, sourceEnd ?? this.length)
      : this;
    const tgt = targetStart !== undefined || targetEnd !== undefined
      ? target.subarray(targetStart ?? 0, targetEnd ?? target.length)
      : target;
    return Buffer.compare(src, tgt);
  }

  copy(target: Buffer | Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd?: number): number {
    const end = sourceEnd ?? this.length;
    const toCopy = Math.min(end - sourceStart, target.length - targetStart);
    if (toCopy <= 0) return 0;
    target.set(this.subarray(sourceStart, sourceStart + toCopy), targetStart);
    return toCopy;
  }

  // slice returns a Buffer (not Uint8Array) that shares memory
  slice(start?: number, end?: number): Buffer {
    const s = start ?? 0;
    const e = end ?? this.length;
    const sub = super.subarray(s, e);
    return new Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }

  // subarray also returns a Buffer
  subarray(start?: number, end?: number): Buffer {
    const sub = super.subarray(start, end);
    return new Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }

  write(string: string, offset?: number, length?: number, encoding?: string): number {
    offset = offset ?? 0;
    const enc = normalizeEncoding(encoding || (typeof length === 'string' ? length : undefined));
    const encoded = encodeString(string, enc);
    const maxLen = length !== undefined && typeof length === 'number' ? Math.min(length, this.length - offset) : this.length - offset;
    const toCopy = Math.min(encoded.length, maxLen);
    this.set(encoded.subarray(0, toCopy), offset);
    return toCopy;
  }

  fill(value: number | string | Uint8Array | Buffer, offset?: number, end?: number, encoding?: string): this {
    const start = offset ?? 0;
    const stop = end ?? this.length;

    if (typeof value === 'number') {
      super.fill(value & 0xff, start, stop);
    } else if (typeof value === 'string') {
      const enc = normalizeEncoding(encoding);
      const encoded = encodeString(value, enc);
      if (encoded.length === 0) {
        super.fill(0, start, stop);
      } else if (encoded.length === 1) {
        super.fill(encoded[0], start, stop);
      } else {
        for (let i = start; i < stop; i++) {
          this[i] = encoded[(i - start) % encoded.length];
        }
      }
    } else if (value instanceof Uint8Array) {
      if (value.length === 0) {
        super.fill(0, start, stop);
      } else {
        for (let i = start; i < stop; i++) {
          this[i] = value[(i - start) % value.length];
        }
      }
    }

    return this;
  }

  indexOf(value: number | string | Uint8Array | Buffer, byteOffset?: number, encoding?: string): number {
    if (typeof value === 'number') {
      return super.indexOf(value & 0xff, byteOffset);
    }
    const needle = typeof value === 'string' ? encodeString(value, normalizeEncoding(encoding)) : value;
    const start = byteOffset ?? 0;
    outer:
    for (let i = start; i <= this.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  lastIndexOf(value: number | string | Uint8Array | Buffer, byteOffset?: number, encoding?: string): number {
    if (typeof value === 'number') {
      return super.lastIndexOf(value & 0xff, byteOffset);
    }
    const needle = typeof value === 'string' ? encodeString(value, normalizeEncoding(encoding)) : value;
    const start = byteOffset !== undefined ? Math.min(byteOffset, this.length - needle.length) : this.length - needle.length;
    outer:
    for (let i = start; i >= 0; i--) {
      for (let j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  includes(value: number | string | Uint8Array | Buffer, byteOffset?: number, encoding?: string): boolean {
    return this.indexOf(value, byteOffset, encoding) !== -1;
  }

  // ---- Read methods ----

  readUInt8(offset = 0): number {
    checkOffset(offset, 1, this.length);
    return this[offset];
  }

  readUInt16BE(offset = 0): number {
    checkOffset(offset, 2, this.length);
    return (this[offset] << 8) | this[offset + 1];
  }

  readUInt16LE(offset = 0): number {
    checkOffset(offset, 2, this.length);
    return this[offset] | (this[offset + 1] << 8);
  }

  readUInt32BE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    return (this[offset] * 0x1000000) + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]);
  }

  readUInt32LE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    return ((this[offset + 3] * 0x1000000) + ((this[offset + 2] << 16) | (this[offset + 1] << 8) | this[offset])) >>> 0;
  }

  readInt8(offset = 0): number {
    checkOffset(offset, 1, this.length);
    return this[offset] | (this[offset] & 0x80 ? 0xffffff00 : 0);
  }

  readInt16BE(offset = 0): number {
    checkOffset(offset, 2, this.length);
    const val = (this[offset] << 8) | this[offset + 1];
    return val & 0x8000 ? val | 0xffff0000 : val;
  }

  readInt16LE(offset = 0): number {
    checkOffset(offset, 2, this.length);
    const val = this[offset] | (this[offset + 1] << 8);
    return val & 0x8000 ? val | 0xffff0000 : val;
  }

  readInt32BE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3];
  }

  readInt32LE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    return this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
  }

  readFloatBE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 4);
    return view.getFloat32(0, false);
  }

  readFloatLE(offset = 0): number {
    checkOffset(offset, 4, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 4);
    return view.getFloat32(0, true);
  }

  readDoubleBE(offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getFloat64(0, false);
  }

  readDoubleLE(offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getFloat64(0, true);
  }

  readBigInt64BE(offset = 0): bigint {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getBigInt64(0, false);
  }

  readBigInt64LE(offset = 0): bigint {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getBigInt64(0, true);
  }

  readBigUInt64BE(offset = 0): bigint {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getBigUint64(0, false);
  }

  readBigUInt64LE(offset = 0): bigint {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    return view.getBigUint64(0, true);
  }

  readUIntBE(offset: number, byteLength: number): number {
    checkOffset(offset, byteLength, this.length);
    let val = 0;
    for (let i = 0; i < byteLength; i++) {
      val = val * 256 + this[offset + i];
    }
    return val;
  }

  readUIntLE(offset: number, byteLength: number): number {
    checkOffset(offset, byteLength, this.length);
    let val = 0;
    let mul = 1;
    for (let i = 0; i < byteLength; i++) {
      val += this[offset + i] * mul;
      mul *= 256;
    }
    return val;
  }

  readIntBE(offset: number, byteLength: number): number {
    checkOffset(offset, byteLength, this.length);
    let val = 0;
    for (let i = 0; i < byteLength; i++) {
      val = val * 256 + this[offset + i];
    }
    if (val >= Math.pow(2, 8 * byteLength - 1)) {
      val -= Math.pow(2, 8 * byteLength);
    }
    return val;
  }

  readIntLE(offset: number, byteLength: number): number {
    checkOffset(offset, byteLength, this.length);
    let val = 0;
    let mul = 1;
    for (let i = 0; i < byteLength; i++) {
      val += this[offset + i] * mul;
      mul *= 256;
    }
    if (val >= Math.pow(2, 8 * byteLength - 1)) {
      val -= Math.pow(2, 8 * byteLength);
    }
    return val;
  }

  // ---- Write methods ----

  writeUInt8(value: number, offset = 0): number {
    checkOffset(offset, 1, this.length);
    this[offset] = value & 0xff;
    return offset + 1;
  }

  writeUInt16BE(value: number, offset = 0): number {
    checkOffset(offset, 2, this.length);
    this[offset] = (value >>> 8) & 0xff;
    this[offset + 1] = value & 0xff;
    return offset + 2;
  }

  writeUInt16LE(value: number, offset = 0): number {
    checkOffset(offset, 2, this.length);
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    return offset + 2;
  }

  writeUInt32BE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }

  writeUInt32LE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    this[offset + 2] = (value >>> 16) & 0xff;
    this[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  }

  writeInt8(value: number, offset = 0): number {
    checkOffset(offset, 1, this.length);
    if (value < 0) value = 0xff + value + 1;
    this[offset] = value & 0xff;
    return offset + 1;
  }

  writeInt16BE(value: number, offset = 0): number {
    checkOffset(offset, 2, this.length);
    this[offset] = (value >>> 8) & 0xff;
    this[offset + 1] = value & 0xff;
    return offset + 2;
  }

  writeInt16LE(value: number, offset = 0): number {
    checkOffset(offset, 2, this.length);
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    return offset + 2;
  }

  writeInt32BE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }

  writeInt32LE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    this[offset + 2] = (value >>> 16) & 0xff;
    this[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  }

  writeFloatBE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 4);
    view.setFloat32(0, value, false);
    return offset + 4;
  }

  writeFloatLE(value: number, offset = 0): number {
    checkOffset(offset, 4, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 4);
    view.setFloat32(0, value, true);
    return offset + 4;
  }

  writeDoubleBE(value: number, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setFloat64(0, value, false);
    return offset + 8;
  }

  writeDoubleLE(value: number, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setFloat64(0, value, true);
    return offset + 8;
  }

  writeBigInt64BE(value: bigint, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setBigInt64(0, value, false);
    return offset + 8;
  }

  writeBigInt64LE(value: bigint, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setBigInt64(0, value, true);
    return offset + 8;
  }

  writeBigUInt64BE(value: bigint, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setBigUint64(0, value, false);
    return offset + 8;
  }

  writeBigUInt64LE(value: bigint, offset = 0): number {
    checkOffset(offset, 8, this.length);
    const view = new DataView(this.buffer, this.byteOffset + offset, 8);
    view.setBigUint64(0, value, true);
    return offset + 8;
  }

  // ---- Swap methods ----

  swap16(): this {
    const len = this.length;
    if (len % 2 !== 0) throw new RangeError('Buffer size must be a multiple of 16-bits');
    for (let i = 0; i < len; i += 2) {
      const a = this[i];
      this[i] = this[i + 1];
      this[i + 1] = a;
    }
    return this;
  }

  swap32(): this {
    const len = this.length;
    if (len % 4 !== 0) throw new RangeError('Buffer size must be a multiple of 32-bits');
    for (let i = 0; i < len; i += 4) {
      const a = this[i]; const b = this[i + 1];
      this[i] = this[i + 3]; this[i + 1] = this[i + 2];
      this[i + 2] = b; this[i + 3] = a;
    }
    return this;
  }

  swap64(): this {
    const len = this.length;
    if (len % 8 !== 0) throw new RangeError('Buffer size must be a multiple of 64-bits');
    for (let i = 0; i < len; i += 8) {
      const a = this[i]; const b = this[i + 1]; const c = this[i + 2]; const d = this[i + 3];
      this[i] = this[i + 7]; this[i + 1] = this[i + 6]; this[i + 2] = this[i + 5]; this[i + 3] = this[i + 4];
      this[i + 4] = d; this[i + 5] = c; this[i + 6] = b; this[i + 7] = a;
    }
    return this;
  }
}

// Constants
export const kMaxLength = 2 ** 31 - 1;
export const kStringMaxLength = 2 ** 28 - 16;
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: kStringMaxLength };

/** @deprecated Use Buffer.alloc() instead */
export class SlowBuffer extends Buffer {
  constructor(size: number) {
    super(size);
  }
}
