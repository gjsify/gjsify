// Hmac class wrapping GLib.Hmac for GJS
// Reference: Node.js lib/internal/crypto/hash.js

import GLib from '@girs/glib-2.0';
import { Transform } from 'stream';
import type { TransformCallback } from 'node:stream';
import { Buffer } from 'buffer';
import { normalizeEncoding as _normalizeEncoding } from '@gjsify/utils';

function normalizeEncoding(enc?: string): BufferEncoding {
  return _normalizeEncoding(enc) as BufferEncoding;
}

const CHECKSUM_TYPES: Record<string, GLib.ChecksumType> = {
  md5: GLib.ChecksumType.MD5,
  sha1: GLib.ChecksumType.SHA1,
  sha256: GLib.ChecksumType.SHA256,
  sha384: GLib.ChecksumType.SHA384,
  sha512: GLib.ChecksumType.SHA512,
};

function normalizeAlgorithm(algorithm: string): string {
  return algorithm.toLowerCase().replace(/-/g, '');
}

/**
 * Creates and returns an Hmac object that uses the given algorithm and key.
 */
export class Hmac extends Transform {
  private _algorithm: string;
  private _hmac: GLib.Hmac;
  private _finalized = false;

  constructor(algorithm: string, key: string | Buffer | Uint8Array) {
    super();
    const normalized = normalizeAlgorithm(algorithm);
    const type = CHECKSUM_TYPES[normalized];
    if (type === undefined) {
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

    this._hmac = new GLib.Hmac(type, keyBytes);
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

    this._hmac.update(bytes);
    return this;
  }

  /** Calculate the HMAC digest. */
  digest(encoding?: BufferEncoding): Buffer | string {
    if (this._finalized) {
      throw new Error('Digest already called');
    }
    this._finalized = true;

    const hexStr = this._hmac.get_string();
    const buf = Buffer.from(hexStr, 'hex');
    if (encoding) return buf.toString(encoding);
    return buf;
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
