// What a version npm accepted but the packument does not serve actually IS.
//
// The status endpoint is the only source that tells `validating` (will appear, or
// turn blocked) from `staged` (needs a human) from `blocked`/`deleted` (never).
// It takes an access token, not the OIDC publish token, so half of these rows are
// about what the classifier says when it could not ask.

import { describe, expect, it } from '@gjsify/unit';
import {
    classifyUnserved,
    describeClass,
    fetchVersionStatus,
    statusTokenFromEnv,
    type StatusProbe,
} from './utils/publish-status.js';

function statusRegistry(status: number, body: string): { fetchImpl: typeof fetch; urls: string[]; auths: string[] } {
    const urls: string[] = [];
    const auths: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(typeof input === 'string' ? input : input.toString());
        auths.push((init?.headers as Record<string, string> | undefined)?.['authorization'] ?? '');
        return new Response(body, {
            status,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
    return { fetchImpl, urls, auths };
}

const known = (status: 'published' | 'validating' | 'staged' | 'blocked' | 'deleted'): StatusProbe => ({
    state: 'known',
    status,
});

export default async () => {
    await describe('statusTokenFromEnv', async () => {
        await it('prefers NPM_STATUS_TOKEN', async () => {
            expect(
                statusTokenFromEnv({
                    NPM_STATUS_TOKEN: 'npm_a',
                    NODE_AUTH_TOKEN: 'npm_b',
                }),
            ).toBe('npm_a');
        });
        await it('falls back to a real NODE_AUTH_TOKEN', async () => {
            expect(statusTokenFromEnv({ NODE_AUTH_TOKEN: 'npm_b' })).toBe('npm_b');
        });
        await it('ignores the setup-node placeholder and empty values', async () => {
            expect(statusTokenFromEnv({ NODE_AUTH_TOKEN: 'XXXXX-XXXXX-XXXXX-XXXXX' })).toBeUndefined();
            expect(statusTokenFromEnv({ NPM_STATUS_TOKEN: '  ' })).toBeUndefined();
            expect(statusTokenFromEnv({})).toBeUndefined();
        });
    });

    await describe('fetchVersionStatus', async () => {
        await it('sends no request without a token', async () => {
            const reg = statusRegistry(200, '{}');
            const probe = await fetchVersionStatus({
                registry: 'https://r.example',
                name: '@gjsify/x',
                version: '1.0.0',
                fetchImpl: reg.fetchImpl,
            });
            expect(probe.state).toBe('unavailable');
            expect(probe.state === 'unavailable' && probe.reason).toBe('no-credential');
            expect(reg.urls.length).toBe(0);
        });
        await it('asks the documented route with a bearer token', async () => {
            const reg = statusRegistry(200, '{"status":"validating"}');
            const probe = await fetchVersionStatus({
                registry: 'https://r.example/',
                name: '@gjsify/x',
                version: '1.0.0',
                token: 'npm_t',
                fetchImpl: reg.fetchImpl,
            });
            expect(probe).toStrictEqual({ state: 'known', status: 'validating' });
            expect(reg.urls[0]).toBe('https://r.example/-/package/@gjsify%2fx/version/1.0.0/status');
            expect(reg.auths[0]).toBe('Bearer npm_t');
        });
        for (const [code, reason] of [
            [401, 'rejected'],
            [403, 'not-enabled'],
            [404, 'not-found'],
            [500, 'error'],
        ] as const) {
            await it(`maps HTTP ${code} to ${reason}`, async () => {
                const reg = statusRegistry(code, '{}');
                const probe = await fetchVersionStatus({
                    registry: 'https://r.example',
                    name: 'x',
                    version: '1.0.0',
                    token: 't',
                    fetchImpl: reg.fetchImpl,
                });
                expect(probe.state === 'unavailable' && probe.reason).toBe(reason);
            });
        }
        await it('rejects an unrecognised status value', async () => {
            const reg = statusRegistry(200, '{"status":"weird"}');
            const probe = await fetchVersionStatus({
                registry: 'https://r.example',
                name: 'x',
                version: '1.0.0',
                token: 't',
                fetchImpl: reg.fetchImpl,
            });
            expect(probe.state === 'unavailable' && probe.reason).toBe('error');
        });
    });

    await describe('classifyUnserved', async () => {
        await it('validating is not terminal', async () => {
            const c = classifyUnserved('not-published', known('validating'));
            expect(c.cls).toBe('validating');
            expect(c.terminal).toBe(false);
        });
        for (const status of ['staged', 'blocked', 'deleted'] as const) {
            await it(`${status} is terminal`, async () => {
                const c = classifyUnserved('not-published', known(status));
                expect(c.cls).toBe(status);
                expect(c.terminal).toBe(true);
            });
        }
        await it('published-but-unserved is lag, not terminal', async () => {
            const c = classifyUnserved('recorded-not-served', known('published'));
            expect(c.cls).toBe('published-lagging');
            expect(c.terminal).toBe(false);
        });
        await it('a status 404 means the PUT did not land', async () => {
            const c = classifyUnserved('not-published', {
                state: 'unavailable',
                reason: 'not-found',
                detail: '404',
            });
            expect(c.cls).toBe('missing');
            expect(c.terminal).toBe(true);
        });
        await it('without a credential it is unchecked and says why — never "missing"', async () => {
            const c = classifyUnserved('not-published', {
                state: 'unavailable',
                reason: 'no-credential',
                detail: 'x',
            });
            expect(c.cls).toBe('unchecked');
            expect(c.terminal).toBe(false);
            expect(c.detail.includes('NPM_STATUS_TOKEN')).toBe(true);
        });
        await it('every class has a label', async () => {
            expect(describeClass('validating').includes('validating')).toBe(true);
            expect(describeClass('unchecked').length > 0).toBe(true);
        });
    });
};
