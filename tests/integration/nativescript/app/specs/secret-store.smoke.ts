// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/secret-store on NS V8 — Android only (ADR 0152). The whole stack is
// under test: openSecretStore → @gjsify/native-secret-store-bridge → AndroidKeyStore AES-256-GCM
// → a ciphertext file under noBackupFilesDir. What the off-device specs can only fake is
// measured here: the Keystore key, the Java byte conversions, the file on disk.
import { openSecretStore, secretStoreInfo } from '@gjsify/secret-store';
import { createNativescriptSecretDriver } from '@gjsify/native-secret-store-bridge';
import { describe, it, expect } from '../reporter.js';

declare const java: any;
declare const android: any;

const NS_A = 'gjsify-smoke-a';
const NS_B = 'gjsify-smoke-b';
const SECRET = 'correct horse battery staple ✓';

function median(values: number[]): number {
    return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

// Median wall time of one write after a clear(), 15 rounds, in ms.
async function cycleCost(dropKeyOnClear: boolean): Promise<number> {
    const store = await createNativescriptSecretDriver({ dropKeyOnClear }).open('gjsify-smoke-cost');
    await store.set('warm', 'x'); // the first-ever key is not part of the cycle
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
        await store.clear();
        const start = Date.now();
        await store.set('k', 'v');
        times.push(Date.now() - start);
    }
    await store.clear();
    return median(times);
}

export default async function secretStoreSmoke(): Promise<void> {
    await describe('@gjsify/secret-store', async () => {
        await it('reports the keystore-file driver', () => {
            expect(secretStoreInfo().driver).toBe('keystore-file');
            expect(secretStoreInfo().persistent).toBe(true);
            expect(secretStoreInfo().encryptedAtRest).toBe(true);
        });

        await it('set / get / keys / delete / clear across two namespaces', async () => {
            const a = await openSecretStore(NS_A);
            const b = await openSecretStore(NS_B);
            await a.clear();
            await b.clear();
            expect(await a.get('token')).toBe(null);
            await a.set('token', SECRET);
            await a.set('other', 'second');
            await b.set('token', 'b-value');
            expect(await a.get('token')).toBe(SECRET);
            expect(await b.get('token')).toBe('b-value');
            expect((await a.keys()).sort().join(',')).toBe('other,token');
            expect((await b.keys()).join(',')).toBe('token');
            await a.delete('other');
            await a.delete('never-existed');
            expect((await a.keys()).join(',')).toBe('token');
            await a.clear();
            expect(await a.get('token')).toBe(null);
            expect((await a.keys()).length).toBe(0);
            expect(await b.get('token')).toBe('b-value');
            await b.clear();
        });

        await it('a second, freshly built driver reads what the first one stored', async () => {
            const first = await createNativescriptSecretDriver().open(NS_A);
            await first.set('persisted', SECRET);
            const second = await createNativescriptSecretDriver().open(NS_A);
            expect(await second.get('persisted')).toBe(SECRET);
            await first.clear();
        });

        await it('the file on disk holds ciphertext, in the no-backup directory', async () => {
            const store = await openSecretStore(NS_A);
            await store.set('plain-check', SECRET);
            const context = (await import('@nativescript/core')).Utils.android.getApplicationContext();
            const dir = new java.io.File(context.getNoBackupFilesDir(), 'gjsify-secrets');
            const files = dir.listFiles();
            expect(files.length > 0).toBe(true);
            let sawPlain = false;
            for (let i = 0; i < files.length; i++) {
                const text = new java.lang.String(java.nio.file.Files.readAllBytes(files[i].toPath()), 'ISO-8859-1');
                if (String(text).includes('correct horse')) sawPlain = true;
            }
            expect(sawPlain).toBe(false);
            expect(android.os.Build.VERSION.SDK_INT >= 26).toBe(true);
            await store.clear();
        });

        await it('measures key generation against keeping the key', async () => {
            const keep = await cycleCost(false);
            const drop = await cycleCost(true);
            console.log(`SECRET_STORE_MEASURE write-after-clear median ms: keepKey=${keep} dropKey=${drop}`);
            expect(keep >= 0 && drop >= 0).toBe(true);
        });
    });
}
