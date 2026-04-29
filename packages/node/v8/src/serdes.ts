// Reference: Node.js lib/v8.js (Serializer/Deserializer/DefaultSerializer/DefaultDeserializer)
// Reimplemented for GJS — V8 wire format v15 in pure TypeScript

import { Buffer } from 'node:buffer';

const WIRE_VERSION = 15;

// Tag bytes matching V8 ValueSerializer::Tag enum
const kVersion         = 0xFF;
const kUndefined       = 0x5F;  // '_'
const kNull            = 0x30;  // '0'
const kTrue            = 0x54;  // 'T'
const kFalse           = 0x46;  // 'F'
const kInt32           = 0x49;  // 'I' — ZigZag varint
const kUint32          = 0x55;  // 'U' — varint
const kDouble          = 0x4E;  // 'N' — 8 bytes LE
const kBigInt          = 0x5A;  // 'Z'
const kOneByteString   = 0x22;  // '"' — Latin1, varint len + bytes
const kUtf8String      = 0x63;  // 'c' — UTF-8, varint len + bytes
const kDate            = 0x44;  // 'D' — float64 ms
const kRegExp          = 0x52;  // 'R'
const kBeginJSObject   = 0x6F;  // 'o'
const kEndJSObject     = 0x7B;  // '{' + varint property count
const kBeginDenseArray = 0x41;  // 'A'
const kEndDenseArray   = 0x24;  // '$' + varint spare + varint length
const kArrayBuffer     = 0x42;  // 'B'
const kObjectReference = 0x5E;  // '^' — backref, varint index
const kHostObject      = 0x5C;  // '\' — host object (TypedArray/DataView/Buffer)

// ─── varint helpers ───────────────────────────────────────────────────────────

function writeVarint(buf: number[], n: number): void {
  n = n >>> 0;
  while (n >= 0x80) {
    buf.push((n & 0x7F) | 0x80);
    n >>>= 7;
  }
  buf.push(n);
}

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0, byte: number;
  do {
    if (pos >= buf.length) throw new Error('Unexpected end of buffer reading varint');
    byte = buf[pos++];
    result |= (byte & 0x7F) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, pos];
}

function zigZagEncode(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

function zigZagDecode(n: number): number {
  return (n & 1) ? -(n >>> 1) - 1 : n >>> 1;
}

function writeFloat64(buf: number[], d: number): void {
  const tmp = new DataView(new ArrayBuffer(8));
  tmp.setFloat64(0, d, true /* LE */);
  for (let i = 0; i < 8; i++) buf.push(tmp.getUint8(i));
}

function readFloat64(buf: Buffer, pos: number): [number, number] {
  if (pos + 8 > buf.length) throw new Error('ReadDouble() failed');
  const view = new DataView(buf.buffer, buf.byteOffset + pos, 8);
  return [view.getFloat64(0, true), pos + 8];
}

function isOneByte(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xFF) return false;
  }
  return true;
}

// ─── TypedArray type index (matching Node.js DefaultSerializer) ───────────────

function typedArrayToIndex(abView: NodeJS.ArrayBufferView): number {
  const tag = Object.prototype.toString.call(abView);
  if (tag === '[object Int8Array]')         return 0;
  if (tag === '[object Uint8Array]')        return 1;
  if (tag === '[object Uint8ClampedArray]') return 2;
  if (tag === '[object Int16Array]')        return 3;
  if (tag === '[object Uint16Array]')       return 4;
  if (tag === '[object Int32Array]')        return 5;
  if (tag === '[object Uint32Array]')       return 6;
  if (tag === '[object Float32Array]')      return 7;
  if (tag === '[object Float64Array]')      return 8;
  if (tag === '[object DataView]')          return 9;
  // index 10 = Buffer (FastBuffer)
  if (tag === '[object BigInt64Array]')     return 11;
  if (tag === '[object BigUint64Array]')    return 12;
  return -1;
}

type TypedArrayCtor = new (buffer: ArrayBuffer, byteOffset: number, length: number) => NodeJS.ArrayBufferView;

