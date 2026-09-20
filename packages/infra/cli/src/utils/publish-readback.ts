// Post-PUT read-back for `gjsify publish`: does the registry actually RESOLVE
// the version we just uploaded?
//
// THE INCIDENT (v0.46.0, run 33735989472). The job `Publish
// @gjsify/node-runtime-darwin-arm64 (bundled Node)` reported SUCCESS and
// published NOTHING. Its own log, with GJSIFY_PUBLISH_DEBUG=1:
//
//     gjsify publish: PUT https://registry.npmjs.org/@gjsify%2fnode-runtime-darwin-arm64
//       payload size:  53863410 bytes
//     + @gjsify/node-runtime-darwin-arm64@0.46.0
//
// The job was green. Minutes later the registry had NEITHER half: the version
// endpoint 404'd, the tarball URL 404'd, `npm view … version` still answered
// 0.45.0, and the packument's `time` map had no 0.46.0 entry at all. Only a
// manual single-job rerun made it land (registry time 09:49:07.419Z). Payload
// size was NOT the cause — darwin-x64 at 55189094 bytes, i.e. LARGER, published
// fine in the same rerun. `res.ok` was checked and npm's answer really was 2xx,
// so the plain `+` success path is exactly what the code was written to print.
//
// WHAT THE 2xx MEANS, MEASURED. A 2xx from npm is an ACCEPTED write, not a
// durable one. Correlating all 199 `+ <name>@0.46.0` lines of that release's
// serial sweep with each packument's own `time["0.46.0"]`:
//
//   180 / 199 (90.5%)  registry time is 0.4-2.4 s BEFORE our success line (median
//                      0.6 s) — the version doc existed before the response came back
//    19 / 199  (9.5%)  registry time is 56.2 s - 251.7 s AFTER the 2xx; the
//                      extreme is @gjsify/child_process, PUT 09:25:08.7, `+`
//                      printed 09:25:10.3, registry time 09:29:21.996Z
//                      (+4m11s). THREE of the 19 were recorded after the
//                      publish job's own completed_at (09:28:35Z).
//     1              not recorded until a manual rerun — the incident above.
//
// So "not there" and "not there YET" are the same observation for up to ~4.2
// minutes, and no client-side signal separates them. That is what this module
// is for: it turns "npm said 2xx" into "the registry serves it", and when it
// cannot, it says which of the two it saw and for how long it looked.
//
// THE MECHANISM, and why the lag is a WRITE and not a read cache. `dist.signatures`
// correlates 1:1 with the sign of that lag across all 199: every one of the 19
// late packages carries TWO signatures (same keyid, different sig), every one of
// the 180 carries ONE, and the client sent exactly one PUT per package (199
// distinct names, no retry, no 5xx in the log). So the late version document was
// written a second time server-side, and `time[version]` records that second
// write. Corroborated client-side rather than inferred: @gjsify/child_process's
// +251.7 s is exactly the package that failed all three attempt-1 node-runtime
// jobs at 09:29:05 with `ETARGET / No matching version found for
// @gjsify/child_process@^0.46.0` — 15 s BEFORE its recorded time and 4 min after
// its `+`. A lag of this kind therefore does not merely delay a report; it
// cascades into every job that installs the release.
//
// WHY THE PACKUMENT AND NOT THE TARBALL URL. One abbreviated-packument GET
// answers both halves that #1407 split apart (npm had stored the tarball and no
// packument there): the version record carries `dist.tarball`, so its presence
// is checked from the same response with no second request. It proves the
// registry ADVERTISES a tarball, not that the bytes are fetchable — a HEAD on
// the tarball would be a second round trip per package and is deliberately not
// done here. Same oracle and same headers as
// `scripts/verify-published-closure.mjs`, so the per-package check and the
// end-of-release closure check cannot disagree about what "published" means —
// an equality that had to be MADE: the closure probe asked for the version key
// alone, so the tarball half of every publish the sweep defers to it was checked
// by nothing. It now reads `dist.tarball` from the same document.

