// PBKDF2 key derivation using GLib.Hmac
// Reference: Node.js lib/internal/crypto/pbkdf2.js, RFC 2898

import GLib from '@girs/glib-2.0';
import { Buffer } from 'buffer';

const CHECKSUM_TYPES: Record<string, GLib.ChecksumType> = {
  md5: GLib.ChecksumType.MD5,
  sha1: GLib.ChecksumType.SHA1,
  sha256: GLib.ChecksumType.SHA256,
  sha384: GLib.ChecksumType.SHA384,
  sha512: GLib.ChecksumType.SHA512,
};

const DIGEST_SIZES: Record<string, number> = {
  md5: 16,
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64,
};

function normalizeAlgorithm(algorithm: string): string {
  return algorithm.toLowerCase().replace(/-/g, '');
}

function hmacDigest(type: GLib.ChecksumType, key: Uint8Array, data: Uint8Array): Buffer {
  const hmac = new GLib.Hmac(type, key);
  hmac.update(data);
  return Buffer.from(hmac.get_string(), 'hex');
}

function validateParameters(iterations: number, keylen: number): void {
  if (typeof iterations !== 'number' || iterations < 0 || !Number.isFinite(iterations)) {
    throw new TypeError('iterations must be a positive number');
  }
  if (iterations === 0) {
    throw new TypeError('iterations must be a positive number');
  }
  if (typeof keylen !== 'number' || keylen < 0 || !Number.isFinite(keylen) || keylen > 2147483647) {
    throw new TypeError('keylen must be a positive number');
  }
}

function toBuffer(input: string | Buffer | Uint8Array | DataView, encoding?: string): Buffer {
  if (typeof input === 'string') {
    return Buffer.from(input, (encoding as BufferEncoding) || 'utf8');
  }
  if (input instanceof DataView) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input);
}

/**
 * Synchronous PBKDF2 key derivation.
 */
export function pbkdf2Sync(
  password: string | Buffer | Uint8Array | DataView,
  salt: string | Buffer | Uint8Array | DataView,
  iterations: number,
  keylen: number,
  digest?: string
): Buffer {
  validateParameters(iterations, keylen);

  const passwordBuf = toBuffer(password);
  const saltBuf = toBuffer(salt);
  const algo = normalizeAlgorithm(digest || 'sha1');
  const checksumType = CHECKSUM_TYPES[algo];
  const hashLen = DIGEST_SIZES[algo];

  if (checksumType === undefined || hashLen === undefined) {
    throw new TypeError(`Unknown message digest: ${digest || 'sha1'}`);
  }

  if (keylen === 0) {
    return Buffer.alloc(0);
  }

  const numBlocks = Math.ceil(keylen / hashLen);
  const dk = Buffer.allocUnsafe(numBlocks * hashLen);

  // RFC 2898 Section 5.2
  for (let blockIndex = 1; blockIndex <= numBlocks; blockIndex++) {
    // U_1 = PRF(Password, Salt || INT_32_BE(i))
    const block = Buffer.allocUnsafe(saltBuf.length + 4);
    saltBuf.copy(block, 0);
    block.writeUInt32BE(blockIndex, saltBuf.length);

    let u = hmacDigest(checksumType, passwordBuf, block);
    let t = Buffer.from(u);

    // U_2 ... U_c
    for (let iter = 1; iter < iterations; iter++) {
      u = hmacDigest(checksumType, passwordBuf, u);
      for (let k = 0; k < hashLen; k++) {
        t[k] ^= u[k];
      }
    }

    t.copy(dk, (blockIndex - 1) * hashLen);
  }

  // Return a proper Buffer slice
  return Buffer.from(dk.buffer, dk.byteOffset, keylen);
}

/**
 * Asynchronous PBKDF2 key derivation.
 */
export function pbkdf2(
  password: string | Buffer | Uint8Array | DataView,
  salt: string | Buffer | Uint8Array | DataView,
  iterations: number,
  keylen: number,
  digest: string,
  callback: (err: Error | null, derivedKey?: Buffer) => void
): void {
  try {
    validateParameters(iterations, keylen);
  } catch (err) {
    // Match Node.js behavior: validation errors are thrown synchronously
    throw err;
  }

  // Run in next tick to be truly async
  setTimeout(() => {
    try {
      const result = pbkdf2Sync(password, salt, iterations, keylen, digest);
      callback(null, result);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }, 0);
}
