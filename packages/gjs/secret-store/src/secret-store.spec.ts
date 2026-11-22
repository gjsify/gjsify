import { describe, expect, it, beforeEach, afterEach } from '@gjsify/unit';

import { createMemoryDriver, openSecretStore, secretStoreInfo, useSecretStoreDriver } from './index.js';

export default async () => {
    await describe('secret-store without a driver', async () => {
        await beforeEach(async () => useSecretStoreDriver(null));
        await it('throws naming the platform instead of falling back', async () => {
            let message = '';
            try {
                await openSecretStore('app');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('no driver for')).toBe(true);
        });
        await it('secretStoreInfo throws too', async () => {
            let threw = false;
            try {
                secretStoreInfo();
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });
    });

    await describe('memory driver', async () => {
        await beforeEach(async () => useSecretStoreDriver(createMemoryDriver()));
        await afterEach(async () => useSecretStoreDriver(null));
        await it('reports itself as non-persistent', async () => {
            const info = secretStoreInfo();
            expect(info.driver).toBe('memory');
            expect(info.persistent).toBe(false);
            expect(info.encryptedAtRest).toBe(false);
        });
        await it('gets null for a missing key and the value after set', async () => {
            const store = await openSecretStore('a');
            expect(await store.get('k')).toBe(null);
            await store.set('k', 's1');
            await store.set('k', 's2');
            expect(await store.get('k')).toBe('s2');
        });
        await it('delete of a missing key is not an error', async () => {
            const store = await openSecretStore('a');
            await store.delete('nope');
            await store.set('k', 's');
            await store.delete('k');
            expect(await store.get('k')).toBe(null);
        });
        await it('lists keys only', async () => {
            const store = await openSecretStore('a');
            await store.set('x', 'secret-x');
            await store.set('y', 'secret-y');
            expect((await store.keys()).sort().join(',')).toBe('x,y');
        });
        await it('keeps namespaces apart and clears one', async () => {
            const a = await openSecretStore('a');
            const b = await openSecretStore('b');
            await a.set('k', 'A');
            await b.set('k', 'B');
            await a.clear();
            expect(await a.get('k')).toBe(null);
            expect(await b.get('k')).toBe('B');
            expect((await a.keys()).length).toBe(0);
        });
        await it('reopening a namespace sees the same entries', async () => {
            await (await openSecretStore('a')).set('k', 'v');
            expect(await (await openSecretStore('a')).get('k')).toBe('v');
        });
    });
};