import { escapePackageName } from './publish-headers.js';

/** One registry answer, classified. `absent` and `error` are NOT the same fact. */
export type ReadbackProbe =
    | { state: 'present'; status: number; tarball: string }
    | { state: 'absent'; status: number; detail: string }
    /**
     * We do not KNOW. A 5xx, a timeout, unparseable JSON — treating any of them
     * as "absent" would fabricate a "never published" verdict out of a registry
     * hiccup, the same distinction `verify-published-closure.mjs` draws between
     * `false` and an `Error`.
     */
    | { state: 'error'; status?: number; detail: string };

/**
 * What the read-back CONCLUDED — the three outcomes a caller may act on, plus
 * the one it may not.
 *
 * `absent` on its own is not a conclusion. The install document not carrying a
 * version has two causes with opposite remedies — the write never landed
 * (re-publish) and the write landed but that document does not serve it yet
 * (wait; a re-publish is answered 409) — and until this type existed both left
 * through one message asserting the first. Observed live on the ts-for-gir
 * v5.1.0 release: `@ts-for-gir/reporter` was recorded by the registry at
 * 21:43:00.983Z and a cache-busted abbreviated read ~40 min later still did not
 * carry 5.1.0, while the full packument's `time` map did; two minutes after
 * that, both agreed.
 */
export type ReadbackVerdict =
    /** The install document serves `name@version` and advertises a tarball. */
    | 'confirmed'
    /** The registry has no record of this version at all — the v0.46.0 shape. */
    | 'not-published'
    /** The registry RECORDS the write; the document npm installs from does not serve it. */
    | 'recorded-not-served'
    /**
     * Nothing was established. A 5xx, a timeout, DNS, an auth wall — or an
     * install document without the version whose registry record could then
     * not be read, which leaves BOTH other verdicts unearned. NEVER "published".
     */
    | 'unknown';

export interface ReadbackResult {
    /** True iff a probe saw the exact version with a tarball on it. */
    confirmed: boolean;
    /** What the read-back concluded. `confirmed === (verdict === 'confirmed')`. */
    verdict: ReadbackVerdict;
    /** One line naming the evidence the verdict rests on — it goes in the report. */
    verdictDetail: string;
    /** `time[version]` from the registry's own record, when the corroboration read one. */
    recordedAt?: string;
    /** Probes actually sent (≥ 1). */
    attempts: number;
    elapsedMs: number;
    /** The URL that was asked, verbatim — it belongs in the failure message. */
    url: string;
    /** What the registry said last. On `confirmed` this is the `present` probe. */
    last: ReadbackProbe;
}

export interface VerifyPublishedVersionInput {
    /** Registry URL, with or without a trailing slash. */
    registry: string;
    /** Full package name including scope. */
    name: string;
    version: string;
    /** Total polling budget in ms. Must be > 0 — a disabled read-back is the caller's decision. */
    budgetMs: number;
    /** Per-probe request timeout. Default 30 s, matching the closure script. */
    probeTimeoutMs?: number;
    /**
     * The `authorization` header the PUT used, forwarded verbatim.
     *
     * A registry that requires a credential to READ answers 401/403 to an
     * anonymous packument GET, which classifies as `error` — so an intact
     * publish to GitHub Packages, an Artifactory repo or a Verdaccio with
     * `access: $authenticated` reports `publish-unconfirmed` and, on the fatal
     * default, exits 1 after the whole budget on a publish that worked.
     * Measured against the first version of this file: 15 read-back GETs, every
     * one anonymous, one second after a PUT that carried a token. Same origin,
     * same credential, one request later — it adds no exposure the PUT did not
     * already have.
     */
    authorization?: string;
    /** Injected in tests; resolved at call time so a `globalThis.fetch` stub is honoured. */
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    /** Called once per probe under `GJSIFY_PUBLISH_DEBUG`. */
    log?: (msg: string) => void;
}

