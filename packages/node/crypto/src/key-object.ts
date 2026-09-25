// KeyObject implementation for GJS
// Reference: Node.js lib/internal/crypto/keys.js
// Reimplemented for GJS using existing ASN.1 parser

import { Buffer } from 'node:buffer';
import {
    parsePemKey,
    parseDerKey,
    rsaKeySize,
    encodeOkpSubjectPublicKeyInfo,
    encodeOkpPrivateKeyInfo,
    encodeSubjectPublicKeyInfo,
    encodeRsaPublicKeyPkcs1,
    encodeRsaPrivateKeyPkcs1,
    encodePrivateKeyInfo,
    derToPem,
} from './asn1.js';
import type { ParsedKey, RsaPublicComponents, RsaPrivateComponents, OkpCurve } from './asn1.js';
import { okpPublicFromPrivate, OKP_KEY_BYTES } from './curve25519.js';
import { codedError } from './crypto-utils.js';

/**
 * Handle of an asymmetric KeyObject. `okpPub` caches the public half of an
 * RFC 8410 key — for a private key it is derived once, at import.
 */
interface AsymmetricHandle {
    parsed: ParsedKey;
    pem: string;
    okpPub?: Uint8Array;
}

const OKP_JWK_CRV: Record<OkpCurve, string> = { ed25519: 'Ed25519', x25519: 'X25519' };

/** Convert BigInt to base64url-encoded string (no padding). */
function bigintToBase64url(value: bigint): string {
    if (value === 0n) return 'AA';
    const hex = value.toString(16);
    const paddedHex = hex.length % 2 ? '0' + hex : hex;
    const bytes: number[] = [];
    for (let i = 0; i < paddedHex.length; i += 2) {
        bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
    }
    return Buffer.from(bytes).toString('base64url');
}

/** Convert base64url-encoded string to BigInt. */
function base64urlToBigint(b64: string): bigint {
    const buf = Buffer.from(b64, 'base64url');
    let result = 0n;
    for (let i = 0; i < buf.length; i++) {
        result = (result << 8n) | BigInt(buf[i]);
    }
    return result;
}

export class KeyObject {
    readonly type: 'secret' | 'public' | 'private';

    /** @internal */
    _handle: unknown;

    constructor(type: 'secret' | 'public' | 'private', handle: unknown) {
        if (type !== 'secret' && type !== 'public' && type !== 'private') {
            throw new TypeError(`Invalid KeyObject type: ${type}`);
        }
        this.type = type;
        this._handle = handle;
    }

    get symmetricKeySize(): number | undefined {
        if (this.type !== 'secret') return undefined;
        return (this._handle as Uint8Array).byteLength;
    }

    get asymmetricKeyType(): string | undefined {
        if (this.type === 'secret') return undefined;
        const handle = this._handle as { parsed: ParsedKey; pem: string };
        if (handle.parsed.type === 'rsa-public' || handle.parsed.type === 'rsa-private') {
            return 'rsa';
        }
        return handle.parsed.curve;
    }

    /** Node: `{ modulusLength, publicExponent }` for RSA, `{}` for the RFC 8410 curves. */
    get asymmetricKeyDetails(): { modulusLength?: number; publicExponent?: bigint } | undefined {
        if (this.type === 'secret') return undefined;
        const parsed = (this._handle as AsymmetricHandle).parsed;
        if (parsed.type === 'rsa-public' || parsed.type === 'rsa-private') {
            return { modulusLength: rsaKeySize(parsed.components.n) * 8, publicExponent: parsed.components.e };
        }
        return {};
    }

    get asymmetricKeySize(): number | undefined {
        if (this.type === 'secret') return undefined;
        const handle = this._handle as { parsed: ParsedKey; pem: string };
        if (handle.parsed.type === 'rsa-public') {
            return rsaKeySize(handle.parsed.components.n) / 8;
        }
        if (handle.parsed.type === 'rsa-private') {
            return rsaKeySize(handle.parsed.components.n) / 8;
        }
        return undefined;
    }

