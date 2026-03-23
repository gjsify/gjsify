// HMAC implementation for GJS using createHash (GLib.Checksum)
// GLib.Hmac bindings crash in GJS (segfault), so we implement HMAC manually.
// HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
// Reference: RFC 2104, Node.js lib/internal/crypto/hash.js

import { Transform } from 'stream';
import type { TransformCallback } from 'node:stream';
import { Buffer } from 'buffer';
import { normalizeEncoding as _normalizeEncoding } from '@gjsify/utils';
import { Hash } from './hash.js';

function normalizeEncoding(enc?: string): BufferEncoding {
  return _normalizeEncoding(enc) as BufferEncoding;
}

function normalizeAlgorithm(algorithm: string): string {
  return algorithm.toLowerCase().replace(/-/g, '');
}

// Hash block sizes per algorithm
const BLOCK_SIZES: Record<string, number> = {
  md5: 64,
  sha1: 64,
  sha256: 64,
  sha384: 128,
  sha512: 128,
};

const SUPPORTED_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);

/**
 * Creates and returns an Hmac object that uses the given algorithm and key.
 * Implemented using createHash (GLib.Checksum) since GLib.Hmac bindings are broken in GJS.
 */
export class Hmac extends Transform {
  private _algorithm: string;
  private _innerHash: Hash;
  private _outerKeyPad: Uint8Array;
  private _finalized = false;

  constructor(algorithm: string, key: string | Buffer | Uint8Array) {
    super();
    const normalized = normalizeAlgorithm(algorithm);
    if (!SUPPORTED_ALGORITHMS.has(normalized)) {
      const err = new Error(`Unknown message digest: ${algorithm}`);
      (err as any).code = 'ERR_CRYPTO_HASH_UNKNOWN';
      throw err;
    }
    this._algorithm = normalized;

    let keyBytes: Uint8Array;
    if (typeof key === 'string') {
      keyBytes = Buffer.from(key, 'utf8');
    } else {
      keyBytes = key instanceof Uint8Array ? key : Buffer.from(key);
    }

    const blockSize = BLOCK_SIZES[normalized];

    // If key is longer than block size, hash it first
    if (keyBytes.length > blockSize) {
      const h = new Hash(normalized);
      h.update(keyBytes);
      keyBytes = h.digest() as Buffer;
    }

    // Pad key to block size
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyBytes);

    // Compute inner and outer key pads
    const iKeyPad = new Uint8Array(blockSize);
    const oKeyPad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      iKeyPad[i] = paddedKey[i] ^ 0x36;
      oKeyPad[i] = paddedKey[i] ^ 0x5c;
    }

    this._outerKeyPad = oKeyPad;

    // Start inner hash: H(iKeyPad || message)
    this._innerHash = new Hash(normalized);
    this._innerHash.update(iKeyPad);
  }

  /** Update the HMAC with data. */
  update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
    if (this._finalized) {
      throw new Error('Digest already called');
    }

    let bytes: Uint8Array;
    if (typeof data === 'string') {
      const enc = normalizeEncoding(inputEncoding);
      bytes = Buffer.from(data, enc);
    } else {
      bytes = data instanceof Uint8Array ? data : Buffer.from(data);
    }

    this._innerHash.update(bytes);
    return this;
  }

  /** Calculate the HMAC digest. */
  digest(encoding?: BufferEncoding): Buffer | string {
    if (this._finalized) {
      throw new Error('Digest already called');
    }
    this._finalized = true;

    // Complete inner hash
    const innerDigest = this._innerHash.digest() as Buffer;

    // Compute outer hash: H(oKeyPad || innerDigest)
    const outerHash = new Hash(this._algorithm);
    outerHash.update(this._outerKeyPad);
    outerHash.update(innerDigest);

    const result = outerHash.digest() as Buffer;
    if (encoding) return result.toString(encoding);
    return result;
  }

  // Transform stream interface
  _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.update(chunk, encoding);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  _flush(callback: TransformCallback): void {
    try {
      this.push(this.digest());
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}
