// Reference: Node.js lib/string_decoder.js
// Reimplemented for GJS — handles incremental decoding of multi-byte character sequences
// Uses function constructor (not ES6 class) for compatibility with legacy CJS patterns
// that call StringDecoder.call(this, enc) (e.g., iconv-lite).

import { normalizeEncoding, checkEncoding, base64Encode as bytesToBase64 } from '@gjsify/utils';

function normalizeAndValidateEncoding(enc?: string): string {
  if (enc) checkEncoding(enc);
  return normalizeEncoding(enc);
}

/**
 * Decode a complete (non-streaming) chunk of UTF-8 bytes into a string,
 * using the W3C "maximal subpart" replacement algorithm (Unicode 3.9 D93b).
 *
 * This avoids relying on TextDecoder which may produce incorrect replacement
 * counts on older SpiderMonkey versions (e.g., GJS 1.80 / SpiderMonkey 115).
 *
 * Valid UTF-8 byte ranges per position:
 *   1-byte: 00-7F
 *   2-byte: C2-DF, 80-BF
 *   3-byte: E0 A0-BF 80-BF | E1-EC 80-BF 80-BF | ED 80-9F 80-BF | EE-EF 80-BF 80-BF
 *   4-byte: F0 90-BF 80-BF 80-BF | F1-F3 80-BF 80-BF 80-BF | F4 80-8F 80-BF 80-BF
 */