function indexToTypedArray(index: number): TypedArrayCtor | undefined {
  switch (index) {
    case 0:  return Int8Array as unknown as TypedArrayCtor;
    case 1:  return Uint8Array as unknown as TypedArrayCtor;
    case 2:  return Uint8ClampedArray as unknown as TypedArrayCtor;
    case 3:  return Int16Array as unknown as TypedArrayCtor;
    case 4:  return Uint16Array as unknown as TypedArrayCtor;
    case 5:  return Int32Array as unknown as TypedArrayCtor;
    case 6:  return Uint32Array as unknown as TypedArrayCtor;
    case 7:  return Float32Array as unknown as TypedArrayCtor;
    case 8:  return Float64Array as unknown as TypedArrayCtor;
    case 9:  return DataView as unknown as TypedArrayCtor;
    case 10: return Buffer as unknown as TypedArrayCtor;
    case 11: return BigInt64Array as unknown as TypedArrayCtor;
    case 12: return BigUint64Array as unknown as TypedArrayCtor;
  }
  return undefined;
}

// ─── Serializer ───────────────────────────────────────────────────────────────

export class Serializer {
  protected _bytes: number[] = [];
  protected _seen: object[] = [];
  protected _treatAbvAsHostObjects = false;
  _getDataCloneError: ErrorConstructor = Error;

  writeHeader(): void {
    this._bytes.push(kVersion);
    writeVarint(this._bytes, WIRE_VERSION);
  }

  writeValue(value: unknown): void {
    // Check backref for objects/arrays/TypedArrays
    if (value !== null && value !== undefined && typeof value === 'object') {
      const idx = this._seen.indexOf(value as object);
      if (idx !== -1) {
        this._bytes.push(kObjectReference);
        writeVarint(this._bytes, idx);
        return;
      }
    }

    if (value === undefined) {
      this._bytes.push(kUndefined);
    } else if (value === null) {
      this._bytes.push(kNull);
    } else if (value === true) {
      this._bytes.push(kTrue);
    } else if (value === false) {
      this._bytes.push(kFalse);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= -(2 ** 31) && value <= 2 ** 32 - 1) {
        if (value >= 0) {
          this._bytes.push(kUint32);
          writeVarint(this._bytes, value);
        } else {
          this._bytes.push(kInt32);
          writeVarint(this._bytes, zigZagEncode(value));
        }
      } else {
        this._bytes.push(kDouble);
        writeFloat64(this._bytes, value);
      }
    } else if (typeof value === 'bigint') {
      this._writeBigInt(value);
    } else if (typeof value === 'string') {
      this._writeString(value);
    } else if (typeof value === 'object') {
      const obj = value as object;

      if (value instanceof Date) {
        this._seen.push(obj);
        this._bytes.push(kDate);
        writeFloat64(this._bytes, (value as Date).getTime());

      } else if (value instanceof RegExp) {
        this._seen.push(obj);
        this._bytes.push(kRegExp);
        this._writeString((value as RegExp).source);
        writeVarint(this._bytes, regExpFlagsToInt(value as RegExp));

      } else if (value instanceof ArrayBuffer) {
        this._seen.push(obj);
        const bytes = new Uint8Array(value as ArrayBuffer);
        this._bytes.push(kArrayBuffer);
        writeVarint(this._bytes, bytes.length);
        for (let i = 0; i < bytes.length; i++) this._bytes.push(bytes[i]);

      } else if (this._treatAbvAsHostObjects &&
                 (ArrayBuffer.isView(value) || Buffer.isBuffer(value))) {
        this._seen.push(obj);
        this._bytes.push(kHostObject);
        this._writeHostObject(obj as NodeJS.ArrayBufferView);

      } else if (Array.isArray(value)) {
        this._seen.push(obj);
        const arr = value as unknown[];
        this._bytes.push(kBeginDenseArray);
        writeVarint(this._bytes, arr.length);
        for (let i = 0; i < arr.length; i++) this.writeValue(arr[i]);
        this._bytes.push(kEndDenseArray);
        writeVarint(this._bytes, 0); // spare properties count
        writeVarint(this._bytes, arr.length);

      } else {
        this._seen.push(obj);
        this._bytes.push(kBeginJSObject);
        const keys = Object.keys(obj);
        for (const key of keys) {
          this._writeString(key);
          this.writeValue((obj as Record<string, unknown>)[key]);
        }
        this._bytes.push(kEndJSObject);
        writeVarint(this._bytes, keys.length);
      }
    } else {
      throw new (this._getDataCloneError)(
        `${String(value)} could not be cloned.`
      );
    }
  }

  releaseBuffer(): Buffer {
    const result = Buffer.from(this._bytes);
    this._bytes = [];
    this._seen = [];
    return result;
  }

  writeUint32(n: number): void {
    writeVarint(this._bytes, n >>> 0);
  }

  writeUint64(hi: number, lo: number): void {
    writeVarint(this._bytes, hi >>> 0);
    writeVarint(this._bytes, lo >>> 0);
  }

  writeDouble(d: number): void {
    writeFloat64(this._bytes, d);
  }

  writeRawBytes(source: NodeJS.ArrayBufferView): void {
    if (!ArrayBuffer.isView(source)) {
      throw new TypeError('source must be a TypedArray or a DataView');
    }
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    for (let i = 0; i < bytes.length; i++) this._bytes.push(bytes[i]);
  }

  _writeHostObject(_obj: object): void {
    throw new (this._getDataCloneError)(
      `Unserializable host object: ${Object.prototype.toString.call(_obj)}`
    );
  }

  _setTreatArrayBufferViewsAsHostObjects(flag: boolean): void {
    this._treatAbvAsHostObjects = flag;
  }

  private _writeString(s: string): void {
    if (isOneByte(s)) {
      this._bytes.push(kOneByteString);
      writeVarint(this._bytes, s.length);
      for (let i = 0; i < s.length; i++) this._bytes.push(s.charCodeAt(i) & 0xFF);
    } else {
      const encoded = new TextEncoder().encode(s);
      this._bytes.push(kUtf8String);
      writeVarint(this._bytes, encoded.length);
      for (let i = 0; i < encoded.length; i++) this._bytes.push(encoded[i]);
    }
  }

  private _writeBigInt(n: bigint): void {
    this._bytes.push(kBigInt);
    const negative = n < 0n;
    const abs = negative ? -n : n;
    // Encode as little-endian 64-bit words
    const words: number[] = [];
    let remaining = abs;
    while (remaining > 0n) {
      words.push(Number(remaining & 0xFFFFFFFFn));
      words.push(Number((remaining >> 32n) & 0xFFFFFFFFn));
      remaining >>= 64n;
    }
    // bitfield: bits 0 = negative, bits 1+ = word count (as pairs of u32)
    const wordCount = words.length; // already in u32s
    const bitfield = ((wordCount) << 1) | (negative ? 1 : 0);
    writeVarint(this._bytes, bitfield);
    for (const w of words) {
      // write as 4 bytes LE
      this._bytes.push(w & 0xFF);
      this._bytes.push((w >> 8) & 0xFF);
      this._bytes.push((w >> 16) & 0xFF);
      this._bytes.push((w >> 24) & 0xFF);
    }
    if (words.length === 0) {
      // Zero bigint — bitfield already encodes 0 words
    }
  }
}

