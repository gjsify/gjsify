// Crypto utilities for GJS — original implementation
// Centralizes algorithm normalization, digest/block sizes, and common helpers
// used across hash, hmac, pbkdf2, hkdf, mgf1, rsa-pss, rsa-oaep, ecdsa, and sign modules.

import { Buffer } from 'buffer';

/**
 * Normalize a hash algorithm name to lowercase without hyphens.
 * e.g. "SHA-256" → "sha256", "MD5" → "md5"
 */
export function normalizeAlgorithm(algorithm: string): string {
  return algorithm.toLowerCase().replace(/-/g, '');
}

/** Hash digest output sizes in bytes. */
export const DIGEST_SIZES: Record<string, number> = {
  md5: 16,
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64,
};

/** Hash block sizes in bytes (used for HMAC key padding). */
export const BLOCK_SIZES: Record<string, number> = {
  md5: 64,
  sha1: 64,
  sha256: 64,
  sha384: 128,
  sha512: 128,
};

/** Set of supported hash algorithm names (normalized). */
export const SUPPORTED_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);

/**
 * Get hash digest size in bytes for a given algorithm.
 * Accepts unnormalized names (e.g. "SHA-256").
 */
export function hashSize(algo: string): number {
  const normalized = normalizeAlgorithm(algo);
  const size = DIGEST_SIZES[normalized];
  if (size === undefined) {
    throw new Error(`Unknown hash algorithm: ${algo}`);
  }
  return size;
}

/**
 * Convert various input types to Buffer.
 * Handles string, Buffer, Uint8Array, DataView, and ArrayBuffer.
 */
export function toBuffer(input: string | Buffer | Uint8Array | DataView | ArrayBuffer, encoding?: string): Buffer {
  if (typeof input === 'string') {
    return Buffer.from(input, (encoding as BufferEncoding) || 'utf8');
  }
  if (input instanceof DataView) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  return Buffer.from(input);
}
