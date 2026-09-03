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

export interface ReadbackResult {
    /** True iff a probe saw the exact version with a tarball on it. */
    confirmed: boolean;
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
 * Default polling budget: 300 s.
 *
 * The measured maximum lag between a 2xx and the registry recording the version
 * was 251.7 s (@gjsify/child_process, v0.46.0), so a budget below ~4.2 minutes
 * turns npm's normal queueing into a false red — and a false red at release time
 * costs a manual re-run of a workflow that did its job. 300 s clears that
 * maximum and is still short enough that a genuinely lost write is reported by
 * the job that lost it rather than by a later sweep.
 *
 * THAT MAXIMUM IS A SAMPLE MAXIMUM, and the sample does not look truncated by
 * nature. The 19 lags fall in buckets ~20-30 s apart — 56(2), 76(3), 96(3),
 * 127(4), 157(3), 189(1), 251(3) — and the TOP bucket is as populated as the
 * middle ones, which is the shape of a distribution cut off by the observation
 * rather than one decaying to zero. One release is one sample, so a lag past
 * 300 s is not ruled out; what makes 300 s affordable anyway is that the
 * remediation is verified rather than assumed. The re-run this reports lands on
 * the 409 path, and that path READS BACK too (see the conflict branch in
 * `commands/publish.ts`), so a window that turns out to be too short costs one
 * re-run that confirms — it does not hand back an unverified success.
 */
export const DEFAULT_VERIFY_BUDGET_MS = 300_000;

/**
 * Poll the registry until `name@version` resolves, or the budget runs out.
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

    return { confirmed: last.state === 'present', attempts, elapsedMs: now() - started, url, last };
}

interface ProbeOnceInput {
    url: string;
    version: string;
    doFetch: typeof fetch;
    probeTimeoutMs: number;
    authorization?: string;
}

async function probeOnce(input: ProbeOnceInput): Promise<ReadbackProbe> {
    const { url, version, doFetch, probeTimeoutMs } = input;
    // `AbortController` + a timer rather than `AbortSignal.timeout`, which the
    // CLI does not use anywhere and which this file must not be the first to
    // require of a GJS host.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
    let res: Response;
    try {
        res = await doFetch(url, {
            headers: {
                // Abbreviated packument: version keys + `dist`, a fraction of the
                // bytes of the full document. `no-cache` because a CDN edge will
                // otherwise answer with a document minted BEFORE the publish we
                // are asking about — which is the whole question here.
                accept: 'application/vnd.npm.install-v1+json',
                'cache-control': 'no-cache',
                ...(input.authorization ? { authorization: input.authorization } : {}),
            },
            signal: controller.signal,
        });
    } catch (err) {
        // A real throw path: network failure, DNS, or our own abort above.
        const msg = err instanceof Error ? err.message : String(err);
        return { state: 'error', detail: `request failed (${msg})` };
    } finally {
        clearTimeout(timer);
    }

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
    const entry = versions && typeof versions === 'object' ? versions[version] : undefined;
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
    const headline =
        claim === 'already-published'
            ? `npm says ${version} is ALREADY PUBLISHED but the registry does not serve it.`
            : 'npm ACCEPTED the upload but the registry does not serve it.';
    const remedy =
        claim === 'already-published'
            ? [
                  '  A 409 is npm refusing to overwrite a version it holds, which is not the same as serving it: in',
                  '  the v0.46.0 recovery @gjsify/node-runtime-darwin-arm64 was answered 409 at 09:48:49 and the',
                  '  registry recorded 0.46.0 at 09:49:07, 18s later. Re-running answers the same 409, so it cannot',
                  '  fix this — wait and re-read (`npm view <name>@<version>`), or check https://status.npmjs.org/.',
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
        `  read-back GET ${readback.url} (accept: application/vnd.npm.install-v1+json, cache-control: no-cache)`,
        `  answered  ${readback.last.state}: ${answered}`,
        `            after ${readback.attempts} probe(s) over ${seconds}s`,
        ...remedy,
    ].join('\n');
}