    equals(otherKeyObject: KeyObject): boolean {
        if (!(otherKeyObject instanceof KeyObject)) return false;
        if (this.type !== otherKeyObject.type) return false;

        if (this.type === 'secret') {
            const a = this._handle as Uint8Array;
            const b = otherKeyObject._handle as Uint8Array;
            if (a.byteLength !== b.byteLength) return false;
            for (let i = 0; i < a.byteLength; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }

        // For asymmetric keys, compare PEM strings
        const a = this._handle as { pem: string };
        const b = otherKeyObject._handle as { pem: string };
        return a.pem === b.pem;
    }

    export(options?: {
        type?: string;
        format?: string;
        cipher?: string;
        passphrase?: unknown;
    }): Buffer | string | object {
        if (this.type === 'secret') {
            const key = this._handle as Uint8Array;
            if (options?.format === 'jwk') {
                return {
                    kty: 'oct',
                    k: Buffer.from(key).toString('base64url'),
                };
            }
            return Buffer.from(key);
        }

        const handle = this._handle as AsymmetricHandle;
        const format = options?.format ?? 'pem';
        const keyType = options?.type;

        if (handle.parsed.type === 'okp-public' || handle.parsed.type === 'okp-private') {
            return exportOkp(handle, this.type, format, keyType, options);
        }

        if (format === 'jwk') {
            return exportJwk(handle.parsed, this.type);
        }

        if (format === 'pem') {
            // If we have a valid PEM (not derived marker), return it directly
            if (handle.pem && !handle.pem.startsWith('[')) {
                return handle.pem;
            }
            // Generate PEM from components
            return generatePem(handle.parsed, this.type, keyType);
        }

        if (format === 'der') {
            // If we have a valid PEM, extract DER from it
            if (handle.pem && !handle.pem.startsWith('[')) {
                const lines = handle.pem.trim().split(/\r?\n/);
                const headerIdx = lines.findIndex((l) => l.startsWith('-----BEGIN '));
                const footerIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith('-----END '));
                const base64Body = lines.slice(headerIdx + 1, footerIdx).join('');
                return Buffer.from(base64Body, 'base64');
            }
            // Generate DER from components
            return generateDer(handle.parsed, this.type, keyType);
        }

        throw new TypeError(`Unsupported export format: ${format}`);
    }

    get [Symbol.toStringTag]() {
        return 'KeyObject';
    }
}

