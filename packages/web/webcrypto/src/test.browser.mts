import { run, describe, it, expect } from '@gjsify/unit';

run({
    async WebCryptoTest() {
        await describe('crypto.getRandomValues', async () => {
            await it('fills Uint8Array with random bytes', async () => {
                const arr = new Uint8Array(32);
                const result = crypto.getRandomValues(arr);
                expect(result).toBe(arr);
            });

            await it('two calls produce different values', async () => {
                const a = crypto.getRandomValues(new Uint8Array(16));
                const b = crypto.getRandomValues(new Uint8Array(16));
                expect(a.toString()).not.toBe(b.toString());
            });

            await it('works with Int32Array', async () => {
                const arr = new Int32Array(8);
                crypto.getRandomValues(arr);
                expect(arr.length).toBe(8);
            });
        });

        await describe('crypto.randomUUID', async () => {
            await it('returns UUID v4 format string', async () => {
                const uuid = crypto.randomUUID();
                expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)).toBe(true);
            });

            await it('produces unique values', async () => {
                expect(crypto.randomUUID()).not.toBe(crypto.randomUUID());
            });
        });

        await describe('SubtleCrypto.digest', async () => {
            await it('SHA-256 produces 32-byte hash', async () => {
                const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test'));
                expect(hash.byteLength).toBe(32);
            });

            await it('SHA-384 produces 48-byte hash', async () => {
                const hash = await crypto.subtle.digest('SHA-384', new TextEncoder().encode('test'));
                expect(hash.byteLength).toBe(48);
            });

            await it('SHA-512 produces 64-byte hash', async () => {
                const hash = await crypto.subtle.digest('SHA-512', new TextEncoder().encode('test'));
                expect(hash.byteLength).toBe(64);
            });

            await it('same input produces same hash (deterministic)', async () => {
                const data = new TextEncoder().encode('deterministic');
                const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
                const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
                expect(h1.toString()).toBe(h2.toString());
            });
        });

        await describe('SubtleCrypto AES-GCM', async () => {
            await it('generateKey returns a CryptoKey', async () => {
                const key = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt'],
                );
                expect(key).toBeDefined();
                expect((key as CryptoKey).type).toBe('secret');
            });

            await it('encrypt/decrypt round-trip', async () => {
                const key = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt'],
                ) as CryptoKey;
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const plaintext = new TextEncoder().encode('secret message');
                const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
                const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
                expect(new TextDecoder().decode(decrypted)).toBe('secret message');
            });
        });

        await describe('SubtleCrypto HMAC', async () => {
            await it('sign and verify round-trip', async () => {
                const key = await crypto.subtle.generateKey(
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['sign', 'verify'],
                ) as CryptoKey;
                const data = new TextEncoder().encode('test data');
                const signature = await crypto.subtle.sign('HMAC', key, data);
                const valid = await crypto.subtle.verify('HMAC', key, signature, data);
                expect(valid).toBe(true);
            });
        });

        await describe('SubtleCrypto importKey / exportKey', async () => {
            await it('imports and exports raw AES key', async () => {
                const raw = crypto.getRandomValues(new Uint8Array(32));
                const key = await crypto.subtle.importKey(
                    'raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
                );
                const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key));
                expect(exported.toString()).toBe(raw.toString());
            });
        });
    },
});
