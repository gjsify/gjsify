// Reference: Node.js lib/string_decoder.js
// Reimplemented for GJS — handles incremental decoding of multi-byte character sequences

import { normalizeEncoding, checkEncoding } from '@gjsify/utils';

// Base64 encoding table
const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes to base64 string (replaces btoa which may not be available in GJS) */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += base64Chars[b0 >> 2];
    result += base64Chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? base64Chars[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? base64Chars[b2 & 0x3f] : '=';
  }
  return result;
}

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

/**
 * StringDecoder provides an interface for efficiently decoding Buffer data
 * into strings while preserving multi-byte characters that are split across
 * Buffer boundaries.
 */
export class StringDecoder {
  readonly encoding: string;
  private _lastNeed = 0;
  private _lastTotal = 0;
  private _lastChar: Uint8Array;
  // Store the lead byte when buffering incomplete UTF-8 sequences,
  // needed for validating continuation bytes per W3C maximal subpart rules
  private _lastLeadByte = 0;

  constructor(encoding?: string) {
    this.encoding = normalizeAndValidateEncoding(encoding);

    if (this.encoding === 'utf8') {
      this._lastChar = new Uint8Array(4); // max UTF-8 char size
    } else if (this.encoding === 'utf16le') {
      this._lastChar = new Uint8Array(4); // 2 bytes per char, but surrogate pairs need 4
    } else if (this.encoding === 'base64') {
      this._lastChar = new Uint8Array(3); // base64 encodes 3 bytes at a time
    } else {
      this._lastChar = new Uint8Array(0);
    }
  }

  /**
   * Write a Buffer or Uint8Array and return any complete characters as a string.
   */
  write(buf: Uint8Array): string {
    if (buf.length === 0) return '';

    switch (this.encoding) {
      case 'utf8':
        return this._writeUtf8(buf);
      case 'utf16le':
        return this._writeUtf16le(buf);
      case 'base64':
        return this._writeBase64(buf);
      case 'ascii':
        return this._decodeAscii(buf);
      case 'latin1':
        return this._decodeLatin1(buf);
      case 'hex':
        return this._decodeHex(buf);
      default:
        return this._decodeAscii(buf);
    }
  }

  /**
   * End decoding, returning any remaining incomplete characters.
   */
  end(buf?: Uint8Array): string {
    let result = '';
    if (buf && buf.length > 0) {
      result = this.write(buf);
    }

    if (this.encoding === 'utf8' && this._lastNeed > 0) {
      // Flush remaining incomplete bytes as replacement character
      result += '\ufffd';
      this._lastNeed = 0;
      this._lastTotal = 0;
    } else if (this.encoding === 'utf16le' && this._lastNeed > 0) {
      // Output any complete 16-bit chars from stored bytes
      const stored = this._lastTotal - this._lastNeed;
      for (let i = 0; i + 1 < stored; i += 2) {
        result += String.fromCharCode(this._lastChar[i] | (this._lastChar[i + 1] << 8));
      }
      this._lastNeed = 0;
      this._lastTotal = 0;
    } else if (this.encoding === 'base64' && this._lastNeed > 0) {
      // Encode remaining base64 bytes
      const remaining = this._lastChar.subarray(0, this._lastTotal - this._lastNeed);
      result += bytesToBase64(remaining);
      this._lastNeed = 0;
      this._lastTotal = 0;
    }

    return result;
  }

  private _writeUtf8(buf: Uint8Array): string {
    // Pure manual streaming UTF-8 decoder using W3C maximal subpart replacement.
    // Does NOT use TextDecoder to avoid inconsistencies across SpiderMonkey versions
    // (GJS 1.80 / SpiderMonkey 115 produces incorrect replacement counts for some sequences).
    let i = 0;
    let result = '';

    // Step 1: If we have leftover bytes from a previous write, try to complete them
    if (this._lastNeed > 0) {
      while (i < buf.length && this._lastNeed > 0) {
        const byte = buf[i];
        const position = this._lastTotal - this._lastNeed; // which byte position we're filling
        if (isValidContinuation(this._lastLeadByte, this._lastTotal, position, byte)) {
          this._lastChar[position] = byte;
          this._lastNeed--;
          i++;
        } else {
          // Invalid continuation — emit replacement for the buffered bytes
          // as one maximal subpart, then reprocess this byte
          result += '\ufffd';
          this._lastNeed = 0;
          this._lastTotal = 0;
          this._lastLeadByte = 0;
          // Don't advance i — reprocess this byte as a new character start
          break;
        }
      }

      if (this._lastNeed === 0 && this._lastTotal > 0) {
        // Completed the character — decode the buffered bytes
        result += utf8DecodeMaximalSubpart(this._lastChar, 0, this._lastTotal);
        this._lastTotal = 0;
        this._lastLeadByte = 0;
      }

      if (this._lastNeed > 0) {
        return result; // Still waiting for more bytes
      }
    }

    // Step 2: Find trailing incomplete character at end of remaining buffer.
    // We need to check if the last few bytes form a valid but incomplete
    // multi-byte sequence that should be buffered for the next write.
    let completeEnd = buf.length;
    // Scan backward from end to find any leading byte
    for (let j = 0; j < Math.min(4, buf.length - i); j++) {
      const idx = buf.length - 1 - j;
      if (idx < i) break;
      const byte = buf[idx];
      if ((byte & 0xC0) !== 0x80) {
        // Found a non-continuation byte (ASCII or leading byte)
        const charLen = utf8CharLength(byte);
        if (charLen > 0 && byte >= 0x80) {
          // It's a multi-byte lead byte — check if the sequence is incomplete
          const available = buf.length - idx;
          if (available < charLen) {
            // Check that all available continuation bytes are valid for this lead
            let allValid = true;
            for (let k = 1; k < available; k++) {
              if (!isValidContinuation(byte, charLen, k, buf[idx + k])) {
                allValid = false;
                break;
              }
            }
            if (allValid) {
              // Incomplete but valid-so-far sequence — save for next write
              completeEnd = idx;
              for (let k = 0; k < available; k++) {
                this._lastChar[k] = buf[idx + k];
              }
              this._lastNeed = charLen - available;
              this._lastTotal = charLen;
              this._lastLeadByte = byte;
            }
          }
        }
        break;
      }
    }

    // Step 3: Decode the complete portion using our manual W3C decoder
    if (completeEnd > i) {
      result += utf8DecodeMaximalSubpart(buf, i, completeEnd);
    }

    return result;
  }

