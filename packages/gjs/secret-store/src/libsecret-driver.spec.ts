import { describe, expect, it } from '@gjsify/unit';

import { createLibsecretDriver, sandboxedError } from './libsecret-driver.js';

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
        await it('inside a sandbox open() throws naming portal-secret, never picks libsecret', async () => {
            const driver = createLibsecretDriver({ secret: undefined, sandboxed: true });
            const message = await messageOf(() => driver.open('app'));
            expect(message.includes('portal-secret')).toBe(true);
            expect(message.includes('not implemented yet')).toBe(true);
        });
        await it('inside a sandbox the info throws too, instead of claiming libsecret', async () => {
            const driver = createLibsecretDriver({ secret: undefined, sandboxed: true });
            expect((await messageOf(() => driver.info)).includes('portal-secret')).toBe(true);
            expect(sandboxedError().message.includes('Flatpak')).toBe(true);
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
