// SPDX-License-Identifier: MIT
// Implements AES-128/192/256 (CBC, CTR, ECB, CFB, OFB, GCM) per FIPS-197 (Rijndael) with PKCS#7 padding
// GCM mode implements NIST SP 800-38D (Galois/Counter Mode)
// Adapted from browserify-cipher (refs/browserify-cipher/)
// Copyright (c) crypto-browserify contributors. MIT license.
// Modifications: Pure-JS implementation for GJS, no OpenSSL dependency

import { Buffer } from 'buffer';

// ---- AES S-Box and inverse S-Box (pre-computed) ----

const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const INV_SBOX = new Uint8Array([
  0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
  0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
  0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
  0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
  0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
  0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
  0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
  0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
  0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
  0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
  0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
  0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
  0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
  0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
  0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
  0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d,
]);

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

// ---- GF(2^8) multiplication ----

function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

// ---- AES Key Expansion ----

function keyExpansion(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4; // 4, 6, or 8 (128, 192, 256 bits)
  const nr = nk + 6; // 10, 12, or 14 rounds
  const nw = 4 * (nr + 1); // total 32-bit words

  const w = new Array<Uint8Array>(nw);
  for (let i = 0; i < nk; i++) {
    w[i] = new Uint8Array([key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]]);
  }

  for (let i = nk; i < nw; i++) {
    let temp = new Uint8Array(w[i-1]);
    if (i % nk === 0) {
      // RotWord + SubWord + Rcon
      temp = new Uint8Array([
        SBOX[temp[1]] ^ RCON[(i/nk) - 1],
        SBOX[temp[2]],
        SBOX[temp[3]],
        SBOX[temp[0]],
      ]);
    } else if (nk > 6 && i % nk === 4) {
      temp = new Uint8Array([SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]]);
    }
    w[i] = new Uint8Array(4);
    for (let j = 0; j < 4; j++) w[i][j] = w[i-nk][j] ^ temp[j];
  }

  // Convert to round keys (16 bytes each)
  const roundKeys: Uint8Array[] = [];
  for (let r = 0; r <= nr; r++) {
    const rk = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      rk[4*c] = w[4*r + c][0];
      rk[4*c+1] = w[4*r + c][1];
      rk[4*c+2] = w[4*r + c][2];
      rk[4*c+3] = w[4*r + c][3];
    }
    roundKeys.push(rk);
  }
  return roundKeys;
}

// ---- AES Block Encrypt (16 bytes) ----

function aesEncryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
  const state = new Uint8Array(block);
  const nr = roundKeys.length - 1;

  // AddRoundKey (initial)
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[0][i];

  for (let round = 1; round < nr; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];

    // ShiftRows
    const t1 = state[1]; state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t1;
    const t2a = state[2]; const t2b = state[6]; state[2] = state[10]; state[6] = state[14]; state[10] = t2a; state[14] = t2b;
    const t3 = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = t3;

    // MixColumns
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = state[i], a1 = state[i+1], a2 = state[i+2], a3 = state[i+3];
      state[i]   = gmul(2,a0) ^ gmul(3,a1) ^ a2 ^ a3;
      state[i+1] = a0 ^ gmul(2,a1) ^ gmul(3,a2) ^ a3;
      state[i+2] = a0 ^ a1 ^ gmul(2,a2) ^ gmul(3,a3);
      state[i+3] = gmul(3,a0) ^ a1 ^ a2 ^ gmul(2,a3);
    }

    // AddRoundKey
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round][i];
  }

  // Final round (no MixColumns)
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
  const t1f = state[1]; state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t1f;
  const t2af = state[2]; const t2bf = state[6]; state[2] = state[10]; state[6] = state[14]; state[10] = t2af; state[14] = t2bf;
  const t3f = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = t3f;
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[nr][i];

  return state;
}

// ---- AES Block Decrypt (16 bytes) ----

function aesDecryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
  const state = new Uint8Array(block);
  const nr = roundKeys.length - 1;

  // AddRoundKey (last round key)
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[nr][i];

  for (let round = nr - 1; round > 0; round--) {
    // InvShiftRows
    const t1 = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t1;
    const t2a = state[10]; const t2b = state[14]; state[10] = state[2]; state[14] = state[6]; state[2] = t2a; state[6] = t2b;
    const t3 = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3;

    // InvSubBytes
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];

    // AddRoundKey
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round][i];

    // InvMixColumns
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = state[i], a1 = state[i+1], a2 = state[i+2], a3 = state[i+3];
      state[i]   = gmul(14,a0) ^ gmul(11,a1) ^ gmul(13,a2) ^ gmul(9,a3);
      state[i+1] = gmul(9,a0) ^ gmul(14,a1) ^ gmul(11,a2) ^ gmul(13,a3);
      state[i+2] = gmul(13,a0) ^ gmul(9,a1) ^ gmul(14,a2) ^ gmul(11,a3);
      state[i+3] = gmul(11,a0) ^ gmul(13,a1) ^ gmul(9,a2) ^ gmul(14,a3);
    }
  }

  // Final inverse round (no InvMixColumns)
  const t1f = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t1f;
  const t2af = state[10]; const t2bf = state[14]; state[10] = state[2]; state[14] = state[6]; state[2] = t2af; state[6] = t2bf;
  const t3f = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3f;
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[0][i];

  return state;
}

// ---- Counter increment for CTR mode ----

function incrementCounter(counter: Uint8Array): void {
  for (let i = 15; i >= 0; i--) {
    if (++counter[i] !== 0) break;
  }
}

// ---- GCM counter increment (only the last 32 bits) ----

function gcmIncrementCounter(counter: Uint8Array): void {
  for (let i = 15; i >= 12; i--) {
    if (++counter[i] !== 0) break;
  }
}

// ---- GF(2^128) multiplication for GHASH ----

/**
 * Multiply two 128-bit values in GF(2^128) using the irreducible polynomial
 * x^128 + x^7 + x^2 + x + 1 (represented as R = 0xe1 << 120).
 *
 * X and Y are 16-byte Uint8Arrays (big-endian bit ordering).
 * Returns a new 16-byte Uint8Array.
 */
function gfMul(X: Uint8Array, Y: Uint8Array): Uint8Array {
  // Z starts at 0, V starts as a copy of X
  const Z = new Uint8Array(16);
  const V = new Uint8Array(X);

  for (let i = 0; i < 128; i++) {
    // Check bit i of Y (big-endian: byte i>>3, bit 7-(i&7))
    if (Y[i >>> 3] & (1 << (7 - (i & 7)))) {
      // Z = Z XOR V
      for (let j = 0; j < 16; j++) Z[j] ^= V[j];
    }

    // Check if the LSB (rightmost bit) of V is set
    const lsb = V[15] & 1;

    // Right-shift V by 1 bit
    for (let j = 15; j > 0; j--) {
      V[j] = (V[j] >>> 1) | ((V[j - 1] & 1) << 7);
    }
    V[0] = V[0] >>> 1;

    // If LSB was set, XOR with R (0xe1 in the most significant byte)
    if (lsb) {
      V[0] ^= 0xe1;
    }
  }

  return Z;
}

/**
 * GHASH function per NIST SP 800-38D.
 *
 * H:    the hash subkey (AES_K(0^128)), 16 bytes
 * aad:  additional authenticated data (arbitrary length)
 * ciphertext: ciphertext (arbitrary length)
 *
 * Returns a 16-byte authentication hash.
 */
