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
            expect(escapePackageName('@gjsify/browser-node-polyfills')).toBe('@gjsify%2fbrowser-node-polyfills');
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

        await it('sets a user-agent carrying this CLI’s real version', async () => {
            // The concern is NOT one particular dead string (the old assertion
            // pinned `gjsify-install/0.3.7`, a literal that no longer exists
            // anywhere in the tree, so it could never fail). It is that the UA
            // reports the version the CLI actually IS: the previous default was
            // a hard-coded `gjsify-publish/0.5.0` while the package sat at
            // 0.22.0, and a stale UA is exactly what a WAF/CDN frontdoor or a
            // registry-side incident report has to be able to trust.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(typeof h['user-agent']).toBe('string');

            const match = /^gjsify-publish\/(\S+) \(.+ .+\)$/.exec(h['user-agent'] as string);
            expect(match).toBeTruthy();
            const version = match?.[1] ?? '';
            // Resolution must have succeeded — `unknown` is the marker
            // `cliVersion()` emits when it cannot read its own package.json.
            expect(version).not.toBe('unknown');
            // …and be a real semver-shaped version, not a placeholder like
            // `0.0.0-dev` (the shape a compile-time define leaves behind when
            // it silently fails to run).
            expect(/^\d+\.\d+\.\d+/.test(version)).toBe(true);
            expect(version.startsWith('0.0.0')).toBe(false);
        });

        await it('reports the SAME version the CLI package declares', async () => {
            // The regression this guards: a hand-maintained version literal
            // drifting from package.json. Reading the manifest here means the
            // assertion tracks every release automatically.
            //
            // The manifest is found by walking UP, not by a fixed
            // `../../package.json` — this spec runs from a bundle in `dist/`,
            // where a fixed depth resolves one directory too high. That is the
            // same trap the implementation avoids.
            //
            // Two start points, because neither alone covers every way this
            // bundle gets run: `import.meta.url` is right for the shipped
            // `dist/test.node.mjs`, and `process.cwd()` covers a bundle emitted
            // OUTSIDE the package (a scratch `--outfile`, which is how a
            // single-suite build is usually driven). Both walks are strict —
            // there is no fallback that would let the assertion pass without a
            // real manifest.
            const { readFileSync } = await import('node:fs');
            const { dirname } = await import('node:path');
            const { fileURLToPath } = await import('node:url');
            const walkUp = (start: string): string => {
                let dir = start;
                for (let i = 0; i < 12; i++) {
                    try {
                        const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as {
                            name?: string;
                            version?: string;
                        };
                        if (pkg.name === '@gjsify/cli' && pkg.version) return pkg.version;
                    } catch {
                        /* keep climbing */
                    }
                    const parent = dirname(dir);
                    if (parent === dir) break;
                    dir = parent;
                }
                return '';
            };
            const declared = walkUp(dirname(fileURLToPath(import.meta.url))) || walkUp(process.cwd());
            expect(declared.length).toBeGreaterThan(0);

            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['user-agent']?.startsWith(`gjsify-publish/${declared} `)).toBe(true);
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
