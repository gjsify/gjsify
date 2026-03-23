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

// Check if TextDecoder supports the stream option
let _textDecoderSupportsStream = false;
try {
  new TextDecoder().decode(new Uint8Array(0), { stream: true });
  _textDecoderSupportsStream = true;
} catch {
  _textDecoderSupportsStream = false;
}

/** Returns the expected total byte length of a UTF-8 character given its first byte. */
function utf8CharLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1;
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1; // invalid leading byte, treat as single byte
}

/**
 * StringDecoder provides an interface for efficiently decoding Buffer data
 * into strings while preserving multi-byte characters that are split across
 * Buffer boundaries.
 */
export class StringDecoder {
  readonly encoding: string;
  private _decoder: TextDecoder | null = null;
  private _lastNeed = 0;
  private _lastTotal = 0;
  private _lastChar: Uint8Array;

  constructor(encoding?: string) {
    this.encoding = normalizeAndValidateEncoding(encoding);

    if (this.encoding === 'utf8') {
      if (_textDecoderSupportsStream) {
        this._decoder = new TextDecoder('utf-8', { fatal: false });
      }
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

    if (this.encoding === 'utf8' && this._decoder) {
      // Flush the TextDecoder
      result += this._decoder.decode(new Uint8Array(0), { stream: false });
      this._decoder = new TextDecoder('utf-8', { fatal: false });
    } else if (this.encoding === 'utf8' && this._lastNeed > 0) {
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
    // Fast path: use TextDecoder with stream: true if supported
    if (this._decoder) {
      return this._decoder.decode(buf, { stream: true });
    }

    // Manual streaming UTF-8 decode for runtimes without stream support (e.g. GJS)
    let i = 0;
    let result = '';

    // Step 1: If we have leftover bytes from a previous write, try to complete them
    if (this._lastNeed > 0) {
      while (i < buf.length && this._lastNeed > 0) {
        const byte = buf[i];
        if ((byte & 0xC0) === 0x80) {
          // Valid continuation byte
          const offset = this._lastTotal - this._lastNeed;
          this._lastChar[offset] = byte;
          this._lastNeed--;
          i++;
        } else {
          // Invalid continuation — emit replacement for incomplete sequence
          result += '\ufffd';
          this._lastNeed = 0;
          this._lastTotal = 0;
          // Don't advance i — reprocess this byte as a new character start
          break;
        }
      }

      if (this._lastNeed === 0 && this._lastTotal > 0) {
        // Completed the character — decode it
        result += new TextDecoder('utf-8', { fatal: false }).decode(
          this._lastChar.subarray(0, this._lastTotal));
        this._lastTotal = 0;
      }

      if (this._lastNeed > 0) {
        return result; // Still waiting for more bytes
      }
    }

    // Step 2: Find trailing incomplete character at end of remaining buffer
    let completeEnd = buf.length;
    // Scan backward from end to find any incomplete multi-byte char
    for (let j = 0; j < Math.min(4, buf.length - i); j++) {
      const idx = buf.length - 1 - j;
      if (idx < i) break;
      const byte = buf[idx];
      if ((byte & 0xC0) !== 0x80) {
        // Found a non-continuation byte (ASCII or leading byte)
        if (byte >= 0x80) {
          const charLen = utf8CharLength(byte);
          const available = buf.length - idx;
          if (available < charLen) {
            // Incomplete character at the end — save for next write
            completeEnd = idx;
            for (let k = 0; k < available; k++) {
              this._lastChar[k] = buf[idx + k];
            }
            this._lastNeed = charLen - available;
            this._lastTotal = charLen;
          }
        }
        break;
      }
    }

    // Step 3: Decode the complete portion using TextDecoder (handles invalid sequences)
    const mainSlice = buf.subarray(i, completeEnd);
    if (mainSlice.length > 0) {
      result += new TextDecoder('utf-8', { fatal: false }).decode(mainSlice);
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
