// Unit tests for the `gjsify onboard` trust-state READ path (`onboard-probe.ts`)
// — the task-#60 fix. Mocks the HTTP layer via a fake `TrustRequester` and
// asserts: the one-shot retry on a transient 401, the concurrency cap + serial
// first read, and that the probe hits the SAME endpoint + method the shared
// requester (= `gjsify trust`'s read) uses.

import { describe, expect, it } from '@gjsify/unit';
import type { Workspace } from '@gjsify/workspace';
import type { NpmrcConfig } from '@gjsify/npm-registry';
import type { TrustRequester, TrustRequestResult } from '../commands/trust.js';
import { trustUrl } from './trust-registry.js';
import {
    DEFAULT_PROBE_CONCURRENCY,
    mapWithConcurrency,
    probeAllTrustStates,
    probeTrustState,
    requestWaitingOutRateLimit,
    retryAfterMs,
    type ProbeContext,
} from './onboard-probe.js';

const REGISTRY = 'https://registry.npmjs.org/';
const NPMRC = { registry: REGISTRY, authTokens: {}, basicAuth: {}, scopeRegistries: {} } as unknown as NpmrcConfig;

function ws(name: string): Workspace {
    return { name, location: `/tmp/${name}` } as unknown as Workspace;
}

function ctx(): ProbeContext {
    return { registryOverride: REGISTRY, npmrc: NPMRC, repository: 'gjsify/gjsify', workflow: 'release.yml' };
}

/** A trust-list result carrying a single matching github entry (→ trusted). */
function trustedBody(): unknown {
    return [{ type: 'github', claims: { repository: 'gjsify/gjsify', workflow_ref: { file: 'release.yml' } } }];
}

const noSleep = async (): Promise<void> => {};

