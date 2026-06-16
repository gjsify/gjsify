// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify NativeScript target — NativeScript V8 has no
// GLib and no crypto.subtle. HMAC implemented via @noble/hashes/hmac which
// is pure-JS and fully synchronous.
//
// Reference: Node.js lib/internal/crypto/hash.js, RFC 2104
// @noble/hashes: Copyright (c) 2022 Paul Miller (https://paulmillr.com), MIT.

import { Buffer } from 'node:buffer';
import { hmac } from '@noble/hashes/hmac';
import { sha256, sha224, sha384, sha512, sha512_256 } from '@noble/hashes/sha2';
import { sha1, md5 } from '@noble/hashes/legacy';
import { type CHash } from '@noble/hashes/utils';

function normalizeAlgorithm(algorithm: string): string {
    return algorithm.toLowerCase().replace(/-/g, '');
}

const NOBLE_ALGOS: Record<string, CHash> = {
    sha1,
    sha224,
    sha256,
    sha384,
    sha512,
    sha512256: sha512_256,
    md5,
};

function getNobleHash(algorithm: string): CHash {
    const normalized = normalizeAlgorithm(algorithm);
    const fn = NOBLE_ALGOS[normalized];
    if (!fn) {
        const err: NodeJS.ErrnoException = new Error(`Unknown message digest: ${algorithm}`);
        err.code = 'ERR_CRYPTO_HASH_UNKNOWN';
        throw err;
    }
    return fn;
}

// Minimal interface matching what @noble/hashes HMAC hashers expose.
interface NobleHmac {
    update(data: Uint8Array): this;
    digest(): Uint8Array;
}

/**
 * HMAC backed by @noble/hashes/hmac — fully synchronous, zero native deps.
 * Compatible with the Node.js Hmac API subset expected by NS consumers.
 */
export class Hmac {
    private _hasher: NobleHmac;
    private _finalized = false;

    constructor(algorithm: string, key: string | Buffer | Uint8Array) {
        const fn = getNobleHash(algorithm);

        let keyBytes: Uint8Array;
        if (typeof key === 'string') {
            keyBytes = Buffer.from(key, 'utf8');
        } else {
            keyBytes = key instanceof Uint8Array ? key : Buffer.from(key);
        }

        this._hasher = hmac.create(fn, keyBytes) as unknown as NobleHmac;
    }

    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        let bytes: Uint8Array;
        if (typeof data === 'string') {
            bytes = Buffer.from(data, inputEncoding ?? 'utf8');
        } else {
            bytes = data instanceof Uint8Array ? data : Buffer.from(data);
        }
        this._hasher.update(bytes);
        return this;
    }

    digest(encoding?: BufferEncoding): Buffer | string {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        this._finalized = true;
        const result = this._hasher.digest();
        const buf = Buffer.from(result);
        if (encoding) return buf.toString(encoding);
        return buf;
    }
}

export function createHmac(algorithm: string, key: string | Buffer | Uint8Array): Hmac {
    return new Hmac(algorithm, key);
}
