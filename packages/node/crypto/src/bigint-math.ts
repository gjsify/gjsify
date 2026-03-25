// Shared BigInt math utilities for RSA and elliptic curve operations.
// Centralizes modular exponentiation and BigInt↔bytes conversion
// used across sign, rsa-pss, rsa-oaep, public-encrypt, ecdsa, ecdh, and dh modules.

/**
 * Modular exponentiation using square-and-multiply (BigInt).
 * Returns (base ** exp) % mod.
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  base = ((base % mod) + mod) % mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Convert a BigInt to a big-endian Uint8Array of exactly `length` bytes.
 */
export function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/**
 * Convert a Uint8Array (big-endian) to a non-negative BigInt.
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}
