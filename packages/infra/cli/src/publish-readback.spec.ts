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
    probeTimeoutFor,
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

/**
 * A registry that answers the abbreviated document and the FULL one separately.
 *
 * The two are different documents and the read-back asks them different
 * questions — "do you serve it" and "do you record it" — so a fake that cannot
 * tell them apart cannot exercise the verdict at all.
 */
function splitRegistry(opts: { abbreviated: Answer[]; full: Answer }): {
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
        const wantsFull = headers['accept'] !== 'application/vnd.npm.install-v1+json';
        const answer = wantsFull
            ? opts.full
            : (opts.abbreviated[
                  Math.min(requests.filter((r) => r.headers['accept']).length - 1, opts.abbreviated.length - 1)
              ] as Answer);
        return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { fetchImpl, requests };
}

/** A FULL packument: a `time` map, which the abbreviated document does not carry. */
function fullPackumentWith(name: string, time: Record<string, string>): string {
    return JSON.stringify({ name, time: { created: '2020-01-01T00:00:00.000Z', ...time }, versions: {} });
}

/** The buster parameter, stripped, so a row can assert on the route it asked for. */
function withoutBuster(url: string): string {
    return url.replace(/[?&]__gjsify_readback=[^&]*/, '');
}

/** The buster parameter's value, or `undefined` when the probe sent none. */
function busterOf(url: string): string | undefined {
    return /[?&]__gjsify_readback=([^&]*)/.exec(url)?.[1];
}

