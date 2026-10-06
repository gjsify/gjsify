// Linux driver: GNOME Online Accounts through libgoa.
//
// libgoa is optional (ADR 0087): a host without it still starts and answers with empty
// capabilities. Secrets are read per call and neither cached, logged nor put in a message.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import type Goa from 'gi://Goa?version=1.0';

import { enabledServices, mailSettingsFrom, passwordIds } from './mapping.js';
import { isUnavailable, noAccountStore } from './no-account-store.js';
import type {
    Account,
    AccountService,
    Credentials,
    CredentialPurpose,
    MailSettings,
    SystemAccounts,
    Unavailable,
} from './types.js';

/**
 * `Goa.Client.new` has no timeout of its own. Against a session bus that accepts the
 * connection and never answers it does not return (measured in postbote: the call ran to the
 * 30 s harness limit). A dead bus fails in milliseconds, so this only bounds the hung one.
 * Kept under GLib's 25 s method-call default so a CLI admits defeat quickly.
 */
const CONNECT_TIMEOUT_MS = 5_000;

export interface GoaOptions {
    /** The libgoa namespace, or `undefined` on a host without it. */
    readonly goa: typeof Goa | undefined;
    readonly now?: () => number;
    readonly connectTimeoutMs?: number;
}

const unavailable = (reason: Unavailable['reason']): Unavailable => ({ kind: 'unavailable', reason });

function newClient(goa: typeof Goa, cancellable: Gio.Cancellable): Promise<Goa.Client> {
    return new Promise((resolve, reject) => {
        goa.Client.new(cancellable, (_source, result) => {
            // Client.new_finish throws on a failed connect; the promise carries it to the caller.
            try {
                resolve(goa.Client.new_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

/** The client, or `undefined` when the session bus is unreachable or never answered. */
async function connect(goa: typeof Goa, timeoutMs: number): Promise<Goa.Client | undefined> {
    const cancellable = new Gio.Cancellable();
    // SOURCE_REMOVE drops the source once it fired; a client that arrives in time leaves no timer behind.
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    try {
        return await newClient(goa, cancellable);
    } catch {
        // A store that cannot be reached is an answer for this package, not an error: the
        // contract reports it as empty lists and `no-account-store`.
        return undefined;
    } finally {
        GLib.Source.remove(timer);
    }
}

function secretOf(proxy: Goa.PasswordBased, id: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        proxy.call_get_password(id, null, (_source, result) => {
            // A missing id or a refused read raises; the caller then tries the next id.
            try {
                const [ok, password] = proxy.call_get_password_finish(result);
                resolve(ok && password ? password : undefined);
            } catch {
                resolve(undefined);
            }
        });
    });
}

function tokenOf(proxy: Goa.OAuth2Based): Promise<[string, number] | undefined> {
    return new Promise((resolve) => {
        proxy.call_get_access_token(null, (_source, result) => {
            // A refresh the provider refuses (revoked, offline) raises; it is reported as unavailable.
            try {
                const [ok, token, expiresIn] = proxy.call_get_access_token_finish(result);
                resolve(ok && token ? [token, expiresIn] : undefined);
            } catch {
                resolve(undefined);
            }
        });
    });
}

function toAccount(object: Goa.Object): Account | undefined {
    const account = object.get_account();
    if (!account) return undefined;
    return {
        id: account.id ?? '',
        provider: account.provider_type ?? '',
        providerName: account.provider_name ?? '',
        identity: account.identity ?? '',
        label: account.presentation_identity ?? '',
        services: enabledServices(
            {
                mail: !!object.get_mail(),
                calendar: !!object.get_calendar(),
                contacts: !!object.get_contacts(),
                files: !!object.get_files(),
            },
            {
                mail: !!account.mail_disabled,
                calendar: !!account.calendar_disabled,
                contacts: !!account.contacts_disabled,
                files: !!account.files_disabled,
            },
        ),
    };
}

export function createGoaAccounts({
    goa,
    now = Date.now,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
}: GoaOptions): SystemAccounts {
    if (!goa) return noAccountStore;

    let pending: Promise<Goa.Client | undefined> | undefined;
    const client = async (): Promise<Goa.Client | undefined> => {
        pending ??= connect(goa, connectTimeoutMs);
        const connected = await pending;
        // A failed connect is not kept, so a later call retries once the bus is back.
        if (!connected) pending = undefined;
        return connected;
    };

    async function find(account: Account): Promise<Goa.Object | Unavailable> {
        const connected = await client();
        if (!connected) return unavailable('no-account-store');
        return connected.lookup_by_id(account.id) ?? unavailable('unknown-account');
    }

    return {
        capabilities: () => ({
            services: ['mail', 'calendar', 'contacts', 'files'],
            credentials: ['password', 'oauth2'],
        }),

        async listAccounts(service?: AccountService): Promise<Account[]> {
            const connected = await client();
            if (!connected) return [];
            const accounts = connected.get_accounts().flatMap((object) => toAccount(object) ?? []);
            return service ? accounts.filter((account) => account.services.includes(service)) : accounts;
        },

        async getMailSettings(account: Account): Promise<MailSettings | Unavailable> {
            const object = await find(account);
            if (isUnavailable(object)) return object;
            const mail = object.get_mail();
            if (!mail) return unavailable('not-supported');
            const settings = mailSettingsFrom({
                emailAddress: mail.email_address ?? '',
                name: mail.name ?? '',
                imapSupported: mail.imap_supported,
                imap: {
                    host: mail.imap_host ?? '',
                    userName: mail.imap_user_name ?? '',
                    useSsl: mail.imap_use_ssl,
                    useTls: mail.imap_use_tls,
                },
                smtpSupported: mail.smtp_supported,
                smtp: {
                    host: mail.smtp_host ?? '',
                    userName: mail.smtp_user_name ?? '',
                    useSsl: mail.smtp_use_ssl,
                    useTls: mail.smtp_use_tls,
                    authenticate: mail.smtp_use_auth,
                },
            });
            return settings ?? unavailable('not-supported');
        },

        async getCredentials(account: Account, purpose: CredentialPurpose): Promise<Credentials> {
            const object = await find(account);
            if (isUnavailable(object)) return object;

            const oauth2 = object.get_oauth2_based();
            if (oauth2) {
                const granted = await tokenOf(oauth2);
                if (!granted) return unavailable('credentials-unavailable');
                const [token, expiresInSeconds] = granted;
                return { kind: 'oauth2', token, expiresAt: now() + expiresInSeconds * 1000 };
            }

            const passwordBased = object.get_password_based();
            if (!passwordBased) return unavailable('not-supported');
            for (const id of passwordIds(purpose)) {
                const secret = await secretOf(passwordBased, id);
                if (secret !== undefined) return { kind: 'password', secret };
            }
            return unavailable('credentials-unavailable');
        },
    };
}
