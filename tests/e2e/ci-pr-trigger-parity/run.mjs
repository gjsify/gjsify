// E2E test for `scripts/manifest-conformance/rules/pr-trigger-parity.mjs` — the rule
// that holds a workflow's `pull_request` trigger to its `push`-to-main trigger.
//
// Two halves, and both are load-bearing.
//
// The SYNTHETIC half exists because a gate nobody has watched fail is not yet a gate.
// This one is easy to write in a form that can only pass: it reads the tree, the tree
// conforms the moment it lands, and a parser that returned `parity` for everything
// would be indistinguishable from a correct one. So each verdict gets a workflow shaped
// to produce it, and the first of them is the exact shape this rule was written for —
// `push:` to main unfiltered, `pull_request:` filtered onto the workflow's own path.
// That was `windows-suites.yml` and `macos-suites.yml` until 2026-08-16, and it is why
// #1209 could merge green and leave the Windows leg red across eight further merges.
//
// The REAL-TREE half is the regression guard: it asserts the invariant over
// `.github/workflows/` as it actually is, so the next workflow that pushes to main
// without offering the same coverage on a PR fails here as well as in the audit.
//
// The parser is structural rather than YAML-backed, for the reason `platforms-ci`
// gives: the gate runs on a host with no install. That trades a dependency for parsing
// risk, which is the other thing the synthetic half is for — every trigger spelling
// this repository uses appears below at least once (flow `[main]` and block `- main`
// branch lists, `paths` and `paths-ignore`, 2-space and 4-space indentation).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-pr-trigger-parity/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RULE = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'pr-trigger-parity.mjs');

const { listUnder, pathFilter, prTriggerParityRule, sameFilter, triggerParityRows } = await import(`file://${RULE}`);

