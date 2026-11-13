// The bounded poll/retry layer of `gjsify webext submit`: ONE drive over a
// {@link StoreBackend} that carries a version from upload to a CLASSIFIED end
// state, and returns a pure value the subcommand only has to print.
//
// WHY A LAYER AND NOT A LOOP PER BACKEND. Both store APIs answer a write before
// they have done it (ADR 0077 § Amendment 1): Chrome's `:upload` answers a
// `uploadState` and the real account is `:fetchStatus`'s `lastAsyncUploadState`,
// which is only set for uploads from the past 24 h; Edge answers `202 Accepted`
// with an operation id in `Location` and nothing in the body at all. That is the
// same shape as npm's accepted-but-not-durable PUT, and `utils/publish-readback.ts`'s
// rule carries over unchanged: NEVER claim what was not established. A store
// that said "accepted" and then never resolved is its OWN outcome here — not a
// success, and not a rejection either.
//
// So the backends poll nothing (both files say so in their headers) and this
// file owns every wait: one deadline, one backoff, an injected clock, and no
// `setTimeout` anywhere a test can reach.
//
// THE END STATES AND THEIR EXIT CODES — the table the ADR amendment repeats:
//
//   code | verdict        | what it means                                   | re-run?
//   -----+----------------+-------------------------------------------------+--------
//      0 | uploaded       | the draft holds this version; no publish asked   | —
//      0 | submitted      | the store confirms a submission for this version | —
//      0 | published      | the store reports this version live              | —
//      0 | already-there  | the store was ALREADY on this version            | —
//      0 | in-review      | a submission is in review; this run changed none  | later
//      1 | rejected       | the store refused it (4xx, a failed operation)    | no
//      1 | failed         | a repeatable failure that did not stop repeating  | yes
//      3 | unresolved     | accepted and never resolved inside the deadline   | yes
//      4 | unverifiable   | the store gave a handle this client cannot read    | no
//
// `0` for `in-review` is a DECISION, argued at {@link SUBMIT_EXIT_CODES}.
// `2` is deliberately absent: `cli-fail.ts` owns it for a usage error, and an
// exit code that means two things is one nobody can branch on.
//
// WHICH FAILURES MAY BE REPEATED — two independent questions, and collapsing
// them is how a release submits twice:
//
//   1. IS THE FAILURE CLASS REPEATABLE? ({@link isRepeatableFailure})
//      transport, no HTTP answer  nothing was established     → repeatable
//      408, 429                   the store asked for later    → repeatable
//      5xx                        the store's side failed      → repeatable
//      4xx except 408/429         its VERDICT on this request  → never
//      a failed operation         its verdict on this package  → never
//      (Edge reports the last one as a 2xx body with `status: Failed`, which the
//      backend already turns into a `StoreApiError` carrying HTTP 200 — not a
//      repeatable class, which is the right answer for a package the store
//      looked at and rejected.)
//
//   2. MAY THIS VERB REPEAT IT? ({@link retryDecision})
//      a `status`/`operation` GET  a read; a repeat costs one request
//      the `upload` POST           writes the DRAFT, a slot and not a queue
//                                  entry: the same zip twice leaves the same
//                                  draft, so a repeat costs bytes and nothing
//                                  else
//      the `publish` POST          CREATES a submission. After a transport
//                                  failure it is NEVER repeated blind — only
//                                  `status()` may decide whether it arrived,
//                                  and only a status that PROVES it did not
//                                  (the store still holds a draft) buys one
//                                  replay. A status that establishes nothing
//                                  ends the drive at `unresolved`, because a
//                                  re-run of the whole command starts from a
//                                  status read and is therefore the safe retry.
//
// Nothing in here has been run against a live store. Every transition is read
// off the two vendor references (ADR 0077 § Amendment 1, `DOCUMENTED`), so the
// states this file does not recognise end at `unresolved` or `unverifiable`
// rather than at a guess.

import {
    isIdempotentSkip,
    redactSecrets,
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
    type StoreBackend,
    type StoreId,
    type StoreOperationKind,
    type StorePublishInput,
    type StoreStatusResult,
    type StoreUploadInput,
} from './index.js';

/* ------------------------------------------------------------------ end states */

/**
 * What a drive ENDED as. Nine, because the store's three asynchronous answers
 * ("busy", "accepted", "I cannot say") are facts a caller acts on differently
 * and a boolean would throw all three away.
 */