function utf8DecodeMaximalSubpart(bytes: Uint8Array, start: number, end: number): string {
  let result = '';
  let i = start;

  while (i < end) {
    const b0 = bytes[i];

    // 1-byte (ASCII): 00-7F
    if (b0 <= 0x7F) {
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 2-byte: C2-DF, 80-BF
    if (b0 >= 0xC2 && b0 <= 0xDF) {
      if (i + 1 < end && bytes[i + 1] >= 0x80 && bytes[i + 1] <= 0xBF) {
        result += String.fromCharCode(((b0 & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
        i += 2;
      } else {
        // Maximal subpart: just b0
        result += '\ufffd';
        i++;
      }
      continue;
    }

    // 3-byte sequences
    if (b0 >= 0xE0 && b0 <= 0xEF) {
      // Determine valid range for second byte
      let lo2: number, hi2: number;
      if (b0 === 0xE0) { lo2 = 0xA0; hi2 = 0xBF; }
      else if (b0 === 0xED) { lo2 = 0x80; hi2 = 0x9F; }
      else { lo2 = 0x80; hi2 = 0xBF; }

      if (i + 1 >= end) {
        // Only lead byte available — maximal subpart is b0
        result += '\ufffd';
        i++;
        continue;
      }
      const b1 = bytes[i + 1];
      if (b1 < lo2 || b1 > hi2) {
        // Second byte out of range — maximal subpart is just b0
        result += '\ufffd';
        i++;
        continue;
      }
      if (i + 2 >= end) {
        // Two valid bytes but third missing — maximal subpart is b0 b1
        result += '\ufffd';
        i += 2;
        continue;
      }
      const b2 = bytes[i + 2];
      if (b2 < 0x80 || b2 > 0xBF) {
        // Third byte invalid — maximal subpart is b0 b1
        result += '\ufffd';
        i += 2;
        continue;
      }
      // Valid 3-byte sequence
      const cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F);
      result += String.fromCharCode(cp);
      i += 3;
      continue;
    }

    // 4-byte sequences
    if (b0 >= 0xF0 && b0 <= 0xF4) {
      // Determine valid range for second byte
      let lo2: number, hi2: number;
      if (b0 === 0xF0) { lo2 = 0x90; hi2 = 0xBF; }
      else if (b0 === 0xF4) { lo2 = 0x80; hi2 = 0x8F; }
      else { lo2 = 0x80; hi2 = 0xBF; }

      if (i + 1 >= end) {
        result += '\ufffd';
        i++;
        continue;
      }
      const b1 = bytes[i + 1];
      if (b1 < lo2 || b1 > hi2) {
        // Second byte out of range — maximal subpart is just b0
        result += '\ufffd';
        i++;
        continue;
      }
      if (i + 2 >= end) {
        // Two valid bytes but incomplete — maximal subpart is b0 b1
        result += '\ufffd';
        i += 2;
        continue;
      }
      const b2 = bytes[i + 2];
      if (b2 < 0x80 || b2 > 0xBF) {
        // Third byte invalid — maximal subpart is b0 b1
        result += '\ufffd';
        i += 2;
        continue;
      }
      if (i + 3 >= end) {
        // Three valid bytes but incomplete — maximal subpart is b0 b1 b2
        result += '\ufffd';
        i += 3;
        continue;
      }
      const b3 = bytes[i + 3];
      if (b3 < 0x80 || b3 > 0xBF) {
        // Fourth byte invalid — maximal subpart is b0 b1 b2
        result += '\ufffd';
        i += 3;
        continue;
      }
      // Valid 4-byte sequence — produces a surrogate pair
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
      // Encode as surrogate pair
      result += String.fromCharCode(
        0xD800 + ((cp - 0x10000) >> 10),
        0xDC00 + ((cp - 0x10000) & 0x3FF)
      );
      i += 4;
      continue;
    }

    // Invalid lead byte (80-BF = orphan continuation, C0-C1 = overlong, F5-FF = too high)
    result += '\ufffd';
    i++;
  }

  return result;
}

/**
 * Returns the expected total byte length of a UTF-8 character given its first byte,
 * and validates the lead byte is in a valid range.
 * Returns 0 for invalid lead bytes.
 */
function utf8CharLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1;
  if (byte >= 0xC2 && byte <= 0xDF) return 2;
  if (byte >= 0xE0 && byte <= 0xEF) return 3;
  if (byte >= 0xF0 && byte <= 0xF4) return 4;
  return 0; // invalid leading byte (C0-C1 overlong, F5+ too high, 80-BF continuation)
}

/**
 * Check if a continuation byte is valid for its position in a multi-byte sequence.
 * Returns true if the byte is in the expected range for that position.
 */
function isValidContinuation(leadByte: number, charLen: number, position: number, byte: number): boolean {
  if (position === 1) {
    // Second byte has restricted ranges for some lead bytes
    if (charLen === 3) {
      if (leadByte === 0xE0) return byte >= 0xA0 && byte <= 0xBF;
      if (leadByte === 0xED) return byte >= 0x80 && byte <= 0x9F;
      return byte >= 0x80 && byte <= 0xBF;
    }
    if (charLen === 4) {
      if (leadByte === 0xF0) return byte >= 0x90 && byte <= 0xBF;
      if (leadByte === 0xF4) return byte >= 0x80 && byte <= 0x8F;
      return byte >= 0x80 && byte <= 0xBF;
    }
  }
  // All other positions: standard continuation range
  return byte >= 0x80 && byte <= 0xBF;
}

interface StringDecoderInstance {
  readonly encoding: string;
  write(buf: Uint8Array): string;
  end(buf?: Uint8Array): string;
}

interface StringDecoderConstructor {
  new (encoding?: string): StringDecoderInstance;
  (this: StringDecoderInstance, encoding?: string): void;
  prototype: StringDecoderInstance;
}

/**
 * StringDecoder provides an interface for efficiently decoding Buffer data
 * into strings while preserving multi-byte characters that are split across
 * Buffer boundaries.
 *
 * Implemented as a function constructor (not ES6 class) for compatibility
 * with legacy CJS patterns that use StringDecoder.call(this, enc).
 */
const StringDecoder = function StringDecoder(this: any, encoding?: string) {
  this.encoding = normalizeAndValidateEncoding(encoding);
  this._lastNeed = 0;
  this._lastTotal = 0;
  this._lastLeadByte = 0;

  if (this.encoding === 'utf8') {
    this._lastChar = new Uint8Array(4);
  } else if (this.encoding === 'utf16le') {
    this._lastChar = new Uint8Array(4);
  } else if (this.encoding === 'base64') {
    this._lastChar = new Uint8Array(3);
  } else {
    this._lastChar = new Uint8Array(0);
  }
} as unknown as StringDecoderConstructor;

StringDecoder.prototype.write = function write(buf: Uint8Array): string {
  if (buf.length === 0) return '';

  switch (this.encoding) {
    case 'utf8':
      return writeUtf8(this, buf);
    case 'utf16le':
      return writeUtf16le(this, buf);
    case 'base64':
      return writeBase64(this, buf);
    case 'ascii':
      return decodeAscii(buf);
    case 'latin1':
      return decodeLatin1(buf);
    case 'hex':
      return decodeHex(buf);
    default:
      return decodeAscii(buf);
  }
};

StringDecoder.prototype.end = function end(buf?: Uint8Array): string {
  let result = '';
  if (buf && buf.length > 0) {
    result = this.write(buf);
  }

  if (this.encoding === 'utf8' && this._lastNeed > 0) {
    result += '\ufffd';
    this._lastNeed = 0;
    this._lastTotal = 0;
  } else if (this.encoding === 'utf16le' && this._lastNeed > 0) {
    const stored = this._lastTotal - this._lastNeed;
    for (let i = 0; i + 1 < stored; i += 2) {
      result += String.fromCharCode(this._lastChar[i] | (this._lastChar[i + 1] << 8));
    }
    this._lastNeed = 0;
    this._lastTotal = 0;
  } else if (this.encoding === 'base64' && this._lastNeed > 0) {
    const remaining = this._lastChar.subarray(0, this._lastTotal - this._lastNeed);
    result += bytesToBase64(remaining);
    this._lastNeed = 0;
    this._lastTotal = 0;
  }

  return result;
};

function writeUtf8(self: any, buf: Uint8Array): string {
  let i = 0;
  let result = '';

  if (self._lastNeed > 0) {
    while (i < buf.length && self._lastNeed > 0) {
      const byte = buf[i];
      const position = self._lastTotal - self._lastNeed;
      if (isValidContinuation(self._lastLeadByte, self._lastTotal, position, byte)) {
        self._lastChar[position] = byte;
        self._lastNeed--;
        i++;
      } else {
        result += '\ufffd';
        self._lastNeed = 0;
        self._lastTotal = 0;
        self._lastLeadByte = 0;
        break;
      }
    }

    if (self._lastNeed === 0 && self._lastTotal > 0) {
      result += utf8DecodeMaximalSubpart(self._lastChar, 0, self._lastTotal);
      self._lastTotal = 0;
      self._lastLeadByte = 0;
    }

    if (self._lastNeed > 0) {
      return result;
    }
  }

  let completeEnd = buf.length;
  for (let j = 0; j < Math.min(4, buf.length - i); j++) {
    const idx = buf.length - 1 - j;
    if (idx < i) break;
    const byte = buf[idx];
    if ((byte & 0xC0) !== 0x80) {
      const charLen = utf8CharLength(byte);
      if (charLen > 0 && byte >= 0x80) {
        const available = buf.length - idx;
        if (available < charLen) {
          let allValid = true;
          for (let k = 1; k < available; k++) {
            if (!isValidContinuation(byte, charLen, k, buf[idx + k])) {
              allValid = false;
              break;
            }
          }
          if (allValid) {
            completeEnd = idx;
            for (let k = 0; k < available; k++) {
              self._lastChar[k] = buf[idx + k];
            }
            self._lastNeed = charLen - available;
            self._lastTotal = charLen;
            self._lastLeadByte = byte;
          }
        }
      }
      break;
    }
  }

  if (completeEnd > i) {
    result += utf8DecodeMaximalSubpart(buf, i, completeEnd);
  }

  return result;
}

function writeUtf16le(self: any, buf: Uint8Array): string {
  let result = '';
  let i = 0;

  if (self._lastNeed > 0) {
    const offset = self._lastTotal - self._lastNeed;
    const needed = Math.min(self._lastNeed, buf.length);
    for (let j = 0; j < needed; j++) {
      self._lastChar[offset + j] = buf[j];
    }
    self._lastNeed -= needed;
    i = needed;

    if (self._lastNeed > 0) return '';

    const stored = self._lastTotal;
    let j = 0;
    while (j + 1 < stored) {
      const code = self._lastChar[j] | (self._lastChar[j + 1] << 8);
      j += 2;
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (j + 1 < stored) {
          const nextCode = self._lastChar[j] | (self._lastChar[j + 1] << 8);
          if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
            result += String.fromCharCode(code, nextCode);
            j += 2;
            continue;
          }
        }
        if (i + 1 < buf.length) {
          const nextCode = buf[i] | (buf[i + 1] << 8);
          if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
            result += String.fromCharCode(code, nextCode);
            i += 2;
            continue;
          }
        } else if (i >= buf.length) {
          self._lastChar[0] = self._lastChar[j - 2];
          self._lastChar[1] = self._lastChar[j - 1];
          self._lastNeed = 2;
          self._lastTotal = 4;
          return result;
        }
      }
      result += String.fromCharCode(code);
    }
    self._lastTotal = 0;
  }

  while (i + 1 < buf.length) {
    const code = buf[i] | (buf[i + 1] << 8);
    i += 2;

    if (code >= 0xD800 && code <= 0xDBFF) {
      if (i + 1 < buf.length) {
        const nextCode = buf[i] | (buf[i + 1] << 8);
        if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
          result += String.fromCharCode(code, nextCode);
          i += 2;
          continue;
        }
      } else if (i < buf.length) {
        result += String.fromCharCode(code);
        self._lastChar[0] = buf[i];
        self._lastNeed = 1;
        self._lastTotal = 2;
        return result;
      } else {
        self._lastChar[0] = buf[i - 2];
        self._lastChar[1] = buf[i - 1];
        self._lastNeed = 2;
        self._lastTotal = 4;
        return result;
      }
    }
    result += String.fromCharCode(code);
  }

  if (i < buf.length) {
    self._lastChar[0] = buf[i];
    self._lastNeed = 1;
    self._lastTotal = 2;
  }

  return result;
}

