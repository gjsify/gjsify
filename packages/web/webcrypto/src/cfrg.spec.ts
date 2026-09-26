// Tests for Ed25519 / X25519 in SubtleCrypto (WebCrypto Secure Curves)
// Ported from refs/node/test/parallel/test-webcrypto-sign-verify-eddsa.js,
// refs/node/test/parallel/test-webcrypto-derivebits-cfrg.js,
// refs/node/test/parallel/test-webcrypto-export-import-cfrg.js,
// refs/node/test/fixtures/crypto/eddsa.js and
// refs/wpt/WebCryptoAPI/sign_verify/eddsa_vectors.js (kSmallOrderTestCases.Ed25519)
// Original: MIT, Node.js contributors; 3-Clause BSD, web-platform-tests contributors

import { describe, it, expect } from '@gjsify/unit';

const hex = (s: string): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
};
const toHex = (b: ArrayBuffer | Uint8Array): string =>
    Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

// refs/node/test/fixtures/crypto/eddsa.js
const ED_PKCS8 = '302e020100300506032b657004220420f3c8f4c48df878146e8cd3bf6df4e50e389ba7074e15c2352dcd5d308d4ca81f';
const ED_SPKI = '302a300506032b6570032100d8e18963d809d487d9549accaec6742e7eeba24d8a0d3b14b7e3caea06893dcc';
const ED_DATA =
    '2b7ed0bc7795694ab4acd35903fe8cd7d80f6a1c8688a6c3414409457514a1457855bbb219e30a1beea8fe869082d99fc8282f9050d024e59eaf0730ba9db70a';
const ED_SIG =
    '3d90de5e5743dfc28225bfadb341b116cbf8a3f1ceedbf4adc350ef5d3471843a418614dcb6e614862614cf7af1496f9340b3c844ea4dceab1d3d155eb7ecc00';

// refs/node/test/parallel/test-webcrypto-derivebits-cfrg.js
const X_PKCS8 = '302e020100300506032b656e04220420c8838e76d057dfb7d8c95a69e138160add6373fd71a4d276bb56e3a81b64ff61';
const X_SPKI = '302a300506032b656e0321001cf2b1e6022ec537371ed7f53e54fa1154d83e98eb64ea51fae5b3307cfe9706';
const X_RESULT = '2768409dfab99ec23b8c89b93ff5880295f76176088f89e43dfebe7ea1950008';

// refs/wpt/WebCryptoAPI/sign_verify/eddsa_vectors.js (kSmallOrderTestCases.Ed25519) — [id, publicKey, message, signature, verified]
const SMALL_ORDER: [string, string, string, string, boolean][] = [
    [
        '0',
        'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
        '8c93255d71dcab10e8f379c26200f3c7bd5f09d9bc3068d3ef4edeb4853022b6',
        'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a0000000000000000000000000000000000000000000000000000000000000000',
        false,
    ],
    [
        '1',
        'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
        '9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79',
        'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43a5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04',
        false,
    ],
    [
        '2',
        'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
        'aebf3f2601a0c8c5d39cc7d8911642f740b78168218da8471772b35f9d35b9ab',
        'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa8c4bd45aecaca5b24fb97bc10ac27ac8751a7dfe1baff8b953ec9f5833ca260e',
        false,
    ],
    [
        '3',
        'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
        '9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79',
        '9046a64750444938de19f227bb80485e92b83fdb4b6506c160484c016cc1852f87909e14428a7a1d62e9f22f3d3ad7802db02eb2e688b6c52fcd6648a98bd009',
        true,
    ],
    [
        '4',
        'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
        'e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c',
        '160a1cb0dc9c0258cd0a7d23e94d8fa878bcb1925f2c64246b2dee1796bed5125ec6bc982a269b723e0668e540911a9a6a58921d6925e434ab10aa7940551a09',
        false,
    ],
    [
        '5',
        'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d',
        'e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c',
        '21122a84e0b5fca4052f5b1235c80a537878b38f3142356b2c2384ebad4668b7e40bc836dac0f71076f9abe3a53f9c03c1ceeeddb658d0030494ace586687405',
        false,
    ],
    [
        '6',
        '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623',
        '85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40',
        'e96f66be976d82e60150baecff9906684aebb1ef181f67a7189ac78ea23b6c0e547f7690a0e2ddcd04d87dbc3490dc19b3b3052f7ff0538cb68afb369ba3a514',
        false,
    ],
    [
        '7',
        '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623',
        '85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40',
        '8ce5b96c8f26d0ab6c47958c9e68b937104cd36e13c33566acd2fe8d38aa19427e71f98a4734e74f2f13f06f97c20d58cc3f54b8bd0d272f42b695dd7e89a8c202',
        false,
    ],
    [
        '8',
        'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
        '9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff03be9678ac102edcd92b0210bb34d7428d12ffc5df5f37e359941266a4e35f0f',
        false,
    ],
    [
        '9',
        'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43',
        '9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffca8c5b64cd208982aa38d4936621a4775aa233aa0505711d8fdcfdaa943d4908',
        false,
    ],
    [
        '10',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'e96b7021eb39c1a163b6da4e3093dcd3f21387da4cc4572be588fafae23c155b',
        'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04',
        false,
    ],
    [
        '11',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        '39a591f5321bbe07fd5a23dc2f39d025d74526615746727ceefd6e82ae65c06f',
        'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04',
        false,
    ],
    [
        '12',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
        '53656e64203130302055534420746f20416c696365',
        'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04',
        false,
    ],
    [
        '13',
        'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
        '53656e64203130303030302055534420746f20416c696365',
        'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04',
        false,
    ],
];