export default async () => {
    await describe('probeTrustState — the packument decides existence', async () => {
        // npm's trust endpoint answers 2xx with an EMPTY LIST for a name that was
        // never published, which reads as `untrusted`. That is how `gjsify onboard`
        // came to trust a package that did not exist, report `0 to publish+trust`
        // and publish nothing — its own gap, reported as closed.
        const emptyTrustList: TrustRequester = async () => ({ status: 200, json: [], text: '' });

        await it('calls it UNPUBLISHED when the registry serves no packument', async () => {
            const plan = await probeTrustState(emptyTrustList, ws('@gjsify/never-published'), ctx(), {
                exists: async () => false,
            });
            expect(plan.state).toBe('unpublished');
            expect(plan.action).toBe('publish-and-trust');
        });

        await it('leaves a real package untrusted, so the sweep only trusts it', async () => {
            const plan = await probeTrustState(emptyTrustList, ws('@gjsify/real'), ctx(), {
                exists: async () => true,
            });
            expect(plan.state).toBe('untrusted');
            expect(plan.action).toBe('trust');
        });

        await it('does not publish on an UNDECIDED probe', async () => {
            // Network failure is not evidence of absence, and a bootstrap that
            // publishes on a failed read is worse than one that reports blocked.
            const plan = await probeTrustState(emptyTrustList, ws('@gjsify/unknown'), ctx(), {
                exists: async () => null,
            });
            expect(plan.state).toBe('untrusted');
            expect(plan.action).toBe('trust');
        });

        await it('does not pay for the extra read when the name is already trusted', async () => {
            // `trusted` cannot be a missing package, and `unpublished` already has
            // its answer — so only the ambiguous case costs a second request.
            let asked = 0;
            const request: TrustRequester = async () => ({ status: 200, json: trustedBody(), text: '' });
            const plan = await probeTrustState(request, ws('@gjsify/foo'), ctx(), {
                exists: async () => {
                    asked++;
                    return true;
                },
            });
            expect(plan.state).toBe('trusted');
            expect(asked).toBe(0);
        });
    });

    await describe('probeTrustState — retry-on-401', async () => {
        await it('retries ONCE on a transient 401 and then classifies the 200', async () => {
            const calls: Array<{ method: string; url: string }> = [];
            let n = 0;
            const request: TrustRequester = async (method, url): Promise<TrustRequestResult> => {
                calls.push({ method, url });
                n++;
                if (n === 1) return { status: 401, json: undefined, text: '' };
                return { status: 200, json: trustedBody(), text: '' };
            };
            const plan = await probeTrustState(request, ws('@gjsify/foo'), ctx(), { sleep: noSleep });
            expect(calls.length).toBe(2); // first 401, one retry
            expect(plan.state).toBe('trusted');
            expect(plan.action).toBe('skip');
            expect(plan.httpStatus).toBe(200);
        });

        await it('does not retry when retryOn401 is false — 401 stays blocked', async () => {
            let n = 0;
            const request: TrustRequester = async (): Promise<TrustRequestResult> => {
                n++;
                return { status: 401, json: undefined, text: '' };
            };
            const plan = await probeTrustState(request, ws('@gjsify/foo'), ctx(), {
                retryOn401: false,
                sleep: noSleep,
                // Same reason as the sibling above: a 401 now consults the
                // packument, so what this case measures — that the RETRY is
                // suppressed — needs existence pinned or it decides the outcome.
                exists: async () => true,
            });
            expect(n).toBe(1);
            expect(plan.state).toBe('auth-required');
            expect(plan.action).toBe('blocked');
        });

        await it('a persistent 401 after the single retry is blocked (not silently trusted)', async () => {
            let n = 0;
            const request: TrustRequester = async (): Promise<TrustRequestResult> => {
                n++;
                return { status: 401, json: undefined, text: '' };
            };
            // `exists: true` is now load-bearing, and stating it is the point: a
            // persistent 401 on a package that DOES exist is genuinely undecidable,
            // so it stays blocked. Without the injection this reads the live
            // registry — and `@gjsify/foo` is a name nobody published, so the test
            // would flip to `publish-and-trust` for a reason that has nothing to do
            // with what it is measuring.
            const plan = await probeTrustState(request, ws('@gjsify/foo'), ctx(), {
                sleep: noSleep,
                exists: async () => true,
            });
            expect(n).toBe(2); // initial + one retry, then give up
            expect(plan.action).toBe('blocked');
        });
    });

    await describe('probeTrustState — a 401 does not hide a missing package', async () => {
        // The state a no-OTP `--dry-run` produces for the whole tree. Before this,
        // 202 packages reported `unreadable` and the plan was empty — including for
        // the two names that had never been published, which is the ONE thing the
        // dry run was being consulted about.
        await it('calls it UNPUBLISHED when the trust read 401s and no packument exists', async () => {
            const request: TrustRequester = async (): Promise<TrustRequestResult> => ({
                status: 401,
                json: undefined,
                text: '',
            });
            const plan = await probeTrustState(request, ws('@gjsify/never-published'), ctx(), {
                sleep: noSleep,
                exists: async () => false,
            });
            expect(plan.state).toBe('unpublished');
            expect(plan.action).toBe('publish-and-trust');
        });

        await it('stays blocked when the packument read is itself undecided', async () => {
            // Registry unreachable. Two failed reads are not evidence of absence,
            // and publishing on them would create the package this command exists
            // to notice was missing.
            const request: TrustRequester = async (): Promise<TrustRequestResult> => ({
                status: 401,
                json: undefined,
                text: '',
            });
            const plan = await probeTrustState(request, ws('@gjsify/unknown'), ctx(), {
                sleep: noSleep,
                exists: async () => null,
            });
            expect(plan.action).toBe('blocked');
        });
    });

    await describe('probeTrustState — same endpoint + method as `gjsify trust`', async () => {
        await it('reads via GET on the exact trustUrl(registry, name)', async () => {
            let seen: { method: string; url: string } | undefined;
            const request: TrustRequester = async (method, url): Promise<TrustRequestResult> => {
                seen = { method, url };
                return { status: 404, json: undefined, text: '' };
            };
            const name = '@gjsify/gtk-runtime-win32-x64';
            const plan = await probeTrustState(request, ws(name), ctx(), { sleep: noSleep });
            expect(seen?.method).toBe('GET');
            // Identical to what `gjsify trust` computes for the same package.
            expect(seen?.url).toBe(trustUrl(REGISTRY, name));
            expect(plan.url).toBe(trustUrl(REGISTRY, name));
            expect(plan.state).toBe('unpublished'); // 404
            expect(plan.action).toBe('publish-and-trust');
        });
    });

    await describe('mapWithConcurrency — cap', async () => {
        await it('never exceeds the concurrency cap', async () => {
            let inFlight = 0;
            let maxInFlight = 0;
            const cap = 3;
            const items = Array.from({ length: 20 }, (_, i) => i);
            await mapWithConcurrency(items, cap, async (i) => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((r) => setTimeout(r, 0));
                inFlight--;
                return i;
            });
            expect(maxInFlight).toBeLessThan(cap + 1); // <= cap
        });

        await it('preserves input order in the result', async () => {
            const out = await mapWithConcurrency([10, 20, 30], 2, async (x) => x * 2);
            expect(out).toStrictEqual([20, 40, 60]);
        });
    });

    await describe('probeAllTrustStates — serial-first, bounded-rest', async () => {
        await it('probes the FIRST package before any of the rest begin', async () => {
            const selected = Array.from({ length: 6 }, (_, i) => ws(`@gjsify/p${i}`));
            let firstDone = false;
            let restBeforeFirstDone = 0;
            let index = 0;
            const request: TrustRequester = async (): Promise<TrustRequestResult> => {
                const myIndex = index++;
                if (myIndex === 0) {
                    await new Promise((r) => setTimeout(r, 5));
                    firstDone = true;
                } else {
                    if (!firstDone) restBeforeFirstDone++;
                    await new Promise((r) => setTimeout(r, 0));
                }
                return { status: 404, json: undefined, text: '' };
            };
            const plans = await probeAllTrustStates(request, selected, DEFAULT_PROBE_CONCURRENCY, ctx(), {
                sleep: noSleep,
            });
            expect(plans.length).toBe(6);
            expect(restBeforeFirstDone).toBe(0); // nothing started until the first finished
        });

        await it('caps concurrency of the REST reads', async () => {
            const selected = Array.from({ length: 25 }, (_, i) => ws(`@gjsify/p${i}`));
            let inFlight = 0;
            let maxInFlight = 0;
            const cap = 4;
            const request: TrustRequester = async (): Promise<TrustRequestResult> => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((r) => setTimeout(r, 0));
                inFlight--;
                return { status: 404, json: undefined, text: '' };
            };
            await probeAllTrustStates(request, selected, cap, ctx(), { sleep: noSleep });
            // Serial first read + bounded rest → never more than `cap` at once.
            expect(maxInFlight).toBeLessThan(cap + 1);
        });

        await it('returns [] for an empty workspace list without calling the requester', async () => {
            let called = false;
            const request: TrustRequester = async (): Promise<TrustRequestResult> => {
                called = true;
                return { status: 200, json: [], text: '' };
            };
            const plans = await probeAllTrustStates(request, [], 4, ctx(), { sleep: noSleep });
            expect(plans.length).toBe(0);
            expect(called).toBeFalsy();
        });
    });

    await describe('onboard-probe — an HTTP 429 is not a state', async () => {
        // Measured on the real 703-package sweep of `gjsify/types`: the first 662
        // reads answered and the LAST 41 came back 429, so the plan reported
        // `41 unreadable` for packages whose state nobody had failed to determine.
        // A cumulative rate limit lands on the tail of an alphabetical list, which
        // makes throttling look like a property of those packages.
        const noSleep = async (): Promise<void> => {};

        await it('retryAfterMs reads delta-seconds and refuses everything else', () => {
            expect(retryAfterMs(new Headers({ 'retry-after': '7' }))).toBe(7000);
            expect(retryAfterMs(new Headers({ 'retry-after': ' 0 ' }))).toBe(0);
            // The HTTP-date form is legal and npm does not send it. Guessing at a
            // date would be a second clock to get wrong, so it reads as "said
            // nothing" and the exponential backoff decides.
            expect(retryAfterMs(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toBe(null);
            expect(retryAfterMs(new Headers({ 'retry-after': '-3' }))).toBe(null);
            expect(retryAfterMs(new Headers())).toBe(null);
            expect(retryAfterMs(undefined)).toBe(null);
        });

        await it('waits out a 429 and returns the answer that follows it', async () => {
            let calls = 0;
            const req: TrustRequester = async () => {
                calls++;
                return calls <= 2
                    ? { status: 429, json: undefined, text: '', headers: new Headers({ 'retry-after': '1' }) }
                    : { status: 200, json: [], text: '[]' };
            };
            const res = await requestWaitingOutRateLimit(req, 'GET', 'https://r/x', undefined, { sleep: noSleep });
            expect(res.status).toBe(200);
            expect(calls).toBe(3);
        });

        await it('gives up after the budget and hands back the 429 — never hangs', async () => {
            let calls = 0;
            const req: TrustRequester = async () => {
                calls++;
                return { status: 429, json: undefined, text: '' };
            };
            const res = await requestWaitingOutRateLimit(req, 'GET', 'https://r/x', undefined, {
                sleep: noSleep,
                maxRateLimitRetries: 3,
            });
            expect(res.status).toBe(429);
            expect(calls).toBe(4); // the first attempt plus three retries
        });

        await it('probeTrustState classifies the answer AFTER the throttling, not the 429', async () => {
            let calls = 0;
            const req: TrustRequester = async () => {
                calls++;
                return calls === 1
                    ? { status: 429, json: undefined, text: '' }
                    : { status: 404, json: undefined, text: '' };
            };
            const plan = await probeTrustState(req, ws('@onb/a'), ctx(), { sleep: noSleep });
            expect(plan.state).toBe('unpublished');
            expect(plan.action).toBe('publish-and-trust');
        });

        await it('still reports blocked when the throttling outlasts the budget', async () => {
            const req: TrustRequester = async () => ({ status: 429, json: undefined, text: '' });
            const plan = await probeTrustState(req, ws('@onb/a'), ctx(), {
                sleep: noSleep,
                maxRateLimitRetries: 1,
            });
            expect(plan.action).toBe('blocked');
            expect(plan.httpStatus).toBe(429);
        });
    });
};
