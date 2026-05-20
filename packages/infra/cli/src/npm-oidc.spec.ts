// `gjsify publish --trusted` / npm Trusted Publishing OIDC plumbing.
//
// We can't reach real `https://registry.npmjs.org/-/npm/v1/oidc/...`
// from the test runner (no GitHub OIDC token available, and the npm
// registry only honours JWTs minted by real GitHub Actions runners).
// Instead each test mutates `globalThis.fetch` to a tiny stub that
// returns the npm endpoint's documented JSON shape — we're testing
// gjsify's request construction + response handling, not npm itself.

import { describe, expect, it } from '@gjsify/unit';
import {
    exchangeOidcForNpmToken,
    fetchGithubOidcToken,
    getNpmTrustedToken,
    hasGithubOidcEnv,
    OidcExchangeError,
    OidcUnavailableError,
} from './utils/npm-oidc.js';

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}

function mockFetch(handler: (req: CapturedRequest) => { status: number; body: string }): {
    restore(): void;
    requests: CapturedRequest[];
} {
    const original = globalThis.fetch;
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const headers: Record<string, string> = {};
        const hdrInit = init?.headers;
        if (hdrInit && typeof hdrInit === 'object' && !Array.isArray(hdrInit)) {
            for (const [k, v] of Object.entries(hdrInit as Record<string, string>)) {
                headers[k.toLowerCase()] = v;
            }
        }
        const captured: CapturedRequest = {
            url,
            method: (init?.method ?? 'GET').toUpperCase(),
            headers,
            body: typeof init?.body === 'string' ? init.body : null,
        };
        requests.push(captured);
        const { status, body } = handler(captured);
        return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return {
        restore: () => {
            globalThis.fetch = original;
        },
        requests,
    };
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

export default async () => {
    await describe('hasGithubOidcEnv', async () => {
        await it('returns true when both ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN} are set', () => {
            withEnv(
                {
                    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
                },
                () => {
                    expect(hasGithubOidcEnv()).toBe(true);
                },
            );
        });

        await it('returns false when either env var is missing', () => {
            withEnv(
                { ACTIONS_ID_TOKEN_REQUEST_URL: 'x', ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined },
                () => {
                    expect(hasGithubOidcEnv()).toBe(false);
                },
            );
            withEnv(
                { ACTIONS_ID_TOKEN_REQUEST_URL: undefined, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't' },
                () => {
                    expect(hasGithubOidcEnv()).toBe(false);
                },
            );
        });
    });

    await describe('fetchGithubOidcToken', async () => {
        await it('throws OidcUnavailableError when env vars missing', async () => {
            await withEnv(
                {
                    ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
                },
                async () => {
                    let thrown: Error | null = null;
                    try {
                        await fetchGithubOidcToken('npm:registry.npmjs.org');
                    } catch (e) {
                        thrown = e as Error;
                    }
                    expect(thrown !== null).toBe(true);
                    expect(thrown instanceof OidcUnavailableError).toBe(true);
                    expect((thrown as OidcUnavailableError).reason).toBe('no-env');
                },
            );
        });

        await it('GETs the request URL with audience param + Bearer token', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ value: 'fake-jwt' }) }));
            try {
                await withEnv(
                    {
                        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-bearer',
                    },
                    async () => {
                        const tok = await fetchGithubOidcToken('npm:registry.npmjs.org');
                        expect(tok).toBe('fake-jwt');
                        expect(stub.requests.length).toBe(1);
                        const req = stub.requests[0]!;
                        expect(req.method).toBe('GET');
                        expect(req.url.startsWith('https://example.com/oidc?audience=')).toBe(true);
                        expect(req.url.includes('npm%3Aregistry.npmjs.org')).toBe(true);
                        expect(req.headers['authorization']).toBe('Bearer github-bearer');
                        expect(req.headers['accept']).toBe('application/json');
                    },
                );
            } finally {
                stub.restore();
            }
        });

        await it('throws OidcUnavailableError(fetch-id-token) when GitHub returns non-2xx', async () => {
            const stub = mockFetch(() => ({ status: 403, body: 'permissions denied' }));
            try {
                await withEnv(
                    {
                        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
                    },
                    async () => {
                        let thrown: Error | null = null;
                        try {
                            await fetchGithubOidcToken('npm:r.example.com');
                        } catch (e) {
                            thrown = e as Error;
                        }
                        expect(thrown instanceof OidcUnavailableError).toBe(true);
                        expect((thrown as OidcUnavailableError).reason).toBe('fetch-id-token');
                        expect((thrown as Error).message.includes('403')).toBe(true);
                    },
                );
            } finally {
                stub.restore();
            }
        });

        await it('throws OidcUnavailableError(no-id-token) when GitHub response lacks .value', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ }) }));
            try {
                await withEnv(
                    {
                        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
                    },
                    async () => {
                        let thrown: Error | null = null;
                        try {
                            await fetchGithubOidcToken('npm:r.example.com');
                        } catch (e) {
                            thrown = e as Error;
                        }
                        expect(thrown instanceof OidcUnavailableError).toBe(true);
                        expect((thrown as OidcUnavailableError).reason).toBe('no-id-token');
                    },
                );
            } finally {
                stub.restore();
            }
        });
    });

    await describe('exchangeOidcForNpmToken', async () => {
        await it('POSTs to /-/npm/v1/oidc/token/exchange/package/<escaped> with Bearer id-token', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ token: 'npm-short-lived' }) }));
            try {
                const tok = await exchangeOidcForNpmToken({
                    packageName: '@gjsify/abort-controller',
                    registry: 'https://registry.npmjs.org',
                    idToken: 'jwt-payload',
                });
                expect(tok).toBe('npm-short-lived');
                const req = stub.requests[0]!;
                expect(req.method).toBe('POST');
                expect(req.url).toBe(
                    'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@gjsify%2fabort-controller',
                );
                expect(req.headers['authorization']).toBe('Bearer jwt-payload');
                expect(req.headers['content-type']).toBe('application/json');
            } finally {
                stub.restore();
            }
        });

        await it('handles unscoped package names via plain encodeURIComponent', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ token: 'x' }) }));
            try {
                await exchangeOidcForNpmToken({
                    packageName: 'plain-pkg',
                    registry: 'https://registry.npmjs.org',
                    idToken: 'jwt',
                });
                expect(stub.requests[0]!.url.endsWith('/package/plain-pkg')).toBe(true);
            } finally {
                stub.restore();
            }
        });

        await it('throws OidcExchangeError with status + body on 4xx', async () => {
            const stub = mockFetch(() => ({
                status: 403,
                body: JSON.stringify({ error: 'no trusted publisher configured for this package' }),
            }));
            try {
                let thrown: Error | null = null;
                try {
                    await exchangeOidcForNpmToken({
                        packageName: '@gjsify/missing-tp',
                        registry: 'https://registry.npmjs.org',
                        idToken: 'jwt',
                    });
                } catch (e) {
                    thrown = e as Error;
                }
                expect(thrown instanceof OidcExchangeError).toBe(true);
                const err = thrown as OidcExchangeError;
                expect(err.status).toBe(403);
                expect(err.body.includes('no trusted publisher')).toBe(true);
                expect(err.packageName).toBe('@gjsify/missing-tp');
            } finally {
                stub.restore();
            }
        });

        await it('throws OidcExchangeError when response body has no .token field', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ unexpected: 'shape' }) }));
            try {
                let thrown: Error | null = null;
                try {
                    await exchangeOidcForNpmToken({
                        packageName: '@gjsify/a',
                        registry: 'https://registry.npmjs.org',
                        idToken: 'jwt',
                    });
                } catch (e) {
                    thrown = e as Error;
                }
                expect(thrown instanceof OidcExchangeError).toBe(true);
                expect((thrown as Error).message.includes('no `token`')).toBe(true);
            } finally {
                stub.restore();
            }
        });

        await it('strips trailing slash from registry URL when building exchange path', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ token: 'x' }) }));
            try {
                await exchangeOidcForNpmToken({
                    packageName: '@gjsify/a',
                    registry: 'https://registry.npmjs.org/',
                    idToken: 'jwt',
                });
                expect(stub.requests[0]!.url.startsWith('https://registry.npmjs.org/-/npm/v1/oidc')).toBe(true);
            } finally {
                stub.restore();
            }
        });
    });

    await describe('getNpmTrustedToken (full flow)', async () => {
        await it('chains id-token fetch + exchange and returns the npm token + audience', async () => {
            let callCount = 0;
            const stub = mockFetch((req) => {
                callCount++;
                if (callCount === 1) {
                    // GitHub OIDC id-token request
                    expect(req.method).toBe('GET');
                    expect(req.url.includes('audience=npm%3Aregistry.npmjs.org')).toBe(true);
                    return { status: 200, body: JSON.stringify({ value: 'github-jwt' }) };
                }
                // npm exchange
                expect(req.method).toBe('POST');
                expect(req.headers['authorization']).toBe('Bearer github-jwt');
                return { status: 200, body: JSON.stringify({ token: 'npm-token' }) };
            });
            try {
                await withEnv(
                    {
                        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gh',
                    },
                    async () => {
                        const result = await getNpmTrustedToken({
                            packageName: '@gjsify/cli',
                            registry: 'https://registry.npmjs.org',
                        });
                        expect(result.token).toBe('npm-token');
                        expect(result.audience).toBe('npm:registry.npmjs.org');
                        expect(callCount).toBe(2);
                    },
                );
            } finally {
                stub.restore();
            }
        });

        await it('derives audience from registry hostname for self-hosted registries', async () => {
            let capturedAudience = '';
            const stub = mockFetch((req) => {
                if (req.method === 'GET') {
                    const match = req.url.match(/audience=([^&]+)/);
                    capturedAudience = match ? decodeURIComponent(match[1]!) : '';
                    return { status: 200, body: JSON.stringify({ value: 'jwt' }) };
                }
                return { status: 200, body: JSON.stringify({ token: 't' }) };
            });
            try {
                await withEnv(
                    {
                        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gh',
                    },
                    async () => {
                        const result = await getNpmTrustedToken({
                            packageName: '@scope/pkg',
                            registry: 'https://npm.private.corp:8443/v1/',
                        });
                        expect(capturedAudience).toBe('npm:npm.private.corp');
                        expect(result.audience).toBe('npm:npm.private.corp');
                    },
                );
            } finally {
                stub.restore();
            }
        });
    });
};
