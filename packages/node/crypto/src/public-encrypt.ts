// Public-key encryption — RSA PKCS#1 v1.5 for GJS
// Reference: refs/public-encrypt/publicEncrypt.js, refs/public-encrypt/privateDecrypt.js
// Reimplemented for GJS using native BigInt (ES2024)

import { Buffer } from 'buffer';
import { randomBytes } from './random.js';
import { parsePemKey, rsaKeySize } from './asn1.js';
import { modPow, bigIntToBytes, bytesToBigInt } from './bigint-math.js';

// ============================================================================
// Key extraction helpers
// ============================================================================

interface KeyInput {
  key: string | Buffer;
  passphrase?: string;
  padding?: number;
}

function extractPem(key: string | Buffer | KeyInput): string {
  if (typeof key === 'string') {
    return key;
  }
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    return Buffer.from(key).toString('utf8');
  }
  if (key && typeof key === 'object' && 'key' in key) {
    const k = key.key;
    if (typeof k === 'string') return k;
    if (Buffer.isBuffer(k) || (k as unknown) instanceof Uint8Array) return Buffer.from(k as Uint8Array).toString('utf8');
  }
  throw new TypeError('Invalid key argument');
}

// ============================================================================
// PKCS#1 v1.5 padding
// ============================================================================

/**
 * Apply PKCS#1 v1.5 Type 2 padding (for encryption).
 * Format: 0x00 0x02 [random non-zero bytes] 0x00 [data]
 * The padding string (PS) must be at least 8 bytes.
 */
function pkcs1v15Type2Pad(data: Uint8Array, keyLen: number): Uint8Array {
  const maxDataLen = keyLen - 11; // 3 bytes overhead + 8 min padding
  if (data.length > maxDataLen) {
    throw new Error(`Data too long for key size. Max ${maxDataLen} bytes, got ${data.length}`);
  }

  const padLen = keyLen - data.length - 3;
  const em = new Uint8Array(keyLen);
  em[0] = 0x00;
  em[1] = 0x02;

  // Generate random non-zero padding bytes
  const padding = randomBytes(padLen);
  for (let i = 0; i < padLen; i++) {
    // Ensure no zero bytes in the padding
    while (padding[i] === 0) {
      const replacement = randomBytes(1);
      padding[i] = replacement[0];
    }
    em[2 + i] = padding[i];
  }

  em[2 + padLen] = 0x00;
  em.set(data, 3 + padLen);

  return em;
}

/**
 * Apply PKCS#1 v1.5 Type 1 padding (for private-key encryption / signature).
 * Format: 0x00 0x01 [0xFF bytes] 0x00 [data]
 */
function pkcs1v15Type1Pad(data: Uint8Array, keyLen: number): Uint8Array {
  const maxDataLen = keyLen - 11;
  if (data.length > maxDataLen) {
    throw new Error(`Data too long for key size. Max ${maxDataLen} bytes, got ${data.length}`);
  }

  const padLen = keyLen - data.length - 3;
  const em = new Uint8Array(keyLen);
  em[0] = 0x00;
  em[1] = 0x01;
  for (let i = 2; i < 2 + padLen; i++) {
    em[i] = 0xff;
  }
  em[2 + padLen] = 0x00;
  em.set(data, 3 + padLen);

  return em;
}

/**
 * Remove PKCS#1 v1.5 Type 2 padding (after decryption with private key).
 * Expects: 0x00 0x02 [random non-zero bytes] 0x00 [data]
 */
function pkcs1v15Type2Unpad(em: Uint8Array): Uint8Array {
  if (em.length < 11) {
    throw new Error('Decryption error: message too short');
  }
  if (em[0] !== 0x00 || em[1] !== 0x02) {
    throw new Error('Decryption error: invalid padding');
  }

  // Find the 0x00 separator (must be at least at index 10 for 8 bytes of padding)
  let sepIdx = 2;
  while (sepIdx < em.length && em[sepIdx] !== 0x00) {
    sepIdx++;
  }
  if (sepIdx >= em.length || sepIdx < 10) {
    throw new Error('Decryption error: invalid padding');
  }

  return em.slice(sepIdx + 1);
}

/**
 * Remove PKCS#1 v1.5 Type 1 padding (after decryption with public key).
 * Expects: 0x00 0x01 [0xFF bytes] 0x00 [data]
 */
