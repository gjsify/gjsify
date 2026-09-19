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

    it('reads a step that is only SOMETIMES continue-on-error', () => {
        // The shape that hides best: an expression is true on some events, and a
        // check keyed on the literal `true` walked past it as if it gated.
        const expr = STEP('').replace(
            'continue-on-error: true',
            "continue-on-error: ${{ github.event_name == 'push' }}",
        );
        const root = withWorkflows({ 'probe.yml': expr });
        try {
            const { code, out } = check(root);
            assert.equal(code, 1);
            assert.match(out, /has no `id`/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not read a `run:` script as YAML', () => {
        // Both directions were measured against this checker: a shell body that
        // contains step-shaped text was refused as a step with no id, and an `id:`
        // inside a heredoc won over the step's real one, so a properly reported
        // probe was reported as unread.
        const withScript = `name: probe
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 'The probe'
        continue-on-error: true
        run: |
          cat <<'EOF' > snippet.yml
          - name: fake step
            id: decoy
            continue-on-error: true
          EOF
          node run-the-suite.mjs
        id: the-probe
      - name: 'Probe outcome'
        if: always()
        env:
          PROBE_OUTCOME: \${{ steps.the-probe.outcome }}
        run: node scripts/report-probe-outcome.mjs
`;
        const root = withWorkflows({ 'probe.yml': withScript });
        try {
            const { code, out } = check(root);
            assert.equal(code, 0, out);
            assert.match(out, /1 continue-on-error step\(s\)/);
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

    it('cannot be made to report something else', () => {
        // A workflow command is `::name key=value::text` on a line of its own, and
        // a summary row is Markdown. Measured against this script before it
        // sanitised: a two-line label emitted a standalone `::error title=…::` —
        // an annotation of someone else's making, from the reporter whose job is to
        // be believed.
        const { stdout, summary } = report({
            PROBE_LABEL: 'benign\n::error title=Injected::pretend gate failure',
            PROBE_OUTCOME: 'failure',
        });
        assert.doesNotMatch(stdout, /^::error/m);
        assert.doesNotMatch(summary, /^::error/m);
        // …and a backtick cannot close the code span the label sits in.
        const { summary: quoted } = report({ PROBE_LABEL: 'a` — **pwned**', PROBE_OUTCOME: 'failure' });
        assert.doesNotMatch(quoted, /`a` /);
    });

    it('reports a padded outcome as the outcome it is', () => {
        const { stdout } = report({ PROBE_LABEL: 'the probe', PROBE_OUTCOME: 'failure ' });
        assert.match(stdout, /::warning title=Probe failed/);
    });

    it('does not fail the step when the summary cannot be written', () => {
        // It exists to report a result GitHub already throws away; failing the job
        // it reports on turns a note into the verdict. Measured: an unwritable
        // `GITHUB_STEP_SUMMARY` exited 1 with a stack trace.
        const stdout = execFileSync(process.execPath, [REPORT], {
            encoding: 'utf-8',
            env: {
                ...process.env,
                PROBE_LABEL: 'the probe',
                PROBE_OUTCOME: 'success',
                GITHUB_STEP_SUMMARY: '/nope/definitely-not-writable.md',
            },
        });
        assert.match(stdout, /✅ \*\*probe\*\*/);
        assert.match(stdout, /could not append to the step summary/);
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

// The third half of the same defect: `check-probe-retirement.mjs`.
//
// The two checks above make a probe's RESULT visible and deliberately do not ask whether
// the probe should still be one. Nobody asked either — measured 2026-09-19, two conditions
// in `gtk-os-suites.yml` had been satisfied for over a week, one of them on a step that had
// been green for 25 consecutive `main` runs. So the conditions became clauses and this is
// what evaluates them.
//
// SYNTHETIC AND OFFLINE, for the reason the head of this file gives twice over: a gate
// nobody has watched FAIL is not yet a gate, and the ripe verdict is the one that must be
// seen. Every case here is a `tree-*` clause, so the suite reads no registry and no API —
// an e2e whose verdict depends on npm being up is one that teaches people to re-run it.

const RETIRE = join(MONOREPO_ROOT, 'scripts', 'check-probe-retirement.mjs');

/** Run the retirement check over `root`; `{ code, out }` with stdout and stderr joined. */
function retirement(root, extra = []) {
    try {
        const out = execFileSync(process.execPath, [RETIRE, '--root', root, ...extra], { encoding: 'utf-8' });
        return { code: 0, out };
    } catch (error) {
        return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
}

/** A blocked probe carrying `clauses`, plus the reader the sibling check demands. */
const BLOCKED = (clauses) => `name: probe
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # RETIREMENT CONDITION: when the thing stops being true.
${clauses.map((c) => `      #   retire-when: ${c}`).join('\n')}
      - name: 'The probe (gating blocked on the thing)'
        id: the-probe
        continue-on-error: true
        run: node run-the-suite.mjs
      - name: 'Probe outcome'
        if: always()
        env:
          PROBE_OUTCOME: \${{ steps.the-probe.outcome }}
        run: node scripts/report-probe-outcome.mjs
`;

/** `withWorkflows` plus one tracked file the `tree-*` clauses can be about. */
function withTree(workflow, files = {}) {
    const root = withWorkflows({ 'probe.yml': workflow });
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(join(root, dirname(rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
    }
    return root;
}

describe('probe retirement conditions are evaluated, not re-read', () => {
    it('FAILS when every clause has come true — the verdict the whole check is for', () => {
        const root = withTree(BLOCKED(['tree-lacks src/table.ts UnixDialog']), {
            'src/table.ts': 'export const rows = [];\n',
        });
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 1);
            assert.match(out, /retirement condition is now MET/);
            assert.match(out, /The probe \(gating blocked on the thing\)/);
            // The remedy must name BOTH outcomes: a met condition is not evidence that the
            // step passes, and the darwin probe is the measurement that says so.
            assert.match(out, /PROXY/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('passes while one clause of a conjunction is still false', () => {
        const root = withTree(BLOCKED(['tree-lacks src/table.ts UnixDialog', 'tree-lacks src/table.ts Printer']), {
            'src/table.ts': 'export const rows = ["Printer"];\n',
        });
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 0);
            assert.match(out, /1 of 2 clause\(s\) met/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a probe whose condition is prose only', () => {
        // The defect in one sentence: a sentence above a step only fires when somebody
        // re-reads it, and for sixteen days nobody did.
        const root = withTree(BLOCKED([]));
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 1);
            assert.match(out, /states a retirement condition in prose and carries no machine-readable clause/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a clause it cannot evaluate, rather than skipping it', () => {
        // A typo'd verb that were merely ignored would leave the probe looking clause-bound
        // and evaluated while nothing read it — the original defect with a new spelling.
        const root = withTree(BLOCKED(['tree-lacs src/table.ts UnixDialog']));
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 1);
            assert.match(out, /unknown clause verb `tree-lacs`/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a clause with the wrong number of arguments', () => {
        const root = withTree(BLOCKED(['tree-lacks src/table.ts']));
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 1);
            assert.match(out, /`tree-lacks` takes 2 argument\(s\), got 1/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves a probe that claims no condition alone, and says how many', () => {
        // `cli-cross-platform.yml`'s ten-step diagnostic sweep is advisory BY DESIGN — its
        // own header says so. Demanding a condition there would be prose of this check's
        // making, so the scope is printed rather than silently applied.
        const advisory = `name: sweep
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 'Diagnostic: does it load'
        id: loads
        continue-on-error: true
        run: node load.mjs
      - name: 'Probe outcome'
        if: always()
        env:
          PROBE_OUTCOME: \${{ steps.loads.outcome }}
        run: node scripts/report-probe-outcome.mjs
`;
        const root = withWorkflows({ 'sweep.yml': advisory });
        try {
            const { code, out } = retirement(root);
            assert.equal(code, 0);
            assert.match(out, /0 probe\(s\) with a stated condition, 1 advisory by design/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('credits a comment block to the step it sits above, not the one before it', () => {
        // The walk stops at a BLANK line and not at a bare `#`, which is how these
        // workflows spell a paragraph break. Getting that backwards would hand one step's
        // clauses to its neighbour — and then both verdicts are about the wrong step.
        const two = `name: two
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # RETIREMENT CONDITION for the FIRST probe.
      #
      #   retire-when: tree-lacks src/table.ts Nothing
      - name: 'First (gating blocked on A)'
        id: first
        continue-on-error: true
        run: node a.mjs

      - name: 'Second (gating blocked on B)'
        id: second
        continue-on-error: true
        run: node b.mjs
      - name: 'Outcomes'
        if: always()
        env:
          A: \${{ steps.first.outcome }}
          B: \${{ steps.second.outcome }}
        run: node scripts/report-probe-outcome.mjs
`;
        const root = withTree(two, { 'src/table.ts': 'export const rows = [];\n' });
        try {
            const { code, out } = retirement(root);
            // The first probe is ripe (the file holds no `Nothing`); the second inherited
            // no clause and is refused for having none. Both verdicts name their own step.
            assert.equal(code, 1);
            assert.match(out, /"Second \(gating blocked on B\)" states a retirement condition in prose/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('holds over the real .github/workflows tree', () => {
        // The regression guard, offline: the next probe added with a prose-only condition
        // fails here as well as in the audit job. The ONLINE half — a published artifact or
        // a recorded outcome that turned a clause true — is what the audit job runs, and it
        // cannot be asserted from a suite that must pass with no network.
        const { code, out } = retirement(MONOREPO_ROOT);
        assert.equal(code, 0, out);
        assert.match(out, /probe\(s\) with a stated condition/);
    });
});
