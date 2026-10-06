// The contract of @gjsify/system-accounts (ADR 0095): the questions an app asks about the
// accounts a user already set up on their system. No type here names an account store's own
// vocabulary, so a driver for another platform can answer the same questions.

export type AccountService = 'mail' | 'calendar' | 'contacts' | 'files';

/** Which login a credential is for. IMAP and SMTP can hold different secrets. */
export type CredentialPurpose = 'imap' | 'smtp';

export type CredentialKind = 'password' | 'oauth2';

/** `tls` is TLS from the first byte, `starttls` upgrades a plain connection, `none` stays plain. */
export type ConnectionSecurity = 'tls' | 'starttls' | 'none';

export interface Account {
    /** Stable for one account on one host; opaque to the caller. */
    readonly id: string;
    /** The store's provider key, e.g. `google` or `imap_smtp`. For display and diagnostics, not for branching. */
    readonly provider: string;
    readonly providerName: string;
    /** What the user logs in as, usually the mail address. */
    readonly identity: string;
    /** The name the system shows for the account. */
    readonly label: string;
    /** The services the account is set up for AND the user has not switched off. */
    readonly services: readonly AccountService[];
}

export interface ServerSettings {
    readonly host: string;
    readonly port: number;
    readonly security: ConnectionSecurity;
    /** Absent when the server takes no login (an SMTP relay without authentication). */
    readonly username?: string;
}

export interface MailSettings {
    readonly sender: { readonly address: string; readonly name?: string };
    /** Absent when the account has no IMAP server configured. */
    readonly imap?: ServerSettings;
    /** Absent when the account has no SMTP server configured. */
    readonly smtp?: ServerSettings;
}

export interface PasswordCredentials {
    readonly kind: 'password';
    readonly secret: string;
}

export interface OAuth2Credentials {
    readonly kind: 'oauth2';
    /** An access token, valid until `expiresAt`. Ask again afterwards; never store it. */
    readonly token: string;
    /** Milliseconds since the epoch. */
    readonly expiresAt: number;
}

/**
 * Why a question got no answer. A missing capability is a value, never an exception
 * (ADR 0095), so callers branch on this instead of wrapping every call in try/catch.
 */
export type UnavailableReason =
    /** The host has no account store, or it cannot be reached. */
    | 'no-account-store'
    | 'unknown-account'
    /** The account exists but is not set up for what was asked, e.g. no mail server. */
    | 'not-supported'
    /** The store would not hand the secret out: locked, cancelled, or none stored. */
    | 'credentials-unavailable';

export interface Unavailable {
    readonly kind: 'unavailable';
    readonly reason: UnavailableReason;
}

export type Credentials = PasswordCredentials | OAuth2Credentials | Unavailable;

export interface AccountCapabilities {
    /** Services `listAccounts` can report. Empty: this host has no account store. */
    readonly services: readonly AccountService[];
    /** Credential kinds `getCredentials` can hand out. Empty: accounts are listed but no secret is given. */
    readonly credentials: readonly CredentialKind[];
}

export interface SystemAccounts {
    /** What THIS host can answer. Synchronous and cheap: decided when the driver is created. */
    capabilities(): AccountCapabilities;
    /** Accounts, optionally only those set up for `service`. Empty when the store cannot be reached. */
    listAccounts(service?: AccountService): Promise<Account[]>;
    getMailSettings(account: Account): Promise<MailSettings | Unavailable>;
    /** The caller owns the result: it is never logged, cached or put in an error by this package. */
    getCredentials(account: Account, purpose: CredentialPurpose): Promise<Credentials>;
}
