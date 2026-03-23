// Reference: Node.js lib/internal/crypto/hkdf.js, RFC 5869
// Reimplemented for GJS using pure-JS Hmac

import { Buffer } from 'buffer';
import { Hmac } from './hmac.js';

const DIGEST_SIZES: Record<string, number> = {
  md5: 16,
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64,
};

const SUPPORTED_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);

function normalizeAlgorithm(algorithm: string): string {
  return algorithm.toLowerCase().replace(/-/g, '');
}

function hmacDigest(algo: string, key: Uint8Array, data: Uint8Array) {
  const hmac = new Hmac(algo, key);
  hmac.update(data);
  return hmac.digest() as Buffer;
}

function toBuffer(input: string | Buffer | Uint8Array | DataView | ArrayBuffer): Buffer {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  if (input instanceof DataView) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return Buffer.from(input);
}

/**
 * HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
 */
function hkdfExtract(algo: string, ikm: Buffer, salt: Buffer): Buffer {
  return hmacDigest(algo, salt, ikm);
}

/**
 * HKDF-Expand: OKM = T(1) || T(2) || ... || T(N)
 *   T(i) = HMAC-Hash(PRK, T(i-1) || info || i)
 */
function hkdfExpand(algo: string, prk: Buffer, info: Buffer, length: number, hashLen: number): Buffer {
  const n = Math.ceil(length / hashLen);
  if (n > 255) {
    throw new Error('HKDF cannot generate more than 255 * HashLen bytes');
  }

  const okm = Buffer.allocUnsafe(n * hashLen);
  let prev: Buffer = Buffer.alloc(0);

  for (let i = 1; i <= n; i++) {
    const input = Buffer.concat([prev, info, Buffer.from([i])]);
    prev = hmacDigest(algo, prk, input);
    prev.copy(okm, (i - 1) * hashLen);
  }

  return Buffer.from(okm.buffer, okm.byteOffset, length);
}

/**
 * Synchronous HKDF key derivation.
 */
export function hkdfSync(
  digest: string,
  ikm: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  salt: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  info: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  keylen: number
): ArrayBuffer {
  const algo = normalizeAlgorithm(digest);
  const hashLen = DIGEST_SIZES[algo];

  if (!SUPPORTED_ALGORITHMS.has(algo) || hashLen === undefined) {
    throw new TypeError(`Unknown message digest: ${digest}`);
  }

  if (typeof keylen !== 'number' || keylen < 0) {
    throw new TypeError('keylen must be a non-negative number');
  }

  const ikmBuf = toBuffer(ikm);
  const saltBuf = toBuffer(salt);
  const infoBuf = toBuffer(info);

  // If salt is empty, use a zero-filled buffer of hash length
  const effectiveSalt = saltBuf.length === 0 ? Buffer.alloc(hashLen, 0) : saltBuf;

  const prk = hkdfExtract(algo, ikmBuf, effectiveSalt);
  const okm = hkdfExpand(algo, prk, infoBuf, keylen, hashLen);

  // Node.js returns ArrayBuffer — copy to ensure a clean ArrayBuffer
  const result = new ArrayBuffer(okm.length);
  new Uint8Array(result).set(okm);
  return result;
}

/**
 * Asynchronous HKDF key derivation.
 */
export function hkdf(
  digest: string,
  ikm: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  salt: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  info: string | Buffer | Uint8Array | DataView | ArrayBuffer,
  keylen: number,
  callback: (err: Error | null, derivedKey?: ArrayBuffer) => void
): void {
  setTimeout(() => {
    try {
      const result = hkdfSync(digest, ikm, salt, info, keylen);
      callback(null, result);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }, 0);
}
