import { describe, it, expect } from '@gjsify/unit';

import { createKeystoreFileDriver, fileNameFor, type RawBackend } from './driver.js';

/** XOR "cipher" with a counter IV: enough to tell ciphertext from plaintext and keys apart. */
function createFake() {
    const files = new Map<string, Uint8Array>();
    const log: string[] = [];
    const keyIds = new Map<string, number>();
    const idOf = (k: string) => keyIds.get(k) ?? (keyIds.set(k, 5 + keyIds.size), keyIds.get(k)!);
    let ivCounter = 0;
    const backend: RawBackend = {
        encrypt(keyName, plain) {
            const keyId = idOf(keyName);
            const out = new Uint8Array(plain.length + 2);
            out[0] = keyId;
            out[1] = ++ivCounter;
            plain.forEach((b, i) => (out[i + 2] = b ^ keyId ^ out[1]));
            return out;
        },
        decrypt(keyName, blob) {
            const keyId = keyIds.get(keyName);
            if (keyId === undefined || blob[0] !== keyId) throw new Error('key is gone');
            return blob.slice(2).map((b) => b ^ keyId ^ blob[1]);
        },
        deleteKey(keyName) {
            log.push(`deleteKey ${keyName}`);
            keyIds.delete(keyName);
        },
        readFile: (name) => files.get(name) ?? null,
        writeFileAtomic(name, data) {
            files.set(name, data);
        },
        deleteFile(name) {
            files.delete(name);
        },
    };
    return { files, log, backend };
}

export default async () => {
    await describe('keystore-file driver', async () => {
        await it('reports what it is', async () => {
            const driver = createKeystoreFileDriver(createFake().backend);
            expect(driver.info).toStrictEqual({ driver: 'keystore-file', persistent: true, encryptedAtRest: true });
        });

        await it('sets, gets, lists, deletes', async () => {
            const store = await createKeystoreFileDriver(createFake().backend).open('a');
            expect(await store.get('k')).toBe(null);
            await store.set('k', 'v1');
            await store.set('j', 'v2');
            expect(await store.get('k')).toBe('v1');
            expect((await store.keys()).sort()).toStrictEqual(['j', 'k']);
            await store.delete('k');
            await store.delete('missing');
            expect(await store.keys()).toStrictEqual(['j']);
        });

        await it('keeps namespaces apart', async () => {
            const driver = createKeystoreFileDriver(createFake().backend);
            const a = await driver.open('a');
            const b = await driver.open('b');
            await a.set('k', 'from-a');
            expect(await b.get('k')).toBe(null);
            await b.set('k', 'from-b');
            await a.clear();
            expect(await a.get('k')).toBe(null);
            expect(await b.get('k')).toBe('from-b');
        });

        await it('persists across a re-opened store', async () => {
            const fake = createFake();
            await (await createKeystoreFileDriver(fake.backend).open('a')).set('k', 'v');
            expect(await (await createKeystoreFileDriver(fake.backend).open('a')).get('k')).toBe('v');
        });

        await it('writes ciphertext, not the secret', async () => {
            const fake = createFake();
            await (await createKeystoreFileDriver(fake.backend).open('a')).set('k', 'hunter2');
            const bytes = [...fake.files.values()][0];
            expect(new TextDecoder().decode(bytes).includes('hunter2')).toBe(false);
        });

        await it('does not lose a key to overlapping writes', async () => {
            const store = await createKeystoreFileDriver(createFake().backend).open('a');
            await Promise.all([store.set('x', '1'), store.set('y', '2'), store.set('z', '3')]);
            expect((await store.keys()).sort()).toStrictEqual(['x', 'y', 'z']);
        });

        await it('uses a hex file name, whatever the namespace holds', async () => {
            expect(fileNameFor('a/../b')).toBe('secrets-612f2e2e2f62.bin');
        });

        await it("clear() drops that namespace's key unless told not to", async () => {
            const drop = createFake();
            await (await createKeystoreFileDriver(drop.backend).open('a')).clear();
            expect(drop.log).toStrictEqual([`deleteKey ${fileNameFor('a')}`]);
            const keep = createFake();
            await (await createKeystoreFileDriver(keep.backend, { dropKeyOnClear: false }).open('a')).clear();
            expect(keep.log).toStrictEqual([]);
        });

        await it('clearing one namespace leaves the other readable', async () => {
            const driver = createKeystoreFileDriver(createFake().backend);
            const a = await driver.open('a');
            const b = await driver.open('b');
            await a.set('k', '1');
            await b.set('k', '2');
            await a.clear();
            expect(await b.get('k')).toBe('2');
            await a.set('k', '3');
            expect(await a.get('k')).toBe('3');
        });

        await it('never puts the secret or the key name into an error', async () => {
            const fake = createFake();
            const store = await createKeystoreFileDriver(fake.backend).open('a');
            await store.set('account-key', 'hunter2');
            fake.backend.deleteKey(fileNameFor('a'));
            let message = '';
            try {
                await store.get('account-key');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('decrypting')).toBe(true);
            expect(message.includes('hunter2')).toBe(false);
            expect(message.includes('account-key')).toBe(false);
        });
    });
};