/**
 * Backoff between probes, in ms; the last value repeats until the budget is out.
 *
 * Shaped by the distribution in the header, not picked for roundness: 90.5% of
 * writes are already committed when the 2xx arrives, so the FIRST probe is
 * immediate and costs one ~0.5 s GET for nine packages in ten. The tail is
 * minutes long and coarse, so probing it finely would only add requests — after
 * 30 s the interval stops shrinking.
 */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

/** Delay before probe `round + 2`. Past the table's end the last value repeats. */
export function backoffFor(round: number): number {
    return BACKOFF_MS[Math.min(Math.max(round, 0), BACKOFF_MS.length - 1)] ?? 30_000;
}

/**
 * The smallest request timeout a probe is ever given.
 *
 * A probe cut below the time an answer takes reports `error` — "we do not know" —
 * where it would have read a 404, so the decisive LAST probe of a short budget
 * would lose the verdict the whole read-back exists to produce. Measured against
 * registry.npmjs.org from a European workstation, 21 abbreviated-packument GETs
 * ran 0.48-0.62 s (median 0.57), so 2 s is ~3.5x the median and above every
 * observation — the floor is what lets a probe answer, not a guess at latency.
 */
const MIN_PROBE_TIMEOUT_MS = 2_000;

/**
 * A probe's request timeout: what was configured, never more than the budget has
 * left to spend — but never less than a probe needs to answer.
 *
 * Configured and budget are otherwise independent, and that makes
 * `--verify-timeout 5` — what the 199-package sweep passes — a promise the code
 * does not keep: one unanswered request may block for the 30 s default, six times
 * the budget it was given, and 199 of those cost ~100 min against the ~11% the
 * deferral is argued on. Clamping bounds the wall clock at
 * `budget + MIN_PROBE_TIMEOUT_MS` instead. The floor is the other half of the
 * same honesty: clamping all the way to zero traded a 30 s overshoot for an
 * `error` verdict on a probe that was about to return the 404 (measured — it
 * turned the incident's own e2e row from `absent: 404` into `request failed
 * (This operation was aborted)`).
 */
export function probeTimeoutFor(configuredMs: number, remainingMs: number): number {
    return Math.min(configuredMs, Math.max(remainingMs, MIN_PROBE_TIMEOUT_MS));
}

/**
 * Default polling budget: 600 s.
 *
 * The lag between a 2xx and the registry recording the version has been measured
 * on two releases, and the second broke the first's ceiling. v0.46.0 (199
 * packages): 19 late writes, maximum 251.7 s (@gjsify/child_process). ts-for-gir
 * v5.1.0 (12 packages, run 34899018849, PUT lines against `time["5.1.0"]`):
 * four recorded ~0.7 s BEFORE the 2xx, eight after it — +74, +74, +75, +75,
 * +96, +248, +248 and +368 s (@ts-for-gir/reporter) — the last past the 300 s
 * this constant used to be, so "above the measured maximum" had quietly
 * stopped being true of it. A budget below the lag turns npm's normal queueing into a false
 * red, and a false red at release time costs a manual re-run of a workflow that
 * did its job. A budget above it costs nothing on the nine in ten that confirm
 * on the first probe; all it delays is the report of a genuinely LOST write —
 * one in 199, measured — by the difference. 600 s is ~1.6x the larger maximum.
 *
 * BOTH MAXIMA ARE SAMPLE MAXIMA, and neither sample looks truncated by nature.
 * The v0.46.0 lags fall in buckets ~20-30 s apart — 56(2), 76(3), 96(3),
 * 127(4), 157(3), 189(1), 251(3) — and the TOP bucket is as populated as the
 * middle ones, which is the shape of a distribution cut off by the observation
 * rather than one decaying to zero; the next release then produced a value past
 * it. So a lag past 600 s is not ruled out either. What makes any finite window
 * affordable is that the remediation is verified rather than assumed: the
 * re-run this reports lands on the 409 path, and that path READS BACK too (see
 * the conflict branch in `commands/publish.ts`), so a window that turns out too
 * short costs one re-run that confirms — never an unverified success.
 *
 * `time[version]` is when the registry RECORDED the write, a lower bound on
 * when the document npm installs from SERVES it: the reporter above was
 * recorded at +368 s and a cache-busted read of its install document still
 * lacked 5.1.0 ~40 min later. No budget waits that out, and none should — that
 * state is what the `recorded-not-served` verdict names.
 */