function ghash(H: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const X = new Uint8Array(16); // X_0 = 0^128

  // Process AAD blocks (pad to 128-bit boundary)
  const aadBlocks = Math.ceil(aad.length / 16) || 0;
  for (let i = 0; i < aadBlocks; i++) {
    const start = i * 16;
    const end = Math.min(start + 16, aad.length);
    // XOR the block into X (zero-padded if partial)
    for (let j = 0; j < 16; j++) {
      const idx = start + j;
      if (idx < end) {
        X[j] ^= aad[idx];
      }
      // else: XOR with 0 (no-op)
    }
    const product = gfMul(X, H);
    X.set(product);
  }

  // Process ciphertext blocks (pad to 128-bit boundary)
  const ctBlocks = Math.ceil(ciphertext.length / 16) || 0;
  for (let i = 0; i < ctBlocks; i++) {
    const start = i * 16;
    const end = Math.min(start + 16, ciphertext.length);
    for (let j = 0; j < 16; j++) {
      const idx = start + j;
      if (idx < end) {
        X[j] ^= ciphertext[idx];
      }
    }
    const product = gfMul(X, H);
    X.set(product);
  }

  // Final block: len(A) || len(C) as 64-bit big-endian bit counts
  const lenBlock = new Uint8Array(16);
  const aadBits = aad.length * 8;
  const ctBits = ciphertext.length * 8;

  // Write aadBits as 64-bit big-endian into bytes 0..7
  // JavaScript bitwise ops are 32-bit, so we handle high and low 32 bits
  const aadHi = Math.floor(aadBits / 0x100000000);
  const aadLo = aadBits >>> 0;
  lenBlock[0] = (aadHi >>> 24) & 0xff;
  lenBlock[1] = (aadHi >>> 16) & 0xff;
  lenBlock[2] = (aadHi >>> 8) & 0xff;
  lenBlock[3] = aadHi & 0xff;
  lenBlock[4] = (aadLo >>> 24) & 0xff;
  lenBlock[5] = (aadLo >>> 16) & 0xff;
  lenBlock[6] = (aadLo >>> 8) & 0xff;
  lenBlock[7] = aadLo & 0xff;

  // Write ctBits as 64-bit big-endian into bytes 8..15
  const ctHi = Math.floor(ctBits / 0x100000000);
  const ctLo = ctBits >>> 0;
  lenBlock[8] = (ctHi >>> 24) & 0xff;
  lenBlock[9] = (ctHi >>> 16) & 0xff;
  lenBlock[10] = (ctHi >>> 8) & 0xff;
  lenBlock[11] = ctHi & 0xff;
  lenBlock[12] = (ctLo >>> 24) & 0xff;
  lenBlock[13] = (ctLo >>> 16) & 0xff;
  lenBlock[14] = (ctLo >>> 8) & 0xff;
  lenBlock[15] = ctLo & 0xff;

  for (let j = 0; j < 16; j++) X[j] ^= lenBlock[j];
  const product = gfMul(X, H);
  X.set(product);

  return X;
}

// ---- Algorithm parsing ----

interface AlgorithmInfo {
  keySize: number; // bytes
  ivSize: number;  // bytes
  mode: 'cbc' | 'ctr' | 'ecb' | 'cfb' | 'ofb' | 'gcm';
}

function parseAlgorithm(algorithm: string): AlgorithmInfo {
  const lower = algorithm.toLowerCase();
  const match = lower.match(/^aes-(128|192|256)-(cbc|ctr|ecb|cfb|ofb|gcm)$/);
  if (!match) {
    throw new Error(`Unsupported cipher algorithm: ${algorithm}`);
  }
  const keyBits = parseInt(match[1]);
  const mode = match[2] as AlgorithmInfo['mode'];
  return {
    keySize: keyBits / 8,
    ivSize: mode === 'ecb' ? 0 : (mode === 'gcm' ? 12 : 16),
    mode,
  };
}

// ---- Encoding helpers ----

function toBuffer(data: string | Buffer | Uint8Array, encoding?: string): Buffer {
  if (typeof data === 'string') {
    return Buffer.from(data, (encoding || 'utf8') as BufferEncoding);
  }
  return Buffer.from(data);
}

function encodeOutput(data: Uint8Array, encoding?: string): string | Buffer {
  if (!encoding) return Buffer.from(data);
  return Buffer.from(data).toString(encoding as BufferEncoding);
}

/**
 * Count how many trailing bytes at the end of a Uint8Array form an incomplete
 * UTF-8 multibyte sequence. Returns 0 if the last character is complete.
 */
function incompleteUtf8Tail(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  // Walk backwards from the end to find the lead byte of the last character
  const end = buf.length;
  for (let back = 1; back <= Math.min(4, end); back++) {
    const b = buf[end - back];
    if ((b & 0x80) === 0) {
      // ASCII byte — this is a complete 1-byte character
      return 0;
    }
    if ((b & 0xC0) === 0x80) {
      // Continuation byte — keep searching backwards for the lead byte
      continue;
    }
    // This is a lead byte — determine expected sequence length
    let expected: number;
    if ((b & 0xE0) === 0xC0) expected = 2;
    else if ((b & 0xF0) === 0xE0) expected = 3;
    else if ((b & 0xF8) === 0xF0) expected = 4;
    else return 0; // Invalid lead byte
    // `back` is how many bytes we have from the lead to the end
    return back < expected ? back : 0;
  }
  return 0;
}

