// Linux driver: GNOME Online Accounts straight over D-Bus, with no libgoa.
//
// A Flatpak runtime ships no libgoa (org.gnome.Platform 51: no libgoa file, no Goa typelib),
// yet an app with `--talk-name=org.gnome.OnlineAccounts` can reach the host's daemon. This
// driver speaks the daemon's own interfaces. It holds no GI import: the bus lives behind
// `AccountStore`, so Node asserts it against a fake and `dbus-gio.ts` supplies the real one.
// Secrets are read per call and neither cached, logged nor put in a message.

import { accountFrom, mailSettingsFrom, passwordIds } from './mapping.js';
import { isUnavailable } from './no-account-store.js';
import type {
    Account,
    AccountService,
    Credentials,
    CredentialPurpose,
    MailSettings,
    SystemAccounts,
    Unavailable,
} from './types.js';

export const GOA_NAMESPACE = 'org.gnome.OnlineAccounts';

export type Properties = Readonly<Record<string, unknown>>;

/** One exported account object: its interfaces' properties and their methods. */
export interface AccountObject {
    /** Properties of `org.gnome.OnlineAccounts.<name>`, or `undefined` when the object lacks the interface. */
    properties(name: string): Properties | undefined;
    /** Calls a method of that interface; the reply's out-arguments, or `undefined` when the call fails. */
    call(name: string, method: string, args: readonly string[]): Promise<readonly unknown[] | undefined>;
}

export interface AccountStore {
    objects(): readonly AccountObject[];
}

export interface DbusOptions {
    /** Connects to the daemon; `undefined` when the bus or the name is unreachable or never answered. */
    readonly connect: () => Promise<AccountStore | undefined>;
    readonly now?: () => number;
}

const unavailable = (reason: Unavailable['reason']): Unavailable => ({ kind: 'unavailable', reason });

const str = (props: Properties | undefined, key: string): string => {
    const value = props?.[key];
    return typeof value === 'string' ? value : '';
};
const bool = (props: Properties | undefined, key: string): boolean => props?.[key] === true;

function accountOf(object: AccountObject): Account | undefined {
    const account = object.properties('Account');
    if (!account) return undefined;
    return accountFrom({
        id: str(account, 'Id'),
        provider: str(account, 'ProviderType'),
        providerName: str(account, 'ProviderName'),
        identity: str(account, 'Identity'),
        label: str(account, 'PresentationIdentity'),
        present: {
            mail: !!object.properties('Mail'),
            calendar: !!object.properties('Calendar'),
            contacts: !!object.properties('Contacts'),
            files: !!object.properties('Files'),
        },
        disabled: {
            mail: bool(account, 'MailDisabled'),
            calendar: bool(account, 'CalendarDisabled'),
            contacts: bool(account, 'ContactsDisabled'),
            files: bool(account, 'FilesDisabled'),
        },
    });
}

export function createDbusAccounts({ connect, now = Date.now }: DbusOptions): SystemAccounts {
    let pending: Promise<AccountStore | undefined> | undefined;
    const store = async (): Promise<AccountStore | undefined> => {
        pending ??= connect();
        const connected = await pending;
        // A failed connect is not kept, so a later call retries once the bus is back.
        if (!connected) pending = undefined;
        return connected;
    };

    async function find(account: Account): Promise<AccountObject | Unavailable> {
        const connected = await store();
        if (!connected) return unavailable('no-account-store');
        const found = connected.objects().find((object) => str(object.properties('Account'), 'Id') === account.id);
        return found ?? unavailable('unknown-account');
    }

    return {
        // Whether the daemon answers is only known per call; the full set is what it can serve.
        capabilities: () => ({
            services: ['mail', 'calendar', 'contacts', 'files'],
            credentials: ['password', 'oauth2'],
        }),

        async listAccounts(service?: AccountService): Promise<Account[]> {
            const connected = await store();
            if (!connected) return [];
            const accounts = connected.objects().flatMap((object) => accountOf(object) ?? []);
            return service ? accounts.filter((account) => account.services.includes(service)) : accounts;
        },

        async getMailSettings(account: Account): Promise<MailSettings | Unavailable> {
            const object = await find(account);
            if (isUnavailable(object)) return object;
            const mail = object.properties('Mail');
            if (!mail) return unavailable('not-supported');
            const settings = mailSettingsFrom({
                emailAddress: str(mail, 'EmailAddress'),
                name: str(mail, 'Name'),
                imapSupported: bool(mail, 'ImapSupported'),
                imap: {
                    host: str(mail, 'ImapHost'),
                    userName: str(mail, 'ImapUserName'),
                    useSsl: bool(mail, 'ImapUseSsl'),
                    useTls: bool(mail, 'ImapUseTls'),
                },
                smtpSupported: bool(mail, 'SmtpSupported'),
                smtp: {
                    host: str(mail, 'SmtpHost'),
                    userName: str(mail, 'SmtpUserName'),
                    useSsl: bool(mail, 'SmtpUseSsl'),
                    useTls: bool(mail, 'SmtpUseTls'),
                    authenticate: bool(mail, 'SmtpUseAuth'),
                },
            });
            return settings ?? unavailable('not-supported');
        },

        async getCredentials(account: Account, purpose: CredentialPurpose): Promise<Credentials> {
            const object = await find(account);
            if (isUnavailable(object)) return object;

            if (object.properties('OAuth2Based')) {
                const reply = await object.call('OAuth2Based', 'GetAccessToken', []);
                const [token, expiresIn] = reply ?? [];
                if (typeof token !== 'string' || !token || typeof expiresIn !== 'number') {
                    return unavailable('credentials-unavailable');
                }
                return { kind: 'oauth2', token, expiresAt: now() + expiresIn * 1000 };
            }

            if (!object.properties('PasswordBased')) return unavailable('not-supported');
            for (const id of passwordIds(purpose)) {
                // A missing id or a refused read fails the call; the next id is tried.
                const [secret] = (await object.call('PasswordBased', 'GetPassword', [id])) ?? [];
                if (typeof secret === 'string' && secret) return { kind: 'password', secret };
            }
            return unavailable('credentials-unavailable');
        },
    };
}