type Pair = { publicKey: CryptoKey; privateKey: CryptoKey };

async function rejectsWith(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        return (err as Error).name;
    }
    return 'resolved';
}

export default async () => {
    const subtle = globalThis.crypto.subtle;

    await describe('SubtleCrypto Ed25519', async () => {
        await it('signs the Node/WPT vector deterministically and verifies it', async () => {
            const priv = await subtle.importKey('pkcs8', hex(ED_PKCS8), { name: 'Ed25519' }, true, ['sign']);
            const pub = await subtle.importKey('spki', hex(ED_SPKI), { name: 'Ed25519' }, true, ['verify']);
            expect(priv.type).toBe('private');
            expect(pub.algorithm.name).toBe('Ed25519');
            const sig = await subtle.sign({ name: 'Ed25519' }, priv, hex(ED_DATA));
            expect(toHex(sig)).toBe(ED_SIG);
            expect(await subtle.verify({ name: 'Ed25519' }, pub, hex(ED_SIG), hex(ED_DATA))).toBe(true);
            const bad = hex(ED_SIG);
            bad[0] ^= 1;
            expect(await subtle.verify({ name: 'Ed25519' }, pub, bad, hex(ED_DATA))).toBe(false);
            expect(await subtle.verify('Ed25519', pub, hex(ED_SIG), hex(ED_DATA).subarray(1))).toBe(false);
        });

        await it('generates a key pair with split usages', async () => {
            const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
            expect(pair.publicKey.type).toBe('public');
            expect(pair.publicKey.extractable).toBe(true);
            expect(pair.publicKey.usages.join()).toBe('verify');
            expect(pair.privateKey.usages.join()).toBe('sign');
            expect(pair.privateKey.algorithm.name).toBe('Ed25519');
            const data = new TextEncoder().encode('hello');
            const sig = await subtle.sign('Ed25519', pair.privateKey, data);
            expect(sig.byteLength).toBe(64);
            expect(await subtle.verify('Ed25519', pair.publicKey, sig, data)).toBe(true);
        });

        await it('exports raw / spki / pkcs8 / jwk and imports them back', async () => {
            const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
            const raw = (await subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
            const spki = (await subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer;
            const pkcs8 = (await subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer;
            expect(raw.byteLength).toBe(32);
            expect(toHex(spki)).toBe('302a300506032b6570032100' + toHex(raw));
            expect(toHex(pkcs8).startsWith('302e020100300506032b657004220420')).toBe(true);
            const jwk = (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
            expect(jwk.kty).toBe('OKP');
            expect(jwk.crv).toBe('Ed25519');
            expect(typeof jwk.d).toBe('string');
            expect(jwk.ext).toBe(true);
            expect((jwk.key_ops as string[]).join()).toBe('sign');
            const pubJwk = (await subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
            expect(pubJwk.d).toBeUndefined();
            expect(pubJwk.x).toBe(jwk.x);

            const data = new TextEncoder().encode('round trip');
            const privBack = await subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
            const pubBack = await subtle.importKey('raw', raw, 'Ed25519', true, ['verify']);
            const sig = await subtle.sign('Ed25519', privBack, data);
            expect(await subtle.verify('Ed25519', pubBack, sig, data)).toBe(true);
            const privFromPkcs8 = await subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
            expect(toHex(await subtle.sign('Ed25519', privFromPkcs8, data))).toBe(toHex(sig));
        });

        await it('rejects usages the key type cannot have', async () => {
            expect(await rejectsWith(subtle.generateKey({ name: 'Ed25519' }, true, ['encrypt']))).toBe('SyntaxError');
            expect(await rejectsWith(subtle.generateKey({ name: 'Ed25519' }, true, ['verify']))).toBe('SyntaxError');
            expect(await rejectsWith(subtle.importKey('spki', hex(ED_SPKI), 'Ed25519', true, ['sign']))).toBe(
                'SyntaxError',
            );
            expect(await rejectsWith(subtle.importKey('pkcs8', hex(ED_PKCS8), 'Ed25519', true, []))).toBe(
                'SyntaxError',
            );
        });

        await it('rejects keys of the other curve and mismatched JWKs', async () => {
            expect(await rejectsWith(subtle.importKey('spki', hex(X_SPKI), 'Ed25519', true, ['verify']))).toBe(
                'DataError',
            );
            const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
            const jwk = (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
            expect(
                await rejectsWith(subtle.importKey('jwk', { ...jwk, crv: 'X25519' }, 'Ed25519', true, ['sign'])),
            ).toBe('DataError');
            expect(await rejectsWith(subtle.importKey('jwk', { ...jwk, kty: 'EC' }, 'Ed25519', true, ['sign']))).toBe(
                'DataError',
            );
        });

        await it('refuses to export a key in the wrong format', async () => {
            const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
            expect(await rejectsWith(subtle.exportKey('pkcs8', pair.publicKey))).toBe('InvalidAccessError');
            expect(await rejectsWith(subtle.exportKey('spki', pair.privateKey))).toBe('InvalidAccessError');
            expect(await rejectsWith(subtle.exportKey('raw', pair.privateKey))).toBe('NotSupportedError');
            const locked = (await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as Pair;
            expect(await rejectsWith(subtle.exportKey('pkcs8', locked.privateKey))).toBe('InvalidAccessError');
        });

        await it('answers the WPT small-order cases', async () => {
            for (const [id, pub, message, signature, verified] of SMALL_ORDER) {
                const key = await subtle.importKey('raw', hex(pub), { name: 'Ed25519' }, false, ['verify']);
                const result = await subtle.verify({ name: 'Ed25519' }, key, hex(signature), hex(message));
                if (result !== verified) throw new Error(`WPT small-order case ${id}: got ${result}`);
            }
        });
    });

    await describe('SubtleCrypto X25519', async () => {
        const importPair = async () => ({
            privateKey: await subtle.importKey('pkcs8', hex(X_PKCS8), { name: 'X25519' }, true, [
                'deriveKey',
                'deriveBits',
            ]),
            publicKey: await subtle.importKey('spki', hex(X_SPKI), { name: 'X25519' }, true, []),
        });

        await it('derives the Node vector with null / default / full / short / odd lengths', async () => {
            const { privateKey, publicKey } = await importPair();
            const params = { name: 'X25519', public: publicKey };
            expect(toHex(await subtle.deriveBits(params, privateKey, 256))).toBe(X_RESULT);
            expect(toHex(await subtle.deriveBits({ name: 'x25519', public: publicKey }, privateKey, 256))).toBe(
                X_RESULT,
            );
            expect(toHex(await subtle.deriveBits(params, privateKey, null as unknown as number))).toBe(X_RESULT);
            expect(toHex(await subtle.deriveBits(params, privateKey, 224))).toBe(X_RESULT.slice(0, -8));
            const odd = new Uint8Array(await subtle.deriveBits(params, privateKey, 245));
            const expected = hex(X_RESULT.slice(0, -2));
            expected[30] &= 0b11111000;
            expect(toHex(odd)).toBe(toHex(expected));
            expect(await rejectsWith(subtle.deriveBits(params, privateKey, 264))).toBe('OperationError');
        });

        await it('reproduces RFC 7748 § 6.1 through raw import', async () => {
            // Alice's private key, as PKCS#8; Bob's public key, raw.
            const alice = await subtle.importKey(
                'pkcs8',
                hex('302e020100300506032b656e0422042077076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'),
                'X25519',
                false,
                ['deriveBits'],
            );
            const bob = await subtle.importKey(
                'raw',
                hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'),
                'X25519',
                true,
                [],
            );
            const bits = await subtle.deriveBits({ name: 'X25519', public: bob }, alice, 256);
            expect(toHex(bits)).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
        });

        await it('generates key pairs that agree, and derives an AES key', async () => {
            const a = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits'])) as Pair;
            const b = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits'])) as Pair;
            expect(a.publicKey.usages.length).toBe(0);
            expect(a.privateKey.usages.length).toBe(2);
            const ab = await subtle.deriveBits({ name: 'X25519', public: b.publicKey }, a.privateKey, 256);
            const ba = await subtle.deriveBits({ name: 'X25519', public: a.publicKey }, b.privateKey, 256);
            expect(toHex(ab)).toBe(toHex(ba));
            const aes = await subtle.deriveKey(
                { name: 'X25519', public: b.publicKey },
                a.privateKey,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt'],
            );
            expect(toHex((await subtle.exportKey('raw', aes)) as ArrayBuffer)).toBe(toHex(ab));
        });

        await it('exports jwk / raw and re-imports', async () => {
            const pair = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as Pair;
            const jwk = (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
            expect(jwk.kty).toBe('OKP');
            expect(jwk.crv).toBe('X25519');
            const raw = (await subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
            expect(raw.byteLength).toBe(32);
            const priv = await subtle.importKey('jwk', jwk, 'X25519', false, ['deriveBits']);
            const pub = await subtle.importKey('raw', raw, 'X25519', false, []);
            const s1 = await subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256);
            const s2 = await subtle.deriveBits({ name: 'X25519', public: pair.publicKey }, pair.privateKey, 256);
            expect(toHex(s1)).toBe(toHex(s2));
        });

        await it('refuses the all-zero shared secret with OperationError', async () => {
            const { privateKey } = await importPair();
            const zero = await subtle.importKey('raw', new Uint8Array(32), 'X25519', false, []);
            expect(await rejectsWith(subtle.deriveBits({ name: 'X25519', public: zero }, privateKey, 256))).toBe(
                'OperationError',
            );
        });

        await it('rejects invalid usages and a public base key', async () => {
            expect(await rejectsWith(subtle.generateKey({ name: 'X25519' }, true, ['sign']))).toBe('SyntaxError');
            expect(await rejectsWith(subtle.importKey('spki', hex(X_SPKI), 'X25519', true, ['deriveBits']))).toBe(
                'SyntaxError',
            );
            const { publicKey } = await importPair();
            expect(
                await rejectsWith(
                    subtle.deriveBits({ name: 'X25519', public: publicKey }, publicKey, null as unknown as number),
                ),
            ).toBe('InvalidAccessError');
        });
    });

    await describe('SubtleCrypto key/algorithm mismatch', async () => {
        await it('rejects a key used under another algorithm with InvalidAccessError', async () => {
            const ed = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
            const x = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as Pair;
            const data = new Uint8Array(4);
            expect(await rejectsWith(subtle.sign('HMAC', ed.privateKey, data))).toBe('InvalidAccessError');
            expect(await rejectsWith(subtle.sign('Ed25519', x.privateKey, data))).toBe('InvalidAccessError');
            expect(await rejectsWith(subtle.verify('Ed25519', x.publicKey, new Uint8Array(64), data))).toBe(
                'InvalidAccessError',
            );
            expect(
                await rejectsWith(subtle.deriveBits({ name: 'X25519', public: x.publicKey }, ed.privateKey, 256)),
            ).toBe('InvalidAccessError');
            expect(
                await rejectsWith(subtle.deriveBits({ name: 'X25519', public: ed.publicKey }, x.privateKey, 256)),
            ).toBe('InvalidAccessError');
        });
    });
};