export const DEFAULT_VERIFY_BUDGET_MS = 600_000;

/**
 * Make one probe's URL uncacheable, by giving it a key no cache holds.
 *
 * THE REQUEST HEADER DOES NOT WORK, and this file used to say it did. Measured
 * against registry.npmjs.org, twice, on two packages, one request apart:
 *
 *   cache-control: no-cache                → cf-cache-status: HIT, age: 192
 *   cache-control: no-cache + pragma       → cf-cache-status: HIT, age: 193
 *   cache-control: max-age=0               → cf-cache-status: HIT, age: 193
 *   cache-control: no-store                → cf-cache-status: HIT, age: 193
 *   ?<unique>                              → cf-cache-status: MISS
 *
 * The packument is served `cache-control: public, max-age=300`, so an edge may
 * answer with a document up to 300 s old — the sweep's whole 5 s budget sixty
 * times over, and half the fatal default. A read-back polling one such edge
 * re-reads ONE document minted before the PUT for up to 300 s of its window and
 * a short budget then reports the publish unconfirmed: a
 * manufacturable false red on a publish that worked, and a verifier that cries
 * wolf is one somebody turns off. It cannot produce the opposite error, because
 * a document minted before the write cannot carry the version.
 *
 * The header is still sent: it costs nothing and a cache that DOES honour it
 * (a corporate proxy, a Verdaccio) should. The parameter is namespaced so it
 * cannot collide with a registry's own query vocabulary, and {@link probeOnce}
 * falls back to the bare URL if a registry answers a non-404 4xx to it.
 */