  private _writeUtf16le(buf: Uint8Array): string {
    let result = '';
    let i = 0;

    // Handle leftover bytes from previous write
    if (this._lastNeed > 0) {
      const offset = this._lastTotal - this._lastNeed;
      const needed = Math.min(this._lastNeed, buf.length);
      for (let j = 0; j < needed; j++) {
        this._lastChar[offset + j] = buf[j];
      }
      this._lastNeed -= needed;
      i = needed;

      if (this._lastNeed > 0) return ''; // still incomplete

      // Completed stored bytes — decode them, handling surrogate pairs within stored data
      const stored = this._lastTotal;
      let j = 0;
      while (j + 1 < stored) {
        const code = this._lastChar[j] | (this._lastChar[j + 1] << 8);
        j += 2;
        if (code >= 0xD800 && code <= 0xDBFF) {
          // High surrogate — first check within stored bytes
          if (j + 1 < stored) {
            const nextCode = this._lastChar[j] | (this._lastChar[j + 1] << 8);
            if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
              result += String.fromCharCode(code, nextCode);
              j += 2;
              continue;
            }
          }
          // Then check in buf
          if (i + 1 < buf.length) {
            const nextCode = buf[i] | (buf[i + 1] << 8);
            if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
              result += String.fromCharCode(code, nextCode);
              i += 2;
              continue;
            }
          } else if (i >= buf.length) {
            // No more bytes — buffer the high surrogate for next write
            this._lastChar[0] = this._lastChar[j - 2];
            this._lastChar[1] = this._lastChar[j - 1];
            this._lastNeed = 2;
            this._lastTotal = 4;
            return result;
          }
        }
        result += String.fromCharCode(code);
      }
      this._lastTotal = 0;
    }

    // Decode complete pairs from buf, handling surrogates
    while (i + 1 < buf.length) {
      const code = buf[i] | (buf[i + 1] << 8);
      i += 2;

      if (code >= 0xD800 && code <= 0xDBFF) {
        // High surrogate — need low surrogate
        if (i + 1 < buf.length) {
          const nextCode = buf[i] | (buf[i + 1] << 8);
          if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
            result += String.fromCharCode(code, nextCode);
            i += 2;
            continue;
          }
        } else if (i < buf.length) {
          // 1 odd byte left — can't form low surrogate, output high surrogate and save odd byte
          result += String.fromCharCode(code);
          this._lastChar[0] = buf[i];
          this._lastNeed = 1;
          this._lastTotal = 2;
          return result;
        } else {
          // No more bytes — buffer the high surrogate
          this._lastChar[0] = buf[i - 2];
          this._lastChar[1] = buf[i - 1];
          this._lastNeed = 2;
          this._lastTotal = 4;
          return result;
        }
      }
      result += String.fromCharCode(code);
    }

    // Save leftover odd byte
    if (i < buf.length) {
      this._lastChar[0] = buf[i];
      this._lastNeed = 1;
      this._lastTotal = 2;
    }

    return result;
  }

  private _writeBase64(buf: Uint8Array): string {
    let start = 0;

    // Handle leftover bytes from previous write
    if (this._lastNeed > 0) {
      const needed = Math.min(this._lastNeed, buf.length);
      for (let i = 0; i < needed; i++) {
        this._lastChar[this._lastTotal - this._lastNeed + i] = buf[i];
        this._lastNeed--;
      }
      start = needed;
      if (this._lastNeed > 0) return '';
    }

    // Process complete 3-byte groups
    const remaining = buf.length - start;
    const complete = remaining - (remaining % 3);
    let result = '';

    if (this._lastTotal > 0 && this._lastNeed === 0) {
      result += bytesToBase64(this._lastChar.subarray(0, this._lastTotal));
      this._lastTotal = 0;
    }

    if (complete > 0) {
      result += bytesToBase64(buf.subarray(start, start + complete));
    }

    // Save remaining bytes (0, 1, or 2)
    const leftover = remaining - complete;
    if (leftover > 0) {
      for (let i = 0; i < leftover; i++) {
        this._lastChar[i] = buf[start + complete + i];
      }
      this._lastNeed = 3 - leftover;
      this._lastTotal = 3;
    }

    return result;
  }

  private _decodeAscii(buf: Uint8Array): string {
    let result = '';
    for (let i = 0; i < buf.length; i++) {
      result += String.fromCharCode(buf[i] & 0x7f);
    }
    return result;
  }

  private _decodeLatin1(buf: Uint8Array): string {
    let result = '';
    for (let i = 0; i < buf.length; i++) {
      result += String.fromCharCode(buf[i]);
    }
    return result;
  }

  private _decodeHex(buf: Uint8Array): string {
    let result = '';
    for (let i = 0; i < buf.length; i++) {
      result += buf[i].toString(16).padStart(2, '0');
    }
    return result;
  }
}

export default { StringDecoder };
