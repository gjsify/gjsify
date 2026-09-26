// Sign/Verify — RSA PKCS#1 v1.5 signature scheme for GJS, plus the one-shot
// crypto.sign / crypto.verify (RSA via the classes, Ed25519 via curve25519.ts)
// Reference: refs/browserify-sign/browser/sign.js, refs/browserify-sign/browser/verify.js
// Reimplemented for GJS using native BigInt (ES2024)

import { Buffer } from 'node:buffer';
import { Hash } from './hash.js';
import { parsePemKey, rsaKeySize } from './asn1.js';
import type { ParsedKey } from './asn1.js';
import { modPow, bigIntToBytes, bytesToBigInt } from './bigint-math.js';
import { codedError } from './crypto-utils.js';
import { ed25519Sign, ed25519Verify } from './curve25519.js';
import { KeyObject, okpKeyMaterial, toKeyObject } from './key-object.js';

/**
 * Node's streaming Sign/Verify cannot drive a pure EdDSA key (the message is
 * hashed inside the algorithm), and an X25519 key cannot sign at all — the two
 * refuse with different codes, OpenSSL's for the latter.
 */
function rejectOkpKey(parsed: ParsedKey): void {
    if (parsed.type !== 'okp-public' && parsed.type !== 'okp-private') return;
    if (parsed.curve === 'ed25519') {
        throw codedError('ERR_CRYPTO_UNSUPPORTED_OPERATION', 'Unsupported crypto operation');
    }
    throw codedError(
        'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE',
        'error:03000096:digital envelope routines::operation not supported for this keytype',
    );
}

// PKCS#1 v1.5 DigestInfo structures

/**
 * DigestInfo DER prefix bytes for each supported hash algorithm.
 * These encode: SEQUENCE { SEQUENCE { OID hashAlg, NULL }, OCTET STRING hashValue }
 * excluding the actual hash value at the end.
 */
const DIGEST_INFO_PREFIX: Record<string, Uint8Array> = {
    sha1: new Uint8Array([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]),
    sha256: new Uint8Array([
        0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04,
        0x20,
    ]),
    sha512: new Uint8Array([
        0x30, 0x51, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03, 0x05, 0x00, 0x04,
        0x40,
    ]),
};

// Algorithm normalization

/**
 * Normalize algorithm strings like "RSA-SHA256", "SHA256", "sha256" to
 * the canonical hash name used internally (e.g. "sha256").
 */
function normalizeSignAlgorithm(algorithm: string): string {
    let alg = algorithm.toLowerCase().replace(/-/g, '');
    // Strip leading "rsa" prefix (e.g., "rsasha256" -> "sha256")
    if (alg.startsWith('rsa')) {
        alg = alg.slice(3);
    }
    if (!DIGEST_INFO_PREFIX[alg]) {
        throw new Error(`Unsupported algorithm: ${algorithm}. Supported: RSA-SHA1, RSA-SHA256, RSA-SHA512`);
    }
    return alg;
}

// Key extraction helpers

interface KeyInput {
    key: string;
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
        if (Buffer.isBuffer(k) || (k as unknown) instanceof Uint8Array)
            return Buffer.from(k as Uint8Array).toString('utf8');
    }
    throw new TypeError('Invalid key argument');
}

// Sign class

/**
 * The Sign class generates RSA PKCS#1 v1.5 signatures.
 *
 * Usage:
 *   const sign = createSign('RSA-SHA256');
 *   sign.update('data');
 *   const signature = sign.sign(privateKey);
 */
export class Sign {
    private _algorithm: string;
    private _hash: Hash;
    private _finalized = false;

    constructor(algorithm: string) {
        this._algorithm = normalizeSignAlgorithm(algorithm);
        this._hash = new Hash(this._algorithm);
    }

    /**
     * Update the Sign object with the given data.
     */
    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
        if (this._finalized) {
            throw new Error('Sign was already finalized');
        }
        this._hash.update(data, inputEncoding);
        return this;
    }

    /**
     * Compute the signature using the private key.
     * Returns the signature as a Buffer (or string if outputEncoding is given).
     */
    sign(privateKey: string | Buffer | KeyInput, outputEncoding?: BufferEncoding): Buffer | string {
        if (this._finalized) {
            throw new Error('Sign was already finalized');
        }
        this._finalized = true;

        // Hash the accumulated data
        const digest = this._hash.digest() as Buffer;

        // Parse the private key
        const pem = extractPem(privateKey);
        const parsed = parsePemKey(pem);
        rejectOkpKey(parsed);
        if (parsed.type !== 'rsa-private') {
            throw new Error('privateKey must be an RSA private key');
        }
        const { n, d } = parsed.components;
        const keyLen = rsaKeySize(n);

        // Build DigestInfo = prefix || hash
        const prefix = DIGEST_INFO_PREFIX[this._algorithm];
        const digestInfo = new Uint8Array(prefix.length + digest.length);
        digestInfo.set(prefix, 0);
        digestInfo.set(digest, prefix.length);

        // Apply PKCS#1 v1.5 Type 1 padding
        // 0x00 0x01 [0xFF padding] 0x00 [DigestInfo]
        const padLen = keyLen - digestInfo.length - 3;
        if (padLen < 8) {
            throw new Error('Key is too short for the specified hash algorithm');
        }

        const em = new Uint8Array(keyLen);
        em[0] = 0x00;
        em[1] = 0x01;
        for (let i = 2; i < 2 + padLen; i++) {
            em[i] = 0xff;
        }
        em[2 + padLen] = 0x00;
        em.set(digestInfo, 3 + padLen);

        // RSA private key operation: signature = em^d mod n
        const m = bytesToBigInt(em);
        const s = modPow(m, d, n);
        const sigBytes = bigIntToBytes(s, keyLen);
        const sigBuf = Buffer.from(sigBytes);

        if (outputEncoding) {
            return sigBuf.toString(outputEncoding);
        }
        return sigBuf;
    }
}