function exportOkp(
    handle: AsymmetricHandle,
    keyType: 'public' | 'private',
    format: string,
    type: string | undefined,
    options: { cipher?: string; passphrase?: unknown } | undefined,
): Buffer | string | object {
    const parsed = handle.parsed as Extract<ParsedKey, { type: 'okp-public' | 'okp-private' }>;
    const pub = handle.okpPub as Uint8Array;
    if (format === 'jwk') {
        const jwk: Record<string, string> = { crv: OKP_JWK_CRV[parsed.curve] };
        if (keyType === 'private') jwk.d = Buffer.from((parsed as { priv: Uint8Array }).priv).toString('base64url');
        jwk.x = Buffer.from(pub).toString('base64url');
        jwk.kty = 'OKP';
        return jwk;
    }
    if (format !== 'pem' && format !== 'der') {
        throw codedError(
            'ERR_INVALID_ARG_VALUE',
            `The property 'options.format' is invalid. Received '${format}'`,
            TypeError,
        );
    }
    const expected = keyType === 'public' ? 'spki' : 'pkcs8';
    if (type !== undefined && type !== expected) {
        throw codedError(
            'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS',
            type === 'pkcs1' || type === 'sec1'
                ? `The selected key encoding ${type} can only be used for ${type === 'pkcs1' ? 'RSA' : 'EC'} keys.`
                : `The property 'options.type' is invalid. Received '${type}'`,
        );
    }
    if (options?.cipher !== undefined || options?.passphrase !== undefined) {
        throw codedError('ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 'Encrypted private key export is not supported');
    }
    const der =
        keyType === 'public'
            ? encodeOkpSubjectPublicKeyInfo(parsed.curve, pub)
            : encodeOkpPrivateKeyInfo(parsed.curve, (parsed as { priv: Uint8Array }).priv);
    return format === 'der'
        ? Buffer.from(der)
        : derToPem(der, keyType === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY') + '\n';
}

/** Build the KeyObject for a parsed key, deriving the public half of an RFC 8410 private key. */
function asymmetricKeyObject(parsed: ParsedKey, kind: 'public' | 'private', pem?: string): KeyObject {
    if (parsed.type === 'okp-private') {
        const okpPub = okpPublicFromPrivate(parsed.curve, parsed.priv);
        if (kind === 'public') {
            return asymmetricKeyObject({ type: 'okp-public', curve: parsed.curve, pub: okpPub }, 'public');
        }
        const der = encodeOkpPrivateKeyInfo(parsed.curve, parsed.priv);
        return new KeyObject('private', {
            parsed,
            pem: derToPem(der, 'PRIVATE KEY'),
            okpPub,
        } satisfies AsymmetricHandle);
    }
    if (parsed.type === 'okp-public') {
        if (kind === 'private') throw new TypeError('Key is not a private key');
        const der = encodeOkpSubjectPublicKeyInfo(parsed.curve, parsed.pub);
        return new KeyObject('public', {
            parsed,
            pem: derToPem(der, 'PUBLIC KEY'),
            okpPub: parsed.pub,
        } satisfies AsymmetricHandle);
    }
    if (parsed.type === 'rsa-private' && kind === 'public') {
        const pubComponents: RsaPublicComponents = { n: parsed.components.n, e: parsed.components.e };
        const der = encodeSubjectPublicKeyInfo(pubComponents);
        return new KeyObject('public', {
            parsed: { type: 'rsa-public', components: pubComponents },
            pem: derToPem(der, 'PUBLIC KEY'),
        } satisfies AsymmetricHandle);
    }
    if (parsed.type === 'rsa-public' && kind === 'private') {
        throw new TypeError('Key is not a private key');
    }
    return new KeyObject(kind, { parsed, pem: pem ?? generatePem(parsed, kind) } satisfies AsymmetricHandle);
}

/** RFC 8037 OKP JWK → parsed key. Node's rules: `crv` must name the curve, the key field must be 32 bytes. */
function parseJwkOkp(jwk: Record<string, unknown>, kind: 'public' | 'private'): ParsedKey {
    const curve = (Object.keys(OKP_JWK_CRV) as OkpCurve[]).find((c) => OKP_JWK_CRV[c] === jwk.crv);
    if (!curve) {
        throw codedError(
            'ERR_INVALID_ARG_VALUE',
            `The property 'key.crv' must be one of: 'Ed25519', 'X25519'. Received ${JSON.stringify(jwk.crv)}`,
            TypeError,
        );
    }
    const field = kind === 'private' ? jwk.d : jwk.x;
    if (typeof jwk.x !== 'string' || typeof field !== 'string') {
        throw codedError('ERR_CRYPTO_INVALID_JWK', 'Invalid JWK OKP key');
    }
    const bytes = new Uint8Array(Buffer.from(field, 'base64url'));
    if (bytes.length !== OKP_KEY_BYTES) {
        throw codedError('ERR_CRYPTO_INVALID_JWK', 'Invalid JWK OKP key');
    }
    return kind === 'private' ? { type: 'okp-private', curve, priv: bytes } : { type: 'okp-public', curve, pub: bytes };
}

/** A `{ key, format: 'jwk' }` input → parsed key (RSA or OKP). */
function parseJwk(jwk: Record<string, unknown>, kind: 'public' | 'private'): { parsed: ParsedKey; pem?: string } {
    if (jwk === null || typeof jwk !== 'object') {
        throw codedError('ERR_INVALID_ARG_TYPE', 'The "key.key" property must be of type object', TypeError);
    }
    if (jwk.kty === 'OKP') {
        return { parsed: parseJwkOkp(jwk, kind) };
    }
    if (jwk.kty === 'RSA') {
        if (kind === 'private' && !jwk.d) throw new Error('JWK does not contain a private key');
        return importJwkRsa(kind === 'private' ? jwk : { n: jwk.n, e: jwk.e });
    }
    throw codedError(
        'ERR_INVALID_ARG_VALUE',
        `The property 'key.kty' must be one of: 'RSA', 'EC', 'OKP'. Received ${JSON.stringify(jwk.kty)}`,
        TypeError,
    );
}

function exportJwk(parsed: ParsedKey, keyType: 'public' | 'private'): object {
    if (parsed.type === 'rsa-public') {
        return {
            kty: 'RSA',
            n: bigintToBase64url(parsed.components.n),
            e: bigintToBase64url(parsed.components.e),
        };
    }
    if (parsed.type === 'rsa-private') {
        if (keyType === 'public') {
            return {
                kty: 'RSA',
                n: bigintToBase64url(parsed.components.n),
                e: bigintToBase64url(parsed.components.e),
            };
        }
        const { n, e, d, p, q } = parsed.components;
        const dp = d % (p - 1n);
        const dq = d % (q - 1n);
        const qi = modInverse(q, p);
        return {
            kty: 'RSA',
            n: bigintToBase64url(n),
            e: bigintToBase64url(e),
            d: bigintToBase64url(d),
            p: bigintToBase64url(p),
            q: bigintToBase64url(q),
            dp: bigintToBase64url(dp),
            dq: bigintToBase64url(dq),
            qi: bigintToBase64url(qi),
        };
    }
    throw new Error('Unsupported key type for JWK export');
}

// oxlint-disable-next-line typescript/no-explicit-any -- JWK shape varies per key type (RSA: n/e/d/p/q/dp/dq/qi; EC: x/y/d/crv); typing accurately requires the JsonWebKey union plus a discriminating narrow at each field, which adds noise without real safety since the function trusts the caller's JWK has the needed fields and base64urlToBigint validates the strings at runtime
function importJwkRsa(jwk: any): { parsed: ParsedKey; pem: string } {
    if (jwk.d) {
        // Private key
        const components: RsaPrivateComponents = {
            n: base64urlToBigint(jwk.n),
            e: base64urlToBigint(jwk.e),
            d: base64urlToBigint(jwk.d),
            p: base64urlToBigint(jwk.p),
            q: base64urlToBigint(jwk.q),
        };
        const parsed: ParsedKey = { type: 'rsa-private', components };
        const der = encodeRsaPrivateKeyPkcs1(components);
        const pem = derToPem(der, 'RSA PRIVATE KEY');
        return { parsed, pem };
    }
    // Public key
    const components: RsaPublicComponents = {
        n: base64urlToBigint(jwk.n),
        e: base64urlToBigint(jwk.e),
    };
    const parsed: ParsedKey = { type: 'rsa-public', components };
    const der = encodeSubjectPublicKeyInfo(components);
    const pem = derToPem(der, 'PUBLIC KEY');
    return { parsed, pem };
}

function generatePem(parsed: ParsedKey, keyType: 'public' | 'private', type?: string): string {
    if (parsed.type === 'rsa-public') {
        if (type === 'pkcs1') {
            const der = encodeRsaPublicKeyPkcs1(parsed.components);
            return derToPem(der, 'RSA PUBLIC KEY');
        }
        // Default: SPKI
        const der = encodeSubjectPublicKeyInfo(parsed.components);
        return derToPem(der, 'PUBLIC KEY');
    }
    if (parsed.type === 'rsa-private' && keyType === 'public') {
        // Exporting public part of private key
        const pubComponents: RsaPublicComponents = {
            n: parsed.components.n,
            e: parsed.components.e,
        };
        if (type === 'pkcs1') {
            const der = encodeRsaPublicKeyPkcs1(pubComponents);
            return derToPem(der, 'RSA PUBLIC KEY');
        }
        const der = encodeSubjectPublicKeyInfo(pubComponents);
        return derToPem(der, 'PUBLIC KEY');
    }
    if (parsed.type === 'rsa-private') {
        if (type === 'pkcs8') {
            const der = encodePrivateKeyInfo(parsed.components);
            return derToPem(der, 'PRIVATE KEY');
        }
        // Default: PKCS#1
        const der = encodeRsaPrivateKeyPkcs1(parsed.components);
        return derToPem(der, 'RSA PRIVATE KEY');
    }
    throw new Error('Cannot generate PEM for this key type');
}

function generateDer(parsed: ParsedKey, keyType: 'public' | 'private', type?: string): Buffer {
    if (parsed.type === 'rsa-public') {
        if (type === 'pkcs1') {
            return Buffer.from(encodeRsaPublicKeyPkcs1(parsed.components));
        }
        return Buffer.from(encodeSubjectPublicKeyInfo(parsed.components));
    }
    if (parsed.type === 'rsa-private' && keyType === 'public') {
        const pubComponents: RsaPublicComponents = {
            n: parsed.components.n,
            e: parsed.components.e,
        };
        if (type === 'pkcs1') {
            return Buffer.from(encodeRsaPublicKeyPkcs1(pubComponents));
        }
        return Buffer.from(encodeSubjectPublicKeyInfo(pubComponents));
    }
    if (parsed.type === 'rsa-private') {
        if (type === 'pkcs8') {
            return Buffer.from(encodePrivateKeyInfo(parsed.components));
        }
        return Buffer.from(encodeRsaPrivateKeyPkcs1(parsed.components));
    }
    throw new Error('Cannot generate DER for this key type');
}

function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [a % m, m];
    let [old_s, s] = [1n, 0n];
    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }
    return ((old_s % m) + m) % m;
}

