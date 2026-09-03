// The post-PUT read-back that decides whether `gjsify publish` may print `+`.
//
// The rows below are written against the ONE distinction the v0.46.0 incident
// turned on: "not there" and "not there YET" look identical at the moment of the
// 2xx. Measured across that release's 199 packages, 90.5% of versions were
// already committed when the response arrived and 9.5% were recorded 56-252 s
// later, so a read-back that cannot tell a lagging write from a lost one either
// false-reds a tenth of the release or repeats the incident. `sleep` and `now`
// are injected so the tail is exercised in milliseconds.

import { describe, expect, it } from '@gjsify/unit';
import {
    backoffFor,
    DEFAULT_VERIFY_BUDGET_MS,
    formatUnconfirmedPublish,
    verifyPublishedVersion,
    type ReadbackResult,
} from './utils/publish-readback.js';

interface CapturedRequest {
    url: string;
    headers: Record<string, string>;
}

/** One canned registry answer. */
type Answer = { status: number; body: string };

/**
 * A fake registry that answers a scripted SEQUENCE — the last answer repeats, so
 * "404 forever" is one entry and "404 twice then served" is three.
 */
function scriptedRegistry(answers: Answer[]): {
    fetchImpl: typeof fetch;
    requests: CapturedRequest[];
} {
    const requests: CapturedRequest[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const headers: Record<string, string> = {};
        const hdrInit = init?.headers;
        if (hdrInit && typeof hdrInit === 'object' && !Array.isArray(hdrInit)) {
            for (const [k, v] of Object.entries(hdrInit as Record<string, string>)) headers[k.toLowerCase()] = v;
        }
        requests.push({ url, headers });
        const answer = answers[Math.min(requests.length - 1, answers.length - 1)] as Answer;
        return new Response(answer.body, {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
    return { fetchImpl, requests };
}

/** An abbreviated packument carrying `version`, tarball and all. */
function packumentWith(name: string, version: string, opts: { tarball?: boolean } = {}): string {
    const dist: Record<string, unknown> = { shasum: 'deadbeef' };
    if (opts.tarball !== false) {
        dist.tarball = `https://registry.example/${name}/-/x-${version}.tgz`;
    }
    return JSON.stringify({ name, 'dist-tags': { latest: version }, versions: { [version]: { version, dist } } });
}

/** A clock + `sleep` that advances it, so a 300 s budget runs in no real time. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
    let t = 1_000;
    const slept: number[] = [];
    return {
        now: () => t,
        sleep: async (ms: number) => {
            slept.push(ms);
            t += ms;
        },
        slept,
    };
}

function readback(overrides: Partial<ReadbackResult> = {}): ReadbackResult {
    return {
        confirmed: false,
        attempts: 7,
        elapsedMs: 300_400,
        url: 'https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64',
        last: { state: 'absent', status: 404, detail: '404 — the registry serves no packument for this name' },
        ...overrides,
    };
}

export default async () => {
    await describe('verifyPublishedVersion — the version is served', async () => {
        await it('confirms on the FIRST probe, the 90.5% case', async () => {
            const clock = fakeClock();
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/child_process', '0.46.0') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org/',
                name: '@gjsify/child_process',
                version: '0.46.0',
                budgetMs: DEFAULT_VERIFY_BUDGET_MS,
                fetchImpl,
                ...clock,
            });
            expect(result.confirmed).toBe(true);
            expect(result.attempts).toBe(1);
            expect(requests.length).toBe(1);
            // Nine packages in ten must cost exactly one GET and no waiting —
            // that is what makes a per-package read-back affordable at all.
            expect(clock.slept.length).toBe(0);
        });

        await it('asks the escaped name with the abbreviated-packument headers', async () => {
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/cli', '0.46.0') },
            ]);
            const result = await verifyPublishedVersion({
                // Trailing slash must not double up in the probe URL.
                registry: 'https://registry.npmjs.org/',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1_000,
                fetchImpl,
                ...fakeClock(),
            });
            expect(requests[0]?.url).toBe('https://registry.npmjs.org/@gjsify%2fcli');
            expect(requests[0]?.headers['accept']).toBe('application/vnd.npm.install-v1+json');
            // Without this the CDN can answer with a document minted BEFORE the
            // publish we are asking about, which is the whole question.
            expect(requests[0]?.headers['cache-control']).toBe('no-cache');
            expect(result.url).toBe('https://registry.npmjs.org/@gjsify%2fcli');
        });
    });

    await describe('verifyPublishedVersion — not there YET', async () => {
        await it('keeps asking and confirms once the write lands', async () => {
            const clock = fakeClock();
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 404, body: '{}' },
                { status: 404, body: '{}' },
                { status: 200, body: packumentWith('@gjsify/async_hooks', '0.46.0') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/async_hooks',
                version: '0.46.0',
                budgetMs: DEFAULT_VERIFY_BUDGET_MS,
                fetchImpl,
                ...clock,
            });
            expect(result.confirmed).toBe(true);
            expect(result.attempts).toBe(3);
            expect(requests.length).toBe(3);
            expect(clock.slept).toStrictEqual([backoffFor(0), backoffFor(1)]);
        });

        await it('treats a packument WITHOUT our version as absent, not as served', async () => {
            // @gjsify/node-runtime-darwin-arm64's packument existed throughout the
            // incident — at 0.45.0. Answering "the name resolves" would have
            // confirmed the publish that never happened.
            const { fetchImpl } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/node-runtime-darwin-arm64', '0.45.0') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/node-runtime-darwin-arm64',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(false);
            expect(result.last.state).toBe('absent');
            expect(result.last.state === 'absent' ? result.last.detail : '').toContain('newest 0.45.0');
        });

        await it('refuses a version record whose dist.tarball is missing (#1407)', async () => {
            const { fetchImpl } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/empty', '0.46.0', { tarball: false }) },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/empty',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(false);
            expect(result.last.state === 'absent' ? result.last.detail : '').toContain('dist.tarball');
        });
    });

    await describe('verifyPublishedVersion — not there', async () => {
        await it('gives up at the budget and reports what it saw', async () => {
            const clock = fakeClock();
            const { fetchImpl, requests } = scriptedRegistry([{ status: 404, body: '{}' }]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/node-runtime-darwin-arm64',
                version: '0.46.0',
                budgetMs: DEFAULT_VERIFY_BUDGET_MS,
                fetchImpl,
                ...clock,
            });
            expect(result.confirmed).toBe(false);
            expect(result.last.state).toBe('absent');
            // The budget is a ceiling on the WAITING, and the last probe is sent
            // from inside it — so the loop terminates and never overshoots by
            // more than one interval's worth of clock.
            expect(result.elapsedMs).toBeLessThan(DEFAULT_VERIFY_BUDGET_MS + 1);
            expect(requests.length).toBe(result.attempts);
            expect(result.attempts).toBeGreaterThan(1);
        });

        await it('a 5xx is `error`, NOT `absent` — no verdict we did not earn', async () => {
            const { fetchImpl } = scriptedRegistry([{ status: 503, body: 'upstream unavailable' }]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(false);
            expect(result.last.state).toBe('error');
            expect(result.last.state === 'error' ? result.last.detail : '').toContain('503');
        });

        await it('a thrown fetch is `error` too, and does not escape', async () => {
            const fetchImpl = (async () => {
                throw new Error('ECONNRESET');
            }) as unknown as typeof fetch;
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.last.state).toBe('error');
            expect(result.last.state === 'error' ? result.last.detail : '').toContain('ECONNRESET');
        });

        await it('a 200 that is not a packument is `error`, not `absent`', async () => {
            const { fetchImpl } = scriptedRegistry([{ status: 200, body: '<html>proxy login</html>' }]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.last.state).toBe('error');
        });
    });

    await describe('formatUnconfirmedPublish', async () => {
        await it('says what was PUT, what was asked, and what came back', async () => {
            // The three questions the incident log could not answer, which is why
            // reconstructing it needed the registry rather than the log.
            const msg = formatUnconfirmedPublish({
                name: '@gjsify/node-runtime-darwin-arm64',
                version: '0.46.0',
                putUrl: 'https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64',
                putStatus: 201,
                putStatusText: 'Created',
                payloadBytes: 53863410,
                readback: readback(),
            });
            expect(msg).toContain('@gjsify/node-runtime-darwin-arm64@0.46.0');
            expect(msg).toContain('PUT       https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64');
            expect(msg).toContain('53863410 bytes');
            expect(msg).toContain('201 Created');
            expect(msg).toContain('read-back GET https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64');
            expect(msg).toContain('404');
            expect(msg).toContain('7 probe(s) over 300.4s');
        });

        await it('reports a probe ERROR as such, so it is not read as "never published"', async () => {
            const msg = formatUnconfirmedPublish({
                name: '@gjsify/cli',
                version: '0.46.0',
                putUrl: 'https://registry.npmjs.org/@gjsify%2fcli',
                putStatus: 200,
                putStatusText: 'OK',
                payloadBytes: 42,
                readback: readback({ last: { state: 'error', status: 503, detail: '503 Service Unavailable' } }),
            });
            expect(msg).toContain('answered  error: 503 Service Unavailable');
        });
    });

    await describe('backoffFor', async () => {
        await it('starts short, stops shrinking at 30 s, and never runs off the table', async () => {
            expect(backoffFor(0)).toBe(2_000);
            expect(backoffFor(4)).toBe(30_000);
            expect(backoffFor(99)).toBe(30_000);
            expect(backoffFor(-1)).toBe(2_000);
        });
    });
};
