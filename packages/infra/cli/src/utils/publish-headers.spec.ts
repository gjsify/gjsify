// Guards the fix for a first-publish `404 Not Found` on a brand-new scoped
// package via token auth: the publish PUT was missing `npm-command: publish` (the
// routing header npm's create-package frontdoor keys on), `npm-auth-type` and a
// real `user-agent`, while sending a stray `accept: */*`. These rows assert the
// builder matches npm's own contract field-by-field, so a regression cannot
// silently reintroduce the routing miss.
//
// The contract lives in `refs/npm-cli`: `lib/npm.js` (npm-command),
// `npm-registry-fetch/lib/index.js` (getHeaders), `config/lib/definitions/`
// (auth-type default "web", forced "legacy" under --otp) and
// `npm-package-arg/lib/npa.js` (escapedName).

import { describe, expect, it } from '@gjsify/unit';
import type { NpmrcConfig } from '@gjsify/npm-registry';
import { buildPublishHeaders, cliVersion, escapePackageName } from './publish-headers.js';

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
            // The exact shape npm-package-arg produces: %2F (uppercase) or an encoded
            // @ would miss the registry create route.
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
            // npa replaces only the scope/name separator. Deeper slashes are not part
            // of a publishable name, but the contract is a single replace.
            expect(escapePackageName('@s/a/b')).toBe('@s%2fa/b');
        });
    });

    await describe('buildPublishHeaders — npm-registry-fetch getHeaders contract', async () => {
        await it('sets npm-command: publish (the create-route routing header)', async () => {
            // Without this header npm's write frontdoor returns a bare `404 Not Found`
            // for a never-before-published scoped package.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['npm-command']).toBe('publish');
        });

        await it('sets npm-auth-type: web when no OTP is supplied', async () => {
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(h['npm-auth-type']).toBe('web');
        });

        await it('sets npm-auth-type: legacy AND npm-otp when an OTP is supplied', async () => {
            // npm forces auth-type to "legacy" once an otp config is present — the
            // exact shape of a manual 2FA publish, which is the repro.
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
            // The invariant is that the UA reports the version the CLI actually IS,
            // not any one literal: the previous default was a hard-coded
            // `gjsify-publish/0.5.0` while the package sat at 0.22.0, and a stale UA is
            // what a WAF/CDN frontdoor or a registry-side incident report has to trust.
            const h = buildPublishHeaders(URL, { npmrc: npmrcWithToken('tok') });
            expect(typeof h['user-agent']).toBe('string');

            const match = /^gjsify-publish\/(\S+) \(.+ .+\)$/.exec(h['user-agent'] as string);
            expect(match).toBeTruthy();
            const version = match?.[1] ?? '';
            // `unknown` is the marker `cliVersion()` emits when it cannot read its own
            // package.json.
            expect(version).not.toBe('unknown');
            // `0.0.0-dev` is the shape a compile-time define leaves behind when it
            // silently fails to run.
            expect(/^\d+\.\d+\.\d+/.test(version)).toBe(true);
            expect(version.startsWith('0.0.0')).toBe(false);
        });

        await it('reports the SAME version the CLI package declares', async () => {
            // Guards a hand-maintained version literal drifting from package.json;
            // reading the manifest makes the assertion track every release.
            //
            // The manifest is found by walking UP, not at a fixed
            // `../../package.json`: this spec runs from a bundle in `dist/`, where a
            // fixed depth resolves one directory too high — the same trap the
            // implementation avoids. Two start points because neither alone covers
            // every way the bundle is run: `import.meta.url` for the shipped
            // `dist/test.node.mjs`, `process.cwd()` for a bundle emitted OUTSIDE the
            // package (a scratch `--outfile`). Both walks are strict, so no fallback
            // can let the assertion pass without a real manifest.
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

        await it('answers a real version from a dist-shaped bundle, for callers that PIN to it', async () => {
            // Meaningful because THIS SPEC RUNS AS A BUNDLE IN `dist/`: the layout
            // where the fixed-depth read `showcase.ts` used to carry answers nothing,
            // unpinning its dlx spec (`docs/code-anti-patterns.md`).
            const version = cliVersion();
            expect(version).not.toBe('unknown');
            expect(/^\d+\.\d+\.\d+/.test(version)).toBe(true);
        });

        await it('honours an explicit userAgent override', async () => {
            const h = buildPublishHeaders(URL, {
                npmrc: npmrcWithToken('tok'),
                userAgent: 'npm/10.0.0 node@v22 (linux)',
            });
            expect(h['user-agent']).toBe('npm/10.0.0 node@v22 (linux)');
        });

        await it('does NOT send a stray `accept: */*` header (npm sends none)', async () => {
            // npm-registry-fetch sets no `accept` on the publish PUT.
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
            // The exact scenario in the bug report: a manual, token-authed, --otp
            // first publish of a new scoped package.
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
