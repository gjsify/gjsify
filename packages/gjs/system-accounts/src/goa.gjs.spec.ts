// The Linux driver against libgoa's own client code, on GJS.
//
// libgoa dials the session bus, so `fake-goa.ts` serves the D-Bus interfaces it calls on a
// peer-to-peer `Gio.DBusServer` and points the session address at it. No GNOME session,
// no real account, no keyring. A dummy secret is only ever compared (`=== SECRET`) so that a
// failing assertion prints a boolean, never the value.

import { describe, expect, it } from '@gjsify/unit';
import type Goa from 'gi://Goa?version=1.0';

import { startFakeGoa, type FakeAccount } from './fake-goa.js';
import { createGoaAccounts } from './goa.js';
import { isUnavailable } from './no-account-store.js';
import type { Account, SystemAccounts } from './types.js';

const SECRET = 'dummy-secret-value';
const OTHER_SECRET = 'dummy-other-value';
const TOKEN = 'dummy-token-value';

const MAIL_ACCOUNT: FakeAccount = {
    id: 'mail_1',
    identity: 'me@example.test',
    mail: {
        email: 'me@example.test',
        name: 'Me',
        imap: { host: 'imap.example.test', user: 'me', ssl: true, tls: false },
        smtp: { host: 'smtp.example.test:2525', user: 'me', ssl: false, tls: true, auth: true },
    },
    calendar: true,
    passwords: { 'imap-password': SECRET, 'smtp-password': OTHER_SECRET },
};

const SHARED_PASSWORD_ACCOUNT: FakeAccount = {
    id: 'mail_shared',
    mail: {
        email: 'shared@example.test',
        name: '',
        imap: { host: 'imap.example.test', user: 'shared', ssl: true, tls: false },
        smtp: { host: 'smtp.example.test', user: 'shared', ssl: false, tls: false, auth: false },
    },
    passwords: { 'imap-password': SECRET },
};

const OAUTH_ACCOUNT: FakeAccount = {
    id: 'oauth_1',
    provider: 'google',
    mail: {
        email: 'oauth@example.test',
        name: 'OAuth',
        imap: { host: 'imap.example.test', user: 'oauth', ssl: true, tls: false },
        smtp: { host: 'smtp.example.test', user: 'oauth', ssl: true, tls: false, auth: true },
    },
    oauth2: { token: TOKEN, expiresIn: 3600 },
};

const CALENDAR_ONLY: FakeAccount = { id: 'cal_1', provider: 'caldav', calendar: true, contacts: true };
const SWITCHED_OFF: FakeAccount = { id: 'off_1', mail: MAIL_ACCOUNT.mail, disabled: { mail: true }, files: true };
const LOCKED_PASSWORD: FakeAccount = { id: 'locked_1', mail: MAIL_ACCOUNT.mail, passwords: {} };

const ALL = [MAIL_ACCOUNT, SHARED_PASSWORD_ACCOUNT, OAUTH_ACCOUNT, CALENDAR_ONLY, SWITCHED_OFF, LOCKED_PASSWORD];

/**
 * libgoa, or `undefined` on a host without it. Imported dynamically HERE rather than through
 * the `&optional` flag: a top-level await in the test entry wedges `@gjsify/unit`'s blocking
 * main loop (ADR 0085 clause 5), so the entry point's own optional import is not reachable
 * from a unit-run bundle.
 */
async function loadGoa(): Promise<typeof Goa | undefined> {
    try {
        return (await import('gi://Goa?version=1.0')).default;
    } catch {
        // The typelib is absent: the suite then declares its expected failure below.
        return undefined;
    }
}

async function driver(
    goa: typeof Goa | undefined,
    accounts: readonly FakeAccount[],
    now?: () => number,
): Promise<{ accounts: SystemAccounts; list: Account[] }> {
    (await startFakeGoa()).setAccounts(accounts);
    const system = createGoaAccounts({ goa, now });
    return { accounts: system, list: await system.listAccounts() };
}

