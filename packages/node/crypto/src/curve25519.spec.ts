// oxlint-disable typescript/no-explicit-any -- the Ed25519/X25519 overloads of generateKeyPairSync/sign/diffieHellman are typed loosely in @types/node for option bags; the casts keep the calls Node-shaped
// Ported from refs/node/test/parallel/test-crypto-sign-verify.js (Ed25519 cases),
// refs/node/test/parallel/test-crypto-dh-stateless.js (x25519 cases),
// refs/node/test/parallel/test-crypto-keygen-eddsa.js and
// refs/node/test/parallel/test-crypto-key-objects.js (OKP import/export).
// Original: MIT, Node.js contributors
// Vectors: RFC 8032 § 7.1 / sign.input, RFC 7748 § 5.2 + § 6.1, Project Wycheproof
// (x25519_test.json), WPT eddsa small-order cases — see ./fixtures/.

import { describe, it, expect } from '@gjsify/unit';
import * as crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { ED25519_SIGN_INPUT } from './fixtures/ed25519-sign-input.js';
import { WYCHEPROOF_X25519 } from './fixtures/wycheproof-x25519.js';
import { WPT_ED25519_SMALL_ORDER } from './fixtures/wpt-ed25519-small-order.js';

const c = crypto as any;

// refs/node/test/fixtures/keys/{ed25519,x25519}_{private,public}.pem
const ED25519_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMFSujN0jIUIdzSvuxka0lfgVVkMdRTuaVvIYUHrvzXQ
-----END PRIVATE KEY-----
`;
const ED25519_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAK1wIouqnuiA04b3WrMa+xKIKIpfHetNZRv3h9fBf768=
-----END PUBLIC KEY-----
`;
const X25519_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VuBCIEIJi/yFpueUawC1BkXyWM8ONIBGFjL7UZHrD/Zo/KPDpn
-----END PRIVATE KEY-----
`;
const X25519_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VuAyEAaSb8Q+RndwfNnPeOYGYPDUN3uhAPnMLzXyfi+mqfhig=
-----END PUBLIC KEY-----
`;

// RFC 8410 DER prefixes — every OpenSSL-produced key starts with exactly these bytes,
// and libsignal (Baileys) slices keys out of DER at these fixed offsets.
const SPKI_PREFIX = { ed25519: '302a300506032b6570032100', x25519: '302a300506032b656e032100' };
const PKCS8_PREFIX = { ed25519: '302e020100300506032b657004220420', x25519: '302e020100300506032b656e04220420' };

type Curve = 'ed25519' | 'x25519';
const hex = (s: string) => Buffer.from(s, 'hex');
const publicFromRaw = (curve: Curve, raw: string) =>
    crypto.createPublicKey({ key: hex(SPKI_PREFIX[curve] + raw), format: 'der', type: 'spki' });
const privateFromRaw = (curve: Curve, raw: string) =>
    crypto.createPrivateKey({ key: hex(PKCS8_PREFIX[curve] + raw), format: 'der', type: 'pkcs8' });

function throwsCode(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (err) {
        return (err as { code?: string }).code ?? 'NO_CODE';
    }
    return undefined;
}