export type SubmitVerdict =
    /** The draft holds this version and no publish was asked for — `submit` without `--submit`. */
    | 'uploaded'
    /** The store confirms a submission for THIS version: Chrome `PENDING_REVIEW`, or Edge's publish operation `Succeeded`. */
    | 'submitted'
    /** The store reports this version as live. Chrome only; Edge has no endpoint that says so. */
    | 'published'
    /** The store was already on this version, so this run had nothing to do (`StoreVersionAlreadyThereError`). */
    | 'already-there'
    /** A submission is in review and this run changed nothing. Not a failure — see {@link SUBMIT_EXIT_CODES}. */
    | 'in-review'
    /** The store refused it: a 4xx that is not 408/429, or an operation it reported as failed. A re-run gets the same answer. */
    | 'rejected'
    /** A repeatable failure that kept repeating — a 5xx, a 429, a transport error — until the retries or the deadline ran out. */
    | 'failed'
    /** The store accepted something and never resolved it inside the deadline. The caller may call again later. */
    | 'unresolved'
    /** The store answered with a handle this client cannot read, so the outcome is not knowable from here. A gap in the backend, named as one. */
    | 'unverifiable';

/**
 * Exit code per verdict. The three decisions in it:
 *
 * **`in-review` exits 0.** The alternative — its own non-zero code — was
 * considered and rejected. The state means the PREVIOUS submit worked and the
 * store is busy with it; nothing in this run failed, nothing was corrupted, and
 * the way out (Chrome's `:cancelSubmission`; Edge documents none) is the
 * person's decision and never this command's. The step that calls `submit` sits
 * behind a GitHub Environment with a required reviewer, so a red there costs a
 * human a re-run of a workflow that did its job — and a check that cries wolf
 * is one somebody switches off, the lesson `publish-readback.ts` paid for. What
 * keeps that honest is that exit 0 here never CLAIMS a submission: the verdict
 * is its own value, `detail` names which version is blocking, and a caller that
 * wants a red can read `verdict` and decide. The plan behind this slice and
 * ADR 0077 § Amendment 1 both say the same ("three outcomes, not one non-zero
 * exit"), so this is also the already-recorded decision.
 *
 * **`failed` and `rejected` share exit 1** — the operator's next move is the
 * same, look at `detail` — while `unresolved` gets its own code, because its
 * next move is the opposite one: call again later, unchanged, and expect
 * progress. Those two must never be one number.
 *
 * **`2` is not in this table.** `cli-app.ts`'s `.fail()` handler exits 2 for a
 * usage error, so a store outcome spelled 2 would be indistinguishable from a
 * mistyped flag.
 */
export const SUBMIT_EXIT_CODES: Readonly<Record<SubmitVerdict, number>> = {
    uploaded: 0,
    submitted: 0,
    published: 0,
    'already-there': 0,
    'in-review': 0,
    rejected: 1,
    failed: 1,
    unresolved: 3,
    unverifiable: 4,
};

/**
 * Verdicts where calling again later can make progress on its own.
 *
 * `rejected` is absent on purpose: the package or the listing has to change
 * first. `unverifiable` is absent too — a re-run meets the same missing
 * capability; what has to change is the backend.
 */
const RETRYABLE_VERDICTS: readonly SubmitVerdict[] = ['in-review', 'failed', 'unresolved'];

/* ---------------------------------------------------------------------- budgets */

/**
 * Default deadline for the whole drive: 600 s.
 *
 * What this waits for is INGESTION and the resolution of an operation, never a
 * review verdict — a review takes days at both stores and no CI job may sit on
 * one. 600 s is `publish-readback.ts`'s budget, chosen there against measured
 * registry lag; nothing comparable has been measured against a store, so the
 * number is borrowed rather than derived, and `--timeout` is what a real
 * observation changes. A non-positive value waits not at all: every async step
 * is read exactly once and an unfinished one ends the drive at `unresolved`.
 */
export const DEFAULT_SUBMIT_TIMEOUT_MS = 600_000;

/**
 * Delay before poll `round + 2`; past the end the last value repeats.
 *
 * Same shape and same reason as `publish-readback.ts`'s table: an ingest that is
 * already done answers on the first read, so the first wait is short, and a tail
 * measured in minutes is not worth probing finely.
 */
const POLL_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000, 30_000];

/** Delay before retry `round + 1` of a repeatable failure. */
const RETRY_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * Delay before retry `round + 1` of a THROTTLED request.
 *
 * A 429 answered after one second is still a 429: retrying on the ordinary
 * table would spend all three attempts inside the window the store asked us to
 * stay out of. Neither backend reads `Retry-After` today, so this table is the
 * only thing standing in for it — the header is the obvious next refinement and
 * is written down here rather than left to be rediscovered.
 */
