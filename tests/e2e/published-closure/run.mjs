// E2E for `scripts/verify-published-closure.mjs` — the post-release assertion
// that what npm now serves is internally consistent.
//
// The guard's whole reason for existing is that a partial publish sweep can be
// WORSE than no publish: pack time rewrites `workspace:*` to the exact released
// version, and npm skips an unresolvable `optionalDependency` in silence, so a
// bridge published before its platform children installs cleanly with no binary
// behind it. This suite drives the script against a LOCAL fake registry so both
// halves are exercised for real: the finding, and — the part that matters more —
// the refusal to report success when the check examined nothing.
//
// The fake registry is a plain http server serving abbreviated packuments
// (`{name, versions}`), which is exactly what the script asks npm for. Its
// contents are a mutable per-case map, so "published" and "never published" are
// the same code path with different data.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockRegistry } from '../mock-registry.mjs';

const SCRIPT = fileURLToPath(new URL('../../../scripts/verify-published-closure.mjs', import.meta.url));
const VERSION = '1.2.3';

function runScript(args, { timeoutMs = 30_000, env: extraEnv } = {}) {
    // GITHUB_STEP_SUMMARY is stripped unless a case sets it deliberately. A
    // suite must not append to the enclosing job's summary — and inheriting it
    // is how the real defect surfaced: under the ci-fedora container that file
    // belongs to the runner user, the child EACCES'd on it, and four fixtures
    // that had verified their closure perfectly went red on a reporting write.
    //
    // GITHUB_ACTIONS goes the same way, for the same reason one level up: under
    // it the script emits `::error::` / `::warning::` workflow commands, so the
    // NEGATIVE cases below — every one of which is a pass when it fails — would
    // decorate the enclosing job with a dozen red annotations about fixtures.
    // Stripping it also makes the message prefixes deterministic locally and in
    // CI. The one case that asserts the annotation sets it deliberately.
    const env = { ...process.env, ...extraEnv };
    if (!extraEnv || !('GITHUB_STEP_SUMMARY' in extraEnv)) delete env.GITHUB_STEP_SUMMARY;
    if (!extraEnv || !('GITHUB_ACTIONS' in extraEnv)) delete env.GITHUB_ACTIONS;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => {
            stdout += c;
        });
        child.stderr.on('data', (c) => {
            stderr += c;
        });
        const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr, out: stdout + stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

/**
 * Write a fixture monorepo.
 *
 * @param root Directory to write into.
 * @param pkgs `{ name, version?, private?, deps?, optionalDeps? }[]`
 * @param pending Entries for `status/pending-npm-bootstrap.json`, or `undefined`
 *   to write no ledger at all. The script reads that file `--root`-relative
 *   precisely so the declared-gap rules are exercisable here rather than only on a
 *   real cut, and so a fixture can hold a ledger state the repository never will.
 */