/** Build a throwaway repo root holding exactly the given `name → yaml` workflows. */
function withWorkflows(workflows) {
    const root = mkdtempSync(join(tmpdir(), 'pr-trigger-parity-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) {
        writeFileSync(join(root, '.github', 'workflows', name), body);
    }
    return root;
}

/** The verdict for one synthetic workflow, with the temp root cleaned up either way. */
function verdictOf(body, name = 'probe.yml') {
    const root = withWorkflows({ [name]: body });
    try {
        const rows = triggerParityRows(root);
        assert.equal(rows.length, 1, 'the fixture must produce exactly one row');
        return rows[0];
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('the shape the rule was written for', () => {
    it('rejects a pull_request filtered onto the workflow itself', () => {
        // Verbatim the trigger `windows-suites.yml` carried. A PR editing anything else
        // in the repository does not run it; a PR editing THIS FILE does. The `on:`
        // block reads as though the leg were PR-covered.
        const row = verdictOf(`name: Probe
on:
  push:
    branches:
      - main
  workflow_dispatch:
  pull_request:
    paths:
      - '.github/workflows/probe.yml'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`);
        assert.equal(row.verdict, 'narrower');
        assert.deepEqual(row.pushFilter, { paths: null, pathsIgnore: null });
        assert.deepEqual(row.prFilter, { paths: ['.github/workflows/probe.yml'], pathsIgnore: null });
    });

    it('names the file, the asymmetry and the fix in the failure text', () => {
        // A rule message that says only "parity violated" costs the reader the
        // investigation the rule just did. The three parts asserted here are what the
        // registry's contract asks for: what is wrong, why it matters, what to edit.
        const root = withWorkflows({
            'probe.yml': `name: Probe
on:
  push:
    branches: [main]
  pull_request:
    paths:
      - '.github/workflows/probe.yml'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`,
        });
        try {
            const { failures } = prTriggerParityRule.run({ root });
            assert.equal(failures.length, 1);
            const [message] = failures;
            assert.match(message, /probe\.yml/);
            assert.match(message, /all checks passed/);
            assert.match(message, /node-gi\.yml/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('the shapes that legitimately pass', () => {
    it('accepts both triggers unfiltered', () => {
        assert.equal(
            verdictOf(`name: Probe
on:
  pull_request:
  push:
    branches: [main]
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'parity',
        );
    });

    it('accepts the same deny-list on both, whatever order it is written in', () => {
        // `node-gi.yml`'s shape. Order is not part of a filter's meaning, and a rule
        // that failed on a reordered list would teach people to distrust it.
        assert.equal(
            verdictOf(`name: Probe
on:
  push:
    branches: [main]
    paths-ignore:
      - '**/*.md'
      - 'docs/**'
      - 'website/**'
  pull_request:
    paths-ignore:
      - 'website/**'
      - '**/*.md'
      - 'docs/**'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'parity',
        );
    });

    it('does not confuse an allow-list with a deny-list of the same membership', () => {
        // `paths: [x]` and `paths-ignore: [x]` are complementary, so treating the pair
        // as equal would pass the one arrangement that inverts the coverage.
        assert.equal(
            verdictOf(`name: Probe
on:
  push:
    branches: [main]
    paths:
      - 'packages/**'
  pull_request:
    paths-ignore:
      - 'packages/**'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'narrower',
        );
    });

    it('ignores a workflow no merge to main can trigger', () => {
        // `release.yml` fires on a published release, `release-cut.yml` on a dispatch,
        // `cancel-pr-runs.yml` on a closed PR. None of them has post-merge coverage for
        // a PR to be missing, and demanding a `pull_request` trigger from them would be
        // an exception list — the thing that turns a rule into a list of names.
        assert.equal(
            verdictOf(`name: Probe
on:
  push:
    tags:
      - 'v*'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'not-gated',
        );
    });

    it('reads a 4-space-indented trigger block', () => {
        // `cancel-pr-runs.yml` is written this way. An indent-sensitive parser would
        // silently classify it, and every file like it, as not-gated.
        assert.equal(
            verdictOf(`name: Probe
on:
    push:
        branches: [main]
    pull_request:
jobs:
    noop:
        runs-on: ubuntu-latest
        steps:
            - run: 'true'
`).verdict,
            'parity',
        );
    });
});

describe('the shapes that must fail loudly rather than quietly', () => {
    it('rejects a push-to-main workflow with no pull_request trigger', () => {
        assert.equal(
            verdictOf(`name: Probe
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 4 * * *'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'no-pr-trigger',
        );
    });

    it('does not accept pull_request_target as the answer', () => {
        // A write token plus secrets on head code must not exist in a workflow that can
        // push — `prebuilds.yml` records the reasoning. If this counted, it would be the
        // cheap way past the rule.
        const row = verdictOf(`name: Probe
on:
  push:
    branches: [main]
  pull_request_target:
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`);
        assert.equal(row.verdict, 'no-pr-trigger');
        assert.equal(row.target, true);
    });

    it('reports a workflow whose on: block it cannot read, instead of skipping it', () => {
        // The failure mode of every parser-backed gate: an unparsed input reads exactly
        // like a conforming one. An unreadable workflow is where a post-merge-only job
        // would sit, so silence here would defeat the rule.
        assert.equal(
            verdictOf(`name: Probe
on: [push, pull_request]
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: 'true'
`).verdict,
            'unreadable',
        );
    });
});

describe('the list parser, on the spellings GitHub accepts', () => {
    it('reads both flow and block sequences, and distinguishes absent from empty', () => {
        assert.deepEqual(listUnder(['  branches: [main, next]'], 'branches'), ['main', 'next']);
        assert.deepEqual(listUnder(['  branches:', "    - 'main'", '    - next'], 'branches'), ['main', 'next']);
        assert.equal(listUnder(['  branches: [main]'], 'paths'), null);
        assert.deepEqual(pathFilter(['  paths:', "    - 'a/**'"]), { paths: ['a/**'], pathsIgnore: null });
    });

    it('does not read `paths-ignore` as `paths`', () => {
        // One is the complement of the other; conflating them would make the rule agree
        // with the arrangement it exists to reject.
        assert.equal(listUnder(['  paths-ignore:', "    - 'a/**'"], 'paths'), null);
        assert.ok(!sameFilter({ paths: ['a'], pathsIgnore: null }, { paths: null, pathsIgnore: ['a'] }));
    });
});

describe('the repository itself', () => {
    it('offers every post-merge workflow on pull requests too', () => {
        const rows = triggerParityRows(MONOREPO_ROOT);
        const offenders = rows.filter((r) => r.verdict !== 'parity' && r.verdict !== 'not-gated');
        assert.deepEqual(
            offenders.map((r) => `${r.file}: ${r.verdict}`),
            [],
        );
        // A rule that classified everything as `not-gated` would satisfy the assertion
        // above while checking nothing — the emptiness has to be earned.
        assert.ok(
            rows.some((r) => r.verdict === 'parity'),
            'no workflow was classified as gated, so the assertion above proved nothing',
        );
    });
});
