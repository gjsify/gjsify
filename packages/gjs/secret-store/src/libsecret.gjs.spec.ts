// The libsecret driver against a REAL Secret Service. CI images have no keyring daemon, so the
// suite probes for one and, when it is missing, SKIPS with that reason printed. Locally:
//
//   dbus-run-session -- sh -c 'echo | gnome-keyring-daemon --unlock --components=secrets; gjsify run test.gjs.mjs'
//
// The values are dummies; a failing assertion compares them with `===` and prints a boolean.

import { describe, expect, it } from '@gjsify/unit';
import type SecretTypes from 'gi://Secret?version=1';

import { createLibsecretDriver } from './libsecret-driver.js';
import type { SecretStore } from './types.js';

const VALUE = 'dummy-secret-value';
const OTHER = 'dummy-other-value';

async function serviceReachable(secret: typeof SecretTypes | undefined): Promise<string | null> {
    if (!secret) return 'the Secret typelib is not installed on this host';
    try {
        await new Promise<void>((resolve, reject) => {
            secret.Service.get(secret.ServiceFlags.OPEN_SESSION, null, (_source, result) => {
                try {
                    secret.Service.get_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        return null;
    } catch (error) {
        return `no Secret Service on the session bus: ${(error as Error).message}`;
    }
}

async function loadSecret(): Promise<typeof SecretTypes | undefined> {
    try {
        const loaded = await import('gi://Secret?version=1');
        return (loaded.default ?? loaded) as typeof SecretTypes;
    } catch {
        return undefined;
    }
}

export default async () => {
    const secretNamespace = await loadSecret();
    const missing = await serviceReachable(secretNamespace);
    if (missing !== null || !secretNamespace) {
        await describe('libsecret driver (real Secret Service)', async () => {
            await it.skip(`SKIPPED, ${missing}`, async () => {});
            if (secretNamespace) {
                const driver = createLibsecretDriver({ secret: secretNamespace, sandboxed: false });
                await it('without a Secret Service open() throws naming the cause, no memory fallback', async () => {
                    let message = '';
                    try {
                        await driver.open('gjsify-test/none');
                    } catch (error) {
                        message = (error as Error).message;
                    }
                    expect(message.includes('no Secret Service is reachable')).toBe(true);
                });
            }
        });
        return;
    }

    const Secret = secretNamespace;
    const run = `t${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const driver = createLibsecretDriver({ secret: Secret, sandboxed: false });
    const open = (name: string): Promise<SecretStore> => driver.open(`gjsify-test/${run}/${name}`);

    await describe('libsecret driver (real Secret Service)', async () => {
        await it('sets, gets and replaces a secret', async () => {
            const store = await open('a');
            try {
                expect(await store.get('k')).toBe(null);
                await store.set('k', VALUE);
                expect((await store.get('k')) === VALUE).toBe(true);
                await store.set('k', OTHER);
                expect((await store.get('k')) === OTHER).toBe(true);
            } finally {
                await store.clear();
            }
        });
        await it('delete of a missing key is not an error, and removes a present one', async () => {
            const store = await open('b');
            try {
                await store.delete('nope');
                await store.set('k', VALUE);
                await store.delete('k');
                expect(await store.get('k')).toBe(null);
            } finally {
                await store.clear();
            }
        });
        await it('lists keys only, sorted', async () => {
            const store = await open('c');
            try {
                await store.set('y', VALUE);
                await store.set('x', OTHER);
                expect((await store.keys()).join(',')).toBe('x,y');
            } finally {
                await store.clear();
            }
        });
        await it('keeps namespaces apart and clears one', async () => {
            const a = await open('d1');
            const b = await open('d2');
            try {
                await a.set('k', VALUE);
                await b.set('k', OTHER);
                await a.clear();
                expect(await a.get('k')).toBe(null);
                expect((await a.keys()).length).toBe(0);
                expect((await b.get('k')) === OTHER).toBe(true);
            } finally {
                await a.clear();
                await b.clear();
            }
        });
        await it('survives a second handle on the same namespace (persisted, not cached)', async () => {
            const first = await open('e');
            try {
                await first.set('k', VALUE);
                const second = await open('e');
                expect((await second.get('k')) === VALUE).toBe(true);
            } finally {
                await first.clear();
            }
        });
        await it('labels are readable and never contain the value', async () => {
            const store = await open('f');
            try {
                await store.set('imap', VALUE);
                const items = await new Promise<SecretTypes.Retrievable[]>((resolve, reject) => {
                    const attributes = { namespace: store.namespace };
                    const schema = Secret.Schema.new('org.gjsify.SecretStore', Secret.SchemaFlags.NONE, {
                        namespace: Secret.SchemaAttributeType.STRING,
                        key: Secret.SchemaAttributeType.STRING,
                    });
                    Secret.password_search(schema, attributes, Secret.SearchFlags.ALL, null, (_s, result) => {
                        try {
                            resolve(Secret.password_search_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
                expect(items.length).toBe(1);
                const label = items[0].get_label();
                expect(label.includes('imap')).toBe(true);
                expect(label.includes(VALUE)).toBe(false);
            } finally {
                await store.clear();
            }
        });
    });
};
