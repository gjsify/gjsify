// E2E test for `scripts/decide-next-publish.mjs` — should tonight's `next` sweep run?
//
// THE ASYMMETRY IS THE POINT, and it is not one asymmetry but two pointing opposite ways.
// The script answers three questions, and an unknown fails differently per question:
//
//   · "may I?" — did main's CI pass, is a release in flight. An unreadable answer is NOT
//     permission, so it skips. The cost of a wrong skip is bounded at one day, because
//     the schedule fires again tomorrow.
//   · "need I?" — is main's HEAD already what `next` holds. An unreadable answer must
//     read as "assume stale", so it publishes. A wrong publish costs ~35 min of runner
//     time and a version number; a wrong skip would freeze the channel for the outage.
//
// Collapsing those two into one fail direction is the defect this suite exists to catch,
// so every case below pairs the shape with its near-miss: a release run that is this very
// run, a `schedule` run of `release.yml` (which IS this channel and must not be mistaken
// for a release), a red CI run that was re-run green, a green run followed by a red re-run.
//
// WHY THE FIXTURES ARE SHAPES. The answers live in GitHub's run history and npm's
// packument, neither of which a test can arrange, so both are injected. The shape that is
// not hypothetical is the `gitHead` round-trip: it was MEASURED (2026-10-13) that an extra
// manifest field survives `gjsify pack` into `package/package.json`, and `gjsify publish`
// builds the version document from that tarball manifest — which is the whole reason the
// source SHA can be read back off the registry at all.
//
// The last describe is the WIRING half: a verdict nothing reads decides nothing, and a
// trigger that still carries the old `workflow_run` keying would make every expression in
// the job read an empty string. Both are asserted against the real `release.yml`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-next-publish/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'decide-next-publish.mjs');
const RELEASE_YML = join(MONOREPO_ROOT, '.github', 'workflows', 'release.yml');

const { nextPublishDecision, DEFAULT_PROBE_PACKAGE } = await import(pathToFileURL(SCRIPT).href);

const REPO = 'gjsify/gjsify';
const MAIN_PATH = '.github/workflows/main.yml';
const RELEASE_PATH = '.github/workflows/release.yml';

// A full 40-hex commit id, written out: the decision validates `gitHead` against
// `/^[0-9a-f]{40}$/`, so a fixture that is 39 or 41 characters long would make every
// "already current" case publish for the wrong reason and still read as green.
/** main's HEAD in most cases below, and the commit a published `next` may claim. */
const HEAD = '65775848946534b0e8dae69f758a6415aeed4530';
const OLDER = 'a'.repeat(40);
/** The run id of the `publish-next` run doing the asking. */
const SELF_RUN = '99999';

/** One `GET /actions/runs` row, with only the fields the decision reads. */
function run({ id, event, status = 'completed', conclusion = 'success', path = MAIN_PATH, headSha = HEAD }) {
    return { id, event, status, conclusion, path, head_sha: headSha };
}

/** A packument carrying a `next` dist-tag whose version records `gitHead`. */
function packumentFor(sha, { version = '0.63.1-next.42', gitHead = sha } = {}) {
    const doc = { 'dist-tags': { latest: '0.63.0', next: version }, versions: { [version]: {} } };
    if (gitHead !== null) doc.versions[version].gitHead = gitHead;
    return doc;
}

/**
 * The two seams, over a run table and a packument.
 *
 * `calls` records every path asked for, so a case can assert what was NOT fetched — the
 * release guard runs FIRST and must end the walk before any registry read happens.
 */
function fixture({ runs = [], packument = packumentFor(OLDER), fail = {} } = {}) {
    const calls = [];
    const api = async (path) => {
        calls.push(path);
        if (fail.api) throw new Error(fail.api);
        const atCommit = /^repos\/.+\/actions\/runs\?head_sha=([^&]+)/.exec(path);
        if (atCommit) return { workflow_runs: runs.filter((r) => r.head_sha === atCommit[1]) };
        const history = /^repos\/.+\/actions\/workflows\/([^/]+)\/runs\?/.exec(path);
        if (history) {
            if (fail.releaseHistory) throw new Error(fail.releaseHistory);
            return { workflow_runs: runs.filter((r) => r.path.endsWith(`/${history[1]}`)) };
        }
        throw new Error(`the fixture API was asked for an unexpected path: ${path}`);
    };
    const pack = async (name) => {
        calls.push(`packument:${name}`);
        if (fail.registry) throw new Error(fail.registry);
        return packument;
    };
    return { api, packument: pack, calls };
}

