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
            const plan = await probeTrustState(request, ws('@gjsify/foo'), ctx(), { sleep: noSleep });
            expect(n).toBe(2); // initial + one retry, then give up
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
};
