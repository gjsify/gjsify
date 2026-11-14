// What this file pins down is not "the loop works" but the three things that
// cost a release if they drift: WHICH failures may be sent again, WHICH end
// state a store's answer maps to, and that NO wait here is a real one.
//
// Every test drives `driveSubmission` over a scripted backend and an injected
// clock, so the suite has no network, no credentials and no wall-clock time in
// it. The clock's `sleep` records the delay and advances `now` by it — that is
// what makes a deadline testable at all: a 600 s budget is exhausted in a
// microsecond, and a test that waits is a test nobody runs.

import { describe, expect, it } from '@gjsify/unit';

import {
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
    type StoreBackend,
    type StoreId,
    type StoreOperationResult,
    type StorePublishInput,
    type StorePublishResult,
    type StoreStatusResult,
    type StoreUploadInput,
    type StoreUploadResult,
} from './index.js';
import {
    DEFAULT_SUBMIT_TIMEOUT_MS,
    driveSubmission,
    isRepeatableFailure,
    isThrottled,
    MAX_SAFE_RETRIES,
    pollBackoffFor,
    retryBackoffFor,
    retryDecision,
    SUBMIT_EXIT_CODES,
    type SubmitResult,
    type SubmitVerdict,
} from './poll.js';

/** One value planted in vendor text, the way `stores.spec.ts` plants it in headers. */
const CANARY = 'gjsify-canary-9f3c1b7a';

const VERSION = '1.2.3';
const UPLOAD: StoreUploadInput = { zipPath: '/home/ci/.cache/gjsify/webext/demo-1.2.3.zip', version: VERSION };
const PUBLISH: StorePublishInput = { version: VERSION };

/* ------------------------------------------------------------------ fake clock */

interface FakeClock {
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
    /** Every delay the drive asked for, in order. An empty one means it never waited. */
    readonly waits: number[];
}

function fakeClock(): FakeClock {
    let t = 0;
    const waits: number[] = [];
    return {
        now: () => t,
        sleep: async (ms: number) => {
            waits.push(ms);
            t += ms;
        },
        waits,
    };
}

/* ---------------------------------------------------------------- fake backend */

/** A scripted answer: the value the verb returns, or the error it throws. */
type Scripted<T> = T | Error;

/**
 * One verb of a fake backend. The LAST scripted answer repeats forever, which is
 * what lets a test say "this store never finishes" without a 200-entry array.
 */
function responder<T>(name: string, script: readonly Scripted<T>[], calls: string[]): () => Promise<T> {
    let round = 0;
    return async () => {
        calls.push(name);
        const step = script[Math.min(round, script.length - 1)];
        round++;
        if (step === undefined) throw new Error(`fake backend: nothing scripted for ${name} call ${round}`);
        if (step instanceof Error) throw step;
        return step;
    };
}

interface BackendScript {
    readonly store?: StoreId;
    readonly upload?: readonly Scripted<StoreUploadResult>[];
    readonly publish?: readonly Scripted<StorePublishResult>[];
    readonly status?: readonly Scripted<StoreStatusResult>[];
    /** Omitted = a backend that declares no `operation()`, which is Chrome's shape. */
    readonly operation?: readonly Scripted<StoreOperationResult>[];
}

interface Fake {
    readonly backend: StoreBackend;
    /** Verb names in call order — the evidence for "it did not resend the publish". */
    readonly calls: string[];
    readonly count: (verb: string) => number;
}

function fakeBackend(script: BackendScript): Fake {
    const calls: string[] = [];
    const backend: StoreBackend = {
        store: script.store ?? 'edge',
        upload: responder('upload', script.upload ?? [{ ingested: true, detail: 'uploadState SUCCEEDED' }], calls),
        publish: responder(
            'publish',
            script.publish ?? [{ state: 'in-review', detail: 'publish answered state' }],
            calls,
        ),
        status: responder('status', script.status ?? [{ state: 'draft', detail: 'a draft, nothing submitted' }], calls),
    };
    if (script.operation !== undefined) {
        const read = responder('operation', script.operation, calls);
        backend.operation = async () => read();
    }
    return { backend, calls, count: (verb) => calls.filter((call) => call === verb).length };
}

