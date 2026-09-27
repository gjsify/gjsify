// crypto.diffieHellman({ privateKey, publicKey }) — the stateless key agreement
// Reference: Node.js lib/internal/crypto/diffiehellman.js (diffieHellman)

import { Buffer } from 'node:buffer';
import { codedError } from './crypto-utils.js';
import { x25519SharedSecret } from './curve25519.js';
import { okpKeyMaterial, toKeyObject } from './key-object.js';

interface DiffieHellmanOptions {
    privateKey: unknown;
    publicKey: unknown;
}

function describe(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an instance of Array';
    return typeof value;
}

function compute(options: DiffieHellmanOptions): Buffer {
    const privateKey = toKeyObject(options.privateKey, 'private');
    const publicKey = toKeyObject(options.publicKey, 'public');
    const priv = okpKeyMaterial(privateKey);
    const pub = okpKeyMaterial(publicKey);
    if (!priv || priv.curve !== 'x25519') {
        const type = privateKey.asymmetricKeyType;
        throw codedError(
            type === 'ed25519'
                ? 'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE'
                : 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM',
            type === 'ed25519'
                ? 'error:03000096:digital envelope routines::operation not supported for this keytype'
                : `diffieHellman() with a '${type}' key is not implemented on GJS yet (supported: 'x25519')`,
        );
    }
    if (!pub || pub.curve !== priv.curve) {
        throw codedError(
            'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE',
            'error:03000096:digital envelope routines::operation not supported for this keytype',
        );
    }
    let secret: Uint8Array;
    try {
        secret = x25519SharedSecret(priv.priv as Uint8Array, pub.pub);
    } catch {
        // @noble/curves throws a plain Error for a low-order peer key; Node
        // (OpenSSL 3) reports the refused derivation under this code.
        throw codedError('ERR_OSSL_FAILED_DURING_DERIVATION', 'Deriving bits failed');
    }
    return Buffer.from(secret);
}

/**
 * The shared secret of an X25519 key pair. Node also accepts EC and DH keys
 * here; those key types have no KeyObject support on GJS yet.
 */
export function diffieHellman(options: DiffieHellmanOptions): Buffer;
export function diffieHellman(
    options: DiffieHellmanOptions,
    callback: (err: Error | null, secret?: Buffer) => void,
): void;
export function diffieHellman(
    options: DiffieHellmanOptions,
    callback?: (err: Error | null, secret?: Buffer) => void,
): Buffer | void {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw codedError(
            'ERR_INVALID_ARG_TYPE',
            `The "options" argument must be of type object. Received ${describe(options)}`,
            TypeError,
        );
    }
    if (callback === undefined) return compute(options);
    if (typeof callback !== 'function') {
        throw codedError(
            'ERR_INVALID_ARG_TYPE',
            `The "callback" argument must be of type function. Received ${describe(callback)}`,
            TypeError,
        );
    }
    let secret: Buffer;
    try {
        secret = compute(options);
    } catch (err) {
        // The callback form reports failures through the callback, never by throwing.
        setTimeout(() => callback(err as Error), 0);
        return;
    }
    setTimeout(() => callback(null, secret), 0);
}
