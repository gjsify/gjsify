// Tests for the publish-PUT request builder — guards the fix for the
// first-publish `404 Not Found` on a brand-new scoped package via token auth.
//
// The bug: gjsify's publish PUT was missing the `npm-command: publish` header
// (the routing header npm's create-package frontdoor keys on), `npm-auth-type`,
// and a real `user-agent`, while sending a stray `accept: */*`. npm's CLI
// (libnpmpublish → npm-registry-fetch `getHeaders`) sends a specific set; these
// tests assert gjsify's builder matches that contract field-by-field so a
// regression can't silently reintroduce the routing miss.
//
// References (refs/npm-cli):
//   - lib/npm.js:404                                  npm-command = "publish"
//   - node_modules/npm-registry-fetch/lib/index.js:215-245
//       user-agent / npm-auth-type / authorization / npm-otp / content-type
//   - workspaces/config/lib/definitions/definitions.js:282-290, 1581-1587
//       auth-type default "web"; forced "legacy" when --otp set
//   - node_modules/npm-package-arg/lib/npa.js:188     escapedName = name.replace('/', '%2f')

import { describe, expect, it } from '@gjsify/unit';
import type { NpmrcConfig } from '@gjsify/npm-registry';
import { buildPublishHeaders, escapePackageName } from './publish-headers.js';

function npmrcWithToken(token: string): NpmrcConfig {
    return {
        registry: 'https://registry.npmjs.org/',
        scopes: {},
        authTokens: { '//registry.npmjs.org': token },
        basicAuth: {},
    };
}

const URL = 'https://registry.npmjs.org/@gjsify%2fbrowser-node-polyfills';

export default async () => {
    await describe('escapePackageName', async () => {
        await it('encodes a scoped name with lowercase %2f and a literal @', async () => {
            // The exact shape npm-package-arg produces (npa.js:188). %2F
            // (uppercase) or an encoded @ would miss the registry create route.
            expect(escapePackageName('@gjsify/browser-node-polyfills')).toBe(
                '@gjsify%2fbrowser-node-polyfills',
            );
        });

        await it('matches npm-package-arg name.replace("/", "%2f") byte-for-byte', async () => {
            const name = '@gjsify/browser-node-polyfills';
            expect(escapePackageName(name)).toBe(name.replace('/', '%2f'));
        });

        await it('leaves an unscoped name unchanged', async () => {
            expect(escapePackageName('left-pad')).toBe('left-pad');
        });

        await it('only replaces the first slash (scope separator)', async () => {
            // npa replaces only the scope/name separator; deeper slashes are
            // not part of a publishable package name, but the contract is a
            // single replace — guard it.
            expect(escapePackageName('@s/a/b')).toBe('@s%2fa/b');
        });
    });

    await describe('buildPublishHeaders — npm-registry-fetch getHeaders contract', async () => {
        await it('sets npm-command: publish (the create-route routing header)', async () => {
            // THE fix: without this header npm's write frontdoor returns a bare
            // `404 Not Found` for a never-before-published scoped package.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['npm-command']).toBe('publish');
        });

        await it('sets npm-auth-type: web when no OTP is supplied', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['npm-auth-type']).toBe('web');
        });

        await it('sets npm-auth-type: legacy AND npm-otp when an OTP is supplied', async () => {
            // npm forces auth-type to "legacy" once an otp config is present
            // (definitions.js:1583-1586) — the exact shape of a manual 2FA
            // publish, which is the user's repro.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok'), otp: '123456' });
            expect(h['npm-auth-type']).toBe('legacy');
            expect(h['npm-otp']).toBe('123456');
        });

        await it('does not set npm-otp when no OTP is supplied', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['npm-otp']).toBeUndefined();
        });

        await it('sets content-type: application/json', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['content-type']).toBe('application/json');
        });

        await it('sets a real (non-placeholder) user-agent', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(typeof h['user-agent']).toBe('string');
            // The dead `gjsify-install/0.3.7` placeholder must not be what we
            // send on a publish PUT.
            expect(h['user-agent']).not.toBe('gjsify-install/0.3.7');
            expect(h['user-agent'].length).toBeGreaterThan(0);
        });

        await it('honours an explicit userAgent override', async () => {
            const h = buildPublishHeaders(URL, {
                npmrc: npmrcWithToken('tok'),
                userAgent: 'npm/10.0.0 node@v22 (linux)',
            });
            expect(h['user-agent']).toBe('npm/10.0.0 node@v22 (linux)');
        });

        await it('does NOT send a stray `accept: */*` header (npm sends none)', async () => {
            // npm-registry-fetch sets no `accept` on the publish PUT; the old
            // `accept: */*` is removed to match.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['accept']).toBeUndefined();
        });

        await it('resolves a Bearer authorization from the npmrc token', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('s3cr3t') });
            expect(h['authorization']).toBe('Bearer s3cr3t');
        });

        await it('lets an explicit authorization (OIDC) override the npmrc auth', async () => {
            const h = buildPublishHeaders(URL, {
                npmrc: npmrcWithToken('npmrc-token'),
                authorization: 'Bearer oidc-token',
            });
            expect(h['authorization']).toBe('Bearer oidc-token');
        });

        await it('produces the full header set npm sends for an OTP publish', async () => {
            // End-to-end shape check against the libnpmpublish/getHeaders
            // contract for the exact scenario in the bug report: a manual,
            // token-authed, --otp first publish of a new scoped package.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok'), otp: '654321' });
            expect(h['authorization']).toBe('Bearer tok');
            expect(h['content-type']).toBe('application/json');
            expect(h['npm-command']).toBe('publish');
            expect(h['npm-auth-type']).toBe('legacy');
            expect(h['npm-otp']).toBe('654321');
            expect(typeof h['user-agent']).toBe('string');
            expect(h['accept']).toBeUndefined();
        });
    });
};
