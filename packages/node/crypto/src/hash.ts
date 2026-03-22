// Hash class wrapping GLib.Checksum for GJS
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

function getChecksumType(algorithm: string): GLib.ChecksumType {
  const normalized = normalizeAlgorithm(algorithm);
  const type = CHECKSUM_TYPES[normalized];
  if (type === undefined) {
    const err = new Error(`Unknown message digest: ${algorithm}`);
    (err as any).code = 'ERR_CRYPTO_HASH_UNKNOWN';
    throw err;
  }
  return type;
}

/**
 * Creates and returns a Hash object that can be used to generate hash digests
 * using the given algorithm.
 */
export class Hash extends Transform {
  private _algorithm: string;
  private _checksum: GLib.Checksum;
  private _finalized = false;

  constructor(algorithm: string) {
    super();
    const normalized = normalizeAlgorithm(algorithm);
    const type = getChecksumType(normalized);
    this._algorithm = normalized;
    this._checksum = new GLib.Checksum(type);
  }

  /** Update the hash with data. */
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

    this._checksum.update(bytes);
    return this;
  }

  /** Calculate the digest of all data passed to update(). */
  digest(encoding?: BufferEncoding): Buffer | string {
    if (this._finalized) {
      throw new Error('Digest already called');
    }
    this._finalized = true;

    const hexStr = this._checksum.get_string();
    const buf = Buffer.from(hexStr, 'hex');
    if (encoding) return buf.toString(encoding);
    return buf;
  }

  /** Copy this hash to a new Hash object. */
  copy(): Hash {
    if (this._finalized) {
      throw new Error('Digest already called');
    }
    const copy = Object.create(Hash.prototype) as Hash;
    Transform.call(copy);
    copy._algorithm = this._algorithm;
    copy._finalized = false;
    copy._checksum = this._checksum.copy();
    return copy;
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

/** Get the list of supported hash algorithms. */
export function getHashes(): string[] {
  return ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];
}

/** Convenience: one-shot hash (Node 21+). */
export function hash(algorithm: string, data: string | Buffer | Uint8Array, encoding?: BufferEncoding): Buffer | string {
  return new Hash(algorithm).update(data).digest(encoding);
}