export default async () => {
    await describe('crypto Ed25519 — RFC 8032 vectors', async () => {
        await it('signs sign.input (incl. RFC 8032 TEST 1-3) byte-exactly and verifies', async () => {
            for (const [seed, pub, message, signature] of ED25519_SIGN_INPUT) {
                const priv = privateFromRaw('ed25519', seed);
                const derivedPub = (crypto.createPublicKey(priv).export({ format: 'jwk' }) as any).x;
                expect(Buffer.from(derivedPub, 'base64url').toString('hex')).toBe(pub);
                const sig = c.sign(null, hex(message), priv) as Buffer;
                expect(sig.toString('hex')).toBe(signature);
                expect(c.verify(null, hex(message), publicFromRaw('ed25519', pub), sig)).toBe(true);
            }
        });

        await it('rejects a signature with one flipped bit', async () => {
            const [, pub, message, signature] = ED25519_SIGN_INPUT[3];
            const sig = hex(signature);
            sig[10] ^= 1;
            expect(c.verify(null, hex(message), publicFromRaw('ed25519', pub), sig)).toBe(false);
        });

        await it('answers the WPT small-order / non-canonical cases like Node', async () => {
            for (const [id, pub, message, signature, verified] of WPT_ED25519_SMALL_ORDER) {
                const result = c.verify(null, hex(message), publicFromRaw('ed25519', pub), hex(signature));
                if (result !== verified) throw new Error(`WPT small-order case ${id}: got ${result}`);
            }
        });
    });

    await describe('crypto.sign / crypto.verify with Ed25519 keys', async () => {
        const data = Buffer.from('Hello world');

        await it('signs with PEM and KeyObject, verifies with private or public key', async () => {
            const sig = c.sign(null, data, ED25519_PRIVATE_PEM) as Buffer;
            expect(sig.length).toBe(64);
            expect(c.verify(null, data, ED25519_PRIVATE_PEM, sig)).toBe(true);
            expect(c.verify(null, data, ED25519_PUBLIC_PEM, sig)).toBe(true);
            const privObj = crypto.createPrivateKey(ED25519_PRIVATE_PEM);
            const pubObj = crypto.createPublicKey(ED25519_PUBLIC_PEM);
            expect((c.sign(null, data, privObj) as Buffer).equals(sig)).toBe(true);
            expect(c.verify(null, data, pubObj, sig)).toBe(true);
            expect(c.verify(undefined, data, { key: pubObj }, sig)).toBe(true);
        });

        await it('supports Ed25519ctx through { key, context }', async () => {
            const context = Buffer.from('my context');
            const sig = c.sign(null, data, { key: ED25519_PRIVATE_PEM, context }) as Buffer;
            expect(sig.length).toBe(64);
            expect(c.verify(null, data, { key: ED25519_PUBLIC_PEM, context }, sig)).toBe(true);
            expect(c.verify(null, data, { key: ED25519_PUBLIC_PEM }, sig)).toBe(false);
            expect(c.verify(null, data, { key: ED25519_PUBLIC_PEM, context: Buffer.from('wrong') }, sig)).toBe(false);
        });

        await it('treats an empty context as plain Ed25519', async () => {
            const context = new Uint8Array();
            const sig = c.sign(null, data, { key: ED25519_PRIVATE_PEM, context }) as Buffer;
            expect(c.verify(null, data, { key: ED25519_PUBLIC_PEM, context }, sig)).toBe(true);
            expect(c.verify(null, data, { key: ED25519_PUBLIC_PEM }, sig)).toBe(true);
        });

        await it('delivers through a callback', async () => {
            const sig = await new Promise<Buffer>((resolve, reject) =>
                c.sign(null, data, ED25519_PRIVATE_PEM, (err: Error | null, s: Buffer) =>
                    err ? reject(err) : resolve(s),
                ),
            );
            const ok = await new Promise<boolean>((resolve, reject) =>
                c.verify(null, data, ED25519_PUBLIC_PEM, sig, (err: Error | null, r: boolean) =>
                    err ? reject(err) : resolve(r),
                ),
            );
            expect(ok).toBe(true);
        });

        await it('refuses Ed25519 keys in the streaming Sign / Verify classes', async () => {
            expect(throwsCode(() => crypto.createSign('SHA256').update('Test123').sign(ED25519_PRIVATE_PEM))).toBe(
                'ERR_CRYPTO_UNSUPPORTED_OPERATION',
            );
            expect(
                throwsCode(() => crypto.createVerify('SHA256').update('Test123').verify(ED25519_PUBLIC_PEM, 'sig')),
            ).toBe('ERR_CRYPTO_UNSUPPORTED_OPERATION');
        });

        await it('refuses X25519 keys for signing', async () => {
            expect(throwsCode(() => crypto.createSign('SHA256').update('Test123').sign(X25519_PRIVATE_PEM))).toBe(
                'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE',
            );
            expect(throwsCode(() => c.sign(null, data, X25519_PRIVATE_PEM))).toBeDefined();
        });
    });

    await describe('crypto X25519 — RFC 7748 vectors', async () => {
        await it('computes the § 5.2 scalar-multiplication vectors', async () => {
            // Scalars are stored unclamped; clamping is part of the X25519 function.
            const cases = [
                [
                    'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
                    'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
                    'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
                ],
                [
                    '4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d',
                    'e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493',
                    '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957',
                ],
            ];
            for (const [scalar, u, out] of cases) {
                const secret = c.diffieHellman({
                    privateKey: privateFromRaw('x25519', scalar),
                    publicKey: publicFromRaw('x25519', u),
                }) as Buffer;
                expect(secret.toString('hex')).toBe(out);
            }
        });

        await it('reproduces the § 6.1 Alice/Bob exchange', async () => {
            const alicePriv = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
            const alicePub = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
            const bobPriv = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
            const bobPub = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
            const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
            const pubOfAlice = (
                crypto.createPublicKey(privateFromRaw('x25519', alicePriv)).export({ format: 'jwk' }) as any
            ).x;
            expect(Buffer.from(pubOfAlice, 'base64url').toString('hex')).toBe(alicePub);
            const ab = c.diffieHellman({
                privateKey: privateFromRaw('x25519', alicePriv),
                publicKey: publicFromRaw('x25519', bobPub),
            });
            const ba = c.diffieHellman({
                privateKey: privateFromRaw('x25519', bobPriv),
                publicKey: publicFromRaw('x25519', alicePub),
            });
            expect(ab.toString('hex')).toBe(shared);
            expect(ba.toString('hex')).toBe(shared);
        });

        await it('matches every Wycheproof x25519_test.json vector', async () => {
            const mismatches: number[] = [];
            for (const [tcId, priv, pub, shared, zero] of WYCHEPROOF_X25519) {
                let got: string;
                try {
                    got = (
                        c.diffieHellman({
                            privateKey: privateFromRaw('x25519', priv),
                            publicKey: publicFromRaw('x25519', pub),
                        }) as Buffer
                    ).toString('hex');
                } catch {
                    // A refused low-order peer is the expected outcome of a zero-secret vector.
                    got = 'refused';
                }
                if (got !== (zero ? 'refused' : shared)) mismatches.push(tcId);
            }
            expect(mismatches.length === 0 ? 'none' : mismatches.join(',')).toBe('none');
        });
    });

    await describe('crypto.diffieHellman with X25519 keys', async () => {
        await it('agrees on a secret from generated key pairs', async () => {
            const a = c.generateKeyPairSync('x25519');
            const b = c.generateKeyPairSync('x25519');
            const s1 = c.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey }) as Buffer;
            const s2 = c.diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey }) as Buffer;
            expect(s1.length).toBe(32);
            expect(s1.equals(s2)).toBe(true);
        });

        await it('accepts PEM strings and a private key in the public slot', async () => {
            const kp = c.generateKeyPairSync('x25519');
            const pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' });
            const privPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
            const expected = c.diffieHellman({ privateKey: kp.privateKey, publicKey: kp.publicKey }) as Buffer;
            expect((c.diffieHellman({ privateKey: privPem, publicKey: pubPem }) as Buffer).equals(expected)).toBe(true);
            expect((c.diffieHellman({ privateKey: privPem, publicKey: privPem }) as Buffer).equals(expected)).toBe(
                true,
            );
        });

        await it('rejects a non-object options argument', async () => {
            expect(throwsCode(() => c.diffieHellman())).toBe('ERR_INVALID_ARG_TYPE');
            expect(throwsCode(() => c.diffieHellman(null))).toBe('ERR_INVALID_ARG_TYPE');
            expect(throwsCode(() => c.diffieHellman([]))).toBe('ERR_INVALID_ARG_TYPE');
        });

        await it('rejects a public KeyObject as the private key', async () => {
            const { publicKey } = c.generateKeyPairSync('x25519');
            expect(throwsCode(() => c.diffieHellman({ privateKey: publicKey, publicKey }))).toBe(
                'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
            );
        });

        await it('refuses the all-zero (low-order) peer key', async () => {
            const kp = c.generateKeyPairSync('x25519');
            const zero = crypto.createPublicKey(
                '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----',
            );
            expect(throwsCode(() => c.diffieHellman({ privateKey: kp.privateKey, publicKey: zero }))).toBeDefined();
        });

        await it('refuses Ed25519 keys', async () => {
            const kp = c.generateKeyPairSync('ed25519');
            expect(
                throwsCode(() => c.diffieHellman({ privateKey: kp.privateKey, publicKey: kp.publicKey })),
            ).toBeDefined();
        });

        await it('delivers through a callback', async () => {
            const a = c.generateKeyPairSync('x25519');
            const secret = await new Promise<Buffer>((resolve, reject) =>
                c.diffieHellman({ privateKey: a.privateKey, publicKey: a.publicKey }, (err: Error | null, s: Buffer) =>
                    err ? reject(err) : resolve(s),
                ),
            );
            expect(secret.length).toBe(32);
        });

        // The exact sequence of npm `libsignal` src/curve.js (Baileys): it takes this path
        // whenever crypto.diffieHellman exists, with no fallback — so DER pkcs8/spki import
        // and the fixed-offset slicing of exported DER must hold whenever diffieHellman ships.
        await it('runs libsignal curve.js generateKeyPair + calculateAgreement', async () => {
            const PUBLIC_KEY_DER_PREFIX = Buffer.from([48, 42, 48, 5, 6, 3, 43, 101, 110, 3, 33, 0]);
            const PRIVATE_KEY_DER_PREFIX = Buffer.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 110, 4, 34, 4, 32]);
            const generateKeyPair = () => {
                const { publicKey, privateKey } = c.generateKeyPairSync('x25519', {
                    publicKeyEncoding: { format: 'der', type: 'spki' },
                    privateKeyEncoding: { format: 'der', type: 'pkcs8' },
                });
                expect(publicKey.subarray(0, PUBLIC_KEY_DER_PREFIX.length).equals(PUBLIC_KEY_DER_PREFIX)).toBe(true);
                expect(privateKey.subarray(0, PRIVATE_KEY_DER_PREFIX.length).equals(PRIVATE_KEY_DER_PREFIX)).toBe(true);
                expect(publicKey.length).toBe(PUBLIC_KEY_DER_PREFIX.length + 32);
                expect(privateKey.length).toBe(PRIVATE_KEY_DER_PREFIX.length + 32);
                return {
                    pubKey: publicKey.slice(PUBLIC_KEY_DER_PREFIX.length, PUBLIC_KEY_DER_PREFIX.length + 32),
                    privKey: privateKey.slice(PRIVATE_KEY_DER_PREFIX.length, PRIVATE_KEY_DER_PREFIX.length + 32),
                };
            };
            const calculateAgreement = (pubKey: Buffer, privKey: Buffer) =>
                c.diffieHellman({
                    privateKey: crypto.createPrivateKey({
                        key: Buffer.concat([PRIVATE_KEY_DER_PREFIX, privKey]),
                        format: 'der',
                        type: 'pkcs8',
                    }),
                    publicKey: crypto.createPublicKey({
                        key: Buffer.concat([PUBLIC_KEY_DER_PREFIX, pubKey]),
                        format: 'der',
                        type: 'spki',
                    }),
                }) as Buffer;
            const alice = generateKeyPair();
            const bob = generateKeyPair();
            const s1 = calculateAgreement(bob.pubKey, alice.privKey);
            const s2 = calculateAgreement(alice.pubKey, bob.privKey);
            expect(s1.length).toBe(32);
            expect(s1.equals(s2)).toBe(true);
        });
    });

    await describe('crypto.generateKeyPair(Sync) for ed25519 / x25519', async () => {
        for (const type of ['ed25519', 'x25519'] as const) {
            await it(`${type}: returns KeyObjects with Node's metadata`, async () => {
                const { publicKey, privateKey } = c.generateKeyPairSync(type);
                expect(publicKey.type).toBe('public');
                expect(privateKey.type).toBe('private');
                expect(publicKey.asymmetricKeyType).toBe(type);
                expect(privateKey.asymmetricKeyType).toBe(type);
                expect(JSON.stringify(publicKey.asymmetricKeyDetails)).toBe('{}');
                expect(JSON.stringify(privateKey.asymmetricKeyDetails)).toBe('{}');
                expect(crypto.createPublicKey(privateKey).equals(publicKey)).toBe(true);
            });

            await it(`${type}: honours publicKeyEncoding / privateKeyEncoding`, async () => {
                const pem = c.generateKeyPairSync(type, {
                    publicKeyEncoding: { type: 'spki', format: 'pem' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                });
                expect(pem.publicKey.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
                expect(pem.privateKey.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
                expect(pem.privateKey.endsWith('-----END PRIVATE KEY-----\n')).toBe(true);
                const der = c.generateKeyPairSync(type, {
                    publicKeyEncoding: { type: 'spki', format: 'der' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
                });
                expect(der.publicKey.subarray(0, 12).toString('hex')).toBe(SPKI_PREFIX[type]);
                expect(der.privateKey.subarray(0, 16).toString('hex')).toBe(PKCS8_PREFIX[type]);
                const jwk = c.generateKeyPairSync(type, {
                    publicKeyEncoding: { format: 'jwk' },
                    privateKeyEncoding: { format: 'jwk' },
                });
                expect(jwk.publicKey.kty).toBe('OKP');
                expect(jwk.privateKey.crv).toBe(type === 'ed25519' ? 'Ed25519' : 'X25519');
                expect(typeof jwk.privateKey.d).toBe('string');
            });

            await it(`${type}: generateKeyPair calls back asynchronously`, async () => {
                let sync = true;
                const result = await new Promise<any[]>((resolve, reject) => {
                    c.generateKeyPair(type, (err: Error | null, publicKey: unknown, privateKey: unknown) =>
                        err ? reject(err) : resolve([publicKey, privateKey, sync]),
                    );
                    sync = false;
                });
                expect(result[0].asymmetricKeyType).toBe(type);
                expect(result[1].type).toBe('private');
                expect(result[2]).toBe(false);
            });
        }

        await it('promisify(generateKeyPair) resolves to { publicKey, privateKey }', async () => {
            const { publicKey, privateKey } = (await promisify(c.generateKeyPair)('ed25519')) as any;
            expect(publicKey.asymmetricKeyType).toBe('ed25519');
            expect(privateKey.type).toBe('private');
        });

        await it('rejects an unknown key type', async () => {
            expect(throwsCode(() => c.generateKeyPairSync('banana'))).toBe('ERR_INVALID_ARG_VALUE');
        });

        await it('generates distinct keys', async () => {
            const a = c.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
            const b = c.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
            expect(a === b).toBe(false);
        });
    });

    await describe('KeyObject with ed25519 / x25519 keys', async () => {
        await it('imports the Node fixture PEMs', async () => {
            const priv = crypto.createPrivateKey(ED25519_PRIVATE_PEM);
            const pub = crypto.createPublicKey(ED25519_PUBLIC_PEM);
            expect(priv.asymmetricKeyType).toBe('ed25519');
            expect(pub.asymmetricKeyType).toBe('ed25519');
            expect(crypto.createPublicKey(priv).equals(pub)).toBe(true);
            expect(crypto.createPublicKey(ED25519_PRIVATE_PEM).equals(pub)).toBe(true);
            const xpriv = crypto.createPrivateKey(X25519_PRIVATE_PEM);
            expect(xpriv.asymmetricKeyType).toBe('x25519');
            expect(crypto.createPublicKey(xpriv).equals(crypto.createPublicKey(X25519_PUBLIC_PEM))).toBe(true);
        });

        await it('round-trips PEM exactly', async () => {
            expect(crypto.createPrivateKey(ED25519_PRIVATE_PEM).export({ type: 'pkcs8', format: 'pem' })).toBe(
                ED25519_PRIVATE_PEM,
            );
            expect(crypto.createPublicKey(ED25519_PUBLIC_PEM).export({ type: 'spki', format: 'pem' })).toBe(
                ED25519_PUBLIC_PEM,
            );
            expect(crypto.createPrivateKey(X25519_PRIVATE_PEM).export({ type: 'pkcs8', format: 'pem' })).toBe(
                X25519_PRIVATE_PEM,
            );
            expect(crypto.createPublicKey(X25519_PUBLIC_PEM).export({ type: 'spki', format: 'pem' })).toBe(
                X25519_PUBLIC_PEM,
            );
        });

        await it('exports and imports JWK (RFC 8037)', async () => {
            const priv = crypto.createPrivateKey(ED25519_PRIVATE_PEM);
            const jwk = priv.export({ format: 'jwk' }) as any;
            expect(jwk.kty).toBe('OKP');
            expect(jwk.crv).toBe('Ed25519');
            expect(jwk.d).toBe('wVK6M3SMhQh3NK-7GRrSV-BVWQx1FO5pW8hhQeu_NdA');
            expect(jwk.x).toBe('K1wIouqnuiA04b3WrMa-xKIKIpfHetNZRv3h9fBf768');
            const pubJwk = crypto.createPublicKey(priv).export({ format: 'jwk' }) as any;
            expect(pubJwk.d).toBeUndefined();
            expect(pubJwk.x).toBe(jwk.x);
            const back = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
            expect(back.equals(priv)).toBe(true);
            const backPub = crypto.createPublicKey({ key: pubJwk, format: 'jwk' });
            expect(backPub.equals(crypto.createPublicKey(ED25519_PUBLIC_PEM))).toBe(true);
            // A private JWK handed to createPublicKey yields the public half.
            expect(crypto.createPublicKey({ key: jwk, format: 'jwk' }).type).toBe('public');
        });

        await it('rejects a JWK with a malformed key', async () => {
            expect(
                throwsCode(() =>
                    crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: 'AAAA' }, format: 'jwk' } as any),
                ),
            ).toBe('ERR_CRYPTO_INVALID_JWK');
        });

        await it('refuses RSA/EC-only encodings for OKP keys', async () => {
            const priv = crypto.createPrivateKey(ED25519_PRIVATE_PEM);
            expect(throwsCode(() => priv.export({ type: 'pkcs1', format: 'pem' }))).toBe(
                'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS',
            );
        });

        await it('distinguishes curves in equals()', async () => {
            const ed = crypto.createPublicKey({
                key: hex(SPKI_PREFIX.ed25519 + '00'.repeat(31) + '01'),
                format: 'der',
                type: 'spki',
            });
            const x = crypto.createPublicKey({
                key: hex(SPKI_PREFIX.x25519 + '00'.repeat(31) + '01'),
                format: 'der',
                type: 'spki',
            });
            expect(ed.equals(x)).toBe(false);
        });
    });
};