function readback(overrides: Partial<ReadbackResult> = {}): ReadbackResult {
    return {
        confirmed: false,
        verdict: 'not-published',
        verdictDetail: 'the registry has no packument for this name at all (404)',
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
            expect(withoutBuster(requests[0]?.url ?? '')).toBe('https://registry.npmjs.org/@gjsify%2fcli');
            expect(requests[0]?.headers['accept']).toBe('application/vnd.npm.install-v1+json');
            // Sent for the caches that honour it. The edge in front of
            // registry.npmjs.org measurably does not — every Cache-Control
            // variant came back `cf-cache-status: HIT` with an `age` up to the
            // document's own max-age=300 — so the probe ALSO carries a key no
            // cache holds, which is the thing that actually produced a MISS.
            expect(requests[0]?.headers['cache-control']).toBe('no-cache');
            expect(busterOf(requests[0]?.url ?? '')).toBeTruthy();
            // The REPORTED url stays the clean route: it is what a human re-runs.
            expect(result.url).toBe('https://registry.npmjs.org/@gjsify%2fcli');
        });

        await it('gives every probe its OWN cache key, not one buster per run', async () => {
            // A buster fixed for the run is a cache key like any other: the
            // second probe would re-read exactly what the first one cached, and
            // a read-back that re-reads its own stale answer for 300 s is the
            // false red this defends against.
            const clock = fakeClock();
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 404, body: '{}' },
                { status: 404, body: '{}' },
                { status: 200, body: packumentWith('@gjsify/fs', '0.46.0') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/fs',
                version: '0.46.0',
                budgetMs: DEFAULT_VERIFY_BUDGET_MS,
                fetchImpl,
                ...clock,
            });
            expect(result.confirmed).toBe(true);
            const busters = requests.map((r) => busterOf(r.url));
            expect(busters.length).toBe(3);
            expect(new Set(busters).size).toBe(3);
        });

        await it('re-asks the BARE url when a registry rejects the parameter', async () => {
            // A registry that 400s an unknown query parameter must not be
            // reported as a failed publish because of it — the fallback is what
            // keeps the cache defeat from becoming an interface demand.
            const requests: CapturedRequest[] = [];
            const fetchImpl = (async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                requests.push({ url, headers: {} });
                if (busterOf(url)) return new Response('bad query', { status: 400 });
                return new Response(packumentWith('@gjsify/cli', '0.46.0'), { status: 200 });
            }) as typeof fetch;
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1_000,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(true);
            expect(result.attempts).toBe(1);
            expect(requests.length).toBe(2);
            expect(busterOf(requests[1]?.url ?? '')).toBe(undefined);
        });

        await it("forwards the PUT's credential, so an auth-gated read is not a false red", async () => {
            // A registry that requires a token to READ (GitHub Packages, an
            // authenticated Verdaccio) answers 401 to an anonymous packument GET,
            // which is an `error` probe — an intact publish would spend the whole
            // budget and then report `publish-unconfirmed`. Measured on the first
            // version of this module: 15 read-back GETs, all anonymous, one second
            // after a PUT that carried a token.
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/cli', '0.46.0') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1_000,
                authorization: 'Bearer npm_readback_token',
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(true);
            expect(requests[0]?.headers['authorization']).toBe('Bearer npm_readback_token');
        });

        await it('sends no authorization when the PUT had none', async () => {
            const { fetchImpl, requests } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/cli', '0.46.0') },
            ]);
            await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1_000,
                fetchImpl,
                ...fakeClock(),
            });
            expect(requests[0]?.headers['authorization']).toBe(undefined);
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

        await it('confirms the EXACT version key — a prerelease sibling is not it', async () => {
            // Found by mutation: a probe matching the key by PREFIX confirmed
            // `0.46.0` from a packument holding only `0.46.0-rc.1`, and every
            // row in this file and the e2e suite stayed green. The confirm path
            // is the one that must not be loose, so this row pins the equality.
            const { fetchImpl } = scriptedRegistry([
                { status: 200, body: packumentWith('@gjsify/cli', '0.46.0-rc.1') },
            ]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(false);
            expect(result.last.state).toBe('absent');
            expect(result.last.state === 'absent' ? result.last.detail : '').toContain('newest 0.46.0-rc.1');
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
            expect(result.verdict).toBe('not-published');
            // The budget is a ceiling on the WAITING, and the last probe is sent
            // from inside it — so the loop terminates and never overshoots by
            // more than one interval's worth of clock.
            expect(result.elapsedMs).toBeLessThan(DEFAULT_VERIFY_BUDGET_MS + 1);
            // One more request than probes: the corroboration that turns `absent`
            // into a verdict, sent once, on the failure path only.
            expect(requests.length).toBe(result.attempts + 1);
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

        await it('a 401 is `error` too — a read we are not allowed to make proves nothing', async () => {
            // The state an auth-gated registry answers with when no credential is
            // forwarded. `absent` here would report "never published" about a
            // package the probe was never permitted to look at.
            const { fetchImpl } = scriptedRegistry([{ status: 401, body: '{"error":"Unauthorized"}' }]);
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
            expect(result.last.state === 'error' ? result.last.detail : '').toContain('401');
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

    await describe('verifyPublishedVersion — the VERDICT', async () => {
        await it('separates "never published" from "recorded but not served"', async () => {
            // The two have OPPOSITE remedies — re-publish vs. wait, since a
            // re-publish of a recorded version is answered 409 — and until the
            // verdict existed both left through one message asserting the first.
            // Observed live on ts-for-gir v5.1.0: @ts-for-gir/reporter recorded at
            // 21:43:00.983Z, and a cache-busted read of its INSTALL document
            // still without 5.1.0 ~40 min later.
            const { fetchImpl, requests } = splitRegistry({
                abbreviated: [{ status: 200, body: packumentWith('@ts-for-gir/reporter', '5.0.0') }],
                full: {
                    status: 200,
                    body: fullPackumentWith('@ts-for-gir/reporter', { '5.1.0': '2026-09-14T21:43:00.983Z' }),
                },
            });
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@ts-for-gir/reporter',
                version: '5.1.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.confirmed).toBe(false);
            expect(result.verdict).toBe('recorded-not-served');
            expect(result.recordedAt).toBe('2026-09-14T21:43:00.983Z');
            // The corroboration is a DIFFERENT document: no install-v1 accept.
            const record = requests[requests.length - 1] as CapturedRequest;
            expect(record.headers['accept']).toBe(undefined);
            expect(busterOf(record.url)).toBeTruthy();
        });

        await it('says not-published when the registry records no such version', async () => {
            const { fetchImpl } = splitRegistry({
                abbreviated: [{ status: 200, body: packumentWith('@gjsify/node-runtime-darwin-arm64', '0.45.0') }],
                full: {
                    status: 200,
                    body: fullPackumentWith('@gjsify/node-runtime-darwin-arm64', { '0.45.0': '2026-01-01T00:00:00Z' }),
                },
            });
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/node-runtime-darwin-arm64',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.verdict).toBe('not-published');
            expect(result.recordedAt).toBe(undefined);
            expect(result.verdictDetail).toContain('no record of 0.46.0');
        });

        await it('a network failure is `unknown` — never published, never absent', async () => {
            // The direction that matters: a dropped connection must not be able
            // to report either "it is there" or "it was never there".
            let calls = 0;
            const fetchImpl = (async () => {
                calls++;
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
            expect(result.confirmed).toBe(false);
            expect(result.verdict).toBe('unknown');
            expect(result.verdictDetail).toContain('ECONNRESET');
            // A read that failed is not evidence to corroborate, so the
            // corroboration is not even attempted.
            expect(calls).toBe(result.attempts);
        });

        await it('a 5xx is `unknown` too, and spends no extra request on it', async () => {
            const { fetchImpl, requests } = scriptedRegistry([{ status: 503, body: 'upstream unavailable' }]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.verdict).toBe('unknown');
            expect(requests.length).toBe(result.attempts);
        });

        await it('a corroboration that itself fails leaves the verdict `unknown`', async () => {
            // The `absent` observation came from a 200/404 and stands, in `last`.
            // The VERDICT does not: `not-published` means "no record anywhere",
            // and the request that would have read the record answered 500 — so
            // that verdict, and its remedy of re-publishing, is exactly the
            // unearned claim this line exists never to make. The FULL packument
            // is a different size class from the install document (typescript's
            // is 15.7 MB), so a cut-short corroboration is what a LARGE package
            // meets, not a broken registry.
            const { fetchImpl } = splitRegistry({
                abbreviated: [{ status: 404, body: '{}' }],
                full: { status: 500, body: 'boom' },
            });
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.verdict).toBe('unknown');
            expect(result.last.state).toBe('absent');
            expect(result.verdictDetail).toContain('500');
        });

        await it('a confirmed read-back says so, with the document it read', async () => {
            const { fetchImpl } = scriptedRegistry([{ status: 200, body: packumentWith('@gjsify/cli', '0.46.0') }]);
            const result = await verifyPublishedVersion({
                registry: 'https://registry.npmjs.org',
                name: '@gjsify/cli',
                version: '0.46.0',
                budgetMs: 1_000,
                fetchImpl,
                ...fakeClock(),
            });
            expect(result.verdict).toBe('confirmed');
            expect(result.confirmed).toBe(true);
            expect(result.verdictDetail).toContain('serves 0.46.0 with a tarball');
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
                readback: readback({
                    verdict: 'unknown',
                    verdictDetail: 'the read-back could not reach a verdict — 503 Service Unavailable',
                    last: { state: 'error', status: 503, detail: '503 Service Unavailable' },
                }),
            });
            expect(msg).toContain('answered  error: 503 Service Unavailable');
            // THE HEADLINE IS THE VERDICT. It used to assert "the registry does
            // not serve it" for an `unknown` too — a claim the probe had not
            // earned, on the line written to stop exactly that.
            expect(msg).toContain('could NOT establish whether the registry serves it');
            expect(msg.includes('has no record of')).toBe(false);
            expect(msg).toContain('verdict   unknown');
            // And neither remedy is offered, because neither is known to apply.
            expect(msg.includes('Re-run this publish')).toBe(false);
            expect(msg.includes('Do NOT re-publish')).toBe(false);
        });

        await it('a RECORDED but unserved version is told to wait, not to re-publish', async () => {
            const msg = formatUnconfirmedPublish({
                name: '@ts-for-gir/reporter',
                version: '5.1.0',
                putUrl: 'https://registry.npmjs.org/@ts-for-gir%2freporter',
                putStatus: 200,
                putStatusText: 'OK',
                payloadBytes: 17460,
                readback: readback({
                    verdict: 'recorded-not-served',
                    verdictDetail:
                        'the registry RECORDS 5.1.0 at 2026-09-14T21:43:00.983Z and its install document does not serve it',
                    recordedAt: '2026-09-14T21:43:00.983Z',
                }),
            });
            expect(msg).toContain('the registry RECORDS 5.1.0');
            expect(msg).toContain('Do NOT re-publish');
            // The 2xx remedy is the WRONG one here and must be gone, not merely
            // joined by a second, contradicting paragraph.
            expect(msg.includes('Re-run this publish')).toBe(false);
        });

        await it('a tolerated 409 gets its OWN headline and the opposite remedy', async () => {
            // Re-running is the remedy for an unconfirmed 2xx and is NOT the
            // remedy for a conflict: npm answers the same 409. Measured on the
            // v0.46.0 recovery — 409 at 09:48:49.19, registry `time[0.46.0]`
            // 09:49:07.419.
            const msg = formatUnconfirmedPublish({
                name: '@gjsify/node-runtime-darwin-arm64',
                version: '0.46.0',
                putUrl: 'https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64',
                putStatus: 409,
                putStatusText: 'Conflict',
                payloadBytes: 53863410,
                readback: readback(),
                claim: 'already-published',
            });
            expect(msg).toContain('ALREADY PUBLISHED and the registry has no record of 0.46.0');
            expect(msg).toContain('409 Conflict');
            expect(msg).toContain('Re-running answers the same 409');
            // And the 2xx advice — "re-run this publish" — must be GONE, not
            // merely joined by a second, contradicting paragraph.
            expect(msg.includes('Re-run this publish')).toBe(false);
            expect(msg.includes('A 2xx from npm is an ACCEPTED write')).toBe(false);
        });
    });

    await describe('probeTimeoutFor', async () => {
        await it('never lets one request outlive the budget it was given', async () => {
            // The sweep passes `--verify-timeout 5`. Unclamped, one unanswered
            // request blocks for the 30 s default — six times the budget, and 199
            // of those cost ~100 min against the ~11% the deferral is argued on.
            expect(probeTimeoutFor(30_000, 5_000)).toBe(5_000);
            // The fatal default is far above the per-probe timeout, so nothing
            // changes there.
            expect(probeTimeoutFor(30_000, 300_000)).toBe(30_000);
            // ...and it never clamps a probe below what an answer takes: the
            // LAST probe of a short budget is the one that produces the verdict,
            // and cutting it to ~0 reported `error` where a 404 was arriving.
            expect(probeTimeoutFor(30_000, 30)).toBe(2_000);
            expect(probeTimeoutFor(30_000, -5_000)).toBe(2_000);
            // A configured timeout below the floor is still honoured — it was
            // asked for explicitly.
            expect(probeTimeoutFor(500, 300_000)).toBe(500);
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