// ---- PKCS#7 Padding ----

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen;
  return padded;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error('bad decrypt');
  }
  const padLen = data[data.length - 1];
  if (padLen === 0 || padLen > 16) {
    throw new Error('bad decrypt');
  }
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error('bad decrypt');
  }
  return new Uint8Array(data.slice(0, data.length - padLen));
}

// ---- Cipher class ----

class CipherBase {
  protected _roundKeys: Uint8Array[];
  protected _iv: Uint8Array;
  protected _mode: AlgorithmInfo['mode'];
  protected _buffer: Uint8Array = new Uint8Array(0);
  protected _autoPadding = true;
  protected _finalized = false;

  constructor(algorithm: string, key: Uint8Array, iv: Uint8Array | null) {
    const info = parseAlgorithm(algorithm);
    if (key.length !== info.keySize) {
      throw new Error(`Invalid key length ${key.length}, expected ${info.keySize} for ${algorithm}`);
    }
    if (info.ivSize > 0 && (!iv || iv.length !== info.ivSize)) {
      throw new Error(`Invalid IV length ${iv?.length ?? 0}, expected ${info.ivSize} for ${algorithm}`);
    }
    this._roundKeys = keyExpansion(key);
    this._iv = iv ? new Uint8Array(iv) : new Uint8Array(16);
    this._mode = info.mode;
  }

  setAutoPadding(autoPadding: boolean): this {
    this._autoPadding = autoPadding;
    return this;
  }
}

class Cipher extends CipherBase {
  private _prevBlock: Uint8Array;
  private _counter: Uint8Array;

  // GCM state
  private _gcmH: Uint8Array | null = null;       // Hash subkey H = AES_K(0^128)
  private _gcmJ0: Uint8Array | null = null;       // Initial counter J0
  private _gcmAAD: Uint8Array = new Uint8Array(0); // Additional authenticated data
  private _gcmCiphertext: Uint8Array[] = [];       // Accumulated ciphertext for GHASH
  private _gcmCiphertextLen = 0;                   // Total ciphertext length
  private _gcmAuthTag: Buffer | null = null;       // Computed authentication tag
  private _gcmAADSet = false;                      // Whether setAAD was called

  constructor(algorithm: string, key: Uint8Array, iv: Uint8Array | null) {
    super(algorithm, key, iv);
    this._prevBlock = new Uint8Array(this._iv);

    if (this._mode === 'gcm') {
      // GCM initialization
      // H = AES_K(0^128) — encrypt zero block with the key
      this._gcmH = aesEncryptBlock(new Uint8Array(16), this._roundKeys);

      // J0 = IV || 0^31 || 1 (when IV is 96 bits / 12 bytes)
      this._gcmJ0 = new Uint8Array(16);
      this._gcmJ0.set(this._iv.subarray(0, 12));
      this._gcmJ0[15] = 1; // last byte = 1 (0^31 || 1)

      // Counter starts at J0 incremented by 1 (ICB = inc32(J0))
      this._counter = new Uint8Array(this._gcmJ0);
      gcmIncrementCounter(this._counter);
    } else {
      this._counter = new Uint8Array(this._iv);
    }
  }

  /**
   * Set Additional Authenticated Data for GCM mode.
   * Must be called before any update() calls.
   */
  setAAD(data: Buffer | Uint8Array): this {
    if (this._mode !== 'gcm') {
      throw new Error('setAAD is only supported in GCM mode');
    }
    if (this._gcmCiphertextLen > 0) {
      throw new Error('setAAD must be called before update()');
    }
    this._gcmAAD = new Uint8Array(data);
    this._gcmAADSet = true;
    return this;
  }

  /**
   * Get the authentication tag after final() has been called.
   * Only valid for GCM mode.
   */
  getAuthTag(): Buffer {
    if (this._mode !== 'gcm') {
      throw new Error('getAuthTag is only supported in GCM mode');
    }
    if (!this._gcmAuthTag) {
      throw new Error('getAuthTag must be called after final()');
    }
    return Buffer.from(this._gcmAuthTag);
  }