const decide = (fx, overrides = {}) =>
    nextPublishDecision({
        api: fx.api,
        packument: fx.packument,
        repo: REPO,
        sha: HEAD,
        runId: SELF_RUN,
        ...overrides,
    });

/** A green `main.yml` run on main's HEAD — the precondition most cases share. */
const GREEN_CI = [run({ id: 1, event: 'push' })];

describe('decide-next-publish: the nightly happy path', () => {
    it('publishes when main moved and its CI is green', async () => {
        const verdict = await decide(fixture({ runs: GREEN_CI }));
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /succeeded on/);
        assert.equal(verdict.publishedSha, OLDER);
    });

    it("publishes the channel's first sweep, when no `next` dist-tag exists yet", async () => {
        const verdict = await decide(
            fixture({ runs: GREEN_CI, packument: { 'dist-tags': { latest: '0.63.0' }, versions: {} } }),
        );
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /first sweep/);
    });
});

describe('decide-next-publish: is there anything new? (the `gitHead` round-trip)', () => {
    it('skips when the live `next` was built from the commit main is on', async () => {
        const verdict = await decide(fixture({ runs: GREEN_CI, packument: packumentFor(HEAD) }));
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /already current/);
        assert.equal(verdict.publishedSha, HEAD);
    });

    it('a `next` with no `gitHead` is UNKNOWN, not "unchanged" — it publishes', async () => {
        // The shape a sweep published before `--source-sha` existed leaves behind. Reading
        // it as "same commit" would freeze the channel permanently, since nothing would
        // ever publish a version that could carry a SHA.
        const verdict = await decide(
            fixture({ runs: GREEN_CI, packument: packumentFor(HEAD, { gitHead: null }) }),
        );
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /no usable .*gitHead/);
    });

    it('an abbreviated `gitHead` is refused rather than compared loosely', async () => {
        const verdict = await decide(
            fixture({ runs: GREEN_CI, packument: packumentFor(HEAD, { gitHead: HEAD.slice(0, 10) }) }),
        );
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /no usable .*gitHead/);
    });

    it('an unreachable REGISTRY publishes — a channel that cannot prove it is fresh is stale', async () => {
        const verdict = await decide(fixture({ runs: GREEN_CI, fail: { registry: 'the registry answered 503' } }));
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /registry did not answer/);
    });
});

describe('decide-next-publish: did main CI accept the commit?', () => {
    it('refuses a commit whose latest `main.yml` run concluded failure', async () => {
        const verdict = await decide(fixture({ runs: [run({ id: 2, event: 'push', conclusion: 'failure' })] }));
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /does not carry code main's CI rejected/);
    });

    it('a red run RE-RUN green reads as green — the latest completed run decides', async () => {
        // Newest-first is the order the API returns and the order this relies on.
        const runs = [run({ id: 11, event: 'push' }), run({ id: 10, event: 'push', conclusion: 'failure' })];
        const verdict = await decide(fixture({ runs }));
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /run 11/);
    });

    it('a green run followed by a red RE-RUN reads as red — the same rule, inverted', async () => {
        const runs = [run({ id: 21, event: 'push', conclusion: 'failure' }), run({ id: 20, event: 'push' })];
        const verdict = await decide(fixture({ runs }));
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /run 21/);
    });

    it('refuses while CI is still running on that commit', async () => {
        const verdict = await decide(
            fixture({ runs: [run({ id: 3, event: 'push', status: 'in_progress', conclusion: null })] }),
        );
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /still running/);
    });

    it('refuses when NO `main.yml` run exists for the commit at all', async () => {
        const verdict = await decide(fixture({ runs: [] }));
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /nothing has tested the commit/);
    });

    it("another workflow's green run on the same commit proves nothing about main.yml", async () => {
        const verdict = await decide(
            fixture({ runs: [run({ id: 4, event: 'push', path: '.github/workflows/node-gi.yml' })] }),
        );
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /no .*main\.yml.* run exists/);
    });

    it('an unreadable run history is not permission — it skips', async () => {
        const verdict = await decide(
            fixture({ runs: GREEN_CI, fail: { api: 'gh api failed: Bad credentials' } }),
        );
        assert.equal(verdict.publish, false, verdict.reason);
    });
});