function byId(list: Account[], id: string): Account {
    const found = list.find((account) => account.id === id);
    if (!found) throw new Error(`the fake did not serve account ${id}`);
    return found;
}

export default async () => {
    const goa = await loadGoa();

    // A host without libgoa cannot run the driver at all; the marker states that and retires the
    // day the image gains the typelib, instead of skipping the test.
    const driverIt = (name: string, test: () => Promise<void>) =>
        it.failing(name, test, 'the libgoa typelib is not installed on this host', { when: goa === undefined });

    await describe('GOA driver (fake accounts service)', async () => {
        await driverIt('reads the accounts from the fake service, not from the session', async () => {
            const fake = await startFakeGoa();
            const before = fake.managedObjectsCalls();
            const { list } = await driver(goa, ALL);
            expect(fake.managedObjectsCalls() > before).toBe(true);
            expect(list.length).toBe(ALL.length);
        });

        await driverIt('reports what a host with libgoa can answer', async () => {
            const { accounts } = await driver(goa, []);
            expect(accounts.capabilities().services).toContain('mail');
            expect(accounts.capabilities().credentials).toContain('password');
            expect(accounts.capabilities().credentials).toContain('oauth2');
        });

        await driverIt('maps account fields and enabled services', async () => {
            const { list } = await driver(goa, ALL);
            const account = byId(list, 'mail_1');
            expect(account.provider).toBe('imap_smtp');
            expect(account.identity).toBe('me@example.test');
            expect(account.services.join(',')).toBe('mail,calendar');
        });

        await driverIt('leaves out a service the user switched off', async () => {
            const { list } = await driver(goa, ALL);
            expect(byId(list, 'off_1').services.join(',')).toBe('files');
        });

        await driverIt('filters by service', async () => {
            const { accounts } = await driver(goa, ALL);
            const calendar = (await accounts.listAccounts('calendar')).map((account) => account.id).sort();
            expect(calendar.join(',')).toBe('cal_1,mail_1');
            const files = (await accounts.listAccounts('files')).map((account) => account.id);
            expect(files.join(',')).toBe('off_1');
        });

        // Not `driverIt`: the assertion holds on BOTH a real host and one
        // without libgoa (the no-store driver also lists nothing), so an
        // expected-fail marker would be stale the moment the typelib is absent.
        await it('lists nothing for a store with no accounts', async () => {
            const { list } = await driver(goa, []);
            expect(list.length).toBe(0);
        });
    });

    await describe('GOA driver: mail settings', async () => {
        await driverIt('maps IMAP, SMTP and the sender from the account', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const settings = await accounts.getMailSettings(byId(list, 'mail_1'));
            if (isUnavailable(settings)) throw new Error(`unexpectedly unavailable: ${settings.reason}`);
            expect(settings.sender.address).toBe('me@example.test');
            expect(settings.sender.name).toBe('Me');
            expect(settings.imap?.host).toBe('imap.example.test');
            expect(settings.imap?.port).toBe(993);
            expect(settings.imap?.security).toBe('tls');
            expect(settings.imap?.username).toBe('me');
            expect(settings.smtp?.host).toBe('smtp.example.test');
            expect(settings.smtp?.port).toBe(2525);
            expect(settings.smtp?.security).toBe('starttls');
        });

        await driverIt('reports an SMTP server without a login as having no user name', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const settings = await accounts.getMailSettings(byId(list, 'mail_shared'));
            if (isUnavailable(settings)) throw new Error(`unexpectedly unavailable: ${settings.reason}`);
            expect(settings.smtp?.security).toBe('none');
            expect(settings.smtp?.port).toBe(25);
            expect(settings.smtp?.username).toBeUndefined();
            expect(settings.sender.name).toBeUndefined();
        });

        await driverIt('answers not-supported for an account with no mail', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const settings = await accounts.getMailSettings(byId(list, 'cal_1'));
            expect(isUnavailable(settings) && settings.reason === 'not-supported').toBe(true);
        });

        await driverIt('answers unknown-account for an id the store does not have', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const stale = { ...byId(list, 'mail_1'), id: 'gone' };
            const settings = await accounts.getMailSettings(stale);
            expect(isUnavailable(settings) && settings.reason === 'unknown-account').toBe(true);
        });
    });

    await describe('GOA driver: credentials', async () => {
        await driverIt('returns the purpose-specific password', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const imap = await accounts.getCredentials(byId(list, 'mail_1'), 'imap');
            const smtp = await accounts.getCredentials(byId(list, 'mail_1'), 'smtp');
            expect(imap.kind).toBe('password');
            expect(smtp.kind).toBe('password');
            expect(imap.kind === 'password' && imap.secret === SECRET).toBe(true);
            expect(smtp.kind === 'password' && smtp.secret === OTHER_SECRET).toBe(true);
        });

        await driverIt('lets SMTP fall back to the stored IMAP password', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const fake = await startFakeGoa();
            const smtp = await accounts.getCredentials(byId(list, 'mail_shared'), 'smtp');
            expect(smtp.kind === 'password' && smtp.secret === SECRET).toBe(true);
            expect(fake.requestedPasswordIds.join(',')).toBe('smtp-password,imap-password');
        });

        await driverIt('hands out an OAuth2 token with an absolute expiry', async () => {
            const { accounts, list } = await driver(goa, ALL, () => 1_000_000);
            const credentials = await accounts.getCredentials(byId(list, 'oauth_1'), 'smtp');
            expect(credentials.kind).toBe('oauth2');
            if (credentials.kind !== 'oauth2') return;
            expect(credentials.token === TOKEN).toBe(true);
            expect(credentials.expiresAt).toBe(1_000_000 + 3600 * 1000);
        });

        await driverIt('answers credentials-unavailable when the store has no such secret', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const credentials = await accounts.getCredentials(byId(list, 'locked_1'), 'imap');
            expect(credentials.kind).toBe('unavailable');
            if (credentials.kind === 'unavailable') expect(credentials.reason).toBe('credentials-unavailable');
        });

        await driverIt('answers not-supported for an account that has no credentials at all', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const credentials = await accounts.getCredentials(byId(list, 'cal_1'), 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'not-supported').toBe(true);
        });

        await driverIt('answers unknown-account for a stale id', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const credentials = await accounts.getCredentials({ ...byId(list, 'mail_1'), id: 'gone' }, 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'unknown-account').toBe(true);
        });

        await driverIt('keeps the secret out of every unavailable answer', async () => {
            const { accounts, list } = await driver(goa, ALL);
            const answers = [
                await accounts.getCredentials(byId(list, 'locked_1'), 'imap'),
                await accounts.getCredentials(byId(list, 'cal_1'), 'imap'),
                await accounts.getMailSettings(byId(list, 'cal_1')),
            ];
            expect(JSON.stringify(answers).includes(SECRET)).toBe(false);
        });
    });

    await describe('GOA driver without libgoa', async () => {
        await it('reports empty capabilities instead of throwing', async () => {
            const system = createGoaAccounts({ goa: undefined });
            expect(system.capabilities().services.length).toBe(0);
            expect(system.capabilities().credentials.length).toBe(0);
        });

        await it('lists no accounts and answers every question with a reason', async () => {
            const system = createGoaAccounts({ goa: undefined });
            expect((await system.listAccounts()).length).toBe(0);
            const account: Account = {
                id: 'a',
                provider: 'p',
                providerName: 'P',
                identity: 'i',
                label: 'l',
                services: [],
            };
            expect(isUnavailable(await system.getMailSettings(account))).toBe(true);
            const credentials = await system.getCredentials(account, 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'no-account-store').toBe(true);
        });
    });
};
