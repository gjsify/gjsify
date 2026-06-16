// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify NativeScript target — NativeScript V8 has no
// GLib and no crypto.subtle, but does ship crypto.getRandomValues and a
// full V8 ES2024 engine. Pure-JS hashing via @noble/hashes.
//
// Reference: Node.js lib/internal/crypto/hash.js
// @noble/hashes: Copyright (c) 2022 Paul Miller (https://paulmillr.com), MIT.

import { Buffer } from 'node:buffer';
import { sha256, sha224, sha384, sha512, sha512_256 } from '@noble/hashes/sha2';
import { sha1, md5 } from '@noble/hashes/legacy';
import { type CHash } from '@noble/hashes/utils';

// Normalise algorithm name to lowercase without hyphens:
// "SHA-256" → "sha256"
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

// Minimal interface matching what @noble/hashes hashers expose.
// Using a structural interface avoids the recursive generic constraint.
interface NobleHasher {
    update(data: Uint8Array): this;
    digest(): Uint8Array;
    clone(): NobleHasher;
}

/**
 * Hash backed by @noble/hashes — fully synchronous, zero native deps.
 * Compatible with the Node.js Hash API subset expected by NS consumers.
 */
export class Hash {
    private _algorithm: string;
    private _hasher: NobleHasher;
    private _finalized = false;

    constructor(algorithm: string) {
        const fn = getNobleHash(algorithm);
        this._algorithm = normalizeAlgorithm(algorithm);
        this._hasher = fn.create() as unknown as NobleHasher;
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

    copy(): Hash {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        const copy = new Hash(this._algorithm);
        copy._hasher = this._hasher.clone();
        return copy;
    }
}

export function createHash(algorithm: string): Hash {
    return new Hash(algorithm);
}

export function getHashes(): string[] {
    return ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-256'];
}

export function hash(
    algorithm: string,
    data: string | Buffer | Uint8Array,
    encoding?: BufferEncoding,
): Buffer | string {
    return new Hash(algorithm).update(data).digest(encoding);
}