describe('decide-next-publish: never publish into a release', () => {
    const inFlight = [
        ['a release event run that is queued', { event: 'release', status: 'queued', conclusion: null }],
        ['a release event run in progress', { event: 'release', status: 'in_progress', conclusion: null }],
        ['a manual recovery dispatch in progress', { event: 'workflow_dispatch', status: 'in_progress', conclusion: null }],
        ['a run waiting on an environment', { event: 'release', status: 'waiting', conclusion: null }],
    ];
    for (const [name, overrides] of inFlight) {
        it(`skips while ${name}`, async () => {
            const fx = fixture({ runs: [run({ id: 50, path: RELEASE_PATH, ...overrides }), ...GREEN_CI] });
            const verdict = await decide(fx);
            assert.equal(verdict.publish, false, verdict.reason);
            assert.match(verdict.reason, /a release always goes first/);
            assert.equal(
                fx.calls.filter((c) => c.startsWith('packument:')).length,
                0,
                'the release guard must end the walk before any registry read',
            );
        });
    }

    it('a COMPLETED release run does not block — it is finished', async () => {
        const runs = [run({ id: 51, event: 'release', path: RELEASE_PATH }), ...GREEN_CI];
        const verdict = await decide(fixture({ runs }));
        assert.equal(verdict.publish, true, verdict.reason);
    });

    it('a `schedule` run of release.yml IS this channel and must not block it', async () => {
        // The near-miss that would make the channel stand aside for itself forever: this
        // very run is an in-progress run of `release.yml`.
        const runs = [
            run({ id: 52, event: 'schedule', status: 'in_progress', conclusion: null, path: RELEASE_PATH }),
            ...GREEN_CI,
        ];
        const verdict = await decide(fixture({ runs }));
        assert.equal(verdict.publish, true, verdict.reason);
    });

    it('the run doing the asking never counts as a release in flight', async () => {
        const runs = [
            run({
                id: Number(SELF_RUN),
                event: 'workflow_dispatch',
                status: 'in_progress',
                conclusion: null,
                path: RELEASE_PATH,
            }),
            ...GREEN_CI,
        ];
        const verdict = await decide(fixture({ runs }));
        assert.equal(verdict.publish, true, verdict.reason);
    });

    it('an unreadable release history is not permission — it skips', async () => {
        const verdict = await decide(
            fixture({ runs: GREEN_CI, fail: { releaseHistory: 'gh api failed: 502' } }),
        );
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /standing aside/);
    });
});

describe('decide-next-publish: what `--force` may and may not override', () => {
    it('publishes an unchanged commit — the urgent case the nightly cadence needs rescuing from', async () => {
        const verdict = await decide(fixture({ runs: GREEN_CI, packument: packumentFor(HEAD) }), { force: true });
        assert.equal(verdict.publish, true, verdict.reason);
        assert.match(verdict.reason, /--force/);
    });

    it('publishes a commit whose CI is red', async () => {
        const runs = [run({ id: 60, event: 'push', conclusion: 'failure' })];
        const verdict = await decide(fixture({ runs }), { force: true });
        assert.equal(verdict.publish, true, verdict.reason);
    });

    it('does NOT override a release in flight — nothing manual is that urgent', async () => {
        const runs = [
            run({ id: 61, event: 'release', status: 'in_progress', conclusion: null, path: RELEASE_PATH }),
            ...GREEN_CI,
        ];
        const verdict = await decide(fixture({ runs }), { force: true });
        assert.equal(verdict.publish, false, verdict.reason);
        assert.match(verdict.reason, /a release always goes first/);
    });
});