  update(data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): string | Buffer {
    const input = toBuffer(data, inputEncoding);

    // Append to buffer
    const combined = new Uint8Array(this._buffer.length + input.length);
    combined.set(this._buffer);
    combined.set(input, this._buffer.length);

    if (this._mode === 'gcm') {
      // GCM uses CTR mode for encryption — process all available bytes
      const output = this._processGcmEncrypt(combined);
      this._buffer = new Uint8Array(0);
      return encodeOutput(output, outputEncoding);
    }

    if (this._mode === 'ctr' || this._mode === 'cfb' || this._mode === 'ofb') {
      // Stream cipher modes: process all available bytes
      const output = this._processStream(combined);
      this._buffer = new Uint8Array(0);
      return encodeOutput(output, outputEncoding);
    }

    // Block cipher modes (CBC, ECB): process complete blocks
    const fullBlocks = Math.floor(combined.length / 16);
    const processLen = fullBlocks * 16;
    const output: Uint8Array[] = [];

    for (let i = 0; i < processLen; i += 16) {
      const block = combined.slice(i, i + 16);
      output.push(this._encryptBlock(block));
    }

    this._buffer = combined.slice(processLen);
    const result = new Uint8Array(output.length * 16);
    for (let i = 0; i < output.length; i++) result.set(output[i], i * 16);
    return encodeOutput(result, outputEncoding);
  }

  final(outputEncoding?: string): string | Buffer {
    if (this._finalized) throw new Error('Cipher already finalized');
    this._finalized = true;

    if (this._mode === 'gcm') {
      // GCM: process any remaining buffer, then compute auth tag
      let finalOutput = new Uint8Array(0);
      if (this._buffer.length > 0) {
        finalOutput = this._processGcmEncrypt(this._buffer) as Uint8Array<ArrayBuffer>;
        this._buffer = new Uint8Array(0);
      }

      // Concatenate all ciphertext chunks for GHASH
      const allCiphertext = new Uint8Array(this._gcmCiphertextLen);
      let offset = 0;
      for (const chunk of this._gcmCiphertext) {
        allCiphertext.set(chunk, offset);
        offset += chunk.length;
      }

      // Compute GHASH(H, AAD, ciphertext)
      const ghashResult = ghash(this._gcmH!, this._gcmAAD, allCiphertext);

      // Tag = GHASH(H, AAD, C) XOR AES_K(J0)
      const encJ0 = aesEncryptBlock(this._gcmJ0!, this._roundKeys);
      const tag = new Uint8Array(16);
      for (let i = 0; i < 16; i++) tag[i] = ghashResult[i] ^ encJ0[i];

      this._gcmAuthTag = Buffer.from(tag);

      return encodeOutput(finalOutput, outputEncoding);
    }

    if (this._mode === 'ctr' || this._mode === 'cfb' || this._mode === 'ofb') {
      // Stream modes: no padding needed, just process remaining
      if (this._buffer.length > 0) {
        const output = this._processStream(this._buffer);
        this._buffer = new Uint8Array(0);
        return encodeOutput(output, outputEncoding);
      }
      return encodeOutput(new Uint8Array(0), outputEncoding);
    }

    // Block modes: apply padding
    let data = this._buffer;
    if (this._autoPadding) {
      data = pkcs7Pad(data);
    } else if (data.length % 16 !== 0) {
      throw new Error('data not multiple of block size');
    }

    const output: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += 16) {
      output.push(this._encryptBlock(data.slice(i, i + 16)));
    }

