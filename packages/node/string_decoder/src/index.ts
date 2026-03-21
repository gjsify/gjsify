// Native string_decoder module for GJS — no Deno dependency
// Handles incremental decoding of multi-byte character sequences across chunk boundaries.
// Uses TextDecoder with stream: true for UTF-8.

type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'latin1' | 'binary' | 'base64' | 'hex' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

function normalizeEncoding(enc?: string): string {
  if (!enc) return 'utf8';
  const lower = ('' + enc).toLowerCase().replace(/-/g, '');
  switch (lower) {
    case 'utf8': return 'utf8';
    case 'ascii': return 'ascii';
    case 'latin1': case 'binary': return 'latin1';
    case 'base64': return 'base64';
    case 'hex': return 'hex';
    case 'ucs2': case 'utf16le': return 'utf16le';
    default:
      throw new TypeError(`Unknown encoding: ${enc}`);
  }
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
    this.encoding = normalizeEncoding(encoding);

    if (this.encoding === 'utf8') {
      this._decoder = new TextDecoder('utf-8', { fatal: false });
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
    // Use TextDecoder with stream: true for incremental decoding
    if (this._decoder) {
      return this._decoder.decode(buf, { stream: true });
    }
    return new TextDecoder().decode(buf);
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
