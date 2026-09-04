// E2E for the two halves of #1552: `scripts/check-probe-outcomes-read.mjs`, which
// refuses a `continue-on-error` step whose result nothing reads, and
// `scripts/report-probe-outcome.mjs`, which is what reads it.
//
// SYNTHETIC FIRST, for `ci-pr-trigger-parity`'s reason: a gate nobody has watched
// FAIL is not yet a gate, and this one is easy to write so that it can only pass —
// it reads the tree, the tree conforms the moment it lands, and a checker that
// returned "fine" for everything would be indistinguishable from a correct one. So
// every verdict gets a workflow shaped to produce it, including the two shapes
// that must NOT be flagged: a step that is properly reported, and the JOB-level
// `continue-on-error`, which is a different question with no `steps.<id>` to read.
//
// Then the real tree, as the regression guard: the next probe added without a
// reader fails here as well as in the audit job.
//
// The reporter is driven as a PROCESS rather than imported, because what it
// promises is process-shaped: a `::warning::` on stdout only for a failure, a row
// appended to `$GITHUB_STEP_SUMMARY`, and a refusal when it was handed nothing to
// report — the shape a call site that forgets an `env:` key would otherwise take
// silently at exit 0.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CHECK = join(MONOREPO_ROOT, 'scripts', 'check-probe-outcomes-read.mjs');
const REPORT = join(MONOREPO_ROOT, 'scripts', 'report-probe-outcome.mjs');

/** A throwaway repo root holding exactly the given `name → yaml` workflows. */
function withWorkflows(workflows) {
    const root = mkdtempSync(join(tmpdir(), 'probe-outcomes-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) {
        writeFileSync(join(root, '.github', 'workflows', name), body);
    }
    return root;
}

/** Run the checker over `root`; `{ code, out }` with stdout and stderr joined. */
function check(root) {
    try {
        const out = execFileSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf-8' });
        return { code: 0, out };
    } catch (error) {
        return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
}

const STEP = (extra) => `name: probe
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 'The probe'
${extra}        continue-on-error: true
        run: node run-the-suite.mjs
`;

describe('probe outcomes are addressable and read', () => {
    it('refuses a continue-on-error step with no id', () => {
        const root = withWorkflows({ 'probe.yml': STEP('') });
        try {
            const { code, out } = check(root);
            assert.equal(code, 1);
            assert.match(out, /"The probe" has no `id`/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a step whose outcome nothing reads', () => {
        const root = withWorkflows({ 'probe.yml': STEP('        id: the-probe\n') });
        try {
            const { code, out } = check(root);
            assert.equal(code, 1);
            assert.match(out, /nothing reads `steps\.the-probe\.outcome`/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('accepts a step that is reported', () => {
        const reported = `${STEP('        id: the-probe\n')}      - name: 'Probe outcome'
        if: always()
        env:
          PROBE_LABEL: 'The probe'
          PROBE_OUTCOME: \${{ steps.the-probe.outcome }}
        run: node scripts/report-probe-outcome.mjs
`;
        const root = withWorkflows({ 'probe.yml': reported });
        try {
            const { code, out } = check(root);
            assert.equal(code, 0);
            assert.match(out, /1 continue-on-error step\(s\)/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('is silent about a JOB-level continue-on-error, which has no steps.<id> to read', () => {
        // A different question, deliberately out of scope: a job marked this way
        // reports `success` to `needs` too, and what stands in for a reader there is
        // the job's own verdict line. Counting it as a step would send an author
        // looking for an id that cannot exist.
        const jobLevel = `name: canary
on: [push]
jobs:
  canary:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - name: 'The work'
        run: node run-the-suite.mjs
`;
        const root = withWorkflows({ 'canary.yml': jobLevel });
        try {
            const { code, out } = check(root);
            assert.equal(code, 0);
            assert.match(out, /0 continue-on-error step\(s\)/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('holds over the real .github/workflows tree', () => {
        const { code, out } = check(MONOREPO_ROOT);
        assert.equal(code, 0, out);
        assert.match(out, /every outcome addressable and read/);
    });
});

describe('reporting one probe outcome', () => {
    /** Run the reporter with an isolated `$GITHUB_STEP_SUMMARY`; `{ stdout, summary }`. */
    function report(env) {
        const dir = mkdtempSync(join(tmpdir(), 'probe-report-'));
        const summaryPath = join(dir, 'summary.md');
        writeFileSync(summaryPath, '');
        try {
            const stdout = execFileSync(process.execPath, [REPORT], {
                encoding: 'utf-8',
                env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, ...env },
            });
            return { stdout, summary: readFileSync(summaryPath, 'utf-8') };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('annotates a FAILURE, because that is the one a green PR page hides', () => {
        const { stdout, summary } = report({ PROBE_LABEL: '@gjsify/react-native', PROBE_OUTCOME: 'failure' });
        assert.match(stdout, /^::warning title=Probe failed \(not gating\)::@gjsify\/react-native/m);
        assert.match(summary, /❌ \*\*probe\*\* `@gjsify\/react-native`/);
        assert.match(summary, /green only because the step is continue-on-error/);
    });

    it('records a pass without annotating, so an annotation still means something', () => {
        const { stdout, summary } = report({ PROBE_LABEL: 'the probe', PROBE_OUTCOME: 'success' });
        assert.doesNotMatch(stdout, /::warning/);
        assert.match(summary, /✅ \*\*probe\*\* `the probe`/);
    });

    it('says so when the outcome is one it does not know', () => {
        // GitHub's vocabulary can grow; a reporter that silently prints nothing for
        // an unfamiliar value would be the same silence one level up.
        const { summary } = report({ PROBE_LABEL: 'the probe', PROBE_OUTCOME: 'wobbly' });
        assert.match(summary, /unrecognised outcome "wobbly"/);
    });

    it('REFUSES to report nothing at exit 0', () => {
        assert.throws(
            () => execFileSync(process.execPath, [REPORT], { encoding: 'utf-8', env: { ...process.env } }),
            (error) => {
                assert.equal(error.status, 1);
                assert.match(error.stderr, /PROBE_LABEL and PROBE_OUTCOME are both required/);
                return true;
            },
        );
    });
});
