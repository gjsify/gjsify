// E2E regression for @gjsify/unit failure attribution / isolation.
//
// Root bug (manifested as an intermittent @gjsify/tls `test:node` flake):
// `MatcherFactory.triggerResult` used to do `++countTestsFailed` AT THE THROW
// SITE. A late assertion that fired with NO it() on the stack — a leaked timer
// / unawaited promise from an already-settled test — therefore bumped the
// GLOBAL fail counter even though no running test owned it. The run then exited
// 1 with a summary ("❌ 1 of N tests failed") that matched no printed ❌ line,
// or, when the stray throw landed in a bystander's await window, was charged to
// an innocent passing test (the reported "❌ should handle IPv6 …" symptom).
//
// Fix: counting is owned exclusively by the OBSERVING boundary (it()'s catch /
// the assert.* helpers). The throw site only throws. A failure that fires with
// no it() active is surfaced as its own "stray" pseudo-test, never charged to a
// bystander.
//
// This e2e bundles a tiny suite that leaks a late assertion (swallowed locally,
// so no test awaits it) and asserts:
//   - every real it() still reports a pass (no bystander poisoned),
//   - the leaked assertion surfaces as a distinct "⚠ … outside any it()" line,
//   - the summary's failed-count equals the number of strays (no divergence).
//
// The fixture entry is built from inside packages/gjs/unit/src so the bare
// `@gjsify/unit` self-import resolves through the workspace (gjs/node won't walk
// node_modules from a tmp dir). The bundle is run in a child node process so
// the runner's module-global counters are isolated from this harness.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const UNIT_SRC = join(MONOREPO_ROOT, 'packages', 'gjs', 'unit', 'src');

function buildEntryFromUnitSrc(entryName, source, outFile) {
    // Place the temp entry inside the unit package so `@gjsify/unit` resolves.
    const tmpEntry = join(UNIT_SRC, entryName);
    writeFileSync(tmpEntry, source, 'utf-8');
    try {
        execFileSync('node', [CLI_ENTRY, 'build', tmpEntry, '--app', 'node', '--outfile', outFile], {
            stdio: 'pipe',
            timeout: 120 * 1000,
            encoding: 'utf8',
        });
    } finally {
        if (existsSync(tmpEntry)) unlinkSync(tmpEntry);
    }
}

const LEAK_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async LeakSuite() {
        await describe('attribution', async () => {
            // A settled test leaks a late assertion. It is swallowed locally
            // (no test awaits it), so the throw escapes no it() — it is a stray.
            await it('A schedules a leaked late assertion', async () => {
                setTimeout(() => {
                    try { expect('leaked-not-undefined').toBeUndefined(); } catch { /* swallow */ }
                }, 0);
            });
            // Bystander: genuinely passes. Must NOT be poisoned by the leak.
            await it('B bystander passes cleanly', async () => {
                expect(undefined).toBeUndefined();
            });
        });
        // Let the leaked timer fire before the summary prints.
        await new Promise((r) => setTimeout(r, 40));
    },
});
`;

const CLEAN_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async CleanSuite() {
        await describe('no leaks', async () => {
            await it('passes 1', async () => { expect(1).toBe(1); });
            await it('passes 2', async () => { expect('a.com').toContain('com'); });
            // toThrow wrapping a failing matcher must NOT leak a failure.
            await it('toThrow does not leak', async () => {
                expect(() => expect(1).toBe(2)).toThrow();
            });
        });
    },
});
`;

