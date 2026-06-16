// Verifies the @gjsify/crypto NativeScript backend (pure-JS, @noble/hashes).
// @noble/hashes runs on every runtime, so this suite executes on GJS + Node.
//
// Digests are checked against fixed known-answer vectors rather than the
// platform's own node:crypto, because the GJS backend (GLib.Checksum) cannot
// do sha224 / sha512-256 — the @noble backend is intentionally more complete,
// so a cross-check would falsely fail there. The vectors below were generated
// once with Node's node:crypto (which supports all seven algorithms).

import { describe, it, expect } from '@gjsify/unit';
import { Buffer } from 'node:buffer';

import { createHash, getHashes, hash as hashOneShot } from './hash.js';
import { createHmac } from './hmac.js';
import { pbkdf2Sync, createCipheriv, createECDH, createSign, getCiphers, getCurves } from './stubs.js';

const ALGOS = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-256'] as const;
const INPUTS = ['', 'hello', 'The quick brown fox jumps over the lazy dog'];

// digest(hex) for each algorithm over INPUTS, in order.
const HASH_VECTORS: Record<(typeof ALGOS)[number], [string, string, string]> = {
    md5: ['d41d8cd98f00b204e9800998ecf8427e', '5d41402abc4b2a76b9719d911017c592', '9e107d9d372bb6826bd81d3542a419d6'],
    sha1: [
        'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
        '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    ],
    sha224: [
        'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
        'ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193',
        '730e109bd7a8a32b1cb9d9a09aa2325d2430587ddbc0c38bad911525',
    ],
    sha256: [
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
    sha384: [
        '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
        '59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f',
        'ca737f1014a48f4c0b6dd43cb177b0afd9e5169367544c494011e3317dbf9a509cb1e5dc1e85a941bbee3d7f2afbc9b1',
    ],
    sha512: [
        'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
        '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043',
        '07e547d9586f6a73f73fbac0435ed76951218fb7d0c8d788a309d785436bbb642e93a252a954f23912547d1e8a3b5ed6e1bfd7097821233fa0538f3db854fee6',
    ],
    'sha512-256': [
        'c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a',
        'e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a',
        'dd9d67b371519c339ed8dbd25af90e976a1eeefd4ad3d889005e532fc5bef04d',
    ],
};

// HMAC-<algo>(key="secret-key", data="the message to authenticate"), hex.
const HMAC_KEY = 'secret-key';
const HMAC_DATA = 'the message to authenticate';
const HMAC_VECTORS: Record<(typeof ALGOS)[number], string> = {
    md5: '22aa499866e9b1e3b242c9acbe2d29f2',
    sha1: 'a864015116c121daa7db2df918e9797b541d9433',
    sha224: 'f45b4e88cc3e9b56d583075aee84800e8e4c0e3f1aacb44a94a34329',
    sha256: 'd064540db4b18aed2db0ee88f1863bdba509c4504796fee5fdf5f23cfa8b0613',
    sha384: '766fbb03ebab600e5ed762bc095cb3dafaa6531d7c1453b1c4b923c888ec15ecbb32332c29b933232b0bbbe0792011d8',
    sha512: '86e68a3392603fa0c9363383829558700ca389aa36402d15ff5b9c75633d60e321400e75adc6c5e1c8ded39a539cf6f260db9e3a0d7e54ee9ae7a2812ff2c266',
    'sha512-256': 'b7e1bf706dee292d47c47816bc24d660c772fe0f4efe16578971777950e10fe8',
};

export default async () => {
    await describe('@gjsify/crypto/nativescript createHash', async () => {
        for (const algo of ALGOS) {
            for (let idx = 0; idx < INPUTS.length; idx++) {
                const input = INPUTS[idx];
                await it(`${algo} of "${input}" matches the known vector`, async () => {
                    expect(createHash(algo).update(input).digest('hex')).toBe(HASH_VECTORS[algo][idx]);
                });
            }
        }

        await it('accepts the canonical "SHA-256" spelling', async () => {
            expect(createHash('SHA-256').update('hello').digest('hex')).toBe(HASH_VECTORS.sha256[1]);
        });

        await it('supports chained update calls', async () => {
            const chained = createHash('sha256').update('hello').update(' ').update('world').digest('hex');
            const oneShot = createHash('sha256').update('hello world').digest('hex');
            expect(chained).toBe(oneShot);
        });

        await it('returns a Buffer of the right length without encoding', async () => {
            expect(createHash('md5').update('test').digest().length).toBe(16);
            expect(createHash('sha256').update('test').digest().length).toBe(32);
        });

        await it('supports base64 encoding', async () => {
            const got = createHash('sha256').update('hello').digest('base64');
            expect(got).toBe(Buffer.from(HASH_VECTORS.sha256[1], 'hex').toString('base64'));
        });

        await it('throws ERR_CRYPTO_HASH_UNKNOWN on an unknown algorithm', async () => {
            let code: string | undefined;
            try {
                createHash('not-a-hash');
            } catch (e) {
                code = (e as NodeJS.ErrnoException).code;
            }
            expect(code).toBe('ERR_CRYPTO_HASH_UNKNOWN');
        });

        await it('throws when digest is called twice', async () => {
            const h = createHash('sha256').update('x');
            h.digest();
            expect(() => h.digest()).toThrow('Digest already called');
        });

        await it('copy() forks independent state', async () => {
            const base = createHash('sha256').update('hello');
            const forked = base.copy();
            base.update(' world');
            expect(forked.digest('hex')).toBe(HASH_VECTORS.sha256[1]);
            expect(base.digest('hex')).toBe(createHash('sha256').update('hello world').digest('hex'));
        });

        await it('one-shot hash() helper matches createHash', async () => {
            expect(hashOneShot('sha256', 'hello', 'hex')).toBe(HASH_VECTORS.sha256[1]);
        });

        await it('getHashes() lists the seven supported algorithms', async () => {
            const hashes = getHashes();
            for (const algo of ALGOS) expect(hashes).toContain(algo);
        });
    });

    await describe('@gjsify/crypto/nativescript createHmac', async () => {
        for (const algo of ALGOS) {
            await it(`HMAC-${algo} matches the known vector`, async () => {
                expect(createHmac(algo, HMAC_KEY).update(HMAC_DATA).digest('hex')).toBe(HMAC_VECTORS[algo]);
            });
        }

        await it('HMAC-SHA256 matches the RFC 4231 test case 2 vector', async () => {
            const got = createHmac('sha256', 'Jefe').update('what do ya want for nothing?').digest('hex');
            expect(got).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
        });

        await it('accepts a Uint8Array key', async () => {
            const key = new Uint8Array([1, 2, 3, 4, 5]);
            const got = createHmac('sha256', key).update('data').digest('hex');
            expect(got).toBe('863fe14d2141cff489043507adf27798f0cc40f594d6bb9e0071235efde52fe1');
        });

        await it('throws when digest is called twice', async () => {
            const h = createHmac('sha256', 'k').update('x');
            h.digest();
            expect(() => h.digest()).toThrow('Digest already called');
        });
    });

    await describe('@gjsify/crypto/nativescript ENOTSUP stubs', async () => {
        const cases: Array<[string, () => unknown]> = [
            ['createCipheriv', () => createCipheriv('aes-256-cbc', Buffer.alloc(32), Buffer.alloc(16))],
            ['createECDH', () => createECDH('prime256v1')],
            ['createSign', () => createSign('RSA-SHA256')],
            ['pbkdf2Sync', () => pbkdf2Sync('pw', 'salt', 1000, 32, 'sha256')],
        ];
        for (const [name, fn] of cases) {
            await it(`${name} throws ENOTSUP`, async () => {
                let code: string | undefined;
                try {
                    fn();
                } catch (e) {
                    code = (e as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        }

        await it('getCiphers() and getCurves() return empty lists', async () => {
            expect(getCiphers().length).toBe(0);
            expect(getCurves().length).toBe(0);
        });
    });
};