function cacheBustedUrl(url: string, nonce: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}__gjsify_readback=${encodeURIComponent(nonce)}`;
}

/**
 * Poll the registry until `name@version` resolves, or the budget runs out, then
 * say WHICH of the three states it found (see {@link ReadbackVerdict}).
 *
 * No side effects, no exits, no printing beyond the injected `log` — the caller
 * owns presentation, same contract as {@link import('./publish-diagnose.js')}.
 */
export async function verifyPublishedVersion(input: VerifyPublishedVersionInput): Promise<ReadbackResult> {
    const { registry, name, version, budgetMs } = input;
    const doFetch = input.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = input.now ?? (() => Date.now());
    const probeTimeoutMs = input.probeTimeoutMs ?? 30_000;

    const registryClean = registry.endsWith('/') ? registry.slice(0, -1) : registry;
    const url = `${registryClean}/${escapePackageName(name)}`;

    const started = now();
    let attempts = 0;
    let last: ReadbackProbe = { state: 'error', detail: 'no probe was sent' };

    for (let round = 0; ; round++) {
        attempts++;
        last = await probeOnce({
            url,
            version,
            doFetch,
            probeTimeoutMs: probeTimeoutFor(probeTimeoutMs, budgetMs - (now() - started)),
            authorization: input.authorization,
            nonce: `${started}-${attempts}`,
        });
        input.log?.(
            `gjsify publish: read-back probe ${attempts} of ${name}@${version} → ${last.state}` +
                (last.state === 'present' ? '' : ` (${last.detail})`),
        );
        if (last.state === 'present') break;
        const remaining = budgetMs - (now() - started);
        if (remaining <= 0) break;
        await sleep(Math.min(backoffFor(round), remaining));
    }

    const base = { attempts, elapsedMs: now() - started, url, last };
    if (last.state === 'present') {
        return {
            ...base,
            confirmed: true,
            verdict: 'confirmed',
            verdictDetail: `${url} serves ${version} with a tarball`,
        };
    }
    if (last.state === 'error') {
        // NOTHING was established, so nothing may be concluded — least of all
        // "published". This branch is the whole reason `error` exists next to
        // `absent`, and it sends no corroboration request: a read that failed
        // is not evidence to corroborate.
        return {
            ...base,
            confirmed: false,
            verdict: 'unknown',
            verdictDetail: `the read-back could not reach a verdict — ${last.detail}`,
        };
    }

    // ABSENT, which is one observation and two facts. Ask the registry's own
    // record — `time[version]` on the FULL packument, the one field that
    // separates them — ONE extra request, on the failure path only.
    const record = await probeRegistryRecord({
        url,
        version,
        doFetch,
        // The configured per-probe timeout, NOT the budget-derived clamp: the
        // budget is spent by now, and the clamp's floor is sized for the
        // abbreviated document. The FULL packument is a different size class —
        // measured, `typescript`'s is 15.7 MB and took 2.86 s to read, over the
        // 2 s floor — so a corroboration on the floor would have answered
        // `unknown` for exactly the packages whose failure most needs a verdict.
        probeTimeoutMs,
        authorization: input.authorization,
        nonce: `${started}-record`,
    });
    input.log?.(`gjsify publish: read-back record probe of ${name}@${version} → ${record.state} (${record.detail})`);
    if (record.state === 'recorded') {
        return {
            ...base,
            confirmed: false,
            verdict: 'recorded-not-served',
            verdictDetail: record.detail,
            recordedAt: record.recordedAt,
        };
    }
    if (record.state === 'no-record') {
        return {
            ...base,
            confirmed: false,
            verdict: 'not-published',
            verdictDetail: record.detail,
        };
    }
    // The corroboration itself failed. The `absent` observation still stands —
    // it is in `last` — but the two verdicts it was meant to separate are BOTH
    // unearned now: no record was read, and neither was its absence. Naming
    // `not-published` here would tell the operator to re-publish on the strength
    // of a request that never answered, on the one line written so a tool never
    // claims what it has not established.
    return {
        ...base,
        confirmed: false,
        verdict: 'unknown',
        verdictDetail: record.detail,
    };
}

/** The registry's own record of a version its install document does not serve. */
type RecordProbe =
    | { state: 'recorded'; recordedAt: string; detail: string }
    | { state: 'no-record'; detail: string }
    /** The corroboration itself failed; the `absent` observation still stands. */
    | { state: 'unknown'; detail: string };

/**
 * Read `time[version]` from the FULL packument.
 *
 * The abbreviated document the polling probe reads is what npm INSTALLS from and
 * carries no `time` map, so this is a different document and deliberately a
 * different request — the full packument for a long-lived package is large, which
 * is exactly why it is asked once, only when the answer is about to be a failure.
 */
async function probeRegistryRecord(input: ProbeOnceInput): Promise<RecordProbe> {
    const { url, version, doFetch, probeTimeoutMs } = input;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
    let res: Response;
    try {
        res = await doFetch(cacheBustedUrl(url, input.nonce), {
            // No `accept` override: the FULL document, for its `time` map.
            headers: {
                'cache-control': 'no-cache',
                ...(input.authorization ? { authorization: input.authorization } : {}),
            },
            signal: controller.signal,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            state: 'unknown',
            detail: `the registry serves no ${version} and its own record was unreadable (${msg})`,
        };
    } finally {
        clearTimeout(timer);
    }
    if (res.status === 404) {
        return { state: 'no-record', detail: 'the registry has no packument for this name at all (404)' };
    }
    if (!res.ok) {
        return {
            state: 'unknown',
            detail: `the registry serves no ${version} and its own record answered ${res.status} ${res.statusText}`,
        };
    }
    let doc: unknown;
    try {
        doc = await res.json();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            state: 'unknown',
            detail: `the registry serves no ${version} and its own record is not JSON (${msg})`,
        };
    }
    const time = (doc as { time?: Record<string, unknown> } | null)?.time;
    const recordedAt = time && typeof time === 'object' ? time[version] : undefined;
    if (typeof recordedAt === 'string' && recordedAt.length > 0) {
        return {
            state: 'recorded',
            recordedAt,
            detail: `the registry RECORDS ${version} at ${recordedAt} and its install document does not serve it`,
        };
    }
    return {
        state: 'no-record',
        detail: `the registry has no record of ${version} — neither in its install document nor in its own \`time\` map`,
    };
}