    this._buffer = new Uint8Array(0);
    if (output.length === 0) return encodeOutput(new Uint8Array(0), outputEncoding);
    const result = new Uint8Array(output.length * 16);
    for (let i = 0; i < output.length; i++) result.set(output[i], i * 16);
    return encodeOutput(result, outputEncoding);
  }

  private _encryptBlock(block: Uint8Array): Uint8Array {
    if (this._mode === 'cbc') {
      // XOR with previous ciphertext (or IV)
      const xored = new Uint8Array(16);
      for (let i = 0; i < 16; i++) xored[i] = block[i] ^ this._prevBlock[i];
      const encrypted = aesEncryptBlock(xored, this._roundKeys);
      this._prevBlock = encrypted;
      return encrypted;
    } else if (this._mode === 'ecb') {
      return aesEncryptBlock(block, this._roundKeys);
    }
    throw new Error(`Block encryption not supported for mode: ${this._mode}`);
  }

  private _processStream(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      const keystream = aesEncryptBlock(this._counter, this._roundKeys);
      const remaining = Math.min(16, data.length - i);
      for (let j = 0; j < remaining; j++) {
        output[i + j] = data[i + j] ^ keystream[j];
      }
      incrementCounter(this._counter);
    }
    return output;
  }

  /**
   * GCM encryption: CTR mode encryption, also accumulates ciphertext for GHASH.
   */
  private _processGcmEncrypt(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      const keystream = aesEncryptBlock(this._counter, this._roundKeys);
      const remaining = Math.min(16, data.length - i);
      for (let j = 0; j < remaining; j++) {
        output[i + j] = data[i + j] ^ keystream[j];
      }
      gcmIncrementCounter(this._counter);
    }
    // Accumulate ciphertext for auth tag computation
    this._gcmCiphertext.push(new Uint8Array(output));
    this._gcmCiphertextLen += output.length;
    return output;
  }
}

class Decipher extends CipherBase {
  private _prevBlock: Uint8Array;
  private _counter: Uint8Array;
  private _pendingUtf8: Uint8Array = new Uint8Array(0);

  // GCM state
  private _gcmH: Uint8Array | null = null;       // Hash subkey H = AES_K(0^128)
  private _gcmJ0: Uint8Array | null = null;       // Initial counter J0
  private _gcmAAD: Uint8Array = new Uint8Array(0); // Additional authenticated data
  private _gcmCiphertext: Uint8Array[] = [];       // Accumulated ciphertext for GHASH
  private _gcmCiphertextLen = 0;                   // Total ciphertext length
  private _gcmExpectedTag: Buffer | null = null;   // Expected authentication tag
  private _gcmAADSet = false;                      // Whether setAAD was called

  constructor(algorithm: string, key: Uint8Array, iv: Uint8Array | null) {
    super(algorithm, key, iv);
    this._prevBlock = new Uint8Array(this._iv);

    if (this._mode === 'gcm') {
      // GCM initialization (same as Cipher)
      this._gcmH = aesEncryptBlock(new Uint8Array(16), this._roundKeys);

      this._gcmJ0 = new Uint8Array(16);
      this._gcmJ0.set(this._iv.subarray(0, 12));
      this._gcmJ0[15] = 1;

      this._counter = new Uint8Array(this._gcmJ0);
      gcmIncrementCounter(this._counter);
    } else {
      this._counter = new Uint8Array(this._iv);
    }
  }

  /**
   * Set Additional Authenticated Data for GCM mode.
   * Must be called before any update() calls.
   */
  setAAD(data: Buffer | Uint8Array): this {
    if (this._mode !== 'gcm') {
      throw new Error('setAAD is only supported in GCM mode');
    }
    if (this._gcmCiphertextLen > 0) {
      throw new Error('setAAD must be called before update()');
    }
    this._gcmAAD = new Uint8Array(data);
    this._gcmAADSet = true;
    return this;
  }

  /**
   * Set the expected authentication tag for GCM decryption.
   * Must be called before final().
   */
  setAuthTag(tag: Buffer | Uint8Array): this {
    if (this._mode !== 'gcm') {
      throw new Error('setAuthTag is only supported in GCM mode');
    }
    this._gcmExpectedTag = Buffer.from(tag);
    return this;
  }

  private _encodeWithUtf8Handling(bytes: Uint8Array, encoding: string | undefined, isFinal: boolean): string | Buffer {
    if (!encoding || (encoding !== 'utf8' && encoding !== 'utf-8')) {
      return encodeOutput(bytes, encoding);
    }

    // Prepend any leftover bytes from previous call
    let data: Uint8Array;
    if (this._pendingUtf8.length > 0) {
      data = new Uint8Array(this._pendingUtf8.length + bytes.length);
      data.set(this._pendingUtf8);
      data.set(bytes, this._pendingUtf8.length);
      this._pendingUtf8 = new Uint8Array(0);
    } else {
      data = bytes;
    }

    if (!isFinal) {
      // Check for incomplete UTF-8 at the end
      const tail = incompleteUtf8Tail(data);
      if (tail > 0) {
        this._pendingUtf8 = new Uint8Array(data.slice(data.length - tail));
        data = new Uint8Array(data.slice(0, data.length - tail));
      }
    }

    return Buffer.from(data).toString('utf8');
  }

