import { describe, expect, it } from '@gjsify/unit';

import { isUnavailable, noAccountStore } from './no-account-store.js';
import type { Account } from './types.js';

const ACCOUNT: Account = {
    id: 'a',
    provider: 'p',
    providerName: 'P',
    identity: 'user@example.test',
    label: 'user@example.test',
    services: ['mail'],
};

export default async () => {
    await describe('noAccountStore', async () => {
        await it('reports empty capabilities', async () => {
            expect(noAccountStore.capabilities().services.length).toBe(0);
            expect(noAccountStore.capabilities().credentials.length).toBe(0);
        });
        await it('lists no accounts instead of throwing', async () => {
            expect((await noAccountStore.listAccounts()).length).toBe(0);
            expect((await noAccountStore.listAccounts('mail')).length).toBe(0);
        });
        await it('answers mail settings and credentials with a reason', async () => {
            const settings = await noAccountStore.getMailSettings(ACCOUNT);
            expect(isUnavailable(settings)).toBe(true);
            const credentials = await noAccountStore.getCredentials(ACCOUNT, 'imap');
            expect(credentials.kind).toBe('unavailable');
            if (credentials.kind === 'unavailable') expect(credentials.reason).toBe('no-account-store');
        });
    });

    await describe('isUnavailable', async () => {
        await it('tells an answer from a missing capability', async () => {
            expect(isUnavailable({ kind: 'unavailable', reason: 'unknown-account' })).toBe(true);
            expect(isUnavailable({ sender: { address: 'user@example.test' } })).toBe(false);
        });
    });
};
