// The D-Bus driver against a fake `AccountStore`: no bus, so it runs on Node and GJS alike.

import { describe, expect, it } from '@gjsify/unit';

import { createDbusAccounts, type AccountObject, type AccountStore, type Properties } from './dbus.js';
import { isUnavailable } from './no-account-store.js';
import type { Account, SystemAccounts } from './types.js';

const SECRET = 'dummy-secret-value';
const OTHER_SECRET = 'dummy-other-value';
const TOKEN = 'dummy-token-value';

interface FakeObject {
    readonly interfaces: Readonly<Record<string, Properties>>;
    readonly passwords?: Readonly<Record<string, string>>;
    readonly token?: readonly [string, number];
}

const requested: string[] = [];

function objectOf(fake: FakeObject): AccountObject {
    return {
        properties: (name) => fake.interfaces[name],
        async call(name, method, args) {
            if (name === 'PasswordBased' && method === 'GetPassword') {
                requested.push(args[0]);
                const secret = fake.passwords?.[args[0]];
                return secret === undefined ? undefined : [secret];
            }
            if (name === 'OAuth2Based' && method === 'GetAccessToken') return fake.token ? [...fake.token] : undefined;
            return undefined;
        },
    };
}

const account = (id: string, extra: Properties = {}): Properties => ({
    Id: id,
    ProviderType: 'imap_smtp',
    ProviderName: 'Fake provider',
    Identity: 'me@example.test',
    PresentationIdentity: 'me@example.test',
    ...extra,
});

const MAIL: Properties = {
    EmailAddress: 'me@example.test',
    Name: 'Me',
    ImapSupported: true,
    ImapHost: 'imap.example.test',
    ImapUserName: 'me',
    ImapUseSsl: true,
    ImapUseTls: false,
    SmtpSupported: true,
    SmtpHost: 'smtp.example.test:2525',
    SmtpUserName: 'me',
    SmtpUseAuth: true,
    SmtpUseSsl: false,
    SmtpUseTls: true,
};

const OBJECTS: FakeObject[] = [
    {
        interfaces: { Account: account('mail_1'), Mail: MAIL, Calendar: {}, PasswordBased: {} },
        passwords: { 'imap-password': SECRET, 'smtp-password': OTHER_SECRET },
    },
    {
        interfaces: { Account: account('shared'), Mail: MAIL, PasswordBased: {} },
        passwords: { 'imap-password': SECRET },
    },
    {
        interfaces: { Account: account('oauth_1', { ProviderType: 'google' }), Mail: MAIL, OAuth2Based: {} },
        token: [TOKEN, 3600],
    },
    { interfaces: { Account: account('cal_1'), Calendar: {}, Contacts: {} } },
    { interfaces: { Account: account('off_1', { MailDisabled: true }), Mail: MAIL, Files: {} } },
    { interfaces: { Account: account('locked_1'), Mail: MAIL, PasswordBased: {} }, passwords: {} },
];

function driver(objects: readonly FakeObject[], now?: () => number): SystemAccounts {
    const store: AccountStore = { objects: () => objects.map(objectOf) };
    return createDbusAccounts({ connect: async () => store, now });
}

async function find(system: SystemAccounts, id: string): Promise<Account> {
    const found = (await system.listAccounts()).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`the fake did not serve account ${id}`);
    return found;
}

