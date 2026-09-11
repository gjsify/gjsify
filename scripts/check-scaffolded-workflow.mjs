#!/usr/bin/env node
// A workflow this repo SCAFFOLDS is read back by the same tools that read the
// workflows it commits.
//
// THE INCIDENT — this one is the absence of an incident, which is the point.
// `gjsify flatpak ci` writes a GitHub Actions workflow into a consumer's
// repository, and the only thing that had ever checked its output was four
// `assert.match` regexes over the raw text in `tests/e2e/flatpak/run.mjs`:
// the container image, the manifest path, the bundle name, and the action ref.
// The file was never parsed as YAML, never handed to `actionlint`, and never run.
// A generator can emit a `runs_on:` typo, an unpinned `uses:`, a `${{ }}`
// expression naming a property no context has, or a `jobs:` key it misspelled,
// and all four regexes still match — because each one asserts a substring the
// mutation does not touch. ADR 0024 names this class for `ship`, which scaffolds
// too; it already existed one command over.
//
// MEASURED, on the real scaffolded `flatpak.yml` with one mutation each
// (2026-09-11, actionlint 1.7.7). "yaml" is a plain `YAML.parse`, the reader a
// hand-rolled structural check would be built on:
//
//   mutation                          actionlint   yaml
//   unclosed `[` in `branches:`       refuses      refuses
//   `runs-on:` → `runs_on:`           refuses      accepts
//   `actions/checkout@v4` → no ref    refuses      accepts
//   `github.sha` → `github.shaX`      refuses      accepts
//   `jobs:` → `jbos:`                 refuses      accepts
//   `on:` → `onn:`                    refuses      accepts
//   unterminated `if` in a `run:`     ACCEPTS      accepts
//
// Two conclusions, and both shape this file. A YAML parse on its own catches one
// of seven, so structural assertions of our own would be nearly the vacuum they
// replace — `actionlint` is the reader, for the reason `audit-runtimes.yml`
// already gives about this repo's own workflows. And `actionlint` is BLIND to the
// last row, because it runs with `-shellcheck=` empty and parses workflow syntax
// rather than the shell inside `run:`. So the chain is two readers, neither
// redundant: `actionlint` for the document, `check-workflow-run-syntax.mjs` for
// the shell. `flatpak ci` emits no `run:` block today, which makes the second
// reader vacuous ON THAT SCAFFOLDER and not on the class — the ledger's minimum
// bar for `ship ci` names `bash -n` on every extracted `run:` block, and this is
// where it will already be wired.
//
// WHY A TEMP `.github/workflows/` LAYOUT IS PART OF THE ANSWER: `actionlint`
// discovers workflows by walking a repository, and a generator's output lives in
// a scratch directory. Measured — pointed at a directory with no `.git`, it exits
// 3 with "no project was found in any parent directories". Passing the FILE
// explicitly works without a repository and is what this script does; the callers
// still scaffold into a real `.github/workflows/` layout, because that is the path
// `check-workflow-run-syntax.mjs --root` walks and the one a consumer will have.
//
// Usage:
//   node scripts/check-scaffolded-workflow.mjs --root <dir> [--require-actionlint]
//   node scripts/check-scaffolded-workflow.mjs --coverage [--repo <dir>]
//
// `--coverage` needs no build and no scaffolded output: it is the static half,
// asserting that every workflow-writing command in the CLI is named in
// SCAFFOLDERS below. That is what stops the next scaffolder from landing with
// nothing reading it — the same shape as `manifest-conformance`'s
// `field-coverage`, which fails on a declaration no rule claims.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = join(HERE, '..');

/**
 * Every command in this tree that writes a GitHub Actions workflow.
 *
 * `source` is checked against reality by `--coverage`: a file under the CLI that
 * mentions a `.github/workflows` path and is not listed here fails the check, so a
 * new scaffolder cannot be added without deciding who reads its output.
 */
const SCAFFOLDERS = [
    {
        id: 'flatpak ci',
        source: 'packages/infra/cli/src/commands/flatpak/ci.ts',
        suite: 'tests/e2e/flatpak/run.mjs',
    },
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
};

const ACTIONLINT = process.env.GJSIFY_ACTIONLINT ?? 'actionlint';

const haveActionlint =
    spawnSync(ACTIONLINT, ['-version'], { encoding: 'utf-8' }).status === 0;