interface KeyInput {
    key: string | Buffer | KeyObject | object;
    format?: 'pem' | 'der' | 'jwk';
    type?: 'pkcs1' | 'spki' | 'pkcs8' | 'sec1';
    passphrase?: string | Buffer;
    encoding?: BufferEncoding;
}

/**
 * Create a secret key from raw bytes.
 */
export function createSecretKey(key: Buffer | Uint8Array | string, encoding?: BufferEncoding): KeyObject {
    let keyBuf: Uint8Array;
    if (typeof key === 'string') {
        keyBuf = Buffer.from(key, encoding ?? 'utf8');
    } else {
        keyBuf = new Uint8Array(key);
    }
    return new KeyObject('secret', keyBuf);
}

/** Parse any non-KeyObject key input (PEM string/Buffer, `{ key, format, type }`). */
function parseKeyInput(
    key: string | Buffer | KeyInput,
    kind: 'public' | 'private',
): { parsed: ParsedKey; pem?: string } {
    if (
        typeof key === 'object' &&
        key !== null &&
        !Buffer.isBuffer(key) &&
        !(key instanceof Uint8Array) &&
        'key' in key
    ) {
        const input = key as KeyInput;
        if (input.format === 'jwk') {
            return parseJwk(input.key as Record<string, unknown>, kind);
        }
        if (input.format === 'der') {
            if (input.type !== 'spki' && input.type !== 'pkcs8' && input.type !== 'pkcs1') {
                throw codedError(
                    'ERR_INVALID_ARG_VALUE',
                    `The property 'key.type' is invalid. Received ${JSON.stringify(input.type)}`,
                    TypeError,
                );
            }
            const raw =
                typeof input.key === 'string'
                    ? Buffer.from(input.key, input.encoding ?? 'utf8')
                    : (input.key as Uint8Array);
            return { parsed: parseDerKey(new Uint8Array(raw), input.type, kind) };
        }
    }
    const pem = normalizePem(key);
    return { parsed: parsePemKey(pem), pem };
}

