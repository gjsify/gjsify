import { describe, expect, it } from '@gjsify/unit';

import { isUnavailable } from './no-account-store.js';
import { createSystemAccounts as createAndroid } from './system-accounts.android.js';
import { createSystemAccounts as createIos } from './system-accounts.ios.js';

export default async () => {
    for (const [name, create] of [
        ['android', createAndroid],
        ['ios', createIos],
    ] as const) {
        await describe(`createSystemAccounts (${name})`, async () => {
            await it('answers empty capabilities without throwing', async () => {
                const accounts = create();
                expect(accounts.capabilities().services.length).toBe(0);
                expect(accounts.capabilities().credentials.length).toBe(0);
                expect((await accounts.listAccounts()).length).toBe(0);
            });
            await it('answers credentials with no-account-store', async () => {
                const answer = await create().getCredentials(
                    { id: 'a', provider: 'p', providerName: 'P', identity: 'u', label: 'u', services: ['mail'] },
                    'imap',
                );
                expect(isUnavailable(answer) && answer.reason === 'no-account-store').toBe(true);
            });
        });
    }
};