interface DriveOptions {
    readonly publish?: StorePublishInput | undefined;
    readonly timeoutMs?: number;
    readonly secrets?: readonly string[];
    readonly logs?: string[];
}

/** Drive the fake and hand back the result plus the clock that was used. */
async function drive(fake: Fake, options: DriveOptions = {}): Promise<{ result: SubmitResult; clock: FakeClock }> {
    const clock = fakeClock();
    const result = await driveSubmission(
        { backend: fake.backend, upload: UPLOAD, publish: options.publish },
        {
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: options.timeoutMs,
            secrets: options.secrets,
            log: options.logs === undefined ? undefined : (msg) => options.logs?.push(msg),
        },
    );
    return { result, clock };
}

const phaseNames = (result: SubmitResult): string[] => result.phases.map((phase) => phase.phase);

export default async () => {
    await describe('webext submit poll: the exit-code table', async () => {
        await it('maps every verdict to exactly the documented code', async () => {
            // Pinned as a whole: a verdict added without a code, or a code
            // quietly moved, has to change this literal and say why.
            expect(SUBMIT_EXIT_CODES).toStrictEqual({
                uploaded: 0,
                submitted: 0,
                published: 0,
                'already-there': 0,
                'in-review': 0,
                rejected: 1,
                failed: 1,
                unresolved: 3,
                unverifiable: 4,
            });
        });

        await it('leaves 2 to the usage-error handler', async () => {
            expect(Object.values(SUBMIT_EXIT_CODES).includes(2)).toBe(false);
        });

        await it('defaults the deadline to the read-back budget', async () => {
            expect(DEFAULT_SUBMIT_TIMEOUT_MS).toBe(600_000);
        });
    });

    await describe('webext submit poll: which failures may be repeated', async () => {
        await it('calls a transport failure, 408, 429 and a 5xx repeatable', async () => {
            expect(isRepeatableFailure(new StoreApiError('edge', undefined, 'socket hang up'))).toBe(true);
            expect(isRepeatableFailure(new StoreApiError('edge', 408, 'request timeout'))).toBe(true);
            expect(isRepeatableFailure(new StoreApiError('edge', 429, 'too many requests'))).toBe(true);
            expect(isRepeatableFailure(new StoreApiError('edge', 503, 'service unavailable'))).toBe(true);
        });

        await it('never calls a verdict repeatable', async () => {
            expect(isRepeatableFailure(new StoreApiError('edge', 400, 'manifest invalid'))).toBe(false);
            expect(isRepeatableFailure(new StoreApiError('chrome', 401, 'token expired'))).toBe(false);
            expect(isRepeatableFailure(new StoreApiError('edge', 404, 'no such product'))).toBe(false);
            // Edge reports a failed operation as a 2xx body, which the backend
            // already turned into an error carrying HTTP 200. Repeating it would
            // only ask the store to reject the same package again.
            expect(isRepeatableFailure(new StoreApiError('edge', 200, 'operation Failed: manifest invalid'))).toBe(
                false,
            );
            expect(isRepeatableFailure(new StoreInReviewError('edge', 'InProgressSubmission'))).toBe(false);
            expect(isRepeatableFailure(new Error('a defect in this client'))).toBe(false);
        });

        await it('separates throttling from the other repeatable classes', async () => {
            expect(isThrottled(new StoreApiError('edge', 429, 'slow down'))).toBe(true);
            expect(isThrottled(new StoreApiError('edge', 503, 'unavailable'))).toBe(false);
        });

        await it('lets a read and an upload resend, and makes a lost publish verify first', async () => {
            const lost = new StoreApiError('edge', undefined, 'socket hang up');
            expect(retryDecision(lost, 'read')).toBe('retry');
            expect(retryDecision(lost, 'upload')).toBe('retry');
            expect(retryDecision(lost, 'publish')).toBe('verify-first');
            // A publish the store DID answer created nothing, so the same
            // request is safe to send again.
            expect(retryDecision(new StoreApiError('edge', 503, 'unavailable'), 'publish')).toBe('retry');
            expect(retryDecision(new StoreApiError('edge', 429, 'slow down'), 'publish')).toBe('retry');
            expect(retryDecision(new StoreApiError('edge', 400, 'invalid'), 'publish')).toBe('fatal');
        });

        await it('backs off further on a 429 than on an ordinary failure, and caps both', async () => {
            expect(retryBackoffFor(0, false)).toBe(1_000);
            expect(retryBackoffFor(0, true)).toBe(5_000);
            expect(retryBackoffFor(99, true)).toBe(30_000);
            expect(pollBackoffFor(0)).toBe(2_000);
            expect(pollBackoffFor(99)).toBe(30_000);
        });
    });

    await describe('webext submit poll: the happy paths', async () => {
        await it('carries an Edge-shaped 202 through both operations', async () => {
            const fake = fakeBackend({
                store: 'edge',
                upload: [
                    { operationId: 'up-1', ingested: false, detail: 'HTTP 202 accepted — upload operation pending' },
                ],
                operation: [
                    { state: 'in-progress', detail: 'upload operation up-1 is still running.' },
                    { state: 'succeeded', detail: 'upload operation succeeded.' },
                    { state: 'succeeded', detail: 'publish operation succeeded.' },
                ],
                publish: [
                    { state: 'unknown', operationId: 'pub-1', detail: 'HTTP 202 accepted — publish operation pending' },
                ],
            });
            const { result, clock } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('submitted');
            expect(result.exitCode).toBe(0);
            expect(result.retryable).toBe(false);
            expect(phaseNames(result)).toStrictEqual(['upload', 'await-upload', 'publish', 'await-publish']);
            expect(result.requests).toBe(5);
            expect(result.retries).toBe(0);
            // One real wait, between the two operation reads.
            expect(clock.waits).toStrictEqual([2_000]);
            expect(result.elapsedMs).toBe(2_000);
        });

        await it('resolves a Chrome-shaped async upload through status(), which is its only account', async () => {
            const fake = fakeBackend({
                store: 'chrome',
                upload: [
                    { operationId: 'items/abc', ingested: false, detail: 'uploadState IN_PROGRESS — poll fetchStatus' },
                ],
                status: [
                    { state: 'unknown', ingesting: true, detail: 'lastAsyncUploadState IN_PROGRESS' },
                    { state: 'draft', version: VERSION, detail: 'fetchStatus carried no upload state' },
                ],
                publish: [{ state: 'in-review', detail: 'publish answered state PENDING_REVIEW' }],
            });
            const { result, clock } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('submitted');
            expect(result.exitCode).toBe(0);
            expect(phaseNames(result)).toStrictEqual(['upload', 'await-upload', 'publish']);
            expect(fake.count('status')).toBe(2);
            expect(clock.waits).toStrictEqual([2_000]);
        });

        await it('reports a live version as published, not as merely submitted', async () => {
            const fake = fakeBackend({
                store: 'chrome',
                publish: [{ state: 'published', detail: 'publish answered state PUBLISHED' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('published');
            expect(result.exitCode).toBe(0);
        });

        await it('treats a draft that was never submitted as a complete outcome', async () => {
            const fake = fakeBackend({ upload: [{ ingested: true, detail: 'uploadState SUCCEEDED' }] });
            const { result, clock } = await drive(fake);
            expect(result.verdict).toBe('uploaded');
            expect(result.exitCode).toBe(0);
            expect(result.detail).toContain('--submit');
            expect(fake.count('publish')).toBe(0);
            expect(clock.waits).toStrictEqual([]);
            expect(phaseNames(result)).toStrictEqual(['upload']);
        });

        await it('exits 0 when the store was already on this version', async () => {
            const fake = fakeBackend({ upload: [new StoreVersionAlreadyThereError('chrome', VERSION)] });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('already-there');
            expect(result.exitCode).toBe(0);
            // Nothing to call again for: the store is where this run wanted it.
            expect(result.retryable).toBe(false);
            expect(fake.count('publish')).toBe(0);
        });

        await it('exits 0 when a submission is already in review, and says to call again later', async () => {
            const fake = fakeBackend({ upload: [new StoreInReviewError('edge', 'operation InProgressSubmission')] });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('in-review');
            expect(result.exitCode).toBe(0);
            expect(result.retryable).toBe(true);
            expect(result.detail).toContain('in review');
        });
    });

    await describe('webext submit poll: a store that says no', async () => {
        await it('does not retry a 400 and does not call it a failure of this run', async () => {
            const fake = fakeBackend({ upload: [new StoreApiError('edge', 400, 'manifest version is not greater')] });
            const { result, clock } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('rejected');
            expect(result.exitCode).toBe(1);
            expect(result.retryable).toBe(false);
            expect(result.requests).toBe(1);
            expect(result.retries).toBe(0);
            expect(clock.waits).toStrictEqual([]);
        });

        await it('ends at rejected when the wait reads a take-down', async () => {
            const fake = fakeBackend({
                store: 'chrome',
                upload: [{ ingested: false, detail: 'uploadState IN_PROGRESS' }],
                status: [{ state: 'rejected', detail: 'takenDown is true — a policy violation' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('rejected');
            expect(result.exitCode).toBe(1);
            expect(fake.count('publish')).toBe(0);
            expect(phaseNames(result)).toStrictEqual(['upload', 'await-upload']);
        });
    });

    await describe('webext submit poll: repeatable failures', async () => {
        await it('resends an upload after a 503 and reports the success', async () => {
            const fake = fakeBackend({
                upload: [new StoreApiError('edge', 503, 'service unavailable'), { ingested: true, detail: 'accepted' }],
            });
            const { result, clock } = await drive(fake);
            expect(result.verdict).toBe('uploaded');
            expect(result.retries).toBe(1);
            expect(result.requests).toBe(2);
            expect(clock.waits).toStrictEqual([1_000]);
        });

        await it('waits out a 429 on the longer table', async () => {
            const fake = fakeBackend({
                upload: [new StoreApiError('edge', 429, 'too many requests'), { ingested: true, detail: 'accepted' }],
            });
            const { result, clock } = await drive(fake);
            expect(result.verdict).toBe('uploaded');
            expect(clock.waits).toStrictEqual([5_000]);
        });

        await it('gives up at the retry ceiling and calls it failed, not rejected', async () => {
            const fake = fakeBackend({ upload: [new StoreApiError('edge', 503, 'service unavailable')] });
            const { result, clock } = await drive(fake);
            expect(result.verdict).toBe('failed');
            expect(result.exitCode).toBe(1);
            expect(result.retryable).toBe(true);
            expect(result.retries).toBe(MAX_SAFE_RETRIES);
            expect(result.requests).toBe(MAX_SAFE_RETRIES + 1);
            expect(clock.waits).toStrictEqual([1_000, 2_000, 4_000]);
        });

        await it('stops retrying when the deadline runs out before the ceiling does', async () => {
            const fake = fakeBackend({ upload: [new StoreApiError('edge', 503, 'service unavailable')] });
            const { result, clock } = await drive(fake, { timeoutMs: 2_500 });
            expect(result.verdict).toBe('failed');
            // 1 s, then 2 s would cross 2.5 s, so the second wait is clipped to
            // what is left and the third is never reached.
            expect(clock.waits).toStrictEqual([1_000, 1_500]);
            expect(result.requests).toBe(3);
        });
    });

    await describe('webext submit poll: accepted and never resolved', async () => {
        await it('ends at its own exit code when an operation never finishes', async () => {
            const fake = fakeBackend({
                upload: [{ operationId: 'up-1', ingested: false, detail: 'HTTP 202 accepted' }],
                operation: [{ state: 'in-progress', detail: 'upload operation up-1 is still running.' }],
            });
            const { result, clock } = await drive(fake, { publish: PUBLISH, timeoutMs: 10_000 });
            expect(result.verdict).toBe('unresolved');
            expect(result.exitCode).toBe(3);
            expect(result.retryable).toBe(true);
            expect(result.detail).toContain('up-1');
            expect(result.detail).toContain('--timeout');
            expect(fake.count('publish')).toBe(0);
            expect(clock.waits).toStrictEqual([2_000, 4_000, 4_000]);
            expect(result.elapsedMs).toBe(10_000);
        });

        await it('reads every async step exactly once at --timeout 0 and waits not at all', async () => {
            const fake = fakeBackend({
                upload: [{ operationId: 'up-1', ingested: false, detail: 'HTTP 202 accepted' }],
                operation: [{ state: 'in-progress', detail: 'still running' }],
            });
            const { result, clock } = await drive(fake, { publish: PUBLISH, timeoutMs: 0 });
            expect(result.verdict).toBe('unresolved');
            expect(fake.count('operation')).toBe(1);
            expect(clock.waits).toStrictEqual([]);
        });

        await it('never claims published from a status about another version', async () => {
            const fake = fakeBackend({
                store: 'chrome',
                publish: [{ state: 'unknown', detail: 'publish answered state (none)' }],
                status: [
                    { state: 'published', version: '9.9.9', detail: 'publishedItemRevisionStatus.state PUBLISHED' },
                ],
            });
            const { result } = await drive(fake, { publish: PUBLISH, timeoutMs: 10_000 });
            expect(result.verdict).toBe('unresolved');
            expect(result.version).toBe(VERSION);
            expect(phaseNames(result)).toStrictEqual(['upload', 'publish', 'await-publish']);
        });
    });

    await describe('webext submit poll: a publish request that got no answer', async () => {
        const lostPublish = (): Error => new StoreApiError('edge', undefined, 'socket hang up');

        await it('asks the store first and reports the submission it finds', async () => {
            const fake = fakeBackend({
                publish: [lostPublish()],
                status: [
                    {
                        state: 'in-review',
                        version: VERSION,
                        detail: 'submittedItemRevisionStatus.state PENDING_REVIEW',
                    },
                ],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('submitted');
            expect(result.exitCode).toBe(0);
            expect(result.detail).toContain('got no answer');
            expect(result.detail).toContain('arrived');
            expect(fake.count('publish')).toBe(1);
        });

        await it('replays it exactly once when the store PROVES it holds only a draft', async () => {
            const fake = fakeBackend({
                publish: [lostPublish(), { state: 'in-review', detail: 'publish answered state PENDING_REVIEW' }],
                status: [
                    { state: 'draft', version: VERSION, detail: 'the draft still holds 1.2.3, nothing submitted' },
                ],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('submitted');
            expect(fake.count('publish')).toBe(2);
            expect(fake.count('status')).toBe(1);
            expect(result.retries).toBe(1);
        });

        await it('does NOT resend when the store cannot say, and ends at unresolved', async () => {
            const fake = fakeBackend({
                publish: [lostPublish()],
                status: [{ state: 'unknown', detail: 'fetchStatus carried no revision status' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('unresolved');
            expect(result.exitCode).toBe(3);
            expect(result.detail).toContain('NOT repeated');
            // The one assertion this whole branch exists for.
            expect(fake.count('publish')).toBe(1);
        });

        await it('reports a rejection the status read turns up', async () => {
            const fake = fakeBackend({
                publish: [lostPublish()],
                status: [{ state: 'rejected', detail: 'takenDown is true' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('rejected');
            expect(fake.count('publish')).toBe(1);
        });

        await it('stops after the single replay instead of looping on a draft', async () => {
            const fake = fakeBackend({
                publish: [lostPublish(), lostPublish()],
                status: [{ state: 'draft', version: VERSION, detail: 'the draft still holds 1.2.3' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('unresolved');
            expect(fake.count('publish')).toBe(2);
        });
    });

    await describe('webext submit poll: a handle this client cannot read', async () => {
        await it('says unverifiable at once, before spending the deadline on it', async () => {
            const fake = fakeBackend({
                store: 'edge',
                publish: [
                    { state: 'unknown', operationId: 'pub-7', detail: 'HTTP 202 accepted — publish operation pending' },
                ],
            });
            const { result, clock } = await drive(fake, { publish: PUBLISH });
            expect(result.verdict).toBe('unverifiable');
            expect(result.exitCode).toBe(4);
            // A re-run meets the same gap; what has to change is the backend.
            expect(result.retryable).toBe(false);
            expect(result.detail).toContain('pub-7');
            expect(result.detail).toContain('operation()');
            expect(clock.waits).toStrictEqual([]);
            expect(fake.calls).toStrictEqual(['upload', 'publish']);
        });
    });

    await describe('webext submit poll: no secret anywhere', async () => {
        await it('keeps a credential echoed by the store out of the result, the trace and the log', async () => {
            const fake = fakeBackend({
                upload: [
                    { operationId: `op-${CANARY}`, ingested: false, detail: `HTTP 202 accepted — ApiKey ${CANARY}` },
                ],
                operation: [{ state: 'in-progress', detail: `still running; sent Authorization: ApiKey ${CANARY}` }],
            });
            const logs: string[] = [];
            const { result } = await drive(fake, { timeoutMs: 10_000, secrets: [CANARY], logs });
            expect(result.verdict).toBe('unresolved');
            expect(result.detail.includes(CANARY)).toBe(false);
            expect(JSON.stringify(result).includes(CANARY)).toBe(false);
            expect(logs.length > 0).toBe(true);
            expect(logs.join('\n').includes(CANARY)).toBe(false);
            // Redacted, not dropped: the operation id is still identifiable.
            expect(result.detail).toContain('<redacted>');
        });

        await it('redacts a secret a failing call carries into the verdict', async () => {
            const fake = fakeBackend({
                upload: [new StoreApiError('edge', 400, `rejected the request signed with ${CANARY}`)],
            });
            const { result } = await drive(fake, { publish: PUBLISH, secrets: [CANARY] });
            expect(result.verdict).toBe('rejected');
            expect(JSON.stringify(result).includes(CANARY)).toBe(false);
            expect(result.phases[0]?.detail.includes(CANARY)).toBe(false);
        });
    });

    await describe('webext submit poll: the value it returns', async () => {
        await it('carries the code its own table assigns, for every drive in this file', async () => {
            const drives: readonly {
                readonly verdict: SubmitVerdict;
                readonly fake: Fake;
                readonly publish: boolean;
            }[] = [
                { verdict: 'uploaded', fake: fakeBackend({}), publish: false },
                { verdict: 'submitted', fake: fakeBackend({}), publish: true },
                {
                    verdict: 'rejected',
                    fake: fakeBackend({ upload: [new StoreApiError('edge', 400, 'invalid')] }),
                    publish: true,
                },
                {
                    verdict: 'unverifiable',
                    fake: fakeBackend({ publish: [{ state: 'unknown', operationId: 'p', detail: '202' }] }),
                    publish: true,
                },
            ];
            for (const expected of drives) {
                const { result } = await drive(expected.fake, { publish: expected.publish ? PUBLISH : undefined });
                expect(result.verdict).toBe(expected.verdict);
                expect(result.exitCode).toBe(SUBMIT_EXIT_CODES[expected.verdict]);
                expect(result.store).toBe('edge');
                expect(result.version).toBe(VERSION);
            }
        });

        await it('accounts for every request in the phase it belonged to', async () => {
            const fake = fakeBackend({
                upload: [new StoreApiError('edge', 503, 'unavailable'), { ingested: true, detail: 'accepted' }],
                publish: [{ state: 'in-review', detail: 'PENDING_REVIEW' }],
            });
            const { result } = await drive(fake, { publish: PUBLISH });
            const total = result.phases.reduce((sum, phase) => sum + phase.requests, 0);
            expect(total).toBe(result.requests);
            expect(result.phases[0]?.requests).toBe(2);
            expect(result.phases[1]?.requests).toBe(1);
        });

        await it('touches neither process nor the real clock', async () => {
            // `driveSubmission` takes `now`/`sleep` and returns a value; there is
            // nothing here that could exit. The assertion is the signature: a
            // drive with a frozen clock still terminates.
            const fake = fakeBackend({
                upload: [{ ingested: false, detail: 'pending' }],
                status: [{ state: 'draft', detail: 'draft' }],
            });
            const { result } = await drive(fake, { timeoutMs: 0 });
            expect(result.verdict).toBe('uploaded');
            expect(result.elapsedMs).toBe(0);
        });
    });
};