function writeTree(root, pkgs, pending) {
    writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'closure-fixture', version: VERSION, private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    if (pending) {
        mkdirSync(join(root, 'status'), { recursive: true });
        writeFileSync(join(root, 'status', 'pending-npm-bootstrap.json'), `${JSON.stringify({ pending }, null, 4)}\n`);
    }
    for (const p of pkgs) {
        const dir = join(root, 'packages', p.name.replace(/^@[^/]+\//, ''));
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            `${JSON.stringify(
                {
                    name: p.name,
                    version: p.version ?? VERSION,
                    ...(p.private ? { private: true } : {}),
                    ...(p.deps ? { dependencies: p.deps } : {}),
                    ...(p.optionalDeps ? { optionalDependencies: p.optionalDeps } : {}),
                },
                null,
                2,
            )}\n`,
        );
    }
}

describe('verify-published-closure (post-release registry assertion)', { timeout: 120_000 }, () => {
    let registry, registryUrl, tmp;
    /** name → string[] of published versions. Missing name = 404. */
    let published = new Map();
    /** name → number of packument requests served (for the retry case). */
    let hits = new Map();
    /** Names the registry answers 5xx for — "we do not know", not "absent". */
    let broken = new Set();
    /**
     * name → the request number from which the version becomes visible. Models
     * CDN propagation by REQUEST COUNT rather than by a timer: a wall-clock
     * fixture would race child-process startup on a loaded runner and flake in
     * both directions (revealing too early → no retry to assert; too late →
     * attempts exhausted).
     */
    let revealAfter = new Map();

    before(async () => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-closure-'));
        // Everything goes through `onRequest` rather than the shared module's
        // fixture store: what each case publishes is MUTATED between cases
        // (`published`, `broken`, `revealAfter` are reassigned per `it`), and a
        // store fixed at construction cannot express that. The shared module is
        // still what owns the socket and the teardown.
        registry = await startMockRegistry(
            {},
            {
                onRequest: (req, res) => {
                    const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0]);
                    hits.set(name, (hits.get(name) ?? 0) + 1);
                    if (broken.has(name)) {
                        res.writeHead(503, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Service Unavailable' }));
                        return true;
                    }
                    const hidden = revealAfter.has(name) && hits.get(name) < revealAfter.get(name);
                    const versions = hidden ? undefined : published.get(name);
                    if (!versions) {
                        res.writeHead(404, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Not found' }));
                        return true;
                    }
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            name,
                            versions: Object.fromEntries(versions.map((v) => [v, { name, version: v }])),
                        }),
                    );
                    return true;
                },
            },
        );
        // `verify-published-closure.mjs` strips a trailing slash itself, so the
        // shared module's `url` needs no adjustment.
        registryUrl = registry.url;
    });

    after(async () => {
        await registry?.close();
        if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    const fixture = (label, pkgs, pending) => {
        const root = join(tmp, label);
        mkdirSync(root, { recursive: true });
        writeTree(root, pkgs, pending);
        return root;
    };

    // A bridge + two platform children (`workspace:*`, i.e. exact-pinned at pack
    // time) + an ordinary library dep — the shape of every split native bridge.
    const splitBridge = [
        { name: '@fix/util' },
        {
            name: '@fix/bridge',
            deps: { '@fix/util': 'workspace:^' },
            optionalDeps: { '@fix/bridge-linux-x64': 'workspace:*', '@fix/bridge-darwin-arm64': 'workspace:*' },
        },
        { name: '@fix/bridge-linux-x64' },
        { name: '@fix/bridge-darwin-arm64' },
    ];

    it('a COMPLETE release passes and reports positive counts', async () => {
        const root = fixture('complete', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `expected a clean pass:\n${r.out}`);
        assert.match(r.stdout, /live on the registry at 1\.2\.3:\s+4/);
        // 2 optionalDependencies + 1 dependencies = 3 pinned edges examined.
        assert.match(
            r.stdout,
            /release-pinned intra-repo edges examined:\s+3 \(2 optionalDependencies, 1 dependencies\)/,
        );
        assert.match(r.stdout, /Every one of 3 release-pinned dependency edge\(s\)/);
    });

    it('an unwritable step summary cannot change the verdict', async () => {
        // The report is a courtesy; `problems` is the verdict. The write happens
        // AFTER the closure is computed and BEFORE the exit, so a throw there
        // turned "every edge resolves" into exit 1 — a reporting side-channel
        // fabricating a finding, which is the same class of defect as everything
        // else this guard exists to remove. Both directions are pinned: a clean
        // tree must still exit 0, and the missing summary must be SAID.
        const root = fixture('summary-unwritable', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1'], {
            // A directory that does not exist → ENOENT on append, deterministically
            // and without needing a permission-restricted path.
            env: { GITHUB_STEP_SUMMARY: join(tmp, 'no-such-dir', 'summary.md') },
        });
        assert.equal(r.status, 0, `a failed summary write must not change the verdict:\n${r.out}`);
        assert.match(r.out, /WARNING: could not write the GitHub step summary/);
        assert.match(r.out, /The verdict below is unaffected/);
        assert.match(r.stdout, /Every one of 3 release-pinned dependency edge\(s\)/);
    });

    it('the step summary IS written when the path is usable', async () => {
        const root = fixture('summary-ok', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const summary = join(root, 'summary.md');
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1'], {
            env: { GITHUB_STEP_SUMMARY: summary },
        });
        assert.equal(r.status, 0, `expected a clean pass:\n${r.out}`);
        // Tolerating a write failure must not become tolerating never writing.
        const written = readFileSync(summary, 'utf8');
        assert.match(written, /## Published dependency closure/);
        assert.match(written, /\| Pinned edges examined \| 3 \|/);
        // The verdict in words, so the table cannot be misread by someone who
        // does not know which of those counts is supposed to be zero.
        assert.match(written, /\| Verdict \| \*\*OK\*\* — all 3 examined edge\(s\) resolve \|/);
        assert.doesNotMatch(r.out, /WARNING: could not write/);
    });

    it('an INCOMPLETE release fails in the SUMMARY, naming the package', async () => {
        // TWO REGRESSIONS IN ONE CASE.
        //
        // The roster (#1056): this used to be the state the script deliberately let
        // pass — "a prefix published, no live pinned parent" is what an ordered,
        // fail-fast sweep looks like when it aborts, and nothing on npm points at
        // anything missing. That tolerance rested on the aborted sweep being
        // ALREADY RED elsewhere, which stopped being true when ADR 0017 gave napi,
        // node-gi and the GTK bundles their own publish jobs: a SKIPPED job leaves a
        // package behind while the sweep stays green. v0.31.0 shipped @gjsify/napi
        // at 0.30.0 through exactly that hole, under a green verify-release-closure.
        //
        // The channel: whatever the script thinks is worth saying must be visible in
        // the artifact a human opens. The honest sentence once went to stdout ONLY,
        // so the rendered summary read `Pinned edges examined | 0` with no alert
        // under a green check — a missing signal reading as a pass, the exact class
        // this guard exists to remove, recurring inside the guard.
        const root = fixture('prefix-summary', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const summary = join(root, 'summary.md');
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1'], {
            // GITHUB_ACTIONS on purpose: the annotation is the one channel that
            // survives an unwritable summary, and it renders NEXT TO the check.
            env: { GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: 'true' },
        });
        assert.notEqual(r.status, 0, `an incomplete release must not pass:\n${r.out}`);
        const written = readFileSync(summary, 'utf8');
        // The finding is the NAMED package, never "the enumeration broke".
        assert.match(written, /> \[!CAUTION\]\n> 1 of \d+ package\(s\) this train meant to publish are NOT on/);
        assert.match(written, /@fix\/bridge/);
        assert.match(written, /\| Verdict \| \*\*FAILED\*\*/);
        // The alert must be ABOVE the table: a reader who stops at the first
        // numbers has already been told.
        assert.ok(
            written.indexOf('[!CAUTION]') < written.indexOf('| Fact | Value |'),
            `the alert must precede the table:\n${written}`,
        );
        assert.doesNotMatch(written, /Every one of/);
    });

    it('a bridge published WITHOUT one platform child FAILS and names it', async () => {
        // The measured hazard: parent live, exact-pinned optional child absent.
        // npm would install this in silence.
        const root = fixture('missing-child', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `a dangling optionalDependency must fail:\n${r.out}`);
        assert.match(
            r.out,
            /UNRESOLVABLE: @fix\/bridge@1\.2\.3 → optionalDependencies\.@fix\/bridge-darwin-arm64@1\.2\.3/,
        );
        assert.match(r.out, /skips an unresolvable optionalDependency in SILENCE/);
        assert.match(r.out, /--tolerate-republish/);
        // The intact sibling must NOT be reported — a guard that names everything
        // names nothing.
        assert.doesNotMatch(r.out, /UNRESOLVABLE: .*bridge-linux-x64/);
    });

    it('a missing package with NO published dependent still fails the ROSTER', async () => {
        // The edge check is right to find nothing here — no live package points at
        // the absent one, so the closure genuinely is intact. That is precisely why
        // the roster is a SECOND question: @gjsify/napi has no incoming manifest
        // edge anywhere in this repository, so an edge-only check could never have
        // reported it missing, and did not.
        const root = fixture('prefix', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `a package the train meant to publish is missing:\n${r.out}`);
        assert.match(r.stdout, /absent at 1\.2\.3 \(1\): @fix\/bridge/);
        assert.match(r.out, /this train meant to publish are NOT on/);
        assert.match(r.out, /--tolerate-republish/);
        // It must not claim an UNRESOLVABLE edge: there is none, and naming one
        // would send the reader after a dangling pin that does not exist.
        assert.doesNotMatch(r.out, /UNRESOLVABLE:/);
        assert.doesNotMatch(r.out, /Every one of/);
    });

    it('a release that published NOTHING fails instead of passing empty', async () => {
        // The whole lesson: zero verified packages is zero evidence. An exit 0
        // here would read as "the closure is fine".
        const root = fixture('nothing', splitBridge);
        published = new Map([['@fix/util', ['0.0.1']]]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `an empty result must not exit 0:\n${r.out}`);
        assert.match(r.out, /this release published\s+NOTHING/);
        assert.match(r.out, /must not report success/);
    });

    it('a tree that declares NO pinned edge fails, however green the registry', async () => {
        // The edge enumeration is the load-bearing half, and its emptiness is a
        // property of the MANIFESTS — so it stays a failure even when every
        // package published perfectly. If a refactor ever stops the enumeration
        // seeing the platform-sibling edges, every future release would otherwise
        // pass on an empty set and look checked.
        const root = fixture('no-edges', [{ name: '@fix/alone' }, { name: '@fix/lonely' }]);
        published = new Map([
            ['@fix/alone', [VERSION]],
            ['@fix/lonely', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `no subject matter must not exit 0:\n${r.out}`);
        assert.match(r.out, /declares NO release-pinned intra-repo dependency at all/);
        // …and ONLY that. The examination-filter assertion also fired here, since
        // 0 declared edges and 0 examined satisfied it — announcing "those three
        // facts cannot all be true" about the one arrangement in which they can,
        // and sending the next reader after a bug that does not exist. A guard
        // whose second sentence is false costs the attention its first one asked
        // for.
        assert.doesNotMatch(r.out, /the examination filter is broken/);
        assert.equal(r.stderr.match(/^ERROR: /gm)?.length, 1, `exactly one problem should be reported here:\n${r.out}`);
    });

    it('an UNANSWERED probe is "unknown", never reported as missing', async () => {
        // A 5xx/timeout on one platform package must not be laundered into a
        // fabricated "never published" verdict on a release that is intact. The
        // three probe states are distinct: live, confirmed-absent (404), unknown.
        // The job still fails — no evidence is not a pass — but for the right
        // reason, and without naming a package that may be perfectly fine.
        const root = fixture('probe-error', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        broken = new Set(['@fix/bridge-darwin-arm64']);
        try {
            const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
            assert.notEqual(r.status, 0, `an unanswered probe is not evidence of a pass:\n${r.out}`);
            assert.match(r.out, /probe failed: @fix\/bridge-darwin-arm64 — Error: 503/);
            assert.match(r.out, /never produced an answer/);
            // The bug this case pins: `!isLive(target)` would have called it a
            // dangling optionalDependency.
            assert.doesNotMatch(r.out, /UNRESOLVABLE/);
            assert.doesNotMatch(r.out, /absent at 1\.2\.3/);
        } finally {
            broken = new Set();
        }
    });

    it('a spec shape it cannot decide FAILS rather than skipping quietly', async () => {
        const root = fixture('unclassified', [
            { name: '@fix/util' },
            { name: '@fix/app', deps: { '@fix/util': '>=0.0.1 <9' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `an undecidable spec must not be a silent skip:\n${r.out}`);
        assert.match(r.out, /UNDECIDABLE EDGE: @fix\/app@1\.2\.3 → dependencies\.@fix\/util = ">=0\.0\.1 <9"/);
        assert.match(r.out, /not the release version 1\.2\.3/);
    });

    // ── the enumeration may drop EXACTLY ONE shape ───────────────────────────
    // A target that is not a package of this repository at all. Everything else
    // in-repo is decided, and an undecidable edge FAILS with the target named.
    // The two cases below are the shapes a `!candidateByName.has(to)` skip used
    // to swallow — measured, both exiting 0 on "Every one of 1 release-pinned
    // dependency edge(s) across 2 published package(s) resolves". Each fixture
    // carries a LEGITIMATE pinned edge (`@fix/util`) alongside the bad one, so
    // the tree-declares-no-edge assertion cannot be what fails and mask the
    // finding — that is precisely how the drop stayed invisible.

    it('an in-repo target left on a DIFFERENT version fails, and is named', async () => {
        // In-repo version skew behind a LITERAL exact pin — how `@gjsify/napi`
        // spells its two platform edges, so this is the shape most at risk. The
        // parent pins the release version of a sibling whose own manifest is a
        // patch behind, so nothing will ever publish that sibling at the pinned
        // version. Decided from the MANIFESTS, with no probe involved: it fails
        // the same way on a complete release, a partial one, and a dry tree.
        const root = fixture('version-skew', [
            { name: '@fix/util' },
            {
                name: '@fix/napi',
                deps: { '@fix/util': 'workspace:^' },
                optionalDeps: { '@fix/napi-darwin-arm64': VERSION },
            },
            { name: '@fix/napi-darwin-arm64', version: '1.2.2' },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/napi', [VERSION]],
            ['@fix/napi-darwin-arm64', ['1.2.2']],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `a pin at a version nothing will publish must fail:\n${r.out}`);
        assert.match(
            r.out,
            /UNDECIDABLE EDGE: @fix\/napi@1\.2\.3 → optionalDependencies\.@fix\/napi-darwin-arm64 = "1\.2\.3"/,
        );
        assert.match(r.out, /own manifest is at 1\.2\.2/);
        // It must not read as a verified closure just because the OTHER edge did.
        assert.doesNotMatch(r.out, /Every one of/);
    });

    it('a published package pinning a `private` sibling fails, and is named', async () => {
        // `resolveWorkspaceProtocol` rewrites `workspace:^` to the target's
        // version whether or not the target is publishable, so this pin is dead
        // on arrival — npm resolves the NAME against the public registry, where
        // it is either absent or somebody else's package. This shape had NO
        // mitigation anywhere else in the repo.
        const root = fixture('private-target', [
            { name: '@fix/util' },
            { name: '@fix/secret', private: true },
            { name: '@fix/app', deps: { '@fix/util': 'workspace:^', '@fix/secret': 'workspace:^' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `a pin on a package no release publishes must fail:\n${r.out}`);
        assert.match(r.out, /UNDECIDABLE EDGE: @fix\/app@1\.2\.3 → dependencies\.@fix\/secret = "workspace:\^"/);
        assert.match(r.out, /the target is a `private` package/);
        assert.doesNotMatch(r.out, /Every one of/);
    });

    it('an edge into a package outside this repo is the one legitimate drop', async () => {
        // The counterweight to the two cases above: widening the enumeration must
        // not turn every external dependency into a finding. `left-pad` is not
        // this release's to publish or pin, so it is the registry's problem.
        const root = fixture('external', [
            { name: '@fix/util' },
            { name: '@fix/app', deps: { '@fix/util': 'workspace:^', 'left-pad': '^1.3.0' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `an external dependency must not be a finding:\n${r.out}`);
        assert.doesNotMatch(r.out, /left-pad/);
        assert.match(r.stdout, /Every one of 1 release-pinned dependency edge\(s\)/);
    });

    it('a registry that has not propagated yet is retried, not failed', async () => {
        // npm's CDN can answer with a packument minted before the publish. A false
        // red at release time costs a manual re-run of a workflow that did its job,
        // so absence is re-queried before it becomes a verdict.
        const root = fixture('propagation', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        hits = new Map();
        // Published, but the registry hides it until the SECOND request for that
        // name — so round 1 must 404 and round 2 must find it, deterministically.
        revealAfter = new Map([['@fix/bridge-darwin-arm64', 2]]);
        try {
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '4',
                '--retry-delay-ms',
                '50',
            ]);
            assert.equal(r.status, 0, `a late-propagating version must pass on a later round:\n${r.out}`);
            assert.match(r.stdout, /round 2\/4 — re-querying 1 unresolved name\(s\)/);
            // Only the ABSENT name is re-queried; a present version never becomes
            // absent, so re-asking for it would be wasted round trips.
            assert.equal(hits.get('@fix/bridge'), 1, 'a package already found live must not be re-queried');
            assert.equal(hits.get('@fix/bridge-darwin-arm64'), 2, 'the absent name must be re-queried exactly once');
        } finally {
            revealAfter = new Map();
        }
    });

    it('private packages are out of scope entirely', async () => {
        const root = fixture('private', [
            { name: '@fix/util' },
            { name: '@fix/secret', private: true, optionalDeps: { '@fix/util': 'workspace:*' } },
            { name: '@fix/app', deps: { '@fix/util': 'workspace:^' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `a private package is never published, so it has no closure:\n${r.out}`);
        assert.match(r.stdout, /candidate packages \(non-private, on the train\): 2/);
    });

    // ── `--phase pre-release`: the same enumeration, one round earlier ───────
    //
    // The post-release job reports at the END of `release.yml`, after the tag and
    // the release record, which `status/sections/priorities.md` § 2 calls out as
    // reading identically to a check that passed. #1494 added two brand-new npm
    // names and nothing in the tree asked for their manual bootstrap; the only
    // thing carrying the requirement was a paragraph in a pull-request body.
    //
    // Running the post-release ASSERTIONS on a pull request was drafted and refuted
    // with measurements (#1500), so what these cases pin is that the phase selects
    // the assertions and not the wording: the registry predicate relaxes from "this
    // exact version" to "the NAME exists", and the declared-gap ledger keeps
    // `docs/publishing.md`'s "or queued as the next maintainer action" branch alive.
    describe('--phase pre-release', () => {
        // The brand-new pair of the actual incident: a bridge and its platform
        // target, neither of them ever published.
        const withNewPair = [
            ...splitBridge,
            { name: '@fix/fresh', optionalDeps: { '@fix/fresh-win32-x64': 'workspace:*' } },
            { name: '@fix/fresh-win32-x64' },
        ];
        /** Everything in `splitBridge`, at a version OLDER than the tree's. */
        const olderThanTree = () =>
            new Map([
                ['@fix/util', ['0.0.1']],
                ['@fix/bridge', ['0.0.1']],
                ['@fix/bridge-linux-x64', ['0.0.1']],
                ['@fix/bridge-darwin-arm64', ['0.0.1']],
            ]);

        it('the PHASE selects the assertions: one tree, two verdicts', async () => {
            // The discriminator, and #1500's disqualifying consequence proven fixed.
            // Every name exists but NONE is at the tree's version — which is the
            // state of `main` for the whole duration of every release cut, since
            // `.release-it.json` puts the version-bump commit on `main` before the
            // sweep runs. Asking "live at package.json's version" there red-lines a
            // REQUIRED check on `main` and on every open PR; asking "does the name
            // exist" is an answer that does not move when the train moves.
            const root = fixture('phase-ab', splitBridge);
            published = olderThanTree();
            const pre = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.equal(pre.status, 0, `the bootstrap question must not move with the train:\n${pre.out}`);
            assert.match(pre.stdout, /existing on the registry \(any version\):\s+4/);
            assert.match(pre.stdout, /Every one of 4 publishable name\(s\) exists on npm/);

            const post = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
            assert.notEqual(post.status, 0, `the release question must still be asked, and answered no:\n${post.out}`);
            assert.match(post.out, /this release published\s+NOTHING/);
        });

        it('the #1494 shape — a brand-new PAIR — fires ONCE, from the roster', async () => {
            // `violations()` requires `isLive(e.from)`, and a bridge that has never
            // been published is not live, so the edge arm is silent here BY
            // CONSTRUCTION. A red-proof that does not separate this from the case
            // below is measuring the wrong shape: it would credit the edge check for
            // a finding only the roster made.
            const root = fixture('fresh-pair', withNewPair);
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
                ['@fix/bridge-darwin-arm64', [VERSION]],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `an unbootstrapped new name must not pass:\n${r.out}`);
            assert.match(r.out, /2 of 6 publishable name\(s\) do not exist on .* and nothing declares that/);
            assert.match(r.out, /@fix\/fresh, @fix\/fresh-win32-x64/);
            // The remediation a contributor can actually take. Never the other one.
            assert.match(r.out, /status\/pending-npm-bootstrap\.json/);
            assert.doesNotMatch(r.out, /--tolerate-republish/);
            assert.doesNotMatch(r.out, /UNRESOLVABLE/);
            assert.equal(r.stderr.match(/^ERROR: /gm)?.length, 1, `exactly one problem belongs here:\n${r.out}`);
        });

        it('a LIVE bridge with a brand-new target fires TWICE', async () => {
            // The other half of the pair above: here the edge arm does have a live
            // parent, so the roster names the absent package AND the closure names
            // the pin that will resolve to nothing.
            const root = fixture('fresh-target', splitBridge);
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `a pin at a name that does not exist must fail:\n${r.out}`);
            assert.match(
                r.out,
                /UNRESOLVABLE: @fix\/bridge → optionalDependencies\.@fix\/bridge-darwin-arm64 does NOT exist/,
            );
            assert.match(r.out, /do not exist on .* and nothing declares that/);
            assert.equal(r.stderr.match(/^ERROR: /gm)?.length, 2, `both arms should report here:\n${r.out}`);
        });

        it('a DECLARED gap passes, and is stated where it cannot be missed', async () => {
            // `docs/publishing.md` states the policy as "the bootstrap is done before
            // merge OR QUEUED as the next maintainer action". A required gate with no
            // escape hatch deletes the second branch, and the only remedy needs a
            // publish credential plus an OTP that CI does not have — so the
            // contributor would get a check they structurally cannot make green.
            const root = fixture('declared', withNewPair, {
                '@fix/fresh': 'queued: publish + trust before the next cut',
                '@fix/fresh-win32-x64': 'queued: publish BEFORE the bridge',
            });
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
                ['@fix/bridge-darwin-arm64', [VERSION]],
            ]);
            const summary = join(root, 'summary.md');
            const r = await runScript(
                ['--root', root, '--registry', registryUrl, '--attempts', '1', '--phase', 'pre-release'],
                { env: { GITHUB_STEP_SUMMARY: summary } },
            );
            assert.equal(r.status, 0, `a declared gap is a queued action, not a finding:\n${r.out}`);
            // Declared is not the same as quiet: the entry costs a WARNING on every
            // run, and the next release is red on it.
            assert.match(r.out, /WARNING: 2 name\(s\) are declared pending bootstrap/);
            assert.match(r.out, /the post-release phase ignores this ledger deliberately/);
            assert.match(r.stdout, /pending: @fix\/fresh — queued: publish \+ trust before the next cut/);
            const written = readFileSync(summary, 'utf8');
            assert.match(written, /## Pre-release npm bootstrap/);
            assert.match(written, /> \[!WARNING\]/);
            assert.match(written, /\| Declared pending bootstrap \| 2 \|/);
            assert.match(written, /\| Verdict \| \*\*OK\*\*/);
        });

        it('a declared TARGET of a live bridge also names the silent consequence', async () => {
            const root = fixture('declared-target', splitBridge, {
                '@fix/bridge-darwin-arm64': 'queued: the darwin leg is bootstrapped next',
            });
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.equal(r.status, 0, `a declared gap is not a finding:\n${r.out}`);
            // The declaration says the absence is known; this says what it COSTS,
            // which is the part npm never reports.
            assert.match(r.out, /1 release-pinned edge\(s\) point at a name declared pending bootstrap/);
            assert.match(r.out, /@fix\/bridge → optionalDependencies\.@fix\/bridge-darwin-arm64/);
        });

        it('the ledger is BIDIRECTIONAL: a declared name that IS published fails', async () => {
            // The arm that keeps the ledger from rotting into a permanent exemption,
            // and the measured hole it closes: an earlier draft looped only over two
            // package families, so a declared-and-published name outside them was
            // never re-examined and passed with exit 0 forever (#1500). This reader
            // enumerates the whole tree, so every entry is held against it.
            const root = fixture('ledger-stale', splitBridge, {
                '@fix/bridge-darwin-arm64': 'queued: stale, this one went live already',
            });
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
                ['@fix/bridge-darwin-arm64', [VERSION]],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `a finished bootstrap must not stay declared:\n${r.out}`);
            assert.match(r.out, /still lists @fix\/bridge-darwin-arm64, which IS on/);
            assert.match(r.out, /delete the entry/);
        });

        it('a ledger entry naming a package this repo does not contain fails', async () => {
            const root = fixture('ledger-foreign', splitBridge, { '@fix/never-existed': 'queued: typo' });
            published = olderThanTree();
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `an entry nothing can ever clear must fail:\n${r.out}`);
            assert.match(r.out, /lists @fix\/never-existed, which this repository does not contain/);
        });

        it('a ledger entry naming an UNPUBLISHABLE package fails', async () => {
            // "Not published yet" about a `private` package is a category error, not a
            // queued action: no release will ever publish it, so the entry would sit
            // forever — which is the exemption this ledger is shaped to refuse.
            const root = fixture('ledger-private', [...splitBridge, { name: '@fix/internal', private: true }], {
                '@fix/internal': 'queued: bootstrap the internal helper',
            });
            published = olderThanTree();
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `a pending entry on a package no release publishes must fail:\n${r.out}`);
            assert.match(r.out, /which this repository contains but no release publishes/);
            assert.match(r.out, /category error/);
        });

        it('a ledger entry with an empty reason fails', async () => {
            const root = fixture('ledger-reasonless', withNewPair, {
                '@fix/fresh': '',
                '@fix/fresh-win32-x64': 'queued: publish BEFORE the bridge',
            });
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
                ['@fix/bridge-darwin-arm64', [VERSION]],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `an entry with no queued action is an exemption:\n${r.out}`);
            assert.match(r.out, /lists @fix\/fresh with an empty reason/);
        });

        it('POST-release ignores the ledger — a release declares no gap of its own', async () => {
            // The escalation that makes the pre-release pass safe: pre-release says
            // "queued", post-release says "you shipped it". If the ledger silenced
            // both, a declared entry would turn into an indefinite licence to publish
            // a bridge with nothing behind it.
            const root = fixture('ledger-post', splitBridge, {
                '@fix/bridge-darwin-arm64': 'queued: not bootstrapped yet',
            });
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/bridge', [VERSION]],
                ['@fix/bridge-linux-x64', [VERSION]],
            ]);
            const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
            assert.notEqual(r.status, 0, `a shipped release does not get to declare its own gap:\n${r.out}`);
            assert.match(r.out, /UNRESOLVABLE: @fix\/bridge@1\.2\.3 → optionalDependencies\.@fix\/bridge-darwin-arm64/);
        });

        it('a MANIFEST-decided defect is red in the pre-release phase too', async () => {
            // The version-skewed literal pin — how `@gjsify/napi` spells its platform
            // edges, maintained by `@release-it/bumper`. Decided from the manifests
            // with no probe involved, so it must fail identically in both phases; a
            // phase that only relaxed the registry predicate must not have relaxed
            // this by accident.
            const root = fixture('pre-skew', [
                { name: '@fix/util' },
                {
                    name: '@fix/napi',
                    deps: { '@fix/util': 'workspace:^' },
                    optionalDeps: { '@fix/napi-darwin-arm64': VERSION },
                },
                { name: '@fix/napi-darwin-arm64', version: '1.2.2' },
            ]);
            published = new Map([
                ['@fix/util', [VERSION]],
                ['@fix/napi', [VERSION]],
                ['@fix/napi-darwin-arm64', ['1.2.2']],
            ]);
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `a drifted pin resolves to a wrong payload, so it must fail:\n${r.out}`);
            assert.match(r.out, /UNDECIDABLE EDGE: @fix\/napi@1\.2\.3 → optionalDependencies\.@fix\/napi-darwin-arm64/);
            assert.match(r.out, /own manifest is at 1\.2\.2/);
            assert.equal(r.stderr.match(/^ERROR: /gm)?.length, 1, `only the manifest defect belongs here:\n${r.out}`);
        });

        it('an unknown --phase is REFUSED, never defaulted', async () => {
            // Defaulting a typo to `post-release` would silently run the assertions
            // #1500 refuted for a pull request, which is the one outcome a
            // phase-selected check must not reach by accident.
            const root = fixture('phase-typo', splitBridge);
            published = olderThanTree();
            const r = await runScript(['--root', root, '--registry', registryUrl, '--phase', 'prerelease']);
            assert.notEqual(r.status, 0, `an unknown phase must not be guessed:\n${r.out}`);
            assert.match(r.out, /unknown --phase "prerelease"; expected one of post-release, pre-release/);
        });

        it('an unknown ARGUMENT is refused, not ignored', async () => {
            // The half the phase guard could not see. It only ever inspects a wrong
            // VALUE; the previous `argv.indexOf(name)` helper answered only for the
            // exact spelling `--phase <value>`, so three others never reached it and
            // fell through to the post-release default. Measured 2026-09-03 on the
            // real tree: `--phaze pre-release`, `--phase=pre-release` and a bare
            // `--phase` each ran the POST-release assertions and exited 0 — a required
            // pull-request check green over the question #1500 refuted for a pull
            // request, which is the class this phase exists to close, reintroduced by
            // its own interface. A typo has to cost a red, not a phase.
            const root = fixture('argv-unknown', splitBridge);
            published = olderThanTree();
            const r = await runScript(['--root', root, '--registry', registryUrl, '--phaze', 'pre-release']);
            assert.notEqual(r.status, 0, `an unknown argument must not be ignored:\n${r.out}`);
            assert.match(r.out, /unknown argument "--phaze"/);
        });

        it('a flag with no value is refused, not silently defaulted', async () => {
            const root = fixture('argv-novalue', splitBridge);
            published = olderThanTree();
            const r = await runScript(['--root', root, '--registry', registryUrl, '--phase']);
            assert.notEqual(r.status, 0, `a missing value must not select the default:\n${r.out}`);
            assert.match(r.out, /--phase needs a value/);
        });

        it('--phase=pre-release selects the phase instead of falling through', async () => {
            // The `=` spelling is the one a workflow author reaches for, and it used to
            // land on the post-release default with no diagnostic at all. This tree is
            // the discriminator: every name exists, none at the tree's version, so
            // pre-release is green here and post-release is red on "published NOTHING".
            // `--attempts=1` exercises the same spelling on a numeric flag.
            const root = fixture('argv-equals', splitBridge);
            published = olderThanTree();
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts=1',
                '--phase=pre-release',
            ]);
            assert.equal(r.status, 0, `the equals spelling must select pre-release:\n${r.out}`);
            assert.match(r.stdout, /Pre-release npm bootstrap check/);
        });

        it('the ledger cannot answer the WHOLE question: zero names confirmed fails', async () => {
            // The pre-release form of the positive-fact rule, which needs its own arm:
            // post-release asserts "the release published something", pre-release never
            // can, and the roster does not substitute for it because the roster fires
            // only on an UNDECLARED absence. Measured 2026-09-03 before this assertion:
            // a tree with every name declared exited 0 printing "Every one of 0
            // publishable name(s) exists on npm" — a success claim over an empty set,
            // which is the one sentence this script's own header forbids.
            const root = fixture('all-declared', splitBridge, {
                '@fix/util': 'queued: publish + trust',
                '@fix/bridge': 'queued: publish after both targets',
                '@fix/bridge-linux-x64': 'queued: target BEFORE bridge',
                '@fix/bridge-darwin-arm64': 'queued: target BEFORE bridge',
            });
            published = new Map();
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '1',
                '--phase',
                'pre-release',
            ]);
            assert.notEqual(r.status, 0, `a run that confirmed no name at all must not pass:\n${r.out}`);
            assert.match(r.out, /not one of 4 publishable name\(s\) was confirmed/);
            assert.doesNotMatch(r.out, /Every one of 0/);
        });

        it('the pre-release phase is WIRED to a job that runs on a pull request', () => {
            // Detection that arrives after the tag reads identically to a check that
            // passed, so the wiring is the whole point of this phase and is asserted
            // rather than assumed. `audit-runtimes.yml` is the required
            // `Detect runtime-triplet drift` job, and it deliberately carries no
            // `paths:` filter — a path-filtered workflow is advisory here.
            const wf = readFileSync(
                fileURLToPath(new URL('../../../.github/workflows/audit-runtimes.yml', import.meta.url)),
                'utf8',
            );
            assert.match(
                wf,
                /node scripts\/verify-published-closure\.mjs --phase pre-release/,
                'audit-runtimes.yml must invoke the pre-release phase; without the wiring this phase is dead code',
            );
            assert.doesNotMatch(
                wf.slice(0, wf.indexOf('jobs:')),
                /paths:/,
                'the job must stay eligible to be required',
            );
        });
    });

    // ── the PREVENTION half, asserted where it can regress ──────────────────
    // Detection is post-hoc: it can only report a window that already opened.
    // The sweep's dependency-ordered publish is what keeps the window shut, and
    // it is one flag in one script — so assert the flag is still there. Without
    // this, dropping it would be invisible until a release aborted in exactly
    // the wrong place.
    it('the npm:publish sweep publishes in dependency order', () => {
        const rootManifest = JSON.parse(
            readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
        );
        const script = rootManifest.scripts['npm:publish'];
        assert.ok(script, 'root package.json must declare npm:publish');

        // The flag has to belong to `gjsify foreach`, NOT to the command it
        // execs. Matching it anywhere in the segment also accepted
        // `--exec -- gjsify publish --topological`, where `gjsify publish` has no
        // such flag and the sweep is UNORDERED — the assertion would have been
        // green over the exact hazard it exists to pin. So split each segment at
        // its `--exec`: group 1 is foreach's own argv, group 2 the execed
        // command. `[^&|]` keeps a segment from spilling across a `&&`.
        const SWEEP = /gjsify foreach\b((?:(?!--exec\b)[^&|])*)--exec\b([^&|]*)/g;
        const ORDER_FLAG = /(?:^|\s)(?:--topological\b|-[a-zA-Z]*t[a-zA-Z]*\b)/; // --topological | -t | a cluster like -vt
        const sweeps = [...script.matchAll(SWEEP)].filter(([, , execed]) => /\bgjsify publish\b/.test(execed));
        // Not "no sweep, nothing to check": an assertion that cannot locate its
        // subject has verified nothing, and passing there is the failure mode
        // this whole PR is about. If the publish sweep is respelled, this test
        // gets updated deliberately.
        assert.ok(
            sweeps.length > 0,
            'this test could not find a `gjsify foreach … --exec … gjsify publish …` sweep in npm:publish, so it ' +
                `verified NOTHING about publish order. Update it to match the new shape. Got: ${script}`,
        );
        for (const [, foreachArgv] of sweeps) {
            assert.match(
                foreachArgv,
                ORDER_FLAG,
                'the `gjsify foreach` publish sweep must carry --topological in its OWN arguments: the graph counts ' +
                    'optionalDependencies, so every platform child precedes its bridge and any prefix of an aborted ' +
                    'sweep is still a resolvable tree. Unordered, a fail-fast abort can publish a bridge pinning ' +
                    `siblings that do not exist. Got: ${script}`,
            );
        }
    });
});
