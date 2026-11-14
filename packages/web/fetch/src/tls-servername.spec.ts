// Decision function behind fetch's `servername` option — pure, so it runs on Node and GJS alike.
// The live handshake side (self-signed chain stays rejected, wrong name rejected) is in
// tls-abort.gjs.spec.ts.

import { describe, it, expect } from '@gjsify/unit';
import { acceptsForServername } from './utils/tls-servername.js';

// Gio.TlsCertificateFlags values (gio/gtlscertificate.h).
const UNKNOWN_CA = 1;
const BAD_IDENTITY = 2;
const EXPIRED = 8;
const REVOKED = 32;

export default async () => {
    await describe('@gjsify/fetch — acceptsForServername', async () => {
        await it('accepts when the URL host was the only problem and the cert names servername', async () => {
            expect(acceptsForServername(BAD_IDENTITY, 0, BAD_IDENTITY)).toBe(true);
        });

        await it('rejects when the cert does not name servername', async () => {
            expect(acceptsForServername(BAD_IDENTITY, BAD_IDENTITY, BAD_IDENTITY)).toBe(false);
        });

        await it('rejects an untrusted chain even when the name matches', async () => {
            expect(acceptsForServername(UNKNOWN_CA | BAD_IDENTITY, 0, BAD_IDENTITY)).toBe(false);
            expect(acceptsForServername(UNKNOWN_CA, 0, BAD_IDENTITY)).toBe(false);
        });

        await it('rejects an expired or revoked cert even when the name matches', async () => {
            expect(acceptsForServername(EXPIRED | BAD_IDENTITY, 0, BAD_IDENTITY)).toBe(false);
            expect(acceptsForServername(REVOKED | BAD_IDENTITY, 0, BAD_IDENTITY)).toBe(false);
        });

        await it('rejects when libsoup reported no error at all (nothing to forgive, not this handler’s case)', async () => {
            expect(acceptsForServername(0, 0, BAD_IDENTITY)).toBe(false);
        });
    });
};