  update(data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): string | Buffer {
    const input = toBuffer(data, inputEncoding);

    const combined = new Uint8Array(this._buffer.length + input.length);
    combined.set(this._buffer);
    combined.set(input, this._buffer.length);

    if (this._mode === 'gcm') {
      // GCM uses CTR mode for decryption — process all available bytes
      // Accumulate ciphertext BEFORE decryption (for GHASH)
      this._gcmCiphertext.push(new Uint8Array(combined));
      this._gcmCiphertextLen += combined.length;
      const output = this._processGcmDecrypt(combined);
      this._buffer = new Uint8Array(0);
      return this._encodeWithUtf8Handling(output, outputEncoding, false);
    }

    if (this._mode === 'ctr' || this._mode === 'cfb' || this._mode === 'ofb') {
      const output = this._processStream(combined);
      this._buffer = new Uint8Array(0);
      return this._encodeWithUtf8Handling(output, outputEncoding, false);
    }

    // Block cipher modes: need to keep last block for padding check in final()
    const fullBlocks = Math.floor(combined.length / 16);
    if (fullBlocks === 0) {
      this._buffer = combined;
      return this._encodeWithUtf8Handling(new Uint8Array(0), outputEncoding, false);
    }

    // Keep last block in buffer for padding removal in final()
    const processBlocks = this._autoPadding ? fullBlocks - 1 : fullBlocks;
    const processLen = processBlocks * 16;
    const output: Uint8Array[] = [];

    for (let i = 0; i < processLen; i += 16) {
      const block = combined.slice(i, i + 16);
      output.push(this._decryptBlock(block));
    }

    this._buffer = combined.slice(processLen);
    const result = new Uint8Array(output.length * 16);
    for (let i = 0; i < output.length; i++) result.set(output[i], i * 16);
    return this._encodeWithUtf8Handling(result, outputEncoding, false);
  }

  final(outputEncoding?: string): string | Buffer {
    if (this._finalized) throw new Error('Decipher already finalized');
    this._finalized = true;

    if (this._mode === 'gcm') {
      // GCM: process any remaining buffer, then verify auth tag
      let finalOutput = new Uint8Array(0);
      if (this._buffer.length > 0) {
        // Accumulate remaining ciphertext for GHASH
        this._gcmCiphertext.push(new Uint8Array(this._buffer));
        this._gcmCiphertextLen += this._buffer.length;
        finalOutput = this._processGcmDecrypt(this._buffer) as Uint8Array<ArrayBuffer>;
        this._buffer = new Uint8Array(0);
      }

      // Verify the authentication tag
      if (!this._gcmExpectedTag) {
        throw new Error('Unsupported state or unable to authenticate data');
      }

      // Concatenate all ciphertext chunks for GHASH
      const allCiphertext = new Uint8Array(this._gcmCiphertextLen);
      let offset = 0;
      for (const chunk of this._gcmCiphertext) {
        allCiphertext.set(chunk, offset);
        offset += chunk.length;
      }

      // Compute GHASH(H, AAD, ciphertext)
      const ghashResult = ghash(this._gcmH!, this._gcmAAD, allCiphertext);

      // Tag = GHASH(H, AAD, C) XOR AES_K(J0)
      const encJ0 = aesEncryptBlock(this._gcmJ0!, this._roundKeys);
      const computedTag = new Uint8Array(16);
      for (let i = 0; i < 16; i++) computedTag[i] = ghashResult[i] ^ encJ0[i];

      // Compare tags (constant-time comparison)
      const expectedTag = this._gcmExpectedTag;
      const tagLen = Math.min(expectedTag.length, 16);
      let diff = 0;
      for (let i = 0; i < tagLen; i++) {
        diff |= computedTag[i] ^ expectedTag[i];
      }
      if (diff !== 0) {
        throw new Error('Unsupported state or unable to authenticate data');
      }

      return this._encodeWithUtf8Handling(finalOutput, outputEncoding, true);
    }

    if (this._mode === 'ctr' || this._mode === 'cfb' || this._mode === 'ofb') {
      if (this._buffer.length > 0) {
        const output = this._processStream(this._buffer);
        this._buffer = new Uint8Array(0);
        return this._encodeWithUtf8Handling(output, outputEncoding, true);
      }
      return this._encodeWithUtf8Handling(new Uint8Array(0), outputEncoding, true);
    }

    if (this._buffer.length === 0) {
      return this._encodeWithUtf8Handling(new Uint8Array(0), outputEncoding, true);
    }

    if (this._buffer.length % 16 !== 0) {
      throw new Error('bad decrypt');
    }

    // Decrypt remaining blocks
    const output: Uint8Array[] = [];
    for (let i = 0; i < this._buffer.length; i += 16) {
      output.push(this._decryptBlock(this._buffer.slice(i, i + 16)));
    }

    const combined = new Uint8Array(output.length * 16);
    for (let i = 0; i < output.length; i++) combined.set(output[i], i * 16);

    const result = this._autoPadding ? pkcs7Unpad(combined) : combined;

    this._buffer = new Uint8Array(0);
    return this._encodeWithUtf8Handling(result, outputEncoding, true);
  }