function writeBase64(self: any, buf: Uint8Array): string {
  let start = 0;

  if (self._lastNeed > 0) {
    const needed = Math.min(self._lastNeed, buf.length);
    for (let i = 0; i < needed; i++) {
      self._lastChar[self._lastTotal - self._lastNeed + i] = buf[i];
      self._lastNeed--;
    }
    start = needed;
    if (self._lastNeed > 0) return '';
  }

  const remaining = buf.length - start;
  const complete = remaining - (remaining % 3);
  let result = '';

  if (self._lastTotal > 0 && self._lastNeed === 0) {
    result += bytesToBase64(self._lastChar.subarray(0, self._lastTotal));
    self._lastTotal = 0;
  }

  if (complete > 0) {
    result += bytesToBase64(buf.subarray(start, start + complete));
  }

  const leftover = remaining - complete;
  if (leftover > 0) {
    for (let i = 0; i < leftover; i++) {
      self._lastChar[i] = buf[start + complete + i];
    }
    self._lastNeed = 3 - leftover;
    self._lastTotal = 3;
  }

  return result;
}

function decodeAscii(buf: Uint8Array): string {
  let result = '';
  for (let i = 0; i < buf.length; i++) {
    result += String.fromCharCode(buf[i] & 0x7f);
  }
  return result;
}

function decodeLatin1(buf: Uint8Array): string {
  let result = '';
  for (let i = 0; i < buf.length; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
}

function decodeHex(buf: Uint8Array): string {
  let result = '';
  for (let i = 0; i < buf.length; i++) {
    result += buf[i].toString(16).padStart(2, '0');
  }
  return result;
}

export { StringDecoder };

export default { StringDecoder };
