import { describe, it, expect } from '@gjsify/unit';
import { BackendAuthError, BackendError } from '@gjsify/pim';
import {
    HttpClient,
    HostLimiter,
    ForbiddenError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ResponseFormatError,
    ServerError,
    TimeoutError,
    UnauthorizedError,
    parseRetryAfter,
} from './index.js';

interface Call {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
}
type Reply = { status: number; body?: string; headers?: Record<string, string> };

function mock(replies: Reply[]) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string, init: RequestInit): Promise<Response> => {
        calls.push({
            method: String(init.method),
            url,
            headers: { ...(init.headers as Record<string, string>) },
            body: init.body as string | undefined,
        });
        const r = replies.shift();
        if (!r) throw new Error('unexpected request ' + url);
        return new Response(r.status === 304 ? null : (r.body ?? ''), { status: r.status, headers: r.headers });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
}

const BASE = 'https://cloud.example.org/api/v1/';

async function failure(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (err) {
        return err;
    }
    throw new Error('expected a failure');
}

export default async () => {
    await describe('HttpClient', async () => {
        await it('resolves relative paths against the base and adds the query', async () => {
            const { fetchFn } = mock([]);
            const client = new HttpClient({ baseUrl: 'https://cloud.example.org/api/v1', fetch: fetchFn });
            expect(client.baseUrl).toBe(BASE);
            const url = client.resolve('/boards', { a: 1, b: undefined, c: true });
            expect(url.href).toBe('https://cloud.example.org/api/v1/boards?a=1&c=true');
        });

        await it('refuses credentials in the base URL and requests off the origin', async () => {
            expect(() => new HttpClient({ baseUrl: 'https://u:p@cloud.example.org/' })).toThrow();
            const client = new HttpClient({ baseUrl: BASE, fetch: mock([]).fetchFn });
            expect(() => client.resolve('https://evil.example.net/steal')).toThrow();
        });

        await it('sends Basic auth for basic and app-password', async () => {
            for (const type of ['basic', 'app-password'] as const) {
                const { calls, fetchFn } = mock([{ status: 200, body: '{}' }]);
                const client = new HttpClient({
                    baseUrl: BASE,
                    auth: { type, username: 'ann', password: 'pw' },
                    fetch: fetchFn,
                });
                await client.getJson('x');
                expect(calls[0].headers['Authorization']).toBe('Basic ' + btoa('ann:pw'));
            }
        });

        await it('sends bearer and named-header auth', async () => {
            const a = mock([{ status: 200, body: '{}' }]);
            await new HttpClient({ baseUrl: BASE, auth: { type: 'bearer', token: 'tok' }, fetch: a.fetchFn }).getJson(
                'x',
            );
            expect(a.calls[0].headers['Authorization']).toBe('Bearer tok');
            const b = mock([{ status: 200, body: '{}' }]);
            await new HttpClient({
                baseUrl: BASE,
                auth: { type: 'header', name: 'X-Api-Key', value: 'k' },
                fetch: b.fetchFn,
            }).getJson('x');
            expect(b.calls[0].headers['X-Api-Key']).toBe('k');
        });

        await it('returns data and etag, and revalidates with If-None-Match', async () => {
            const { calls, fetchFn } = mock([
                { status: 200, body: '{"n":1}', headers: { ETag: '"v1"' } },
                { status: 304, headers: { ETag: '"v1"' } },
            ]);
            const client = new HttpClient({ baseUrl: BASE, fetch: fetchFn });
            const first = await client.getJson<{ n: number }>('boards');
            expect(first.status).toBe('ok');
            if (first.status === 'ok') {
                expect(first.data.n).toBe(1);
                expect(first.etag).toBe('"v1"');
            }
            const second = await client.getJson('boards', { etag: '"v1"' });
            expect(second.status).toBe('unchanged');
            expect(calls[1].headers['If-None-Match']).toBe('"v1"');
        });

        await it('sends JSON bodies with POST and PATCH', async () => {
            const { calls, fetchFn } = mock([
                { status: 200, body: '{"ok":true}' },
                { status: 200, body: '{"ok":true}' },
            ]);
            const client = new HttpClient({ baseUrl: BASE, fetch: fetchFn });
            await client.postJson('query', { q: 1 });
            await client.sendJson('PATCH', 'cards/1', { title: 't' });
            expect(calls[0].method).toBe('POST');
            expect(calls[0].body).toBe('{"q":1}');
            expect(calls[0].headers['Content-Type']).toBe('application/json');
            expect(calls[1].method).toBe('PATCH');
        });

        await it('treats an empty 2xx as a format error unless allowEmpty is set', async () => {
            const { fetchFn } = mock([{ status: 200 }, { status: 200 }]);
            const client = new HttpClient({ baseUrl: BASE, fetch: fetchFn });
            expect(await failure(() => client.getJson('x'))).toBeInstanceOf(ResponseFormatError);
            const ok = await client.getJson('x', { allowEmpty: true });
            expect(ok.status).toBe('ok');
        });

        await it('rejects a body that is not JSON', async () => {
            const client = new HttpClient({ baseUrl: BASE, fetch: mock([{ status: 200, body: '<html>' }]).fetchFn });
            expect(await failure(() => client.getJson('x'))).toBeInstanceOf(ResponseFormatError);
        });

        await it('maps statuses to typed errors that extend the pim errors', async () => {
            const cases: Array<[number, new (...args: never[]) => unknown]> = [
                [401, UnauthorizedError],
                [403, ForbiddenError],
                [404, NotFoundError],
                [429, RateLimitedError],
                [503, ServerError],
            ];
            for (const [status, type] of cases) {
                const client = new HttpClient({ baseUrl: BASE, fetch: mock([{ status }]).fetchFn });
                const err = await failure(() => client.getJson('x'));
                expect(err).toBeInstanceOf(type);
                expect(err).toBeInstanceOf(BackendError);
                expect((err as BackendError).domain).toBe('http');
                expect((err as BackendError).code).toBe(status);
            }
            const auth = await failure(() =>
                new HttpClient({ baseUrl: BASE, fetch: mock([{ status: 401 }]).fetchFn }).getJson('x'),
            );
            expect(auth).toBeInstanceOf(BackendAuthError);
        });

        await it('carries Retry-After on a 429 without leaking query or body', async () => {
            const { fetchFn } = mock([{ status: 429, body: 'secret-body', headers: { 'Retry-After': '7' } }]);
            const client = new HttpClient({ baseUrl: BASE, fetch: fetchFn });
            const err = (await failure(() => client.getJson('x', { query: { token: 'abc' } }))) as RateLimitedError;
            expect(err.retryAfterMs).toBe(7000);
            expect(err.message.includes('abc')).toBe(false);
            expect(err.message.includes('secret-body')).toBe(false);
        });

        await it('scrubs credentials from network errors', async () => {
            const fetchFn = (async () => {
                throw new Error('connect failed for Bearer s3cret-token');
            }) as unknown as typeof fetch;
            const client = new HttpClient({
                baseUrl: BASE,
                auth: { type: 'bearer', token: 's3cret-token' },
                fetch: fetchFn,
            });
            const err = await failure(() => client.getJson('x'));
            expect(err).toBeInstanceOf(NetworkError);
            expect((err as Error).message.includes('s3cret-token')).toBe(false);
        });

        await it('times out a request that never answers', async () => {
            const fetchFn = ((_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                })) as unknown as typeof fetch;
            const client = new HttpClient({ baseUrl: BASE, fetch: fetchFn, timeoutMs: 20 });
            expect(await failure(() => client.getJson('x'))).toBeInstanceOf(TimeoutError);
        });

        await it('never serialises credentials', async () => {
            const client = new HttpClient({
                baseUrl: BASE,
                auth: { type: 'bearer', token: 'tok' },
                fetch: mock([]).fetchFn,
            });
            expect(JSON.stringify(client)).toBe(JSON.stringify({ baseUrl: BASE }));
        });

        await it('uses a caller-supplied limiter', async () => {
            const limiter = new HostLimiter({ maxConcurrent: 1 });
            let ran = 0;
            const original = limiter.run.bind(limiter);
            limiter.run = ((host: string, task: () => Promise<unknown>) => {
                ran += 1;
                return original(host, task);
            }) as typeof limiter.run;
            const client = new HttpClient({
                baseUrl: BASE,
                limiter,
                fetch: mock([{ status: 200, body: '{}' }]).fetchFn,
            });
            await client.getJson('x');
            expect(ran).toBe(1);
        });
    });

    await describe('parseRetryAfter', async () => {
        await it('reads seconds and HTTP dates, and ignores junk', async () => {
            expect(parseRetryAfter('3')).toBe(3000);
            const now = Date.parse('2026-01-01T00:00:00Z');
            expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
            expect(parseRetryAfter('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0);
            expect(parseRetryAfter('soon')).toBe(undefined);
            expect(parseRetryAfter(null)).toBe(undefined);
        });
    });
};