// Verify class

/**
 * The Verify class verifies RSA PKCS#1 v1.5 signatures.
 *
 * Usage:
 *   const verify = createVerify('RSA-SHA256');
 *   verify.update('data');
 *   const ok = verify.verify(publicKey, signature);
 */
export class Verify {
    private _algorithm: string;
    private _hash: Hash;
    private _finalized = false;

    constructor(algorithm: string) {
        this._algorithm = normalizeSignAlgorithm(algorithm);
        this._hash = new Hash(this._algorithm);
    }

    /**
     * Update the Verify object with the given data.
     */
    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
        if (this._finalized) {
            throw new Error('Verify was already finalized');
        }
        this._hash.update(data, inputEncoding);
        return this;
    }

    /**
     * Verify the signature against the public key.
     * Returns true if the signature is valid, false otherwise.
     */
    verify(
        publicKey: string | Buffer | KeyInput,
        signature: string | Buffer | Uint8Array,
        signatureEncoding?: BufferEncoding,
    ): boolean {
        if (this._finalized) {
            throw new Error('Verify was already finalized');
        }
        this._finalized = true;

        // Hash the accumulated data
        const digest = this._hash.digest() as Buffer;

        // Parse the public key
        const pem = extractPem(publicKey);
        const parsed = parsePemKey(pem);
        rejectOkpKey(parsed);

        let n: bigint;
        let e: bigint;
        if (parsed.type === 'rsa-public') {
            n = parsed.components.n;
            e = parsed.components.e;
        } else if (parsed.type === 'rsa-private') {
            // Allow using a private key for verification (extract public components)
            n = parsed.components.n;
            e = parsed.components.e;
        } else {
            throw new Error('publicKey must be an RSA public or private key');
        }

        const keyLen = rsaKeySize(n);

        // Decode the signature
        let sigBytes: Uint8Array;
        if (typeof signature === 'string') {
            sigBytes = Buffer.from(signature, signatureEncoding || 'base64');
        } else {
            sigBytes = signature instanceof Uint8Array ? signature : Buffer.from(signature);
        }

        if (sigBytes.length !== keyLen) {
            return false;
        }

        // RSA public key operation: em = signature^e mod n
        const s = bytesToBigInt(sigBytes);
        if (s >= n) {
            return false;
        }
        const m = modPow(s, e, n);
        const em = bigIntToBytes(m, keyLen);

        // Verify PKCS#1 v1.5 Type 1 padding structure
        // Expected: 0x00 0x01 [0xFF...] 0x00 [DigestInfo]
        if (em[0] !== 0x00 || em[1] !== 0x01) {
            return false;
        }

        // Find the 0x00 separator after the 0xFF padding
        let sepIdx = 2;
        while (sepIdx < em.length && em[sepIdx] === 0xff) {
            sepIdx++;
        }
        if (sepIdx >= em.length || em[sepIdx] !== 0x00) {
            return false;
        }
        // Must have at least 8 bytes of 0xFF padding
        if (sepIdx - 2 < 8) {
            return false;
        }
        sepIdx++; // skip the 0x00 separator

        // Extract DigestInfo from the decrypted message
        const recoveredDigestInfo = em.slice(sepIdx);

        // Build expected DigestInfo
        const prefix = DIGEST_INFO_PREFIX[this._algorithm];
        const expectedDigestInfo = new Uint8Array(prefix.length + digest.length);
        expectedDigestInfo.set(prefix, 0);
        expectedDigestInfo.set(digest, prefix.length);

        // Constant-time comparison
        if (recoveredDigestInfo.length !== expectedDigestInfo.length) {
            return false;
        }
        let diff = 0;
        for (let i = 0; i < recoveredDigestInfo.length; i++) {
            diff |= recoveredDigestInfo[i] ^ expectedDigestInfo[i];
        }
        return diff === 0;
    }
}