/** Run actionlint over explicit files. Returns null when clean, else its output. */
function actionlint(files) {
    // `-shellcheck=` and `-pyflakes=` empty for the same reason `audit-runtimes.yml`
    // passes them: those two are separate tools that may be absent, and their
    // absence would otherwise turn into a diagnostic about the workflow.
    const r = spawnSync(ACTIONLINT, ['-shellcheck=', '-pyflakes=', ...files], { encoding: 'utf-8' });
    if (r.error !== undefined) return { message: `actionlint could not run: ${r.error.message}` };
    if (r.status === 0) return null;
    return { message: (r.stdout || r.stderr || '').trim() };
}

/** Run the repo's own `run:`-block shell parser over a scaffolded root. */
function runSyntax(root) {
    const r = spawnSync(process.execPath, [join(HERE, 'check-workflow-run-syntax.mjs'), '--root', root], {
        encoding: 'utf-8',
    });
    if (r.status === 0) return null;
    return { message: (r.stdout || r.stderr || '').trim() };
}

function workflowsUnder(root) {
    const dir = join(root, '.github', 'workflows');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
        .map((n) => join(dir, n))
        .sort();
}

// ── the negative control ─────────────────────────────────────────────────────
// A reader that accepts everything reports the same green as one that works, and
// this script's whole subject is a check that had never been red. So the mutants
// run on EVERY invocation, against a workflow shaped like the ones being judged:
// each must be refused, and the unmutated control must be accepted. Same
// construction as `check-workflow-run-syntax.mjs`'s PWSH_MUST_REJECT.
const CONTROL_WORKFLOW = `name: Probe

on:
  push:
    branches: ["main"]

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Say something
        run: echo "sha is \${{ github.sha }}"
`;

/** Each entry must be REFUSED by the reader named. */
const MUTANTS = [
    ['unparseable YAML', (s) => s.replace('["main"]', '["main"'), 'actionlint'],
    ['a misspelled runs-on', (s) => s.replace('runs-on:', 'runs_on:'), 'actionlint'],
    ['an action reference with no ref', (s) => s.replace('actions/checkout@v4', 'actions/checkout'), 'actionlint'],
    ['a property no context defines', (s) => s.replace('github.sha', 'github.shaX'), 'actionlint'],
    ['a misspelled jobs section', (s) => s.replace('\njobs:', '\njbos:'), 'actionlint'],
    ['an unterminated shell block', (s) => s.replace('run: echo "sha', 'run: |\n          if [ -z "$x" ]; then\n            echo "sha'), 'run-syntax'],
];

function selfTest() {
    const failures = [];
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-scaffold-selftest-'));
    const wfDir = join(dir, '.github', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const file = join(wfDir, 'probe.yml');

    const judge = (reader) => {
        if (reader === 'actionlint') return haveActionlint ? actionlint([file]) : 'unread';
        return runSyntax(dir);
    };

    // The control first: a reader that refuses everything would "catch" every
    // mutant and prove nothing.
    writeFileSync(file, CONTROL_WORKFLOW);
    for (const reader of ['actionlint', 'run-syntax']) {
        const verdict = judge(reader);
        if (verdict !== null && verdict !== 'unread') {
            failures.push(`${reader} refused the UNMUTATED control workflow: ${verdict.message}`);
        }
    }

    for (const [label, mutate, reader] of MUTANTS) {
        writeFileSync(file, mutate(CONTROL_WORKFLOW));
        const verdict = judge(reader);
        if (verdict === 'unread') continue;
        if (verdict === null) failures.push(`${reader} accepted ${label} — it is not discriminating`);
    }

    rmSync(dir, { recursive: true, force: true });
    return failures;
}

// ── coverage: no scaffolder without a reader ─────────────────────────────────

/**
 * Source with `/* *​/` and `//` comments blanked out.
 *
 * Deliberately crude — it is a GREP's input, not a parser's. A `//` inside a
 * string literal would be blanked too; the cost of that is a scaffolder whose
 * only workflow path is spelled inside a URL, which no scaffolder in this tree
 * has and which would fail loudly in the SCAFFOLDERS-names-a-missing-file
 * direction rather than quietly in the other.
 */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function coverage(repo) {
    const cliSrc = join(repo, 'packages', 'infra', 'cli', 'src');
    const known = new Set(SCAFFOLDERS.map((s) => join(repo, s.source)));
    const found = [];

    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
            // COMMENTS STRIPPED FIRST, and that is not tidiness. The first version of
            // this scan read the raw text and named `utils/gjsify-shim.ts`, which
            // writes a `node` shim and mentions `.github/workflows/release-cut.yml`
            // in a prose comment about a bootstrap trap. A coverage rule that cries
            // wolf gets an exception list, and an exception list is where the real
            // scaffolder eventually hides.
            const code = stripComments(readFileSync(full, 'utf-8'));
            // A path under `.github/workflows` reached by a writer. `writeFileSync`
            // is how a scaffolder's output lands on disk; a file that only READS one
            // (the CI checks in `scripts/`) is not a scaffolder.
            if (/\.github\/workflows/.test(code) && /writeFileSync/.test(code)) found.push(full);
        }
    };
    walk(cliSrc);

    const failures = [];
    for (const file of found) {
        if (!known.has(file)) {
            failures.push(
                `${relative(repo, file)} writes a .github/workflows path and is in no SCAFFOLDERS entry. ` +
                    'Add it, and wire its suite to run this script over the output — a scaffolded workflow ' +
                    'that nothing parses is the class this check exists for.',
            );
        }
    }
    for (const entry of SCAFFOLDERS) {
        if (!existsSync(join(repo, entry.source))) {
            failures.push(`SCAFFOLDERS names ${entry.source}, which does not exist. It moved or was deleted.`);
        }
        if (!existsSync(join(repo, entry.suite))) {
            failures.push(`SCAFFOLDERS names the suite ${entry.suite}, which does not exist.`);
        }
    }
    return failures;
}