/**
 * Create a public key from PEM, DER, JWK, or another KeyObject. A private key
 * input yields its public half, as in Node.
 */
export function createPublicKey(key: string | Buffer | KeyInput | KeyObject): KeyObject {
    if (key instanceof KeyObject) {
        if (key.type === 'public') return key;
        if (key.type === 'private') {
            return asymmetricKeyObject((key._handle as AsymmetricHandle).parsed, 'public');
        }
        throw new TypeError('Cannot create public key from secret key');
    }
    if (typeof key === 'object' && key !== null && 'key' in key && key.key instanceof KeyObject) {
        return createPublicKey(key.key);
    }
    const { parsed, pem } = parseKeyInput(key, jwkKind(key));
    const isPrivate = parsed.type === 'rsa-private' || parsed.type === 'okp-private';
    return asymmetricKeyObject(parsed, 'public', isPrivate ? undefined : pem);
}

/** A JWK carrying `d` describes a private key, whichever factory it is handed to. */
function jwkKind(key: string | Buffer | KeyInput): 'public' | 'private' {
    if (typeof key === 'object' && key !== null && 'format' in key && key.format === 'jwk') {
        return (key.key as Record<string, unknown>)?.d !== undefined ? 'private' : 'public';
    }
    return 'public';
}

/**
 * Create a private key from PEM, DER, JWK, or KeyInput.
 */
