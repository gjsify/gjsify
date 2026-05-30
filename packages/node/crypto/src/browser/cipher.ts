// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-ref: browserify-cipher).
//
// Architectural note: Node's Cipher API is streaming + sync (`update()`,
// `final()`); WebCrypto's `subtle.encrypt`/`decrypt` is one-shot + async.
// We buffer all `update()` chunks and resolve the cipher operation in
// `finalAsync()`. The sync `final()` throws `ENOTSUP_SYNC_CIPHER`.

import { Buffer } from 'node:buffer';

type AesMode = 'aes-cbc' | 'aes-ctr' | 'aes-gcm';

interface ParsedCipherName {
    /** WebCrypto AlgorithmIdentifier mode prefix, e.g. "AES-CBC". */
    webMode: 'AES-CBC' | 'AES-CTR' | 'AES-GCM';
    /** Key bit-length: 128/192/256. */
    keyBits: 128 | 192 | 256;
    /** Short mode tag used internally. */
    aesMode: AesMode;
}

function parseCipherName(name: string): ParsedCipherName {
    const lower = name.toLowerCase().replace(/_/g, '-');
    const match = lower.match(/^aes-(128|192|256)-(cbc|ctr|gcm)$/);
    if (!match) {
        const err: NodeJS.ErrnoException = new Error(
            `Unsupported cipher in browser builds: ${name}. ` +
                `Supported: aes-{128,192,256}-{cbc,ctr,gcm}.`,
        );
        err.code = 'ENOTSUP_CIPHER';
        throw err;
    }
    const keyBits = Number(match[1]) as 128 | 192 | 256;
    const modeTag = match[2] as 'cbc' | 'ctr' | 'gcm';
    return {
        webMode: `AES-${modeTag.toUpperCase()}` as ParsedCipherName['webMode'],
        keyBits,
        aesMode: `aes-${modeTag}` as AesMode,
    };
}

function getWebSubtle(): SubtleCrypto {
    if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
        throw new Error('WebCrypto SubtleCrypto is unavailable in this environment');
    }
    return globalThis.crypto.subtle;
}

function toBytes(input: string | Buffer | Uint8Array): Uint8Array {
    if (typeof input === 'string') return Buffer.from(input, 'utf8');
    return input instanceof Uint8Array ? input : Buffer.from(input);
}

function syncUnsupportedError(): Error {
    const err: NodeJS.ErrnoException = new Error(
        'Synchronous Cipher.final() / Decipher.final() is not supported in browser builds. ' +
            'Use finalAsync() (returns Promise<Buffer>) or await crypto.subtle.encrypt/decrypt directly.',
    );
    err.code = 'ENOTSUP_SYNC_CIPHER';
    return err;
}

abstract class CipherBase {
    protected _parsed: ParsedCipherName;
    protected _key: Uint8Array;
    protected _iv: Uint8Array;
    protected _chunks: Uint8Array[] = [];
    protected _aad: Uint8Array | null = null;
    protected _authTag: Uint8Array | null = null;
    protected _finalized = false;

    constructor(name: string, key: Uint8Array, iv: Uint8Array) {
        this._parsed = parseCipherName(name);
        if (key.byteLength * 8 !== this._parsed.keyBits) {
            throw new RangeError(
                `Invalid key length: got ${key.byteLength * 8} bits, expected ${this._parsed.keyBits}.`,
            );
        }
        this._key = key;
        this._iv = iv;
    }

    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): Buffer {
        if (this._finalized) {
            throw new Error('Cipher already finalised');
        }
        const bytes = typeof data === 'string' ? Buffer.from(data, inputEncoding ?? 'utf8') : toBytes(data);
        this._chunks.push(bytes);
        // Streaming output is not possible without re-encrypting; Node's API
        // accepts an empty chunk return on `update()` calls that haven't yet
        // emitted a full block, and the rest comes out on `final()`. We
        // collect all data and emit everything via `finalAsync()`.
        return Buffer.alloc(0);
    }

    setAAD(buffer: Buffer | Uint8Array): this {
        if (this._parsed.aesMode !== 'aes-gcm') {
            throw new Error('setAAD() is only valid for AES-GCM');
        }
        this._aad = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);
        return this;
    }

    /** Sync final — throws ENOTSUP_SYNC_CIPHER. */
    final(_outputEncoding?: BufferEncoding): Buffer | string {
        throw syncUnsupportedError();
    }

    protected _allBytes(): Uint8Array {
        if (this._chunks.length === 0) return new Uint8Array(0);
        if (this._chunks.length === 1) return this._chunks[0];
        const totalLen = this._chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of this._chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out;
    }

    protected _algorithmParams(): AesCbcParams | AesCtrParams | AesGcmParams {
        switch (this._parsed.aesMode) {
            case 'aes-cbc':
                return { name: 'AES-CBC', iv: this._iv as BufferSource };
            case 'aes-ctr':
                // Node `crypto.createCipheriv('aes-256-ctr', key, iv)` IV is the full 16-byte counter.
                return { name: 'AES-CTR', counter: this._iv as BufferSource, length: 64 };
            case 'aes-gcm':
                return {
                    name: 'AES-GCM',
                    iv: this._iv as BufferSource,
                    ...(this._aad ? { additionalData: this._aad as BufferSource } : {}),
                };
        }
    }
}

