import { describe, expect, it } from '@gjsify/unit';

import {
    enabledServices,
    mailSettingsFrom,
    passwordIds,
    securityFromFlags,
    serverSettingsFrom,
    splitHostPort,
    type MailFields,
} from './mapping.js';

const NO_SERVICES = { mail: false, calendar: false, contacts: false, files: false };

const MAIL: MailFields = {
    emailAddress: 'me@example.test',
    name: 'Me',
    imapSupported: true,
    imap: { host: 'imap.example.test', userName: 'me', useSsl: true, useTls: false },
    smtpSupported: true,
    smtp: { host: 'smtp.example.test', userName: 'me', useSsl: false, useTls: true, authenticate: true },
};

export default async () => {
    await describe('splitHostPort', async () => {
        await it('keeps a bare host without a port', async () => {
            expect(splitHostPort('imap.example.test').host).toBe('imap.example.test');
            expect(splitHostPort('imap.example.test').port).toBeUndefined();
        });
        await it('splits host:port', async () => {
            expect(splitHostPort('imap.example.test:1993').host).toBe('imap.example.test');
            expect(splitHostPort('imap.example.test:1993').port).toBe(1993);
        });
        await it('reads a bracketed IPv6 literal with and without a port', async () => {
            expect(splitHostPort('[::1]:993').host).toBe('::1');
            expect(splitHostPort('[::1]:993').port).toBe(993);
            expect(splitHostPort('[::1]').host).toBe('::1');
            expect(splitHostPort('[::1]').port).toBeUndefined();
        });
        await it('reads a bare IPv6 literal as a host with no port', async () => {
            expect(splitHostPort('fe80::1').host).toBe('fe80::1');
            expect(splitHostPort('fe80::1').port).toBeUndefined();
        });
        await it('drops a port that is not 1..65535', async () => {
            expect(splitHostPort('imap.example.test:0').port).toBeUndefined();
            expect(splitHostPort('imap.example.test:70000').port).toBeUndefined();
            expect(splitHostPort('imap.example.test:abc').port).toBeUndefined();
            expect(splitHostPort('imap.example.test:').port).toBeUndefined();
            expect(splitHostPort('imap.example.test:').host).toBe('imap.example.test');
        });
    });

    await describe('securityFromFlags', async () => {
        await it('maps the SSL flag to tls and the TLS flag to starttls', async () => {
            expect(securityFromFlags('imap', true, false)).toBe('tls');
            expect(securityFromFlags('imap', false, true)).toBe('starttls');
            expect(securityFromFlags('smtp', true, false)).toBe('tls');
            expect(securityFromFlags('smtp', false, true)).toBe('starttls');
        });
        await it('lets the SSL flag win over the TLS flag', async () => {
            expect(securityFromFlags('imap', true, true)).toBe('tls');
        });
        await it('maps no flag to none', async () => {
            expect(securityFromFlags('imap', false, false)).toBe('none');
            expect(securityFromFlags('smtp', false, false, 25)).toBe('none');
        });
        await it('reads the implicit-TLS port when neither flag is set', async () => {
            expect(securityFromFlags('imap', false, false, 993)).toBe('tls');
            expect(securityFromFlags('smtp', false, false, 465)).toBe('tls');
            expect(securityFromFlags('imap', false, false, 465)).toBe('none');
        });
        await it('does not let the port override an explicit starttls flag', async () => {
            expect(securityFromFlags('imap', false, true, 993)).toBe('starttls');
        });
    });

    await describe('serverSettingsFrom', async () => {
        const base = { userName: 'me', useSsl: false, useTls: false, authenticate: true };

        await it('has no settings without a host', async () => {
            expect(serverSettingsFrom('imap', { ...base, host: '' })).toBeUndefined();
        });
        await it('picks the default port from protocol and security', async () => {
            expect(serverSettingsFrom('imap', { ...base, host: 'h', useSsl: true })?.port).toBe(993);
            expect(serverSettingsFrom('imap', { ...base, host: 'h', useTls: true })?.port).toBe(143);
            expect(serverSettingsFrom('imap', { ...base, host: 'h' })?.port).toBe(143);
            expect(serverSettingsFrom('smtp', { ...base, host: 'h', useSsl: true })?.port).toBe(465);
            expect(serverSettingsFrom('smtp', { ...base, host: 'h', useTls: true })?.port).toBe(587);
            expect(serverSettingsFrom('smtp', { ...base, host: 'h' })?.port).toBe(25);
        });
        await it('takes an explicit port over the default', async () => {
            const settings = serverSettingsFrom('smtp', { ...base, host: 'h:2525', useTls: true });
            expect(settings?.host).toBe('h');
            expect(settings?.port).toBe(2525);
            expect(settings?.security).toBe('starttls');
        });
        await it('treats an unflagged explicit 993 as TLS from the first byte', async () => {
            const settings = serverSettingsFrom('imap', { ...base, host: 'h:993' });
            expect(settings?.security).toBe('tls');
            expect(settings?.port).toBe(993);
        });
        await it('reports the user name only for a server that takes a login', async () => {
            expect(serverSettingsFrom('smtp', { ...base, host: 'h' })?.username).toBe('me');
            expect(serverSettingsFrom('smtp', { ...base, host: 'h', authenticate: false })?.username).toBeUndefined();
            expect(serverSettingsFrom('smtp', { ...base, host: 'h', userName: '' })?.username).toBeUndefined();
        });
    });

    await describe('mailSettingsFrom', async () => {
        await it('maps IMAP, SMTP and the sender', async () => {
            const settings = mailSettingsFrom(MAIL);
            expect(settings?.sender.address).toBe('me@example.test');
            expect(settings?.sender.name).toBe('Me');
            expect(settings?.imap?.host).toBe('imap.example.test');
            expect(settings?.imap?.port).toBe(993);
            expect(settings?.imap?.security).toBe('tls');
            expect(settings?.smtp?.host).toBe('smtp.example.test');
            expect(settings?.smtp?.port).toBe(587);
            expect(settings?.smtp?.security).toBe('starttls');
        });
        await it('leaves out a server the account does not support', async () => {
            const settings = mailSettingsFrom({ ...MAIL, imapSupported: false });
            expect(settings?.imap).toBeUndefined();
            expect(settings?.smtp?.host).toBe('smtp.example.test');
        });
        await it('leaves out a supported server that names no host', async () => {
            const settings = mailSettingsFrom({ ...MAIL, smtp: { ...MAIL.smtp, host: '' } });
            expect(settings?.smtp).toBeUndefined();
            expect(settings?.imap?.host).toBe('imap.example.test');
        });
        await it('has no settings when neither server remains', async () => {
            expect(mailSettingsFrom({ ...MAIL, imapSupported: false, smtpSupported: false })).toBeUndefined();
        });
        await it('omits an empty sender name', async () => {
            expect(mailSettingsFrom({ ...MAIL, name: '' })?.sender.name).toBeUndefined();
        });
    });

    await describe('enabledServices', async () => {
        await it('lists what is present and not switched off', async () => {
            const services = enabledServices(
                { mail: true, calendar: true, contacts: true, files: false },
                { ...NO_SERVICES, calendar: true },
            );
            expect(services.join(',')).toBe('mail,contacts');
        });
        await it('is empty for an account with nothing set up', async () => {
            expect(enabledServices(NO_SERVICES, NO_SERVICES).length).toBe(0);
        });
    });

    await describe('passwordIds', async () => {
        await it('asks for the purpose-specific id first', async () => {
            expect(passwordIds('imap')[0]).toBe('imap-password');
            expect(passwordIds('smtp')[0]).toBe('smtp-password');
        });
        await it('lets SMTP fall back to the IMAP password, never the reverse', async () => {
            expect(passwordIds('smtp')).toContain('imap-password');
            expect(passwordIds('imap')).not.toContain('smtp-password');
        });
    });
};
