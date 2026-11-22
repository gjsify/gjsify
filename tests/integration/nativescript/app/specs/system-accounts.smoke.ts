// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/system-accounts on NS V8 (ADR 0152, proof item 5): the package loads
// without any `gi://` import and answers empty capabilities instead of throwing.
import { createSystemAccounts, isUnavailable } from '@gjsify/system-accounts';
import { describe, it, expect } from '../reporter.js';

export default async function systemAccountsSmoke(): Promise<void> {
    await describe('@gjsify/system-accounts', async () => {
        await it('answers empty capabilities', () => {
            const caps = createSystemAccounts().capabilities();
            expect(caps.services.length).toBe(0);
            expect(caps.credentials.length).toBe(0);
        });
        await it('lists no accounts and answers with a reason', async () => {
            const accounts = createSystemAccounts();
            expect((await accounts.listAccounts()).length).toBe(0);
            const answer = await accounts.getCredentials(
                { id: 'a', provider: 'p', providerName: 'P', identity: 'u', label: 'u', services: ['mail'] },
                'imap',
            );
            expect(isUnavailable(answer) && answer.reason === 'no-account-store').toBe(true);
        });
    });
}