interface ProbeOnceInput extends PackumentRequestInput {
    version: string;
}

interface PackumentRequestInput {
    url: string;
    doFetch: typeof fetch;
    probeTimeoutMs: number;
    authorization?: string;
    /** Distinct per probe — what actually defeats the CDN, see {@link cacheBustedUrl}. */
    nonce: string;
}

/**
 * One abbreviated-packument GET: cache-busted, with the non-404 4xx fallback.
 *
 * Extracted so the version read-back and {@link probePackageName} cannot drift
 * into asking the registry two different questions — the same reason the
 * read-back and `verify-published-closure.mjs` read the same document.
 */
async function sendPackumentRequest(input: PackumentRequestInput): Promise<Response | { error: string }> {
    const { url, doFetch, probeTimeoutMs } = input;
    const headers = {
        // Abbreviated packument: version keys + `dist`, a fraction of the bytes
        // of the full document, and the document npm itself installs from.
        // `cache-control` is sent for the caches that honour it; the edge in
        // front of registry.npmjs.org measurably does not, which is what the
        // query parameter is for.
        accept: 'application/vnd.npm.install-v1+json',
        'cache-control': 'no-cache',
        ...(input.authorization ? { authorization: input.authorization } : {}),
    };
    // `AbortController` + a timer rather than `AbortSignal.timeout`, which the
    // CLI does not use anywhere and which this file must not be the first to
    // require of a GJS host.
    const send = async (target: string): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
        try {
            return await doFetch(target, { headers, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    };

    let res: Response;
    try {
        res = await send(cacheBustedUrl(url, input.nonce));
        // A registry that does not know the parameter must not be reported as a
        // failed publish because of it. 404 is excluded: that is a real answer
        // about the NAME, and re-asking it bare would only re-ask a cache.
        if (!res.ok && res.status !== 404 && res.status >= 400 && res.status < 500) {
            res = await send(url);
        }
    } catch (err) {
        // A real throw path: network failure, DNS, or our own abort above.
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `request failed (${msg})` };
    }
    return res;
}

async function probeOnce(input: ProbeOnceInput): Promise<ReadbackProbe> {
    const { version } = input;
    const sent = await sendPackumentRequest(input);
    if ('error' in sent) {
        return { state: 'error', detail: sent.error };
    }
    const res = sent;

    if (res.status === 404) {
        return { state: 'absent', status: 404, detail: '404 — the registry serves no packument for this name' };
    }
    if (!res.ok) {
        return { state: 'error', status: res.status, detail: `${res.status} ${res.statusText}` };
    }

    let doc: unknown;
    try {
        doc = await res.json();
    } catch (err) {
        // A 200 whose body is not a packument answers nothing; `absent` would be
        // a verdict we did not earn.
        const msg = err instanceof Error ? err.message : String(err);
        return { state: 'error', status: res.status, detail: `packument is not JSON (${msg})` };
    }

    const versions = (doc as { versions?: Record<string, { dist?: { tarball?: unknown } }> } | null)?.versions;
    const known = versions && typeof versions === 'object' ? Object.keys(versions) : [];
    const entry =
        versions && typeof versions === 'object' && Object.hasOwn(versions, version) ? versions[version] : undefined;
    if (!entry) {
        const newest = known.length > 0 ? known[known.length - 1] : '(none)';
        return {
            state: 'absent',
            status: res.status,
            detail: `packument carries ${known.length} version(s), newest ${newest} — ${version} is not among them`,
        };
    }
    const tarball = entry.dist?.tarball;
    if (typeof tarball !== 'string' || tarball.length === 0) {
        // The #1407 half: a version record with no tarball to install.
        return {
            state: 'absent',
            status: res.status,
            detail: `packument has ${version} but its \`dist.tarball\` is missing`,
        };
    }
    return { state: 'present', status: res.status, tarball };
}

/**
 * The unconfirmed-publish diagnostic, ready for stderr.
 *
 * The message has to answer three questions the incident log could not, which is
 * why it needed the registry to reconstruct at all: what was PUT, what was asked,
 * and what came back.
 */
export function formatUnconfirmedPublish(opts: {
    name: string;
    version: string;
    putUrl: string;
    putStatus: number;
    putStatusText: string;
    payloadBytes: number;
    readback: ReadbackResult;
    /**
     * What npm claimed before the read-back disagreed. `accepted` is a 2xx;
     * `already-published` is a tolerated 409, where the remediation is the
     * opposite one — a re-run answers the same conflict.
     */
    claim?: 'accepted' | 'already-published';
}): string {
    const { name, version, putUrl, putStatus, putStatusText, payloadBytes, readback } = opts;
    const claim = opts.claim ?? 'accepted';
    const seconds = (readback.elapsedMs / 1000).toFixed(1);
    // Only ever called on an UNCONFIRMED read-back, so `last` is `absent` or
    // `error` — both carry a `detail`; `present` has nothing to explain.
    const answered = readback.last.state === 'present' ? 'served' : readback.last.detail;
    const claimed =
        claim === 'already-published' ? `npm says ${version} is ALREADY PUBLISHED` : 'npm ACCEPTED the upload';
    // THE HEADLINE IS THE VERDICT, not the claim. It used to assert "the registry
    // does not serve it" for every unconfirmed read-back, including one whose
    // last probe was a 5xx — a statement the probe had not earned, on the very
    // line written to stop a tool claiming what it had not established.
    const headline =
        readback.verdict === 'unknown'
            ? readback.last.state === 'absent'
                ? `${claimed}; its install document does not serve ${version} and the registry's own record could NOT be read.`
                : `${claimed} and the read-back could NOT establish whether the registry serves it.`
            : readback.verdict === 'recorded-not-served'
              ? `${claimed}; the registry RECORDS ${version} and its install document does not serve it.`
              : `${claimed} and the registry has no record of ${version}.`;
    const remedy =
        readback.verdict === 'unknown'
            ? [
                  '  This is NOT a report that the publish failed, and it is not one that it worked. The read-back',
                  '  reached no answer it could act on, so the version may or may not be installable — confirm it',
                  '  before releasing anything that depends on it (`npm view <name>@<version> dist.tarball`).',
              ]
            : readback.verdict === 'recorded-not-served'
              ? [
                    '  Do NOT re-publish: the registry holds the write, so a re-run is answered 409 and changes',
                    "  nothing. The document npm installs from is behind the registry's own record — measured on",
                    '  the ts-for-gir v5.1.0 release, @ts-for-gir/reporter was recorded at 21:43:00.983Z and a',
                    '  cache-busted read of its install document still did not carry 5.1.0 ~40 min later. Wait and',
                    '  re-read; if it persists, check https://status.npmjs.org/.',
                ]
              : claim === 'already-published'
                ? [
                      '  A 409 is npm refusing to overwrite a version it holds, which is not the same as serving it:',
                      '  in the v0.46.0 recovery @gjsify/node-runtime-darwin-arm64 was answered 409 at 09:48:49 and',
                      '  the registry recorded 0.46.0 at 09:49:07, 18s later. Re-running answers the same 409, so it',
                      '  cannot fix this — wait and re-read (`npm view <name>@<version>`), or check',
                      '  https://status.npmjs.org/.',
                  ]
                : [
                      '  A 2xx from npm is an ACCEPTED write, not a durable one. In the v0.46.0 release 19 of 199',
                      '  packages were recorded by the registry 56-252s after their 2xx, and ONE was never recorded',
                      '  at all while its job stayed green — that is the failure this check exists to name.',
                      `  Re-run this publish (\`--tolerate-republish\` no-ops if it landed meanwhile). If it keeps`,
                      '  failing, the write was rejected downstream of the 2xx: check https://status.npmjs.org/.',
                  ];
    return [
        `gjsify publish: ${name}@${version} — ${headline}`,
        `  PUT       ${putUrl} (${payloadBytes} bytes) → ${putStatus} ${putStatusText}`,
        `  read-back GET ${readback.url} (accept: application/vnd.npm.install-v1+json, per-probe cache buster)`,
        `  answered  ${readback.last.state}: ${answered}`,
        `            after ${readback.attempts} probe(s) over ${seconds}s`,
        `  verdict   ${readback.verdict} — ${readback.verdictDetail}`,
        ...remedy,
    ].join('\n');
}

/** Whether the registry serves a packument for a NAME at all. */
export type NamePresence =
    | { state: 'present'; status: number; versions: number }
    | { state: 'absent'; status: number; detail: string }
    /**
     * We do not KNOW — a 5xx, a timeout, an auth wall. A caller that blocks a
     * publish on this must treat it as "not established", never as "absent":
     * the whole point of the guard is that it cannot manufacture a red.
     */
    | { state: 'unknown'; status?: number; detail: string };

export interface ProbePackageNameInput {
    registry: string;
    name: string;
    probeTimeoutMs?: number;
    authorization?: string;
    fetchImpl?: typeof fetch;
}

let nameProbeSeq = 0;

/**
 * Ask ONE question: does this NAME exist on the registry at all.
 *
 * Deliberately not a version question, and that is what makes it safe to gate a
 * publish on. A version is eventually consistent — measured on v0.46.0, 19 of
 * 199 packages were recorded 56-252 s AFTER their own 2xx — so "is name@version
 * there" answers "not yet" for minutes and a gate built on it would manufacture
 * a red on a publish that worked. Presence of the NAME does not move once the
 * first version lands, which is the same reason
 * `verify-published-closure.mjs --phase pre-release` asks it rather than the
 * version: an answer that does not move when the train moves.
 */
export async function probePackageName(input: ProbePackageNameInput): Promise<NamePresence> {
    const doFetch = input.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const registryClean = input.registry.endsWith('/') ? input.registry.slice(0, -1) : input.registry;
    const sent = await sendPackumentRequest({
        url: `${registryClean}/${escapePackageName(input.name)}`,
        doFetch,
        probeTimeoutMs: input.probeTimeoutMs ?? 30_000,
        authorization: input.authorization,
        nonce: `name-${Date.now()}-${++nameProbeSeq}`,
    });
    if ('error' in sent) {
        return { state: 'unknown', detail: sent.error };
    }
    if (sent.status === 404) {
        return { state: 'absent', status: 404, detail: '404 — the registry serves no packument for this name' };
    }
    if (!sent.ok) {
        return { state: 'unknown', status: sent.status, detail: `${sent.status} ${sent.statusText}` };
    }
    let doc: unknown;
    try {
        doc = await sent.json();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { state: 'unknown', status: sent.status, detail: `packument is not JSON (${msg})` };
    }
    const versions = (doc as { versions?: Record<string, unknown> } | null)?.versions;
    const count = versions && typeof versions === 'object' ? Object.keys(versions).length : 0;
    if (count === 0) {
        // A 200 that carries no version is not a name that exists: every
        // published name has at least one, and an unpublished-then-emptied
        // packument is precisely the state npm serves for a name whose only
        // version was unpublished.
        return { state: 'unknown', status: sent.status, detail: 'a 200 carrying no versions establishes nothing' };
    }
    return { state: 'present', status: sent.status, versions: count };
}
