// SPDX-License-Identifier: MIT
// AES-128/192/256 block primitives + GF(2^128) GHASH helpers.
//
// Adapted from browserify-cipher (refs/browserify-cipher/) — pure-JS AES
// (Rijndael) per FIPS-197 plus the GCM-mode helpers per NIST SP 800-38D.
// Copyright (c) crypto-browserify contributors. MIT license.
// Modifications: extracted from cipher.ts pre-split as a stand-alone module
// so the `Cipher` / `Decipher` classes can import the primitives without
// pulling in the full encrypt/decrypt machinery. The function bodies are
// otherwise unchanged from the pre-split file.

const SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9,
    0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f,
    0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07,
    0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3,
    0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58,
    0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3,
    0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f,
    0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88,
    0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac,
    0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a,
    0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70,
    0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
    0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
    0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = new Uint8Array([
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb, 0x7c, 0xe3, 0x39,
    0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb, 0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2,
    0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e, 0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76,
    0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25, 0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc,
    0x5d, 0x65, 0xb6, 0x92, 0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d,
    0x84, 0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06, 0xd0, 0x2c,
    0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b, 0x3a, 0x91, 0x11, 0x41, 0x4f,
    0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73, 0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85,
    0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e, 0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62,
    0x0e, 0xaa, 0x18, 0xbe, 0x1b, 0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd,
    0x5a, 0xf4, 0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f, 0x60,
    0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef, 0xa0, 0xe0, 0x3b, 0x4d,
    0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61, 0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6,
    0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
]);

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

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

export function keyExpansion(key: Uint8Array): Uint8Array[] {
    const nk = key.length / 4; // 4, 6, or 8 (128, 192, 256 bits)
    const nr = nk + 6; // 10, 12, or 14 rounds
    const nw = 4 * (nr + 1); // total 32-bit words

    const w = Array.from<Uint8Array>({ length: nw });
    for (let i = 0; i < nk; i++) {
        w[i] = new Uint8Array([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }

    for (let i = nk; i < nw; i++) {
        let temp = new Uint8Array(w[i - 1]);
        if (i % nk === 0) {
            // RotWord + SubWord + Rcon
            temp = new Uint8Array([SBOX[temp[1]] ^ RCON[i / nk - 1], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]]);
        } else if (nk > 6 && i % nk === 4) {
            temp = new Uint8Array([SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]]);
        }
        w[i] = new Uint8Array(4);
        for (let j = 0; j < 4; j++) w[i][j] = w[i - nk][j] ^ temp[j];
    }

    // Convert to round keys (16 bytes each)
    const roundKeys: Uint8Array[] = [];
    for (let r = 0; r <= nr; r++) {
        const rk = new Uint8Array(16);
        for (let c = 0; c < 4; c++) {
            rk[4 * c] = w[4 * r + c][0];
            rk[4 * c + 1] = w[4 * r + c][1];
            rk[4 * c + 2] = w[4 * r + c][2];
            rk[4 * c + 3] = w[4 * r + c][3];
        }
        roundKeys.push(rk);
    }
    return roundKeys;
}

// ---- AES Block Encrypt (16 bytes) ----

export function aesEncryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
    const state = new Uint8Array(block);
    const nr = roundKeys.length - 1;

    // AddRoundKey (initial)
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[0][i];

    for (let round = 1; round < nr; round++) {
        // SubBytes
        for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];

        // ShiftRows
        const t1 = state[1];
        state[1] = state[5];
        state[5] = state[9];
        state[9] = state[13];
        state[13] = t1;
        const t2a = state[2];
        const t2b = state[6];
        state[2] = state[10];
        state[6] = state[14];
        state[10] = t2a;
        state[14] = t2b;
        const t3 = state[15];
        state[15] = state[11];
        state[11] = state[7];
        state[7] = state[3];
        state[3] = t3;

        // MixColumns
        for (let c = 0; c < 4; c++) {
            const i = c * 4;
            const a0 = state[i],
                a1 = state[i + 1],
                a2 = state[i + 2],
                a3 = state[i + 3];
            state[i] = gmul(2, a0) ^ gmul(3, a1) ^ a2 ^ a3;
            state[i + 1] = a0 ^ gmul(2, a1) ^ gmul(3, a2) ^ a3;
            state[i + 2] = a0 ^ a1 ^ gmul(2, a2) ^ gmul(3, a3);
            state[i + 3] = gmul(3, a0) ^ a1 ^ a2 ^ gmul(2, a3);
        }

        // AddRoundKey
        for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round][i];
    }

    // Final round (no MixColumns)
    for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
    const t1f = state[1];
    state[1] = state[5];
    state[5] = state[9];
    state[9] = state[13];
    state[13] = t1f;
    const t2af = state[2];
    const t2bf = state[6];
    state[2] = state[10];
    state[6] = state[14];
    state[10] = t2af;
    state[14] = t2bf;
    const t3f = state[15];
    state[15] = state[11];
    state[11] = state[7];
    state[7] = state[3];
    state[3] = t3f;
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[nr][i];

    return state;
}

// ---- AES Block Decrypt (16 bytes) ----

export function aesDecryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
    const state = new Uint8Array(block);
    const nr = roundKeys.length - 1;

    // AddRoundKey (last round key)
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[nr][i];

    for (let round = nr - 1; round > 0; round--) {
        // InvShiftRows
        const t1 = state[13];
        state[13] = state[9];
        state[9] = state[5];
        state[5] = state[1];
        state[1] = t1;
        const t2a = state[10];
        const t2b = state[14];
        state[10] = state[2];
        state[14] = state[6];
        state[2] = t2a;
        state[6] = t2b;
        const t3 = state[3];
        state[3] = state[7];
        state[7] = state[11];
        state[11] = state[15];
        state[15] = t3;

        // InvSubBytes
        for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];

        // AddRoundKey
        for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round][i];

        // InvMixColumns
        for (let c = 0; c < 4; c++) {
            const i = c * 4;
            const a0 = state[i],
                a1 = state[i + 1],
                a2 = state[i + 2],
                a3 = state[i + 3];
            state[i] = gmul(14, a0) ^ gmul(11, a1) ^ gmul(13, a2) ^ gmul(9, a3);
            state[i + 1] = gmul(9, a0) ^ gmul(14, a1) ^ gmul(11, a2) ^ gmul(13, a3);
            state[i + 2] = gmul(13, a0) ^ gmul(9, a1) ^ gmul(14, a2) ^ gmul(11, a3);
            state[i + 3] = gmul(11, a0) ^ gmul(13, a1) ^ gmul(9, a2) ^ gmul(14, a3);
        }
    }

    // Final inverse round (no InvMixColumns)
    const t1f = state[13];
    state[13] = state[9];
    state[9] = state[5];
    state[5] = state[1];
    state[1] = t1f;
    const t2af = state[10];
    const t2bf = state[14];
    state[10] = state[2];
    state[14] = state[6];
    state[2] = t2af;
    state[6] = t2bf;
    const t3f = state[3];
    state[3] = state[7];
    state[7] = state[11];
    state[11] = state[15];
    state[15] = t3f;
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[0][i];

    return state;
}

// ---- Counter increment for CTR mode ----

export function incrementCounter(counter: Uint8Array): void {
    for (let i = 15; i >= 0; i--) {
        if (++counter[i] !== 0) break;
    }
}

// ---- GCM counter increment (only the last 32 bits) ----

export function gcmIncrementCounter(counter: Uint8Array): void {
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
export function ghash(H: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
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