function pkcs1v15Type1Unpad(em: Uint8Array): Uint8Array {
  if (em.length < 11) {
    throw new Error('Decryption error: message too short');
  }
  if (em[0] !== 0x00 || em[1] !== 0x01) {
    throw new Error('Decryption error: invalid padding');
  }

  // Skip 0xFF bytes
  let sepIdx = 2;
  while (sepIdx < em.length && em[sepIdx] === 0xff) {
    sepIdx++;
  }
  if (sepIdx >= em.length || em[sepIdx] !== 0x00 || sepIdx < 10) {
    throw new Error('Decryption error: invalid padding');
  }

  return em.slice(sepIdx + 1);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Encrypt data using an RSA public key with PKCS#1 v1.5 Type 2 padding.
 *
 * @param key - PEM-encoded RSA public key (or private key, from which public components are extracted)
 * @param buffer - Data to encrypt (must be <= keyLen - 11 bytes)
 * @returns Encrypted data as a Buffer
 */
export function publicEncrypt(key: string | Buffer | KeyInput, buffer: Buffer | Uint8Array): Buffer {
  const pem = extractPem(key);
  const parsed = parsePemKey(pem);

  let n: bigint;
  let e: bigint;
  if (parsed.type === 'rsa-public') {
    n = parsed.components.n;
    e = parsed.components.e;
  } else if (parsed.type === 'rsa-private') {
    n = parsed.components.n;
    e = parsed.components.e;
  } else {
    throw new Error('Key must be an RSA public or private key');
  }

  const keyLen = rsaKeySize(n);
  const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  // Apply PKCS#1 v1.5 Type 2 padding
  const em = pkcs1v15Type2Pad(data, keyLen);

  // RSA encrypt: c = m^e mod n
  const m = bytesToBigInt(em);
  const c = modPow(m, e, n);
  return Buffer.from(bigIntToBytes(c, keyLen));
}

/**
 * Decrypt data using an RSA private key (reverses publicEncrypt).
 *
 * @param key - PEM-encoded RSA private key
 * @param buffer - Encrypted data
 * @returns Decrypted data as a Buffer
 */
export function privateDecrypt(key: string | Buffer | KeyInput, buffer: Buffer | Uint8Array): Buffer {
  const pem = extractPem(key);
  const parsed = parsePemKey(pem);

  if (parsed.type !== 'rsa-private') {
    throw new Error('Key must be an RSA private key');
  }

  const { n, d } = parsed.components;
  const keyLen = rsaKeySize(n);
  const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  if (data.length !== keyLen) {
    throw new Error(`Data length (${data.length}) does not match key length (${keyLen})`);
  }

  // RSA decrypt: m = c^d mod n
  const c = bytesToBigInt(data);
  if (c >= n) {
    throw new Error('Decryption error: cipher value out of range');
  }
  const m = modPow(c, d, n);
  const em = bigIntToBytes(m, keyLen);

  // Remove PKCS#1 v1.5 Type 2 padding
  return Buffer.from(pkcs1v15Type2Unpad(em));
}

/**
 * Encrypt data using an RSA private key with PKCS#1 v1.5 Type 1 padding.
 * This is the raw RSA private-key operation used for compatibility with
 * signature-like use cases.
 *
 * @param key - PEM-encoded RSA private key
 * @param buffer - Data to encrypt
 * @returns Encrypted data as a Buffer
 */
export function privateEncrypt(key: string | Buffer | KeyInput, buffer: Buffer | Uint8Array): Buffer {
  const pem = extractPem(key);
  const parsed = parsePemKey(pem);

  if (parsed.type !== 'rsa-private') {
    throw new Error('Key must be an RSA private key');
  }

  const { n, d } = parsed.components;
  const keyLen = rsaKeySize(n);
  const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  // Apply PKCS#1 v1.5 Type 1 padding
  const em = pkcs1v15Type1Pad(data, keyLen);

  // RSA private key operation: c = m^d mod n
  const m = bytesToBigInt(em);
  const c = modPow(m, d, n);
  return Buffer.from(bigIntToBytes(c, keyLen));
}

/**
 * Decrypt data using an RSA public key (reverses privateEncrypt).
 * Removes PKCS#1 v1.5 Type 1 padding.
 *
 * @param key - PEM-encoded RSA public key (or private key for public components)
 * @param buffer - Encrypted data
 * @returns Decrypted data as a Buffer
 */
export function publicDecrypt(key: string | Buffer | KeyInput, buffer: Buffer | Uint8Array): Buffer {
  const pem = extractPem(key);
  const parsed = parsePemKey(pem);

  let n: bigint;
  let e: bigint;
  if (parsed.type === 'rsa-public') {
    n = parsed.components.n;
    e = parsed.components.e;
  } else if (parsed.type === 'rsa-private') {
    n = parsed.components.n;
    e = parsed.components.e;
  } else {
    throw new Error('Key must be an RSA public or private key');
  }

  const keyLen = rsaKeySize(n);
  const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  if (data.length !== keyLen) {
    throw new Error(`Data length (${data.length}) does not match key length (${keyLen})`);
  }

  // RSA public key operation: m = c^e mod n
  const c = bytesToBigInt(data);
  if (c >= n) {
    throw new Error('Decryption error: cipher value out of range');
  }
  const m = modPow(c, e, n);
  const em = bigIntToBytes(m, keyLen);

  // Remove PKCS#1 v1.5 Type 1 padding
  return Buffer.from(pkcs1v15Type1Unpad(em));
}
