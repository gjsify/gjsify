// Implements scrypt per RFC 7914 (The scrypt Password-Based Key Derivation Function)
// Reference: refs/node/lib/internal/crypto/scrypt.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Pure-JS implementation for GJS using internal PBKDF2/Hmac

import { Buffer } from 'buffer';
import { pbkdf2Sync } from './pbkdf2.js';

export interface ScryptOptions {
  N?: number;    // CPU/memory cost parameter (default: 16384)
  r?: number;    // Block size parameter (default: 8)
  p?: number;    // Parallelization parameter (default: 1)
  maxmem?: number;
}

type ScryptCallback = (err: Error | null, derivedKey: Buffer) => void;

// ---- Salsa20/8 core ----

function R(a: number, b: number): number {
  return ((a << b) | (a >>> (32 - b))) >>> 0;
}

function salsa20_8(B: Uint32Array): void {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) x[i] = B[i];

  for (let i = 0; i < 4; i++) {
    // Column round
    x[ 4] ^= R(x[ 0]+x[12], 7);  x[ 8] ^= R(x[ 4]+x[ 0], 9);
    x[12] ^= R(x[ 8]+x[ 4],13);  x[ 0] ^= R(x[12]+x[ 8],18);
    x[ 9] ^= R(x[ 5]+x[ 1], 7);  x[13] ^= R(x[ 9]+x[ 5], 9);
    x[ 1] ^= R(x[13]+x[ 9],13);  x[ 5] ^= R(x[ 1]+x[13],18);
    x[14] ^= R(x[10]+x[ 6], 7);  x[ 2] ^= R(x[14]+x[10], 9);
    x[ 6] ^= R(x[ 2]+x[14],13);  x[10] ^= R(x[ 6]+x[ 2],18);
    x[ 3] ^= R(x[15]+x[11], 7);  x[ 7] ^= R(x[ 3]+x[15], 9);
    x[11] ^= R(x[ 7]+x[ 3],13);  x[15] ^= R(x[11]+x[ 7],18);
    // Row round
    x[ 1] ^= R(x[ 0]+x[ 3], 7);  x[ 2] ^= R(x[ 1]+x[ 0], 9);
    x[ 3] ^= R(x[ 2]+x[ 1],13);  x[ 0] ^= R(x[ 3]+x[ 2],18);
    x[ 6] ^= R(x[ 5]+x[ 4], 7);  x[ 7] ^= R(x[ 6]+x[ 5], 9);
    x[ 4] ^= R(x[ 7]+x[ 6],13);  x[ 5] ^= R(x[ 4]+x[ 7],18);
    x[11] ^= R(x[10]+x[ 9], 7);  x[ 8] ^= R(x[11]+x[10], 9);
    x[ 9] ^= R(x[ 8]+x[11],13);  x[10] ^= R(x[ 9]+x[ 8],18);
    x[12] ^= R(x[15]+x[14], 7);  x[13] ^= R(x[12]+x[15], 9);
    x[14] ^= R(x[13]+x[12],13);  x[15] ^= R(x[14]+x[13],18);
  }

  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) >>> 0;
}

// ---- BlockMix (Salsa20/8) ----

function blockMix(B: Uint32Array, r: number): void {
  const blockWords = 2 * r * 16;
  const X = new Uint32Array(16);
  // X = B[2r-1]
  for (let i = 0; i < 16; i++) X[i] = B[blockWords - 16 + i];

  const Y = new Uint32Array(blockWords);

  for (let i = 0; i < 2 * r; i++) {
    // X = X ⊕ B[i]
    for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
    salsa20_8(X);
    // Y[i] = X
    for (let j = 0; j < 16; j++) Y[i * 16 + j] = X[j];
  }

  // B = [Y[0], Y[2], ..., Y[2r-2], Y[1], Y[3], ..., Y[2r-1]]
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < 16; j++) B[i * 16 + j] = Y[2 * i * 16 + j];
  }
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < 16; j++) B[(r + i) * 16 + j] = Y[(2 * i + 1) * 16 + j];
  }
}

// ---- ROMix ----

function roMix(B: Uint32Array, N: number, r: number): void {
  const blockWords = 2 * r * 16;
  const V = new Array<Uint32Array>(N);

  for (let i = 0; i < N; i++) {
    V[i] = new Uint32Array(B);
    blockMix(B, r);
  }

  for (let i = 0; i < N; i++) {
    // j = Integerify(B) mod N
    const j = B[blockWords - 16] & (N - 1);
    for (let k = 0; k < blockWords; k++) B[k] ^= V[j][k];
    blockMix(B, r);
  }
}

// ---- Bytes to Uint32Array (little-endian) ----

function bytesToWords(bytes: Uint8Array): Uint32Array {
  const words = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < words.length; i++) {
    words[i] = bytes[i*4] | (bytes[i*4+1] << 8) | (bytes[i*4+2] << 16) | (bytes[i*4+3] << 24);
  }
  return words;
}

function wordsToBytes(words: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    bytes[i*4] = words[i] & 0xff;
    bytes[i*4+1] = (words[i] >> 8) & 0xff;
    bytes[i*4+2] = (words[i] >> 16) & 0xff;
    bytes[i*4+3] = (words[i] >> 24) & 0xff;
  }
  return bytes;
}

// ---- scrypt core ----

function scryptCore(
  password: Buffer | Uint8Array,
  salt: Buffer | Uint8Array,
  N: number,
  r: number,
  p: number,
  keyLen: number,
): Buffer {
  // Step 1: Generate initial blocks with PBKDF2-SHA256
  const blockSize = 128 * r;
  const B = pbkdf2Sync(password, salt, 1, p * blockSize, 'sha256');

  // Step 2: Apply ROMix to each block
  for (let i = 0; i < p; i++) {
    const blockBytes = new Uint8Array(B.buffer, B.byteOffset + i * blockSize, blockSize);
    const blockWords = bytesToWords(blockBytes);
    roMix(blockWords, N, r);
    const result = wordsToBytes(blockWords);
    blockBytes.set(result);
  }

  // Step 3: Derive final key with PBKDF2-SHA256
  return pbkdf2Sync(password, B, 1, keyLen, 'sha256');
}

// ---- Public API ----

export function scryptSync(
  password: string | Buffer | Uint8Array,
  salt: string | Buffer | Uint8Array,
  keylen: number,
  options?: ScryptOptions,
): Buffer {
  const pwd = typeof password === 'string' ? Buffer.from(password) : Buffer.from(password);
  const slt = typeof salt === 'string' ? Buffer.from(salt) : Buffer.from(salt);
  const N = options?.N ?? 16384;
  const r = options?.r ?? 8;
  const p = options?.p ?? 1;

  if (N <= 0 || (N & (N - 1)) !== 0) {
    throw new Error('N must be a positive power of 2');
  }

  return scryptCore(pwd, slt, N, r, p, keylen);
}

export function scrypt(
  password: string | Buffer | Uint8Array,
  salt: string | Buffer | Uint8Array,
  keylen: number,
  optionsOrCallback: ScryptOptions | ScryptCallback,
  callback?: ScryptCallback,
): void {
  let options: ScryptOptions = {};
  let cb: ScryptCallback;

  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    cb = callback!;
  }

  try {
    const result = scryptSync(password, salt, keylen, options);
    // Use setTimeout to make it async
    setTimeout(() => cb(null, result), 0);
  } catch (err) {
    setTimeout(() => cb(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)), 0);
  }
}