const THROTTLE_BACKOFF_MS: readonly number[] = [5_000, 15_000, 30_000];

/** How often a repeatable failure of one call is repeated before the drive gives up. */
export const MAX_SAFE_RETRIES = 3;

/**
 * How often a `publish` POST may be sent again after a transport failure —
 * once, and only on a `status()` that PROVED the first one did not arrive.
 */
const MAX_PUBLISH_REPLAYS = 1;

const stepFrom = (table: readonly number[], round: number): number =>
    table[Math.min(Math.max(round, 0), table.length - 1)] ?? table[table.length - 1] ?? 0;

/** Delay before the poll after `round` (0-based). */
export function pollBackoffFor(round: number): number {
    return stepFrom(POLL_BACKOFF_MS, round);
}

/** Delay before retry `round` (0-based) of a repeatable failure; throttling gets its own, longer table. */
export function retryBackoffFor(round: number, throttled: boolean): number {
    return stepFrom(throttled ? THROTTLE_BACKOFF_MS : RETRY_BACKOFF_MS, round);
}

/* ------------------------------------------------------------ idempotency class */

/** Which call failed, for {@link retryDecision}. A verb, not an endpoint: what matters is whether repeating it WRITES. */
export type StoreVerb = 'read' | 'upload' | 'publish';

/** HTTP statuses that mean "later", not "no". */
const RETRY_AFTER_STATUSES: readonly number[] = [408, 429];

/**
 * Is this failure's CLASS one that a repeat of the same request could survive?
 *
 * Only {@link StoreApiError} can be: the two idempotent skips are answers, not
 * failures, and anything else reaching here is a defect in this client, which a
 * repeat cannot fix.
 */
export function isRepeatableFailure(error: unknown): boolean {
    if (!(error instanceof StoreApiError)) return false;
    const status = error.httpStatus;
    // No status at all: the request never produced an HTTP answer, so nothing
    // about it was established — including, for a write, whether it arrived.
    if (status === undefined) return true;
    if (RETRY_AFTER_STATUSES.includes(status)) return true;
    return status >= 500 && status < 600;
}

/** True for the failure class whose remedy is specifically "wait longer than usual". */
export function isThrottled(error: unknown): boolean {
    return error instanceof StoreApiError && error.httpStatus === 429;
}

export type RetryDecision =
    /** Send the same request again after a backoff. */
    | 'retry'
    /** Do not resend. Ask the store what happened first — only `publish` reaches this. */
    | 'verify-first'
    /** The store has answered the question; a repeat gets the same answer. */
    | 'fatal';

/**
 * What to do about `error` from `verb`.
 *
 * The asymmetry between the two POSTs is the whole point: an `upload` writes the
 * draft, which is a SLOT — sending the same zip twice leaves the same draft, so
 * a repeat costs bytes. A `publish` CREATES a submission, so a repeat after a
 * transport failure risks a second one against a store that already took the
 * first; `status()` is the only thing allowed to decide that.
 */
export function retryDecision(error: unknown, verb: StoreVerb): RetryDecision {
    if (!isRepeatableFailure(error)) return 'fatal';
    if (verb !== 'publish') return 'retry';
    // A publish whose failure carries an HTTP status DID reach the store and was
    // answered (429, 503): nothing was created, so the same request is safe.
    // One with no status may or may not have arrived.
    return error instanceof StoreApiError && error.httpStatus === undefined ? 'verify-first' : 'retry';
}

/* -------------------------------------------------------------------- the value */

/** Where a drive was when a phase ended. */
export type SubmitPhaseName = 'upload' | 'await-upload' | 'publish' | 'await-publish' | 'confirm';

/** One phase of a drive, appended when it ends. The subcommand prints these in order. */
export interface SubmitPhase {
    readonly phase: SubmitPhaseName;
    /** Requests this phase sent, retries and polls included. */
    readonly requests: number;
    /** Milliseconds since the drive started, on the injected clock. */
    readonly elapsedMs: number;
    /** The store's own account of what happened, redacted. */
    readonly detail: string;
}

/**
 * What a drive established. A pure value: no printing, no exiting, no `process`
 * — the subcommand (S6) renders it and exits {@link SubmitResult.exitCode}.
 */