export function createPrivateKey(key: string | Buffer | KeyInput): KeyObject {
    if (typeof key === 'object' && key !== null && 'key' in key && key.key instanceof KeyObject) {
        if (key.key.type !== 'private')
            throw codedError(
                'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
                `Invalid key object type ${key.key.type}, expected private.`,
                TypeError,
            );
        return key.key;
    }
    const { parsed, pem } = parseKeyInput(key, 'private');
    if (parsed.type !== 'rsa-private' && parsed.type !== 'okp-private') {
        throw new TypeError('Key is not a private key');
    }
    return asymmetricKeyObject(parsed, 'private', pem);
}

/**
 * Resolve any key argument Node's one-shot APIs accept (KeyObject, PEM,
 * `{ key, format, type }`, JWK) to a KeyObject of the wanted kind. A private
 * key where a public one is wanted yields its public half, as in Node.
 */
export function toKeyObject(key: unknown, kind: 'public' | 'private'): KeyObject {
    if (key instanceof KeyObject) {
        if (kind === 'private' && key.type !== 'private') {
            throw codedError(
                'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
                `Invalid key object type ${key.type}, expected private.`,
                TypeError,
            );
        }
        if (kind === 'public' && key.type === 'secret') {
            throw codedError(
                'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
                'Invalid key object type secret, expected private or public.',
                TypeError,
            );
        }
        return key;
    }
    if (typeof key === 'object' && key !== null && 'key' in key && (key as KeyInput).key instanceof KeyObject) {
        return toKeyObject((key as KeyInput).key, kind);
    }
    if (kind === 'private') return createPrivateKey(key as KeyInput);
    // A public-key argument may still be private-key material (Node derives the public half).
    const input = key as string | Buffer | KeyInput;
    const { parsed } = parseKeyInput(input, jwkKind(input));
    return asymmetricKeyObject(
        parsed,
        parsed.type === 'rsa-private' || parsed.type === 'okp-private' ? 'private' : 'public',
    );
}

/** The RFC 8410 view of a KeyObject, or undefined for any other key type. */
export function okpKeyMaterial(key: KeyObject): { curve: OkpCurve; pub: Uint8Array; priv?: Uint8Array } | undefined {
    if (key.type === 'secret') return undefined;
    const handle = key._handle as AsymmetricHandle;
    const parsed = handle.parsed;
    if (parsed.type === 'okp-private')
        return { curve: parsed.curve, pub: handle.okpPub as Uint8Array, priv: parsed.priv };
    if (parsed.type === 'okp-public') return { curve: parsed.curve, pub: parsed.pub };
    return undefined;
}

/** @internal Build a KeyObject pair straight from a raw RFC 8410 private key. */
export function okpKeyPair(curve: OkpCurve, priv: Uint8Array): { publicKey: KeyObject; privateKey: KeyObject } {
    const privateKey = asymmetricKeyObject({ type: 'okp-private', curve, priv }, 'private');
    return { publicKey: createPublicKey(privateKey), privateKey };
}

function normalizePem(key: string | Buffer | KeyInput): string {
    if (typeof key === 'string') return key;
    if (Buffer.isBuffer(key) || key instanceof Uint8Array) return Buffer.from(key).toString('utf8');
    if (key && typeof key === 'object' && 'key' in key) {
        const input = key as KeyInput;
        if (typeof input.key === 'string') return input.key;
        if (Buffer.isBuffer(input.key) || input.key instanceof Uint8Array)
            return Buffer.from(input.key).toString(input.encoding ?? 'utf8');
        if (input.key instanceof KeyObject) {
            return input.key.export({ format: 'pem' }) as string;
        }
    }
    throw new TypeError('Invalid key input');
}
