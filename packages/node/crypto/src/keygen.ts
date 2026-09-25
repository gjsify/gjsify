// generateKeyPair / generateKeyPairSync for GJS
// Reference: Node.js lib/internal/crypto/keygen.js

import type { Buffer } from 'node:buffer';
import { generateOkpPrivateKey } from './curve25519.js';
import { codedError } from './crypto-utils.js';
import { okpKeyPair, type KeyObject } from './key-object.js';

interface KeyEncoding {
    type?: string;
    format?: string;
    cipher?: string;
    passphrase?: unknown;
}

interface KeyPairOptions {
    publicKeyEncoding?: KeyEncoding;
    privateKeyEncoding?: KeyEncoding;
    [key: string]: unknown;
}

type EncodedKey = KeyObject | Buffer | string | object;

/** Node's full list — the error message names every type Node knows, not just ours. */
const NODE_KEY_TYPES = ['rsa', 'rsa-pss', 'dsa', 'ec', 'ed25519', 'ed448', 'x25519', 'x448', 'dh'];

function encode(key: KeyObject, encoding: KeyEncoding | undefined): EncodedKey {
    return encoding === undefined ? key : key.export(encoding);
}

export function generateKeyPairSync(
    type: string,
    options?: KeyPairOptions,
): { publicKey: EncodedKey; privateKey: EncodedKey } {
    if (typeof type !== 'string') {
        throw codedError(
            'ERR_INVALID_ARG_TYPE',
            `The "type" argument must be of type string. Received ${typeof type}`,
            TypeError,
        );
    }
    if (type !== 'ed25519' && type !== 'x25519') {
        if (NODE_KEY_TYPES.includes(type)) {
            throw codedError(
                'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM',
                `generateKeyPair('${type}') is not implemented on GJS yet (supported: 'ed25519', 'x25519')`,
            );
        }
        throw codedError(
            'ERR_INVALID_ARG_VALUE',
            `The argument 'type' must be a supported key type. Received '${type}'`,
            TypeError,
        );
    }
    const { publicKey, privateKey } = okpKeyPair(type, generateOkpPrivateKey(type));
    return {
        publicKey: encode(publicKey, options?.publicKeyEncoding),
        privateKey: encode(privateKey, options?.privateKeyEncoding),
    };
}

type KeyPairCallback = (err: Error | null, publicKey?: EncodedKey, privateKey?: EncodedKey) => void;

export function generateKeyPair(
    type: string,
    options: KeyPairOptions | KeyPairCallback | undefined,
    callback?: KeyPairCallback,
): void {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? undefined : options;
    if (typeof cb !== 'function') {
        throw codedError('ERR_INVALID_ARG_TYPE', 'The "callback" argument must be of type function', TypeError);
    }
    // Argument errors throw synchronously in Node; only the work is deferred.
    const pair = generateKeyPairSync(type, opts);
    setTimeout(() => cb(null, pair.publicKey, pair.privateKey), 0);
}

// util.promisify(generateKeyPair) resolves to `{ publicKey, privateKey }` in
// Node (its callback has two result arguments, which plain promisify drops).
Object.defineProperty(generateKeyPair, Symbol.for('nodejs.util.promisify.custom'), {
    value: (type: string, options?: KeyPairOptions) =>
        // A throw inside the executor rejects the promise.
        new Promise((resolve) => resolve(generateKeyPairSync(type, options))),
});