export interface SubmitResult {
    readonly store: StoreId;
    readonly version: string;
    readonly verdict: SubmitVerdict;
    /** `SUBMIT_EXIT_CODES[verdict]`, carried so a caller cannot re-derive it differently. */
    readonly exitCode: number;
    /** One line naming the evidence the verdict rests on, redacted. */
    readonly detail: string;
    readonly phases: readonly SubmitPhase[];
    readonly elapsedMs: number;
    /** Requests the whole drive sent. */
    readonly requests: number;
    /** How many of them were repeats of a failed one. */
    readonly retries: number;
    /** True when calling again later, unchanged, can make progress on its own. */
    readonly retryable: boolean;
}

export interface SubmitDriveInput {
    readonly backend: StoreBackend;
    readonly upload: StoreUploadInput;
    /**
     * Absent = upload the draft and stop, which is `submit`'s default; `--submit`
     * is what fills this in. A draft that is never submitted is a complete,
     * successful outcome and not half of one.
     */
    readonly publish?: StorePublishInput;
}

export interface SubmitDriveOptions {
    /** `--timeout`'s value in ms. Default {@link DEFAULT_SUBMIT_TIMEOUT_MS}; `<= 0` waits not at all. */
    readonly timeoutMs?: number;
    /** Injected in tests — nothing here calls `setTimeout` itself. */
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    /** Called per step under `GJSIFY_WEBEXT_DEBUG`. Already redacted. */
    readonly log?: (msg: string) => void;
    /**
     * Values that may never appear in a phase detail, the result or a log line —
     * `secretValuesOf(store, credentials)`. The backends redact their own
     * messages; this is the second net, because a detail here is assembled from
     * vendor text and vendor text is where an echoed credential turns up.
     */
    readonly secrets?: readonly string[];
}

/* --------------------------------------------------------------------- the drive */

type CallOutcome<T> =
    | { readonly kind: 'value'; readonly value: T }
    /** Terminal: the store answered, or a repeatable failure stopped being worth repeating. */
    | { readonly kind: 'error'; readonly error: unknown; readonly exhausted: boolean }
    /** A `publish` POST with no HTTP answer: it may or may not have arrived. */
    | { readonly kind: 'lost'; readonly error: unknown };

/**
 * Drive one version into one store and say what the store ended up at.
 *
 * upload → wait for the ingest → publish → wait for the submission, each step
 * bounded by ONE shared deadline: two budgets would make the wall clock twice
 * what `--timeout` promises, the same mistake `probeTimeoutFor` was written to
 * stop in the read-back.
 */
