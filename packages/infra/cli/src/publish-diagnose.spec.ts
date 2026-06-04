// `gjsify publish` dead-token-vs-missing-package 404 diagnostic.
//
// Verifies the /-/whoami probe correctly disambiguates the two situations:
//   - body `{}`         → dead-token hint (refresh ~/.npmrc)
//   - body `{username}` → live-token-404 hint (first-publish bootstrap)
//
// We don't reach real registry.npmjs.org from the test runner — every test
// installs a `globalThis.fetch` stub that mimics npm's documented response
// shape and asserts on the request + message produced by `diagnose404`.

import { describe, expect, it } from '@gjsify/unit';
import { diagnose404, is404DiagnosticCandidate } from './utils/publish-diagnose.js';
import type { NpmrcConfig } from '@gjsify/npm-registry';

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
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

function npmrcWithToken(token: string): NpmrcConfig {
    return {
        registry: 'https://registry.npmjs.org/',
        scopes: {},
        authTokens: { '//registry.npmjs.org': token },
        basicAuth: {},
    };
}

export default async () => {
    await describe('is404DiagnosticCandidate', async () => {
        await it('treats empty body as candidate', () => {
            expect(is404DiagnosticCandidate('')).toBe(true);
            expect(is404DiagnosticCandidate('   ')).toBe(true);
        });

        await it('treats "Not Found" (any case) as candidate', () => {
            expect(is404DiagnosticCandidate('Not Found')).toBe(true);
            expect(is404DiagnosticCandidate('not found')).toBe(true);
            expect(is404DiagnosticCandidate(' Not Found ')).toBe(true);
        });

        await it('treats {"error":"Not Found"} JSON shape as candidate', () => {
            expect(is404DiagnosticCandidate('{"error":"Not Found"}')).toBe(true);
        });

        await it('rejects structured npm errors with codes', () => {
            expect(is404DiagnosticCandidate('{"error":"E404 some other shape"}')).toBe(false);
            expect(is404DiagnosticCandidate('forbidden')).toBe(false);
        });
    });

    await describe('diagnose404 — dead token (whoami body {})', async () => {
        await it('reports dead-token reason + refresh hint', async () => {
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/abort-controller',
                    version: '0.4.36',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('npm_DEADBEEF'),
                });
                expect(result.reason).toBe('dead-token');
                expect(result.username).toBeUndefined();
                expect(result.message.includes('@gjsify/abort-controller@0.4.36')).toBe(true);
                expect(result.message.includes('404 Not Found')).toBe(true);
                expect(result.message.includes('revoked or expired')).toBe(true);
                expect(result.message.includes('npm login')).toBe(true);
                expect(result.message.includes('/-/whoami')).toBe(true);
            } finally {
                stub.restore();
            }
        });

        await it('forwards the bearer token to /-/whoami', async () => {
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                await diagnose404({
                    packageName: '@gjsify/cli',
                    version: '0.4.36',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('npm_TESTTOKEN_xyz'),
                });
                expect(stub.requests.length).toBe(1);
                const req = stub.requests[0]!;
                expect(req.method).toBe('GET');
                expect(req.url).toBe('https://registry.npmjs.org/-/whoami');
                expect(req.headers['authorization']).toBe('Bearer npm_TESTTOKEN_xyz');
            } finally {
                stub.restore();
            }
        });

        await it('handles registry URL without trailing slash', async () => {
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                await diagnose404({
                    packageName: '@gjsify/x',
                    version: '0.0.0',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('t'),
                });
                expect(stub.requests[0]!.url).toBe('https://registry.npmjs.org/-/whoami');
            } finally {
                stub.restore();
            }
        });
    });

    await describe('diagnose404 — live token (whoami body {username})', async () => {
        await it('reports live-token-404 with first-publish hint', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ username: 'jumplink' }) }));
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/brand-new-pkg',
                    version: '0.0.1',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('npm_LIVE_TOKEN'),
                });
                expect(result.reason).toBe('live-token-404');
                expect(result.username).toBe('jumplink');
                expect(result.message.includes('Authenticated as: jumplink')).toBe(true);
                expect(result.message.includes('NOT a dead-token problem')).toBe(true);
                expect(result.message.includes('first-publish')).toBe(true);
                // the new transient-provisioning-race hint
                expect(result.message.includes('provisioning')).toBe(true);
                expect(result.message.includes('npm publish')).toBe(true);
                expect(result.message.includes('@gjsify/brand-new-pkg')).toBe(true);
                expect(result.message.includes('npm access ls-packages')).toBe(true);
            } finally {
                stub.restore();
            }
        });

        await it('treats empty-string username as dead token', async () => {
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ username: '' }) }));
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/x',
                    version: '0.0.0',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('t'),
                });
                expect(result.reason).toBe('dead-token');
            } finally {
                stub.restore();
            }
        });
    });

    await describe('diagnose404 — best-effort fallback', async () => {
        await it('returns unknown when whoami throws', async () => {
            const original = globalThis.fetch;
            globalThis.fetch = (async () => {
                throw new TypeError('fetch failed');
            }) as typeof fetch;
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/x',
                    version: '0.0.0',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('t'),
                });
                expect(result.reason).toBe('unknown');
            } finally {
                globalThis.fetch = original;
            }
        });

        await it('returns unknown when whoami returns non-2xx', async () => {
            const stub = mockFetch(() => ({ status: 401, body: 'Unauthorized' }));
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/x',
                    version: '0.0.0',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('t'),
                });
                expect(result.reason).toBe('unknown');
            } finally {
                stub.restore();
            }
        });

        await it('returns unknown when whoami body is not JSON', async () => {
            const stub = mockFetch(() => ({ status: 200, body: 'not-json' }));
            try {
                const result = await diagnose404({
                    packageName: '@gjsify/x',
                    version: '0.0.0',
                    registry: 'https://registry.npmjs.org',
                    npmrc: npmrcWithToken('t'),
                });
                expect(result.reason).toBe('unknown');
            } finally {
                stub.restore();
            }
        });
    });
};
