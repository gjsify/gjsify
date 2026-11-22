import { describe, expect, it } from '@gjsify/unit';

import type Secret from 'gi://Secret?version=1';

import { createLibsecretDriver } from './libsecret-driver.js';

interface FakeOptions {
    onServiceGet?: () => void;
    onLookup?: () => void;
    lookupError?: string;
}

/** Just enough of `gi://Secret` for `open()`: the two calls it makes to find its way in. */
function fakeSecret(options: FakeOptions): typeof Secret {
    const fake = {
        Schema: { new: () => ({}) },
        SchemaFlags: { NONE: 0 },
        SchemaAttributeType: { STRING: 0 },
        ServiceFlags: { OPEN_SESSION: 2 },
        Service: {
            get: (_flags: number, _cancellable: unknown, callback: (source: null, result: object) => void) => {
                options.onServiceGet?.();
                callback(null, {});
            },
            get_finish: () => ({}),
        },
        password_lookup: (
            _schema: unknown,
            _attrs: unknown,
            _cancellable: unknown,
            callback: (source: null, result: object) => void,
        ) => {
            options.onLookup?.();
            callback(null, {});
        },
        password_lookup_finish: () => {
            if (options.lookupError) throw new Error(options.lookupError);
            return null;
        },
    };
    return fake as unknown as typeof Secret;
}

async function messageOf(work: () => Promise<unknown> | unknown): Promise<string> {
    try {
        await work();
    } catch (error) {
        return (error as Error).message;
    }
    return '';
}

export default async () => {
    await describe('libsecret driver, choosing', async () => {
        await it('inside a sandbox the driver is portal-secret, never libsecret', async () => {
            const driver = createLibsecretDriver({ secret: undefined, sandboxed: true });
            expect(driver.info.driver).toBe('portal-secret');
            expect(driver.info.persistent).toBe(true);
            expect(driver.info.encryptedAtRest).toBe(true);
        });
        await it('inside a sandbox open() checks the portal, not the Secret Service', async () => {
            let serviceAsked = false;
            let lookups = 0;
            const fake = fakeSecret({
                onServiceGet: () => (serviceAsked = true),
                onLookup: () => lookups++,
            });
            const driver = createLibsecretDriver({ secret: fake, sandboxed: true });
            const store = await driver.open('app');
            expect(store.namespace).toBe('app');
            expect(serviceAsked).toBe(false);
            expect(lookups).toBe(1);
        });
        await it('inside a sandbox an unreachable portal throws naming it, no memory fallback', async () => {
            const fake = fakeSecret({ lookupError: 'The name org.freedesktop.portal.Desktop was not provided' });
            const driver = createLibsecretDriver({ secret: fake, sandboxed: true });
            const message = await messageOf(() => driver.open('app'));
            expect(message.includes('portal-secret')).toBe(true);
            expect(message.includes('org.freedesktop.portal.Secret')).toBe(true);
            expect(message.includes('was not provided')).toBe(true);
        });
        await it('outside a sandbox open() still asks the Secret Service', async () => {
            let serviceAsked = false;
            const fake = fakeSecret({ onServiceGet: () => (serviceAsked = true) });
            await createLibsecretDriver({ secret: fake, sandboxed: false }).open('app');
            expect(serviceAsked).toBe(true);
        });
        await it('without the Secret typelib open() throws naming the cause', async () => {
            const driver = createLibsecretDriver({ secret: undefined, sandboxed: false });
            const message = await messageOf(() => driver.open('app'));
            expect(message.includes('typelib')).toBe(true);
            expect(driver.info.driver).toBe('libsecret');
        });
        await it('reports persistent and encrypted at rest', async () => {
            const { info } = createLibsecretDriver({ secret: undefined, sandboxed: false });
            expect(info.persistent).toBe(true);
            expect(info.encryptedAtRest).toBe(true);
        });
    });
};