// ── main ─────────────────────────────────────────────────────────────────────

const selfFailures = selfTest();
if (selfFailures.length > 0) {
    console.error('scaffolded-workflow: the readers do not discriminate, so a green run would mean nothing:');
    for (const f of selfFailures) console.error(`  · ${f}`);
    process.exit(1);
}

if (flag('--coverage')) {
    const repo = value('--repo', REPO_DEFAULT);
    const failures = coverage(repo);
    if (failures.length > 0) {
        console.error('scaffolded-workflow: a workflow scaffolder is unaccounted for:');
        for (const f of failures) console.error(`  · ${f}`);
        process.exit(1);
    }
    console.log(`OK — ${SCAFFOLDERS.length} workflow scaffolder(s), each named with the suite that reads its output.`);
    process.exit(0);
}

const root = value('--root');
if (root === undefined) {
    console.error('usage: check-scaffolded-workflow.mjs --root <dir> [--require-actionlint] | --coverage [--repo <dir>]');
    process.exit(2);
}

const files = workflowsUnder(root);
if (files.length === 0) {
    console.error(
        `scaffolded-workflow: no workflow under ${join(root, '.github/workflows')}. ` +
            'The scaffolder wrote nothing, or wrote it somewhere this cannot see — either way the readers ' +
            'below would have passed having read nothing.',
    );
    process.exit(1);
}

const failures = [];

if (haveActionlint) {
    const bad = actionlint(files);
    if (bad) failures.push(`actionlint:\n${bad.message}`);
} else if (flag('--require-actionlint')) {
    // Same shape as `check-workflow-run-syntax.mjs --require-pwsh`: on a host that
    // is supposed to have the reader, not having it IS the failure, because the one
    // leg that exists to run it would otherwise pass by skipping all of it.
    failures.push(
        `actionlint is not on PATH and --require-actionlint was passed. It is the reader that catches six of ` +
            'the seven mutations this script measures; skipping it quietly is what the flag exists to prevent.',
    );
}

const badShell = runSyntax(root);
if (badShell) failures.push(`run-syntax:\n${badShell.message}`);

if (failures.length > 0) {
    console.error(`scaffolded-workflow: ${files.length} scaffolded workflow(s) under ${root} were refused:`);
    for (const f of failures) console.error(`\n${f}`);
    process.exit(1);
}

console.log(`OK — ${files.length} scaffolded workflow(s) parse and lint.`);
if (!haveActionlint) {
    // NAMED, not silent: the stronger of the two readers did not run, and a reader
    // that did not run must never look like one that passed.
    console.log('   actionlint is NOT on PATH — the document-level reader did not run on this host.');
}
process.exit(0);