export async function driveSubmission(
    input: SubmitDriveInput,
    options: SubmitDriveOptions = {},
): Promise<SubmitResult> {
    const { backend } = input;
    const version = input.upload.version;
    const now = options.now ?? ((): number => Date.now());
    const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms)));
    const timeoutMs = options.timeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    const secrets = options.secrets ?? [];

    const started = now();
    const phases: SubmitPhase[] = [];
    let requests = 0;
    let retries = 0;
    let phaseRequests = 0;

    const clean = (text: string): string => redactSecrets(text, secrets);
    const note = (msg: string): void => options.log?.(clean(`gjsify webext submit: ${msg}`));
    const remaining = (): number => timeoutMs - (now() - started);

    const endPhase = (phase: SubmitPhaseName, detail: string): void => {
        phases.push({ phase, requests: phaseRequests, elapsedMs: now() - started, detail: clean(detail) });
        phaseRequests = 0;
    };

    const finish = (verdict: SubmitVerdict, detail: string): SubmitResult => ({
        store: backend.store,
        version,
        verdict,
        exitCode: SUBMIT_EXIT_CODES[verdict],
        detail: clean(detail),
        phases,
        elapsedMs: now() - started,
        requests,
        retries,
        retryable: RETRYABLE_VERDICTS.includes(verdict),
    });

    /** The terminal verdict for an error, after every retry it was entitled to. */
    const fromError = (phase: SubmitPhaseName, error: unknown, exhausted: boolean): SubmitResult => {
        const message = error instanceof Error ? error.message : String(error);
        endPhase(phase, message);
        if (error instanceof StoreVersionAlreadyThereError) return finish('already-there', message);
        if (error instanceof StoreInReviewError) return finish('in-review', message);
        if (exhausted) {
            return finish(
                'failed',
                `${message} — repeated ${MAX_SAFE_RETRIES}x or until the ${timeoutMs} ms deadline; the failure class is repeatable, so calling again later may work.`,
            );
        }
        return finish('rejected', message);
    };

    /** One call to the backend, with the retries its verb and the failure's class allow. */
    const call = async <T>(verb: StoreVerb, run: () => Promise<T>): Promise<CallOutcome<T>> => {
        for (let round = 0; ; round++) {
            requests++;
            phaseRequests++;
            try {
                return { kind: 'value', value: await run() };
            } catch (error) {
                if (isIdempotentSkip(error)) return { kind: 'error', error, exhausted: false };
                const decision = retryDecision(error, verb);
                if (decision === 'fatal') return { kind: 'error', error, exhausted: false };
                if (decision === 'verify-first') return { kind: 'lost', error };
                const left = remaining();
                if (round >= MAX_SAFE_RETRIES || left <= 0) return { kind: 'error', error, exhausted: true };
                const wait = Math.min(retryBackoffFor(round, isThrottled(error)), left);
                note(
                    `${verb} failed with a repeatable error, retry ${round + 1} of ${MAX_SAFE_RETRIES} in ${wait} ms — ` +
                        (error instanceof Error ? error.message : String(error)),
                );
                retries++;
                await sleep(wait);
            }
        }
    };

    /**
     * Does a status answer speak about OUR version?
     *
     * A store reporting `published` for some other version says nothing about
     * this one, and reporting it as ours would be exactly the claim neither this
     * file nor `publish-readback.ts` is allowed to make. A status that names no
     * version at all is accepted: Edge's `status()` answers about the operation
     * this run created, so there is no other submission it could be about.
     */
    const aboutOurVersion = (status: StoreStatusResult): boolean =>
        status.version === undefined || status.version === version;

    type WaitOutcome =
        | { readonly kind: 'done'; readonly detail: string }
        | { readonly kind: 'end'; readonly result: SubmitResult };

    /**
     * Wait for an asynchronous step to resolve, through whichever account the
     * backend has of it.
     *
     * `operation()` when the backend declares one — Edge's two operation GETs —
     * else `status()`, which is what Chrome's `lastAsyncUploadState` needs. A
     * backend with neither account of a HANDLE the store issued cannot resolve
     * it at all; that is `unverifiable` and is decided before a single poll, not
     * after a deadline, because waiting would only make a capability gap look
     * like a slow store.
     */
    const waitFor = async (
        kind: StoreOperationKind,
        phase: SubmitPhaseName,
        operationId: string | undefined,
        seed: string,
    ): Promise<WaitOutcome> => {
        const readOperation = backend.operation;
        if (readOperation === undefined && operationId !== undefined && kind === 'publish') {
            // `status()` can only speak about the product's own state. A store
            // that answers a publish with an operation id AND NOTHING ELSE
            // (Edge's `202`) therefore leaves a backend without `operation()`
            // with nothing to read — and the publish was ACCEPTED, so this is
            // neither a success nor a failure.
            endPhase(phase, seed);
            return {
                kind: 'end',
                result: finish(
                    'unverifiable',
                    `${seed} The publish was accepted and the ${backend.store} backend declares no operation() to read ${operationId} with, ` +
                        `so whether a submission exists cannot be established from here. It may well be in review — check the dashboard; the fix is operation() on that backend.`,
                ),
            };
        }

        for (let round = 0; ; round++) {
            if (readOperation !== undefined && operationId !== undefined) {
                const read = await call('read', () => readOperation.call(backend, kind, operationId, version));
                if (read.kind === 'error') return { kind: 'end', result: fromError(phase, read.error, read.exhausted) };
                if (read.kind === 'value' && read.value.state === 'succeeded') {
                    return { kind: 'done', detail: read.value.detail };
                }
                if (read.kind === 'value') note(`${kind} operation ${operationId}: ${read.value.detail}`);
            } else {
                const read = await call('read', () => backend.status());
                if (read.kind === 'error') return { kind: 'end', result: fromError(phase, read.error, read.exhausted) };
                if (read.kind === 'value') {
                    const status = read.value;
                    if (status.state === 'rejected') {
                        endPhase(phase, status.detail);
                        return { kind: 'end', result: finish('rejected', status.detail) };
                    }
                    if (kind === 'upload' && status.ingesting !== true) {
                        return { kind: 'done', detail: status.detail };
                    }
                    if (kind === 'publish' && aboutOurVersion(status)) {
                        if (status.state === 'published' || status.state === 'in-review') {
                            return { kind: 'done', detail: status.detail };
                        }
                    }
                    note(`status while waiting for the ${kind}: ${status.detail}`);
                }
            }
            const left = remaining();
            if (left <= 0) {
                const detail =
                    `the ${kind} was accepted and had not resolved after ${now() - started} ms` +
                    (operationId === undefined ? '' : ` (operation ${operationId})`) +
                    `. Nothing is lost: call \`gjsify webext submit\` again — it reads the store's state first and will report ` +
                    `"already there" or "in review" if this one landed meanwhile. Raise --timeout to wait longer.`;
                endPhase(phase, detail);
                return { kind: 'end', result: finish('unresolved', detail) };
            }
            await sleep(Math.min(pollBackoffFor(round), left));
        }
    };

    /* ----------------------------------------------------------------- upload */

    note(`${backend.store}: uploading ${version} from ${input.upload.zipPath}`);
    const uploaded = await call('upload', () => backend.upload(input.upload));
    if (uploaded.kind === 'error') return fromError('upload', uploaded.error, uploaded.exhausted);
    if (uploaded.kind === 'lost') {
        // Unreachable: `retryDecision` only answers `verify-first` for `publish`.
        // Kept as a type-level total case, not as a runtime guard.
        return fromError('upload', uploaded.error, false);
    }
    endPhase('upload', uploaded.value.detail);

    if (!uploaded.value.ingested) {
        const ingest = await waitFor('upload', 'await-upload', uploaded.value.operationId, uploaded.value.detail);
        if (ingest.kind === 'end') return ingest.result;
        endPhase('await-upload', ingest.detail);
    }

    if (input.publish === undefined) {
        return finish(
            'uploaded',
            `${version} is in the ${backend.store} draft and was NOT submitted — pass --submit to ask for review.`,
        );
    }

    /* ---------------------------------------------------------------- publish */

    const publishInput = input.publish;
    let replays = 0;
    for (;;) {
        note(`${backend.store}: asking for review of ${version}`);
        const published = await call('publish', () => backend.publish(publishInput));

        if (published.kind === 'error') return fromError('publish', published.error, published.exhausted);

        if (published.kind === 'lost') {
            // THE ONE PLACE A WRITE'S OUTCOME IS UNKNOWN. No resend until the
            // store itself says the first one is not there.
            const message = published.error instanceof Error ? published.error.message : String(published.error);
            note(`the publish request got no answer (${message}) — asking the store whether it arrived`);
            const confirm = await call('read', () => backend.status());
            if (confirm.kind !== 'value') {
                // `lost` cannot happen for a read — `retryDecision` answers
                // `verify-first` only for `publish`. Narrowed, not guarded.
                return fromError('publish', confirm.error, confirm.kind === 'error' && confirm.exhausted);
            }
            const status = confirm.value;
            if (status.state === 'rejected') {
                endPhase('publish', status.detail);
                return finish('rejected', status.detail);
            }
            if (aboutOurVersion(status) && (status.state === 'in-review' || status.state === 'published')) {
                endPhase('publish', status.detail);
                return finish(
                    status.state === 'published' ? 'published' : 'submitted',
                    `the publish request got no answer, and the store reports it arrived: ${status.detail}`,
                );
            }
            if (
                status.state === 'draft' &&
                aboutOurVersion(status) &&
                replays < MAX_PUBLISH_REPLAYS &&
                remaining() > 0
            ) {
                // PROVEN not to have arrived: the store still holds a draft and
                // no submission for it. One replay, counted as a retry.
                replays++;
                retries++;
                note(`the store still holds a draft (${status.detail}) — sending the publish request once more`);
                continue;
            }
            const detail =
                `the publish request got no answer (${message}) and the store's own state does not say whether it arrived: ` +
                `${status.detail}. The request was NOT repeated — a second one would risk a second submission. ` +
                `Call \`gjsify webext submit\` again once the store settles; it reads the state first.`;
            endPhase('publish', detail);
            return finish('unresolved', detail);
        }

        const result = published.value;
        endPhase('publish', result.detail);
        if (result.state === 'rejected') return finish('rejected', result.detail);
        if (result.state === 'published') return finish('published', result.detail);
        if (result.state === 'in-review') return finish('submitted', result.detail);

        // `draft` or `unknown`: Edge always answers this way (its `202` carries
        // no state at all), and Chrome's `:publish` may answer without one.
        const settled = await waitFor('publish', 'await-publish', result.operationId, result.detail);
        if (settled.kind === 'end') return settled.result;
        endPhase('await-publish', settled.detail);
        return finish('submitted', settled.detail);
    }
}