// ─── Deserializer ─────────────────────────────────────────────────────────────

export class Deserializer {
  protected _pos = 0;
  protected _wireVersion = 0;
  protected _seen: unknown[] = [];
  readonly buffer: Buffer;

  constructor(buffer: NodeJS.ArrayBufferView | ArrayBuffer) {
    if (!ArrayBuffer.isView(buffer) && !(buffer instanceof ArrayBuffer)) {
      throw new TypeError('buffer must be a TypedArray or a DataView');
    }
    if (buffer instanceof ArrayBuffer) {
      this.buffer = Buffer.from(buffer);
    } else {
      this.buffer = Buffer.from(
        (buffer as NodeJS.ArrayBufferView).buffer,
        (buffer as NodeJS.ArrayBufferView).byteOffset,
        (buffer as NodeJS.ArrayBufferView).byteLength,
      );
    }
  }

  readHeader(): boolean {
    if (this.buffer[this._pos] !== kVersion) {
      throw new Error('ReadHeader() failed');
    }
    this._pos++;
    const [ver, pos] = readVarint(this.buffer, this._pos);
    this._wireVersion = ver;
    this._pos = pos;
    return true;
  }

  getWireFormatVersion(): number {
    return this._wireVersion;
  }

  readValue(): unknown {
    if (this._pos >= this.buffer.length) {
      throw new Error('Unexpected end of buffer');
    }
    const tag = this.buffer[this._pos++];

    switch (tag) {
      case kUndefined: return undefined;
      case kNull:      return null;
      case kTrue:      return true;
      case kFalse:     return false;

      case kInt32: {
        const [n, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        return zigZagDecode(n);
      }

      case kUint32: {
        const [n, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        return n >>> 0;
      }

      case kDouble: {
        const [d, p] = readFloat64(this.buffer, this._pos);
        this._pos = p;
        return d;
      }

      case kBigInt: {
        return this._readBigInt();
      }

      case kOneByteString: {
        const [len, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(this.buffer[this._pos++]);
        return s;
      }

      case kUtf8String: {
        const [len, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        const bytes = this.buffer.slice(this._pos, this._pos + len);
        this._pos += len;
        return new TextDecoder().decode(bytes);
      }

      case kDate: {
        const [ms, p] = readFloat64(this.buffer, this._pos);
        this._pos = p;
        const d = new Date(ms);
        this._seen.push(d);
        return d;
      }

      case kRegExp: {
        const source = this.readValue() as string;
        const [flagBits, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        const flags = intToRegExpFlags(flagBits);
        const re = new RegExp(source, flags);
        this._seen.push(re);
        return re;
      }

      case kArrayBuffer: {
        const [byteLen, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        const ab = new ArrayBuffer(byteLen);
        const view = new Uint8Array(ab);
        for (let i = 0; i < byteLen; i++) view[i] = this.buffer[this._pos++];
        this._seen.push(ab);
        return ab;
      }

      case kObjectReference: {
        const [idx, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        if (idx >= this._seen.length) throw new Error('Invalid object reference');
        return this._seen[idx];
      }

      case kBeginDenseArray: {
        const [len, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        const arr: unknown[] = new Array(len);
        this._seen.push(arr);
        for (let i = 0; i < len; i++) arr[i] = this.readValue();
        // read kEndDenseArray tag
        if (this.buffer[this._pos] !== kEndDenseArray) throw new Error('Expected kEndDenseArray');
        this._pos++;
        // spare properties count (varint)
        const [, p2] = readVarint(this.buffer, this._pos);
        this._pos = p2;
        // length (varint, should match)
        const [, p3] = readVarint(this.buffer, this._pos);
        this._pos = p3;
        return arr;
      }

      case kBeginJSObject: {
        const obj: Record<string, unknown> = {};
        this._seen.push(obj);
        while (this.buffer[this._pos] !== kEndJSObject) {
          const key = this.readValue() as string;
          obj[key] = this.readValue();
        }
        this._pos++; // consume kEndJSObject
        // property count varint
        const [, p] = readVarint(this.buffer, this._pos);
        this._pos = p;
        return obj;
      }

      case kHostObject: {
        const obj = this._readHostObject();
        if (obj !== null && obj !== undefined) this._seen.push(obj);
        return obj;
      }

      default:
        throw new Error(`Unknown tag 0x${tag.toString(16).padStart(2, '0')} at position ${this._pos - 1}`);
    }
  }

  readUint32(): number {
    const [n, p] = readVarint(this.buffer, this._pos);
    this._pos = p;
    return n >>> 0;
  }

  readUint64(): [number, number] {
    const [hi, p1] = readVarint(this.buffer, this._pos);
    const [lo, p2] = readVarint(this.buffer, p1);
    this._pos = p2;
    return [hi >>> 0, lo >>> 0];
  }

  readDouble(): number {
    const [d, p] = readFloat64(this.buffer, this._pos);
    this._pos = p;
    return d;
  }

  // Returns the byte offset within this.buffer where the raw bytes start.
  // Callers use: new FastBuffer(this.buffer.buffer, this.buffer.byteOffset + offset, length)
  _readRawBytes(length: number): number {
    const offset = this._pos;
    this._pos += length;
    if (this._pos > this.buffer.length) throw new Error('Unexpected end of buffer reading raw bytes');
    return offset;
  }

  // readRawBytes is patched on the prototype below (as in Node.js) to return a Buffer slice
  readRawBytes(length: number): Buffer {
    const offset = this._readRawBytes(length);
    return Buffer.from(this.buffer.buffer, this.buffer.byteOffset + offset, length);
  }

  _readHostObject(): unknown {
    throw new Error('No host object deserializer installed');
  }

  private _readBigInt(): bigint {
    const [bitfield, p] = readVarint(this.buffer, this._pos);
    this._pos = p;
    const negative = (bitfield & 1) === 1;
    const u32Count = (bitfield >> 1);
    let result = 0n;
    for (let i = 0; i < u32Count; i++) {
      const lo = this.buffer[this._pos] |
        (this.buffer[this._pos + 1] << 8) |
        (this.buffer[this._pos + 2] << 16) |
        (this.buffer[this._pos + 3] << 24);
      this._pos += 4;
      result |= BigInt(lo >>> 0) << BigInt(i * 32);
    }
    return negative ? -result : result;
  }
}

// ─── RegExp flags encoding ────────────────────────────────────────────────────

// Matches V8's RegExpFlags enum bit layout
function regExpFlagsToInt(re: RegExp): number {
  let flags = 0;
  if (re.global)      flags |= 1 << 0;
  if (re.ignoreCase)  flags |= 1 << 1;
  if (re.multiline)   flags |= 1 << 2;
  if (re.sticky)      flags |= 1 << 3;
  if (re.unicode)     flags |= 1 << 4;
  if (re.dotAll)      flags |= 1 << 5;
  if (re.hasIndices)  flags |= 1 << 6;
  if (re.unicodeSets) flags |= 1 << 7;
  return flags;
}

function intToRegExpFlags(bits: number): string {
  let flags = '';
  if (bits & (1 << 0)) flags += 'g';
  if (bits & (1 << 1)) flags += 'i';
  if (bits & (1 << 2)) flags += 'm';
  if (bits & (1 << 3)) flags += 'y';
  if (bits & (1 << 4)) flags += 'u';
  if (bits & (1 << 5)) flags += 's';
  if (bits & (1 << 6)) flags += 'd';
  if (bits & (1 << 7)) flags += 'v';
  return flags;
}

// ─── DefaultSerializer / DefaultDeserializer ─────────────────────────────────

export class DefaultSerializer extends Serializer {
  constructor() {
    super();
    this._setTreatArrayBufferViewsAsHostObjects(true);
  }

  override _writeHostObject(abView: NodeJS.ArrayBufferView): void {
    let typeIndex: number;
    if (Buffer.isBuffer(abView)) {
      typeIndex = 10; // FastBuffer / Buffer
    } else {
      typeIndex = typedArrayToIndex(abView);
      if (typeIndex === -1) {
        throw new (this._getDataCloneError)(
          `Unserializable host object: ${Object.prototype.toString.call(abView)}`
        );
      }
    }
    this.writeUint32(typeIndex);
    this.writeUint32(abView.byteLength);
    this.writeRawBytes(new Uint8Array(abView.buffer, abView.byteOffset, abView.byteLength));
  }
}

export class DefaultDeserializer extends Deserializer {
  override _readHostObject(): NodeJS.ArrayBufferView {
    const typeIndex = this.readUint32();
    const byteLength = this.readUint32();
    const byteOffset = this._readRawBytes(byteLength);

    if (typeIndex === 10) {
      // Buffer
      const b = Buffer.allocUnsafe(byteLength);
      this.buffer.copy(b, 0, this.buffer.byteOffset + byteOffset, this.buffer.byteOffset + byteOffset + byteLength);
      return b;
    }

    const Ctor = indexToTypedArray(typeIndex);
    if (!Ctor) throw new Error(`Unknown TypedArray type index ${typeIndex}`);

    const bytesPerElement = (Ctor as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const elementCount = byteLength / bytesPerElement;
    const absoluteOffset = this.buffer.byteOffset + byteOffset;

    if (absoluteOffset % bytesPerElement === 0) {
      return new Ctor(this.buffer.buffer as ArrayBuffer, absoluteOffset, elementCount);
    }
    // Unaligned — copy to aligned buffer
    const copy = Buffer.allocUnsafe(byteLength);
    this.buffer.copy(copy, 0, this.buffer.byteOffset + byteOffset, this.buffer.byteOffset + byteOffset + byteLength);
    return new Ctor(copy.buffer as ArrayBuffer, copy.byteOffset, elementCount);
  }
}