// Factory functions

/**
 * Create and return a Sign object for the given algorithm.
 */
export function createSign(algorithm: string): Sign {
    return new Sign(algorithm);
}

/**
 * Create and return a Verify object for the given algorithm.
 */
export function createVerify(algorithm: string): Verify {
    return new Verify(algorithm);
}

// One-shot sign / verify

type SignKeyInput = KeyObject | string | Buffer | { key: unknown; context?: Uint8Array; [k: string]: unknown };

function contextOf(key: SignKeyInput): Uint8Array | undefined {
    if (typeof key !== 'object' || key === null || key instanceof KeyObject || Buffer.isBuffer(key)) return undefined;
    const context = (key as { context?: Uint8Array }).context;
    return context === undefined ? undefined : new Uint8Array(context);
}

function toBytes(data: string | ArrayBufferView, name: string): Uint8Array {
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw codedError(
        'ERR_INVALID_ARG_TYPE',
        `The "${name}" argument must be an instance of Buffer, TypedArray, or DataView.`,
        TypeError,
    );
}

/** PEM of a KeyObject for the RSA class path, which parses PEM. */
function rsaPem(key: KeyObject): string {
    return key.export({ format: 'pem', type: key.type === 'private' ? 'pkcs1' : 'spki' }) as string;
}

/** EdDSA fixes its own hash: Node (OpenSSL) refuses any digest name for it. */
function rejectDigestForEdDSA(algorithm: string | null | undefined): void {
    if (algorithm !== null && algorithm !== undefined) {
        throw codedError('ERR_OSSL_INVALID_DIGEST', 'error:1C80007A:Provider routines::invalid digest');
    }
}

function oneShotSign(algorithm: string | null | undefined, data: Uint8Array, key: SignKeyInput): Buffer {
    const keyObject = toKeyObject(key, 'private');
    const okp = okpKeyMaterial(keyObject);
    if (okp) {
        if (okp.curve !== 'ed25519')
            rejectOkpKey({ type: 'okp-private', curve: okp.curve, priv: okp.priv as Uint8Array });
        rejectDigestForEdDSA(algorithm);
        return Buffer.from(ed25519Sign(okp.priv as Uint8Array, data, contextOf(key)));
    }
    const signer = new Sign(algorithm ?? 'sha256');
    signer.update(Buffer.from(data));
    return signer.sign(rsaPem(keyObject)) as Buffer;
}

function oneShotVerify(
    algorithm: string | null | undefined,
    data: Uint8Array,
    key: SignKeyInput,
    signature: Uint8Array,
): boolean {
    const keyObject = toKeyObject(key, 'public');
    const okp = okpKeyMaterial(keyObject);
    if (okp) {
        if (okp.curve !== 'ed25519') rejectOkpKey({ type: 'okp-public', curve: okp.curve, pub: okp.pub });
        rejectDigestForEdDSA(algorithm);
        return ed25519Verify(okp.pub, data, signature, contextOf(key));
    }
    const verifier = new Verify(algorithm ?? 'sha256');
    verifier.update(Buffer.from(data));
    return verifier.verify(rsaPem(keyObject), signature);
}

/**
 * crypto.sign(algorithm, data, key[, callback]). For Ed25519 `algorithm` is
 * null/undefined (EdDSA fixes its own hash); a `{ key, context }` input selects
 * Ed25519ctx, an empty context is plain Ed25519 — both as in Node.
 */
export function sign(
    algorithm: string | null | undefined,
    data: string | ArrayBufferView,
    key: SignKeyInput,
    callback?: (err: Error | null, signature?: Buffer) => void,
): Buffer | void {
    const bytes = toBytes(data, 'data');
    if (callback === undefined) return oneShotSign(algorithm, bytes, key);
    let result: Buffer;
    try {
        result = oneShotSign(algorithm, bytes, key);
    } catch (err) {
        // The callback form reports failures through the callback, never by throwing.
        setTimeout(() => callback(err as Error), 0);
        return;
    }
    setTimeout(() => callback(null, result), 0);
}

/** crypto.verify(algorithm, data, key, signature[, callback]). */
export function verify(
    algorithm: string | null | undefined,
    data: string | ArrayBufferView,
    key: SignKeyInput,
    signature: ArrayBufferView,
    callback?: (err: Error | null, result?: boolean) => void,
): boolean | void {
    const bytes = toBytes(data, 'data');
    const sig = toBytes(signature, 'signature');
    if (callback === undefined) return oneShotVerify(algorithm, bytes, key, sig);
    let result: boolean;
    try {
        result = oneShotVerify(algorithm, bytes, key, sig);
    } catch (err) {
        // The callback form reports failures through the callback, never by throwing.
        setTimeout(() => callback(err as Error), 0);
        return;
    }
    setTimeout(() => callback(null, result), 0);
}