// The LEDGER case. An `expect` fails inside a host callback that is off the
// awaited promise's reject path, so the promise is never settled and the test can
// only end by timing out.
//
// This must be a plain `it()`: the whole observable effect is that the reported
// failure carries the ASSERTION's message instead of a bare "Timeout", and that
// can only be seen in a run that FAILS — hence a child process, like the leak
// case above. (`it.failing` deliberately ignores the ledger, so the probes in
// `callback-assertion.spec.ts` cannot cover this.)
//
// A short per-test timeout keeps the fixture fast; the ledger does not care how
// long the wait was.
const LOST_ASSERTION_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async LostAssertionSuite() {
        await describe('assertion lost in a host callback', async () => {
            await it('reports the assertion, not the timeout', async () => {
                await new Promise((resolve) => {
                    setTimeout(() => {
                        expect('actual-value').toBe('expected-value');
                        resolve();
                    }, 0);
                });
            }, 300);
        });
    },
});
`;

// The DELETED-CWD case. A spec that `chdir`s into a temp directory and then
// removes it leaves the whole PROCESS in a deleted working directory, and every
// later `process.cwd()` — including one inside a child the runner spawns — dies
// with `ENOENT … uv_cwd`. Specs share one process, so the cost lands on whatever
// runs NEXT: on darwin-x64 this failed `@gjsify/cli`'s classifier suite in ~30 % of
// runs, in a spec that never touches the CWD, while the spec that broke it passed.
//
// Attribution is the entire value, so the fixture puts a clean bystander AFTER the
// offender: the run must name the offender and leave the bystander green.
const DELETED_CWD_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
run({
    async DeletedCwdSuite() {
        await describe('deleted cwd', async () => {
            await it('A chdirs into a temp dir and removes it', async () => {
                const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-deleted-cwd-'));
                process.chdir(dir);
                rmSync(dir, { recursive: true, force: true });
                expect(1).toBe(1);
            });
            await it('B bystander never touches the cwd', async () => {
                expect(2).toBe(2);
            });
        });
    },
});
`;

