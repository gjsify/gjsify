// SPDX-License-Identifier: MIT
// Implements AES-128/192/256 (CBC, CTR, ECB, CFB, OFB, GCM) per FIPS-197 (Rijndael) with PKCS#7 padding
// GCM mode implements NIST SP 800-38D (Galois/Counter Mode)
// Adapted from browserify-cipher (refs/browserify-cipher/)
// Copyright (c) crypto-browserify contributors. MIT license.
// Modifications: Pure-JS implementation for GJS, no OpenSSL dependency.
//
// Composition layout (see each module's header for details):
//   - aes-primitives.ts  — AES key expansion + block enc/dec + CTR/GCM
//                          counter helpers + GHASH math (~315 LoC)
//   - cipher-utils.ts    — `AlgorithmInfo` + `parseAlgorithm` + buffer/
//                          encoding helpers + PKCS#7 pad / unpad (~100 LoC)
//   - cipher.ts          — this file: `CipherBase` + `Cipher` + `Decipher`
//                          + factory functions (~540 LoC).

import { Buffer } from 'node:buffer';
import {
  keyExpansion,
  aesEncryptBlock,
  aesDecryptBlock,
  incrementCounter,
  gcmIncrementCounter,
  ghash,
} from './aes-primitives.js';
import {
  type AlgorithmInfo,
  parseAlgorithm,
  toBuffer,
  encodeOutput,
  incompleteUtf8Tail,
  pkcs7Pad,
  pkcs7Unpad,
} from './cipher-utils.js';


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