export class Cipher extends CipherBase {
    /** Async final — preferred entry. Returns ciphertext (incl. GCM tag appended). */
    async finalAsync(outputEncoding?: BufferEncoding): Promise<Buffer | string> {
        if (this._finalized) {
            throw new Error('Cipher already finalised');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const cryptoKey = await subtle.importKey('raw', this._key as BufferSource, this._parsed.webMode, false, ['encrypt']);
        const cipherText = await subtle.encrypt(this._algorithmParams(), cryptoKey, this._allBytes() as BufferSource);
        const buf = Buffer.from(cipherText);
        if (this._parsed.aesMode === 'aes-gcm') {
            // WebCrypto GCM returns ciphertext || tag concatenated; extract tag for getAuthTag().
            this._authTag = buf.subarray(buf.byteLength - 16);
        }
        return outputEncoding ? buf.toString(outputEncoding) : buf;
    }

    /** GCM auth tag — only valid after `finalAsync()`. */
    getAuthTag(): Buffer {
        if (this._parsed.aesMode !== 'aes-gcm') {
            throw new Error('getAuthTag() is only valid for AES-GCM');
        }
        if (!this._authTag) {
            throw new Error('getAuthTag() called before finalAsync()');
        }
        return Buffer.from(this._authTag);
    }
}

export class Decipher extends CipherBase {
    setAuthTag(buffer: Buffer | Uint8Array): this {
        if (this._parsed.aesMode !== 'aes-gcm') {
            throw new Error('setAuthTag() is only valid for AES-GCM');
        }
        this._authTag = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);
        return this;
    }

    /** Async final — preferred entry. Returns plaintext. */
    async finalAsync(outputEncoding?: BufferEncoding): Promise<Buffer | string> {
        if (this._finalized) {
            throw new Error('Cipher already finalised');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const cryptoKey = await subtle.importKey('raw', this._key as BufferSource, this._parsed.webMode, false, ['decrypt']);

        // For GCM, WebCrypto expects ciphertext || tag concatenated; Node API
        // splits the tag via setAuthTag(). Recombine before calling subtle.decrypt.
        let body = this._allBytes();
        if (this._parsed.aesMode === 'aes-gcm') {
            if (!this._authTag) {
                throw new Error('GCM decrypt requires setAuthTag() before finalAsync()');
            }
            const combined = new Uint8Array(body.byteLength + this._authTag.byteLength);
            combined.set(body, 0);
            combined.set(this._authTag, body.byteLength);
            body = combined;
        }

        const plain = await subtle.decrypt(this._algorithmParams(), cryptoKey, body as BufferSource);
        const buf = Buffer.from(plain);
        return outputEncoding ? buf.toString(outputEncoding) : buf;
    }
}

export function createCipheriv(
    algorithm: string,
    key: Buffer | Uint8Array | string,
    iv: Buffer | Uint8Array | string,
): Cipher {
    return new Cipher(algorithm, toBytes(key), toBytes(iv));
}

export function createDecipheriv(
    algorithm: string,
    key: Buffer | Uint8Array | string,
    iv: Buffer | Uint8Array | string,
): Decipher {
    return new Decipher(algorithm, toBytes(key), toBytes(iv));
}

/**
 * Legacy `createCipher(algorithm, password)` — deprecated in Node and unsafe;
 * not supported in browser builds because it requires a sync PBKDF1
 * key-derivation that WebCrypto cannot reproduce.
 */
export function createCipher(_algorithm: string, _password: string | Buffer | Uint8Array): never {
    const err: NodeJS.ErrnoException = new Error(
        'createCipher() is deprecated and not supported in browser builds. Use createCipheriv() with an explicit IV.',
    );
    err.code = 'ENOTSUP_LEGACY_CIPHER';
    throw err;
}

export function createDecipher(_algorithm: string, _password: string | Buffer | Uint8Array): never {
    const err: NodeJS.ErrnoException = new Error(
        'createDecipher() is deprecated and not supported in browser builds. Use createDecipheriv() with an explicit IV.',
    );
    err.code = 'ENOTSUP_LEGACY_CIPHER';
    throw err;
}

export function getCiphers(): string[] {
    return ['aes-128-cbc', 'aes-192-cbc', 'aes-256-cbc', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm'];
}
