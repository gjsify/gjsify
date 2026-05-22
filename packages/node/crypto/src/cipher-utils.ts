// Encoding + algorithm + PKCS#7 padding helpers shared by Cipher /
// Decipher / GCM authenticated-encryption code in cipher.ts.
//
// Originally inlined in cipher.ts pre-split. Extracted because (a) they
// are runtime-cheap pure functions, (b) the `AlgorithmInfo` type is
// referenced by every cipher mode plus the GCM auth-tag flow, and (c)
// `incompleteUtf8Tail` is the kind of helper that is easy to need from
// other crypto code (HMAC streaming, hash-incremental update buffers).

import { Buffer } from 'node:buffer';

// ─── Algorithm parsing ───────────────────────────────────────────────────

export interface AlgorithmInfo {
  keySize: number; // bytes
  ivSize: number;  // bytes
  mode: 'cbc' | 'ctr' | 'ecb' | 'cfb' | 'ofb' | 'gcm';
}

export function parseAlgorithm(algorithm: string): AlgorithmInfo {
  const lower = algorithm.toLowerCase();
  const match = lower.match(/^aes-(128|192|256)-(cbc|ctr|ecb|cfb|ofb|gcm)$/);
  if (!match) {
    throw new Error(`Unsupported cipher algorithm: ${algorithm}`);
  }
  const keyBits = parseInt(match[1]);
  const mode = match[2] as AlgorithmInfo['mode'];
  return {
    keySize: keyBits / 8,
    ivSize: mode === 'ecb' ? 0 : (mode === 'gcm' ? 12 : 16),
    mode,
  };
}

// ─── Encoding helpers ────────────────────────────────────────────────────

export function toBuffer(data: string | Buffer | Uint8Array, encoding?: string): Buffer {
  if (typeof data === 'string') {
    return Buffer.from(data, (encoding || 'utf8') as BufferEncoding);
  }
  return Buffer.from(data);
}

export function encodeOutput(data: Uint8Array, encoding?: string): string | Buffer {
  if (!encoding) return Buffer.from(data);
  return Buffer.from(data).toString(encoding as BufferEncoding);
}

/**
 * Count how many trailing bytes at the end of a Uint8Array form an incomplete
 * UTF-8 multibyte sequence. Returns 0 if the last character is complete.
 */
export function incompleteUtf8Tail(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  // Walk backwards from the end to find the lead byte of the last character
  const end = buf.length;
  for (let back = 1; back <= Math.min(4, end); back++) {
    const b = buf[end - back];
    if ((b & 0x80) === 0) {
      // ASCII byte — this is a complete 1-byte character
      return 0;
    }
    if ((b & 0xC0) === 0x80) {
      // Continuation byte — keep searching backwards for the lead byte
      continue;
    }
    // This is a lead byte — determine expected sequence length
    let expected: number;
    if ((b & 0xE0) === 0xC0) expected = 2;
    else if ((b & 0xF0) === 0xE0) expected = 3;
    else if ((b & 0xF8) === 0xF0) expected = 4;
    else return 0; // Invalid lead byte
    // `back` is how many bytes we have from the lead to the end
    return back < expected ? back : 0;
  }
  return 0;
}

// ─── PKCS#7 Padding ──────────────────────────────────────────────────────

export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen;
  return padded;
}

export function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error('bad decrypt');
  }
  const padLen = data[data.length - 1];
  if (padLen === 0 || padLen > 16) {
    throw new Error('bad decrypt');
  }
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error('bad decrypt');
  }
  return new Uint8Array(data.slice(0, data.length - padLen));
}