describe('the wiring in release.yml', () => {
    const TEXT = readFileSync(RELEASE_YML, 'utf8');
    const LINES = TEXT.split('\n');

    /** A job's body: every line indented deeper than its `  <name>:` key. */
    function jobBody(name) {
        const at = LINES.findIndex((l) => l === `  ${name}:`);
        assert.ok(at >= 0, `release.yml has no \`${name}\` job`);
        const body = [];
        for (const line of LINES.slice(at + 1)) {
            if (/^ {0,2}\S/.test(line)) break;
            body.push(line);
        }
        return body;
    }

    const NEXT = () => jobBody('publish-next');

    it('the trigger is a nightly schedule at 03:00 Europe/Berlin, declared as a timezone', () => {
        // Not two UTC crons with a `TZ=… date +%H` guard: `timezone` is supported on
        // `on.schedule` (workflow-syntax reference), so the DST shift is GitHub's problem
        // rather than a shell condition that silently skips an hour twice a year.
        const on = TEXT.slice(TEXT.indexOf('\non:'), TEXT.indexOf('\nconcurrency:'));
        assert.match(on, /schedule:/, 'the `next` channel runs on a schedule');
        assert.match(on, /- cron: '0 3 \* \* \*'/);
        assert.match(on, /timezone: Europe\/Berlin/);
        assert.doesNotMatch(on, /workflow_run:/, 'the per-merge `workflow_run` trigger is gone');
    });

    it('a manual dispatch can ask for a next publish without touching the release path', () => {
        const on = TEXT.slice(TEXT.indexOf('\non:'), TEXT.indexOf('\nconcurrency:'));
        assert.match(on, /publish_next:/, 'the dispatch needs an input that selects the next channel');
    });

    it('`next` and the release pipeline sit in DIFFERENT concurrency groups', () => {
        // GitHub keeps one PENDING run per group and cancels the older pending one, so a
        // shared group would let a `next` run EVICT a queued recovery run.
        const group = LINES.find((l) => /^ {2}group: /.test(l));
        assert.match(group, /release-npm-next/);
        assert.match(group, /release-npm-publish/);
        assert.ok(
            LINES.some((l) => /^ {2}cancel-in-progress: false$/.test(l)),
            'a cancelled publishing run leaves a partial release',
        );
    });

    it('the release jobs skip on the next channel events, and nothing reads a null `inputs`', () => {
        // On `schedule`, `inputs` is null and `inputs.skip_publish == false` evaluates
        // null == false → TRUE. Every release gate spelled that way would FIRE: a full
        // `latest` publish of main's HEAD, nightly. The explicit event guard is the fix.
        for (const job of ['publish', 'verify-release-closure']) {
            const gate = jobBody(job).find((l) => /^ {4}if: /.test(l));
            assert.ok(gate, `${job} must carry an explicit event guard`);
            assert.match(gate, /github\.event_name != 'schedule'/, `${job} must not run on the nightly`);
            assert.doesNotMatch(gate, /workflow_run/, `${job}'s guard still names the removed trigger`);
        }
    });

    it('publish-next runs the decision, and every publishing step waits for its verdict', () => {
        const body = NEXT();
        assert.ok(
            body.some((l) => /node scripts\/decide-next-publish\.mjs/.test(l)),
            'the job must invoke the decision this suite tests',
        );
        assert.ok(
            body.some((l) => /^ {6}actions: read$/.test(l)),
            'the run-record queries need `actions: read` on GITHUB_TOKEN',
        );
        const publishStep = body.findIndex((l) => /gjsify run npm:publish:next/.test(l));
        assert.ok(publishStep >= 0, 'the sweep step must exist');
        const guards = body.filter((l) => /^ {8}if: /.test(l));
        assert.ok(
            guards.every((l) => /steps\.decide\.outputs\.publish == 'true'|always\(\)/.test(l)),
            'every gated step keys on the verdict (or is an always() reporter)',
        );
    });

    it('the verdict is published on an explicit `true`, never on an unset output', async () => {
        const body = NEXT().join('\n');
        assert.match(
            body,
            /steps\.decide\.outputs\.publish == 'true'/,
            'a crashed decision leaves the output empty, which must not read as permission',
        );
    });

    it('the checkout and the summary name main, not the removed `workflow_run` payload', () => {
        const body = NEXT().join('\n');
        // EXPRESSIONS only, not the word: `github.event.workflow_run.head_sha` now
        // evaluates to the empty string on both of this job's events, which would check
        // out the wrong ref and print a summary claiming the sweep came from nowhere. The
        // comments that say why the ref changed are the reason the old shape does not
        // come back, so they are not what this forbids.
        assert.doesNotMatch(body, /\$\{\{[^}]*workflow_run/, 'a `workflow_run` expression would read empty now');
        assert.match(body, /ref: \$\{\{ github\.sha \}\}/, 'a scheduled run checks out the default branch head');
    });

    it('the recorded source SHA is what the decision reads back, so both name one commit', () => {
        const body = NEXT().join('\n');
        assert.match(body, /--source-sha/, 'the sweep must record the commit it was built from');
        assert.match(
            body,
            /next-channel-version\.mjs --write/,
            'the rewrite is what carries the version and the SHA into the tarballs',
        );
    });

    it('the probe package the decision reads is one the sweep actually publishes', () => {
        // A probe on a package the sweep skips would answer for a version that never moves.
        const manifest = JSON.parse(readFileSync(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'package.json'), 'utf8'));
        assert.equal(manifest.name, DEFAULT_PROBE_PACKAGE);
        assert.notEqual(manifest.private, true, 'the probe package must be published');
    });
});
