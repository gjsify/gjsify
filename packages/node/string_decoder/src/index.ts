// Native string_decoder module for GJS — no Deno dependency
// Handles incremental decoding of multi-byte character sequences across chunk boundaries.

import { normalizeEncoding, checkEncoding } from '@gjsify/utils';

type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'latin1' | 'binary' | 'base64' | 'hex' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

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
      // Output remaining byte as replacement character
      result += '\ufffd';
      this._lastNeed = 0;
    } else if (this.encoding === 'base64' && this._lastNeed > 0) {
      // Encode remaining base64 bytes
      const remaining = this._lastChar.subarray(0, this._lastTotal - this._lastNeed);
      let binary = '';
      for (let i = 0; i < remaining.length; i++) {
        binary += String.fromCharCode(remaining[i]);
      }
      result += btoa(binary);
      this._lastNeed = 0;
    }

    return result;
  }

  private _writeUtf8(buf: Uint8Array): string {
    // Fast path: use TextDecoder with stream: true if supported
    if (this._decoder) {
      return this._decoder.decode(buf, { stream: true });
    }

    // Manual streaming UTF-8 decode for runtimes without stream support (e.g. GJS)
    let consumedFromBuf = 0;
    let completedChar: Uint8Array | null = null;

    // Step 1: Complete any leftover bytes from a previous write
    if (this._lastNeed > 0) {
      const needed = Math.min(this._lastNeed, buf.length);
      const offset = this._lastTotal - this._lastNeed;
      for (let j = 0; j < needed; j++) {
        this._lastChar[offset + j] = buf[j];
      }
      this._lastNeed -= needed;
      consumedFromBuf = needed;
      if (this._lastNeed > 0) return ''; // still incomplete
      // We completed the pending character
      completedChar = this._lastChar.subarray(0, this._lastTotal);
      this._lastTotal = 0;
    }

    // Step 2: Scan backward from end of buf to find any trailing incomplete character
    let completeEnd = buf.length;
    for (let j = 0; j < Math.min(4, buf.length - consumedFromBuf); j++) {
      const idx = buf.length - 1 - j;
      if (idx < consumedFromBuf) break;
      const byte = buf[idx];
      if ((byte & 0xc0) !== 0x80) {
        // This is either ASCII or a leading byte
        if (byte >= 0x80) {
          const charLen = utf8CharLength(byte);
          const available = buf.length - idx;
          if (available < charLen) {
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

    // Step 3: Decode
    const mainSlice = buf.subarray(consumedFromBuf, completeEnd);
    if (completedChar) {
      const combined = new Uint8Array(completedChar.length + mainSlice.length);
      combined.set(completedChar, 0);
      combined.set(mainSlice, completedChar.length);
      return new TextDecoder('utf-8', { fatal: false }).decode(combined);
    }
    if (mainSlice.length === 0) return '';
    return new TextDecoder('utf-8', { fatal: false }).decode(mainSlice);
  }

  private _writeUtf16le(buf: Uint8Array): string {
    let result = '';
    let i = 0;

    // Handle leftover byte from previous write
    if (this._lastNeed > 0) {
      this._lastChar[this._lastTotal - this._lastNeed] = buf[0];
      this._lastNeed--;
      if (this._lastNeed === 0) {
        result += String.fromCharCode(this._lastChar[0] | (this._lastChar[1] << 8));
        i = 1;
        this._lastTotal = 0;
      } else {
        return '';
      }
    }

    // Decode complete pairs
    for (; i + 1 < buf.length; i += 2) {
      result += String.fromCharCode(buf[i] | (buf[i + 1] << 8));
    }

    // Save leftover byte
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
      let binary = '';
      for (let i = 0; i < this._lastTotal; i++) {
        binary += String.fromCharCode(this._lastChar[i]);
      }
      result += btoa(binary);
      this._lastTotal = 0;
    }

    if (complete > 0) {
      let binary = '';
      for (let i = start; i < start + complete; i++) {
        binary += String.fromCharCode(buf[i]);
      }
      result += btoa(binary);
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
