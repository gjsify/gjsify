// Pure mapping from an account store's flat fields to the contract. No GI import, so every
// host asserts it, whatever the driver underneath.

import type { AccountService, ConnectionSecurity, CredentialPurpose, MailSettings, ServerSettings } from './types.js';

export interface HostPort {
    readonly host: string;
    readonly port?: number;
}

/**
 * Split `host`, `host:port` and `[v6]:port`. A bare IPv6 literal has several colons and no
 * port. A port outside 1..65535 is dropped rather than guessed, so the caller falls back to
 * the protocol default instead of dialling port 0.
 */
export function splitHostPort(raw: string): HostPort {
    const value = raw.trim();
    const bracketed = /^\[([^\]]+)\](?::(\d*))?$/.exec(value);
    if (bracketed) return { host: bracketed[1], port: parsePort(bracketed[2]) };
    const firstColon = value.indexOf(':');
    if (firstColon === -1 || firstColon !== value.lastIndexOf(':')) return { host: value };
    return { host: value.slice(0, firstColon), port: parsePort(value.slice(firstColon + 1)) };
}

function parsePort(text: string | undefined): number | undefined {
    if (!text || !/^\d+$/.test(text)) return undefined;
    const port = Number.parseInt(text, 10);
    return port >= 1 && port <= 65535 ? port : undefined;
}

const IMPLICIT_TLS_PORT = { imap: 993, smtp: 465 } as const;

const DEFAULT_PORT = {
    imap: { tls: 993, starttls: 143, none: 143 },
    smtp: { tls: 465, starttls: 587, none: 25 },
} as const satisfies Record<CredentialPurpose, Record<ConnectionSecurity, number>>;

/**
 * The two flags an account store keeps for transport security. When neither is set the
 * port still tells: 993/465 is TLS from the first byte, which some stores leave unflagged.
 */
export function securityFromFlags(
    protocol: CredentialPurpose,
    useSsl: boolean,
    useTls: boolean,
    explicitPort?: number,
): ConnectionSecurity {
    if (useSsl) return 'tls';
    if (useTls) return 'starttls';
    return explicitPort === IMPLICIT_TLS_PORT[protocol] ? 'tls' : 'none';
}

export interface ServerFields {
    readonly host: string;
    readonly userName: string;
    readonly useSsl: boolean;
    readonly useTls: boolean;
    /** False for a server that takes no login: the user name is then not reported. */
    readonly authenticate: boolean;
}

/** `undefined` when the account names no host. */
export function serverSettingsFrom(protocol: CredentialPurpose, fields: ServerFields): ServerSettings | undefined {
    const { host, port: explicitPort } = splitHostPort(fields.host);
    if (!host) return undefined;
    const security = securityFromFlags(protocol, fields.useSsl, fields.useTls, explicitPort);
    return {
        host,
        port: explicitPort ?? DEFAULT_PORT[protocol][security],
        security,
        ...(fields.authenticate && fields.userName ? { username: fields.userName } : {}),
    };
}

export interface MailFields {
    readonly emailAddress: string;
    readonly name: string;
    readonly imapSupported: boolean;
    readonly imap: Omit<ServerFields, 'authenticate'>;
    readonly smtpSupported: boolean;
    readonly smtp: ServerFields;
}

/** `undefined` when the account has neither an IMAP nor an SMTP server. */
export function mailSettingsFrom(fields: MailFields): MailSettings | undefined {
    const imap = fields.imapSupported ? serverSettingsFrom('imap', { ...fields.imap, authenticate: true }) : undefined;
    const smtp = fields.smtpSupported ? serverSettingsFrom('smtp', fields.smtp) : undefined;
    if (!imap && !smtp) return undefined;
    return {
        sender: { address: fields.emailAddress, ...(fields.name ? { name: fields.name } : {}) },
        ...(imap ? { imap } : {}),
        ...(smtp ? { smtp } : {}),
    };
}

/** The services an account is set up for and the user has not switched off. */
export function enabledServices(
    present: Readonly<Record<AccountService, boolean>>,
    disabled: Readonly<Record<AccountService, boolean>>,
): AccountService[] {
    const all: AccountService[] = ['mail', 'calendar', 'contacts', 'files'];
    return all.filter((service) => present[service] && !disabled[service]);
}

/**
 * The secret ids to try, in order. The store keeps the IMAP and the SMTP password under
 * their own ids; the bare ids are what older account types used. SMTP falls back to the
 * IMAP password because one login often serves both and the store keeps it once.
 */
export function passwordIds(purpose: CredentialPurpose): readonly string[] {
    return purpose === 'imap' ? ['imap-password', 'password', ''] : ['smtp-password', 'imap-password', 'password', ''];
}