  private _decryptBlock(block: Uint8Array): Uint8Array {
    if (this._mode === 'cbc') {
      const decrypted = aesDecryptBlock(block, this._roundKeys);
      const output = new Uint8Array(16);
      for (let i = 0; i < 16; i++) output[i] = decrypted[i] ^ this._prevBlock[i];
      this._prevBlock = new Uint8Array(block);
      return output;
    } else if (this._mode === 'ecb') {
      return aesDecryptBlock(block, this._roundKeys);
    }
    throw new Error(`Block decryption not supported for mode: ${this._mode}`);
  }

  private _processStream(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      const keystream = aesEncryptBlock(this._counter, this._roundKeys);
      const remaining = Math.min(16, data.length - i);
      for (let j = 0; j < remaining; j++) {
        output[i + j] = data[i + j] ^ keystream[j];
      }
      incrementCounter(this._counter);
    }
    return output;
  }

  /**
   * GCM decryption: CTR mode decryption (same as encryption, since CTR is symmetric).
   */
  private _processGcmDecrypt(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      const keystream = aesEncryptBlock(this._counter, this._roundKeys);
      const remaining = Math.min(16, data.length - i);
      for (let j = 0; j < remaining; j++) {
        output[i + j] = data[i + j] ^ keystream[j];
      }
      gcmIncrementCounter(this._counter);
    }
    return output;
  }
}

// ---- Public API ----

export function createCipher(_algorithm: string, _password: string | Buffer | Uint8Array): never {
  throw new Error('crypto.createCipher() is deprecated. Use createCipheriv() instead.');
}

export function createCipheriv(algorithm: string, key: string | Buffer | Uint8Array, iv: string | Buffer | Uint8Array | null): Cipher {
  const keyBuf = typeof key === 'string' ? Buffer.from(key) : new Uint8Array(key);
  const ivBuf = iv == null ? null : (typeof iv === 'string' ? Buffer.from(iv) : new Uint8Array(iv));
  return new Cipher(algorithm, keyBuf, ivBuf);
}

export function createDecipher(_algorithm: string, _password: string | Buffer | Uint8Array): never {
  throw new Error('crypto.createDecipher() is deprecated. Use createDecipheriv() instead.');
}

export function createDecipheriv(algorithm: string, key: string | Buffer | Uint8Array, iv: string | Buffer | Uint8Array | null): Decipher {
  const keyBuf = typeof key === 'string' ? Buffer.from(key) : new Uint8Array(key);
  const ivBuf = iv == null ? null : (typeof iv === 'string' ? Buffer.from(iv) : new Uint8Array(iv));
  return new Decipher(algorithm, keyBuf, ivBuf);
}

export function getCiphers(): string[] {
  return [
    'aes-128-cbc', 'aes-128-ecb', 'aes-192-cbc', 'aes-192-ecb',
    'aes-256-cbc', 'aes-256-ecb', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
    'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
    'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
  ];
}