export default async () => {
    await describe('D-Bus driver: accounts', async () => {
        await it('reports what a host with the daemon can answer', async () => {
            const caps = driver([]).capabilities();
            expect(caps.services).toContain('mail');
            expect(caps.credentials).toContain('oauth2');
        });

        await it('maps account fields and enabled services', async () => {
            const mail = await find(driver(OBJECTS), 'mail_1');
            expect(mail.provider).toBe('imap_smtp');
            expect(mail.identity).toBe('me@example.test');
            expect(mail.services.join(',')).toBe('mail,calendar');
        });

        await it('leaves out a service the user switched off', async () => {
            expect((await find(driver(OBJECTS), 'off_1')).services.join(',')).toBe('files');
        });

        await it('filters by service', async () => {
            const system = driver(OBJECTS);
            expect(
                (await system.listAccounts('calendar'))
                    .map((a) => a.id)
                    .sort()
                    .join(','),
            ).toBe('cal_1,mail_1');
            expect((await system.listAccounts('files')).map((a) => a.id).join(',')).toBe('off_1');
        });

        await it('lists nothing for a store with no accounts', async () => {
            expect((await driver([]).listAccounts()).length).toBe(0);
        });
    });

    await describe('D-Bus driver: mail settings', async () => {
        await it('maps IMAP, SMTP and the sender', async () => {
            const system = driver(OBJECTS);
            const settings = await system.getMailSettings(await find(system, 'mail_1'));
            if (isUnavailable(settings)) throw new Error(`unexpectedly unavailable: ${settings.reason}`);
            expect(settings.sender.address).toBe('me@example.test');
            expect(settings.sender.name).toBe('Me');
            expect(settings.imap?.host).toBe('imap.example.test');
            expect(settings.imap?.port).toBe(993);
            expect(settings.imap?.security).toBe('tls');
            expect(settings.smtp?.host).toBe('smtp.example.test');
            expect(settings.smtp?.port).toBe(2525);
            expect(settings.smtp?.security).toBe('starttls');
        });

        await it('answers not-supported for an account with no mail', async () => {
            const system = driver(OBJECTS);
            const settings = await system.getMailSettings(await find(system, 'cal_1'));
            expect(isUnavailable(settings) && settings.reason === 'not-supported').toBe(true);
        });

        await it('answers unknown-account for an id the store does not have', async () => {
            const system = driver(OBJECTS);
            const stale = { ...(await find(system, 'mail_1')), id: 'gone' };
            const settings = await system.getMailSettings(stale);
            expect(isUnavailable(settings) && settings.reason === 'unknown-account').toBe(true);
        });
    });

    await describe('D-Bus driver: credentials', async () => {
        await it('returns the purpose-specific password', async () => {
            const system = driver(OBJECTS);
            const target = await find(system, 'mail_1');
            const imap = await system.getCredentials(target, 'imap');
            const smtp = await system.getCredentials(target, 'smtp');
            expect(imap.kind === 'password' && imap.secret === SECRET).toBe(true);
            expect(smtp.kind === 'password' && smtp.secret === OTHER_SECRET).toBe(true);
        });

        await it('lets SMTP fall back to the stored IMAP password', async () => {
            const system = driver(OBJECTS);
            requested.length = 0;
            const smtp = await system.getCredentials(await find(system, 'shared'), 'smtp');
            expect(smtp.kind === 'password' && smtp.secret === SECRET).toBe(true);
            expect(requested.join(',')).toBe('smtp-password,imap-password');
        });

        await it('hands out an OAuth2 token with an absolute expiry', async () => {
            const system = driver(OBJECTS, () => 1_000_000);
            const credentials = await system.getCredentials(await find(system, 'oauth_1'), 'smtp');
            expect(credentials.kind).toBe('oauth2');
            if (credentials.kind !== 'oauth2') return;
            expect(credentials.token === TOKEN).toBe(true);
            expect(credentials.expiresAt).toBe(1_000_000 + 3600 * 1000);
        });

        await it('answers credentials-unavailable when the store has no such secret', async () => {
            const system = driver(OBJECTS);
            const credentials = await system.getCredentials(await find(system, 'locked_1'), 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'credentials-unavailable').toBe(true);
        });

        await it('answers not-supported for an account without credentials', async () => {
            const system = driver(OBJECTS);
            const credentials = await system.getCredentials(await find(system, 'cal_1'), 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'not-supported').toBe(true);
        });

        await it('keeps the secret out of every unavailable answer', async () => {
            const system = driver(OBJECTS);
            const answers = [
                await system.getCredentials(await find(system, 'locked_1'), 'imap'),
                await system.getMailSettings(await find(system, 'cal_1')),
            ];
            expect(JSON.stringify(answers).includes(SECRET)).toBe(false);
        });
    });

    await describe('D-Bus driver: unreachable daemon', async () => {
        await it('lists nothing and answers no-account-store, then retries', async () => {
            let reachable = false;
            const store: AccountStore = { objects: () => OBJECTS.map(objectOf) };
            const system = createDbusAccounts({ connect: async () => (reachable ? store : undefined) });
            const stale: Account = {
                id: 'mail_1',
                provider: '',
                providerName: '',
                identity: '',
                label: '',
                services: [],
            };
            expect((await system.listAccounts()).length).toBe(0);
            const mail = await system.getMailSettings(stale);
            expect(isUnavailable(mail) && mail.reason === 'no-account-store').toBe(true);
            const credentials = await system.getCredentials(stale, 'imap');
            expect(credentials.kind === 'unavailable' && credentials.reason === 'no-account-store').toBe(true);
            reachable = true;
            expect((await system.listAccounts()).length).toBe(OBJECTS.length);
        });
    });
};