// oxlint-disable-next-line no-control-regex -- ANSI SGR sequences are ESC-prefixed by design
const ANSI = /\x1B\[[0-9;]*m/g;
const stripAnsi = (s) => s.replace(ANSI, '');

/** Is a real `gjs` on PATH? The ledger case below can only be observed there. */
function hasGjs() {
    try {
        execFileSync('gjs', ['--version'], { stdio: 'pipe', timeout: 20 * 1000 });
        return true;
    } catch {
        return false; // e.g. the Windows test VM — the gjs half runs on the Linux legs
    }
}

function buildGjsEntryFromUnitSrc(entryName, source, outFile) {
    const tmpEntry = join(UNIT_SRC, entryName);
    writeFileSync(tmpEntry, source, 'utf-8');
    try {
        execFileSync('node', [CLI_ENTRY, 'build', tmpEntry, '--app', 'gjs', '--outfile', outFile], {
            stdio: 'pipe',
            timeout: 120 * 1000,
            encoding: 'utf8',
        });
    } finally {
        if (existsSync(tmpEntry)) unlinkSync(tmpEntry);
    }
}

function runGjsBundle(outFile) {
    try {
        const stdout = execFileSync('gjs', ['-m', outFile], {
            stdio: 'pipe',
            timeout: 60 * 1000,
            encoding: 'utf8',
        });
        return { code: 0, out: stdout };
    } catch (e) {
        return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

/**
 * Run the bundle with the CI-detection env PINNED rather than inherited.
 *
 * `GITHUB_ACTIONS` is exported into every Actions step and a spawned child inherits
 * it, so the runner's annotation branch (#1159) fired in CI and not locally: the same
 * input, two code paths, decided by an env var no test mentioned. That is exactly the
 * trap `packages/infra/cli/src/affected-classifier.spec.ts` documents for
 * `GITHUB_OUTPUT`, and it cost a red E2E here before this pin existed.
 *
 * `githubActions: true` opts INTO the annotation path, for the test that covers it.
 */
function runBundle(outFile, { githubActions = false } = {}) {
    const env = { ...process.env };
    if (githubActions) env.GITHUB_ACTIONS = 'true';
    else delete env.GITHUB_ACTIONS;
    try {
        const stdout = execFileSync('node', [outFile], {
            stdio: 'pipe',
            timeout: 60 * 1000,
            encoding: 'utf8',
            env,
        });
        return { code: 0, out: stdout };
    } catch (e) {
        return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

describe('@gjsify/unit failure attribution E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli build\``);
        }
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-unit-attr-'));
        mkdirSync(tmpDir, { recursive: true });
    });

    after(() => {
        if (tmpDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('a leaked late assertion does not poison a bystander test', () => {
        const out = join(tmpDir, 'leak.node.mjs');
        buildEntryFromUnitSrc('__e2e_leak_attribution.mts', LEAK_SUITE, out);
        const { code, out: stdout } = runBundle(out);

        // Strip ANSI so matchers are colour-agnostic.
        const plain = stripAnsi(stdout);

        // Both real tests report a pass — the bystander is NOT poisoned.
        assert.match(plain, /✔ A schedules a leaked late assertion/, 'test A should pass');
        assert.match(plain, /✔ B bystander passes cleanly/, 'bystander B should pass');

        // The leak surfaces as its own distinct stray line, NOT as a ❌ on a
        // real test. No real it() line (a "❌ <name>  (<ms>)" entry) is marked
        // failed — the only ❌ allowed is the summary "❌ N of M tests failed".
        assert.match(plain, /assertion fired outside any it\(\)/, 'stray line should appear');
        // And the SUMMARY says which kind of failure it was. A stray assertion
        // belongs to no test, so counting it into the ratio printed `1 of 2 tests
        // failed` over two tests that both passed — the arithmetic was possible
        // here and impossible as soon as there were more strays than tests
        // (measured: `3 of 2`, and `2 of 0`). ADR 0044.
        assert.match(plain, /❌ .*1 failure outside any test, 2 tests passed/, 'the verdict names the kind');
        const VERDICT = /tests failed|failures? outside any test/;
        const itFailureLines = plain.split('\n').filter((l) => /❌\s+\S/.test(l) && !VERDICT.test(l));
        assert.deepStrictEqual(itFailureLines, [], 'no real it() should be marked failed');

        // The count must equal the number of strays (1) — no divergence between
        // the summary count and the printed failures. It is NOT phrased as a ratio
        // over tests any more, which is the correction above: the stray is not one
        // of them.
        assert.doesNotMatch(plain, /\d+ of \d+ tests failed/, 'a stray is not a test failure');

        // A genuine failure (the leak IS a real test bug) → non-zero exit.
        assert.notStrictEqual(code, 0, 'run with a stray must exit non-zero');
    });

    it('a destroyed process cwd is charged to the test that destroyed it', () => {
        const out = join(tmpDir, 'deleted-cwd.node.mjs');
        buildEntryFromUnitSrc('__e2e_deleted_cwd.mts', DELETED_CWD_SUITE, out);
        const { code, out: stdout } = runBundle(out);
        const plain = stripAnsi(stdout);

        // Named, and named as the offender rather than as a generic failure.
        assert.match(
            plain,
            /A chdirs into a temp dir and removes it — this test left the process in a deleted working directory/,
            'the offending test must be named',
        );

        // The bystander that runs AFTER it stays green. Before the latch existed,
        // this is where the failure surfaced — in a spec that touches nothing.
        assert.match(plain, /✔ B bystander never touches the cwd/, 'the later bystander must stay green');

        // Reported at the failure and once more in the recap — and NOWHERE else.
        //
        // The property under test is that the count does not scale with the suite: the
        // bug this pins reported the transition once per REMAINING test. Since #1159 the
        // runner also names every failure in a recap block above the summary, so the
        // honest assertion is one occurrence on each side of that block's header rather
        // than a loosened "at least one", which would stop noticing per-test repetition.
        const parts = plain.split(/^\u2716 .*failed tests?$/m);
        assert.strictEqual(parts.length, 2, 'expected exactly one failure-recap header');
        assert.strictEqual(
            parts[0].split('deleted working directory').length - 1,
            1,
            'the transition is reported exactly once where it happened',
        );
        assert.strictEqual(
            parts[1].split('deleted working directory').length - 1,
            1,
            'and exactly once in the recap that names it',
        );

        assert.notStrictEqual(code, 0, 'a run that destroyed its cwd must exit non-zero');
    });

    it('under GITHUB_ACTIONS the failure is also emitted as a workflow command', () => {
        // The branch that turned this suite red before `runBundle` pinned the env: on
        // Actions the runner also writes `::error::` lines so the names reach the run's
        // summary page. Covered here rather than left to the machine — an output branch
        // that only appears in CI is one nobody reads until it breaks something else.
        const out = join(tmpDir, 'annotated-cwd.node.mjs');
        buildEntryFromUnitSrc('__e2e_annotated_cwd.mts', DELETED_CWD_SUITE, out);
        const { code, out: stdout } = runBundle(out, { githubActions: true });
        const plain = stripAnsi(stdout);

        const commands = plain.split('\n').filter((l) => l.startsWith('::error title='));
        assert.strictEqual(commands.length, 1, 'exactly one annotation for the one failure');
        assert.match(commands[0], /deleted working directory/, 'the annotation carries the reason');

        // A workflow command must start at column 0 and carry no SGR bytes, or Actions
        // prints it literally instead of rendering an annotation.
        const raw = stdout.split('\n').find((l) => l.includes('::error title='));
        assert.ok(raw.startsWith('::error title='), 'the command must start at column 0');
        // A plain substring check, not a regex: `no-control-regex` flags the escape in
        // either spelling, and the suppression would be noise for a one-character test.
        assert.ok(!raw.includes('\u001b['), 'the command must carry no escape codes');

        assert.notStrictEqual(code, 0, 'still a failing run');
    });

    it('without GITHUB_ACTIONS it emits no workflow commands', () => {
        // The other half of the pin: the default path must stay quiet, so a developer
        // reading the log locally never sees Actions plumbing.
        const out = join(tmpDir, 'unannotated-cwd.node.mjs');
        buildEntryFromUnitSrc('__e2e_unannotated_cwd.mts', DELETED_CWD_SUITE, out);
        const { out: stdout } = runBundle(out);
        assert.doesNotMatch(stripAnsi(stdout), /^::error/m, 'no workflow commands off Actions');
    });

    it('a clean suite (incl. toThrow-wrapped matcher) reports zero failures', () => {
        const out = join(tmpDir, 'clean.node.mjs');
        buildEntryFromUnitSrc('__e2e_clean_attribution.mts', CLEAN_SUITE, out);
        const { code, out: stdout } = runBundle(out);
        const plain = stripAnsi(stdout);

        // The point is that it reports a clean run (0 failures), with all three
        // it()s green and no stray. The optional `[<runtime>]` label (e.g.
        // `✔ [Node.js 26.4.0] 3 tests passed`) sits between the tick and the count.
        // The count is TESTS since #1557 — it used to be assertions under the word
        // "completed", which is what made a falling number unreadable.
        assert.match(plain, /✔ (?:\[[^\]]+\] )?\d+ tests? passed/, 'clean run reports a pass, 0 failed');
        assert.match(plain, /✔ passes 1/);
        assert.match(plain, /✔ toThrow does not leak/);
        assert.doesNotMatch(plain, /tests failed/, 'no failure summary');
        assert.doesNotMatch(plain, /outside any it\(\)/, 'no stray');
        assert.strictEqual(code, 0, 'clean run exits 0');
    });

    it('a lost assertion is charged once and keeps its message (host-hook path)', () => {
        // On the Node family the `uncaughtException`/`unhandledRejection` hook
        // claims the escaped assertion and fails THIS test with it directly —
        // measured at ~2ms, i.e. the 300ms timeout never elapses. So this case
        // pins the hook path, and the ledger's own diagnosis is NOT expected here.
        const out = join(tmpDir, 'lost-assertion.node.mjs');
        buildEntryFromUnitSrc('__e2e_lost_assertion.mts', LOST_ASSERTION_SUITE, out);
        const { code, out: stdout } = runBundle(out);
        const plain = stripAnsi(stdout);

        assert.match(plain, /1 of \d+ tests failed/, 'the lost assertion is charged exactly once');
        assert.strictEqual(code, 1, 'a lost assertion must fail the run');
        // The point of the whole mechanism: the run SAYS what was wrong instead of
        // dying with no summary.
        assert.match(plain, /expected-value/, 'the assertion message must survive');
        assert.match(plain, /actual-value/, 'both sides of the comparison must survive');
    });

    it('on GJS the same loss is recovered from the timeout by the ledger', (t) => {
        // GJS installs no host hook (nothing emits those events there), so the
        // promise stays unsettled and the test can only end by timing out. The
        // ledger is what turns that bare timeout back into the assertion — and
        // this is the ONLY place that path is observable: `it.failing` ignores the
        // ledger by design, so the probes in `callback-assertion.spec.ts` cannot
        // reach it.
        if (!hasGjs()) {
            t.skip('no gjs on PATH (Windows VM); covered by the Linux/GJS legs');
            return;
        }
        const out = join(tmpDir, 'lost-assertion.gjs.mjs');
        buildGjsEntryFromUnitSrc('__e2e_lost_assertion_gjs.mts', LOST_ASSERTION_SUITE, out);
        const { code, out: stdout } = runGjsBundle(out);
        const plain = stripAnsi(stdout);

        assert.strictEqual(code, 1, 'a lost assertion must fail the run on GJS too');
        assert.match(plain, /1 of \d+ tests failed/, 'charged exactly once');
        // Recovered from the timeout — the assertion, not "Timeout: … exceeded".
        assert.match(plain, /expected-value/, 'the ledger must recover the assertion message');
        // And it must explain itself, or the next reader re-derives the cause.
        assert.match(plain, /OUTSIDE this test's awaited chain/, 'the diagnosis must be stated');
    });
});
