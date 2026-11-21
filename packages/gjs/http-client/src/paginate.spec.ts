import { describe, it, expect } from '@gjsify/unit';
import { HttpClient, HostLimiter, ResponseFormatError, paginate, paginateAll, parseLinkHeader } from './index.js';

type Reply = { status: number; body: string; headers?: Record<string, string> };

function clientFor(replies: Reply[]) {
    const urls: string[] = [];
    const fetchFn = (async (url: string): Promise<Response> => {
        urls.push(url);
        const r = replies.shift();
        if (!r) throw new Error('unexpected request ' + url);
        return new Response(r.body, { status: r.status, headers: r.headers });
    }) as unknown as typeof fetch;
    return { urls, client: new HttpClient({ baseUrl: 'https://api.example.org/v1/', fetch: fetchFn }) };
}

export default async () => {
    await describe('parseLinkHeader', async () => {
        await it('parses several links with rel values', async () => {
            const refs = parseLinkHeader(
                '<https://a.example/p2>; rel="next", <https://a.example/p1>; rel="prev first"',
            );
            expect(refs.length).toBe(2);
            expect(refs[0].url).toBe('https://a.example/p2');
            expect(refs[0].rel[0]).toBe('next');
            expect(refs[1].rel.length).toBe(2);
        });

        await it('returns nothing for an absent header', async () => {
            expect(parseLinkHeader(null).length).toBe(0);
        });
    });

    await describe('paginate', async () => {
        await it('follows Link rel=next until it is gone', async () => {
            const { client, urls } = clientFor([
                {
                    status: 200,
                    body: '[1,2]',
                    headers: { Link: '<https://api.example.org/v1/items?page=2>; rel="next"' },
                },
                { status: 200, body: '[3]' },
            ]);
            const all = await paginateAll<number>(client, 'items', { style: 'link' });
            expect(all.length).toBe(3);
            expect(urls[1]).toBe('https://api.example.org/v1/items?page=2');
        });

        await it('refuses a next link that leaves the origin', async () => {
            const { client } = clientFor([
                { status: 200, body: '[1]', headers: { Link: '<https://evil.example.net/x>; rel="next"' } },
            ]);
            let error: unknown;
            try {
                await paginateAll(client, 'items', { style: 'link' });
            } catch (err) {
                error = err;
            }
            expect(error).toBeInstanceOf(ResponseFormatError);
        });

        await it('walks offset pages by items and stops on a short page', async () => {
            const { client, urls } = clientFor([
                { status: 200, body: '[1,2]' },
                { status: 200, body: '[3,4]' },
                { status: 200, body: '[5]' },
            ]);
            const all = await paginateAll<number>(client, 'items', { style: 'offset', pageSize: 2 });
            expect(all.length).toBe(5);
            expect(urls[0]).toBe('https://api.example.org/v1/items?pageSize=2&offset=0');
            expect(urls[1]).toBe('https://api.example.org/v1/items?pageSize=2&offset=2');
        });

        await it('counts pages from 1 with offsetUnit pages and custom parameter names', async () => {
            const { client, urls } = clientFor([
                { status: 200, body: '{"rows":[1,2]}' },
                { status: 200, body: '{"rows":[]}' },
            ]);
            const pages: number[][] = [];
            for await (const page of paginate<number>(client, 'items', {
                style: 'offset',
                pageSize: 2,
                offsetUnit: 'pages',
                offsetParam: 'page',
                limitParam: 'size',
                items: (body) => (body as { rows: number[] }).rows,
            })) {
                pages.push(page);
            }
            expect(pages.length).toBe(1);
            expect(urls[0]).toBe('https://api.example.org/v1/items?size=2&page=1');
        });

        await it('fails instead of truncating when the page cap is hit', async () => {
            const { client } = clientFor([
                { status: 200, body: '[1]', headers: { Link: '<https://api.example.org/v1/a>; rel="next"' } },
                { status: 200, body: '[1]', headers: { Link: '<https://api.example.org/v1/b>; rel="next"' } },
            ]);
            let error: unknown;
            try {
                await paginateAll(client, 'items', { style: 'link', maxPages: 2 });
            } catch (err) {
                error = err;
            }
            expect(error).toBeInstanceOf(ResponseFormatError);
        });

        await it('rejects a page body that is not an array', async () => {
            const { client } = clientFor([{ status: 200, body: '{"a":1}' }]);
            let error: unknown;
            try {
                await paginateAll(client, 'items', { style: 'offset', pageSize: 2 });
            } catch (err) {
                error = err;
            }
            expect(error).toBeInstanceOf(ResponseFormatError);
        });
    });

    await describe('HostLimiter', async () => {
        await it('keeps at most maxConcurrent tasks in flight per host', async () => {
            const limiter = new HostLimiter({ maxConcurrent: 2 });
            let active = 0;
            let peak = 0;
            const task = async () => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
            };
            await Promise.all([1, 2, 3, 4, 5].map(() => limiter.run('a.example', task)));
            expect(peak).toBe(2);
        });

        await it('keeps hosts independent', async () => {
            const limiter = new HostLimiter({ maxConcurrent: 1 });
            let active = 0;
            let peak = 0;
            const task = async () => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
            };
            await Promise.all([limiter.run('a.example', task), limiter.run('b.example', task)]);
            expect(peak).toBe(2);
        });

        await it('spaces request starts by minIntervalMs', async () => {
            const slept: number[] = [];
            let clock = 1000;
            const limiter = new HostLimiter({
                minIntervalMs: 50,
                now: () => clock,
                sleep: async (ms) => {
                    slept.push(ms);
                    clock += ms;
                },
            });
            await limiter.run('a.example', async () => {});
            await limiter.run('a.example', async () => {});
            expect(slept.length).toBe(1);
            expect(slept[0]).toBe(50);
        });

        await it('rejects an invalid maxConcurrent', async () => {
            expect(() => new HostLimiter({ maxConcurrent: 0 })).toThrow();
        });
    });
};
