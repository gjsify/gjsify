// RSA-OAEP (Optimal Asymmetric Encryption Padding) per RFC 8017 Section 7.1
// Reference: refs/node/lib/internal/crypto/cipher.js
// Copyright (c) Node.js contributors. MIT license.
// Reimplemented for GJS using BigInt RSA math

import { Hash } from './hash.js';
import { randomBytes } from './random.js';
import { mgf1 } from './mgf1.js';
import { parsePemKey, rsaKeySize } from './asn1.js';
import type { RsaPrivateComponents, RsaPublicComponents } from './asn1.js';

// ---------------------------------------------------------------------------
// RSA math
// ---------------------------------------------------------------------------

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  base = ((base % m) + m) % m;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function hashSize(algo: string): number {
  switch (algo.toLowerCase().replace(/-/g, '')) {
    case 'sha1': return 20;
    case 'sha256': return 32;
    case 'sha384': return 48;
    case 'sha512': return 64;
    default: throw new Error(`Unknown hash: ${algo}`);
  }
}

function hashDigest(algo: string, data: Uint8Array): Uint8Array {
  const h = new Hash(algo);
  h.update(data);
  return new Uint8Array(h.digest() as any);
}

// ---------------------------------------------------------------------------
// RSAES-OAEP-ENCRYPT (RFC 8017 Section 7.1.1)
// ---------------------------------------------------------------------------

/**
 * RSA-OAEP encrypt using PEM public key.
 */
export function rsaOaepEncrypt(
  hashAlgo: string,
  pubKeyPem: string,
  plaintext: Uint8Array,
  label?: Uint8Array,
): Uint8Array {
  const parsed = parsePemKey(pubKeyPem);
  let n: bigint, e: bigint;
  if (parsed.type === 'rsa-public') {
    ({ n, e } = parsed.components as RsaPublicComponents);
  } else if (parsed.type === 'rsa-private') {
    ({ n, e } = parsed.components as RsaPrivateComponents);
  } else {
    throw new Error('RSA-OAEP: expected RSA key');
  }

  const keyBytes = Math.ceil(rsaKeySize(n) / 8);
  const hLen = hashSize(hashAlgo);

  if (plaintext.length > keyBytes - 2 * hLen - 2) {
    throw new Error('RSA-OAEP: message too long');
  }

  // lHash = Hash(L) where L = label (empty by default)
  const lHash = hashDigest(hashAlgo, label || new Uint8Array(0));

  // DB = lHash || PS || 0x01 || M
  const dbLen = keyBytes - hLen - 1;
  const DB = new Uint8Array(dbLen);
  DB.set(lHash, 0);
  DB[dbLen - plaintext.length - 1] = 0x01;
  DB.set(plaintext, dbLen - plaintext.length);

  // seed = random bytes of length hLen
  const seed = new Uint8Array(randomBytes(hLen));

  // dbMask = MGF(seed, dbLen)
  const dbMask = mgf1(hashAlgo, seed, dbLen);

  // maskedDB = DB ⊕ dbMask
  const maskedDB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) maskedDB[i] = DB[i] ^ dbMask[i];

  // seedMask = MGF(maskedDB, hLen)
  const seedMask = mgf1(hashAlgo, maskedDB, hLen);

  // maskedSeed = seed ⊕ seedMask
  const maskedSeed = new Uint8Array(hLen);
  for (let i = 0; i < hLen; i++) maskedSeed[i] = seed[i] ^ seedMask[i];

  // EM = 0x00 || maskedSeed || maskedDB
  const EM = new Uint8Array(keyBytes);
  EM[0] = 0x00;
  EM.set(maskedSeed, 1);
  EM.set(maskedDB, 1 + hLen);

  // RSAEP: c = m^e mod n
  const m = bytesToBigInt(EM);
  const c = modPow(m, e, n);
  return bigIntToBytes(c, keyBytes);
}

// ---------------------------------------------------------------------------
// RSAES-OAEP-DECRYPT (RFC 8017 Section 7.1.2)
// ---------------------------------------------------------------------------

/**
 * RSA-OAEP decrypt using PEM private key.
 */
export function rsaOaepDecrypt(
  hashAlgo: string,
  privKeyPem: string,
  ciphertext: Uint8Array,
  label?: Uint8Array,
): Uint8Array {
  const parsed = parsePemKey(privKeyPem);
  if (parsed.type !== 'rsa-private') throw new Error('RSA-OAEP: expected RSA private key');
  const { n, d } = parsed.components as RsaPrivateComponents;

  const keyBytes = Math.ceil(rsaKeySize(n) / 8);
  const hLen = hashSize(hashAlgo);

  if (ciphertext.length !== keyBytes || keyBytes < 2 * hLen + 2) {
    throw new Error('RSA-OAEP: decryption error');
  }

  // RSADP: m = c^d mod n
  const c = bytesToBigInt(ciphertext);
  const m = modPow(c, d, n);
  const EM = bigIntToBytes(m, keyBytes);

  // Y = EM[0], maskedSeed = EM[1..hLen], maskedDB = EM[1+hLen..]
  const Y = EM[0];
  const maskedSeed = EM.slice(1, 1 + hLen);
  const maskedDB = EM.slice(1 + hLen);
  const dbLen = keyBytes - hLen - 1;

  // seedMask = MGF(maskedDB, hLen)
  const seedMask = mgf1(hashAlgo, maskedDB, hLen);

  // seed = maskedSeed ⊕ seedMask
  const seed = new Uint8Array(hLen);
  for (let i = 0; i < hLen; i++) seed[i] = maskedSeed[i] ^ seedMask[i];

  // dbMask = MGF(seed, dbLen)
  const dbMask = mgf1(hashAlgo, seed, dbLen);

  // DB = maskedDB ⊕ dbMask
  const DB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) DB[i] = maskedDB[i] ^ dbMask[i];

  // lHash' = DB[0..hLen-1]
  const lHash = hashDigest(hashAlgo, label || new Uint8Array(0));
  const lHashPrime = DB.slice(0, hLen);

  // Verify Y == 0 and lHash == lHash'
  let valid = Y === 0 ? 1 : 0;
  for (let i = 0; i < hLen; i++) {
    valid &= (lHash[i] === lHashPrime[i]) ? 1 : 0;
  }

  // Find 0x01 separator
  let sepIdx = -1;
  for (let i = hLen; i < dbLen; i++) {
    if (DB[i] === 0x01) {
      sepIdx = i;
      break;
    } else if (DB[i] !== 0x00) {
      valid = 0;
      break;
    }
  }

  if (sepIdx === -1) valid = 0;

  if (!valid) {
    throw new Error('RSA-OAEP: decryption error');
  }

  return DB.slice(sepIdx + 1);
}
