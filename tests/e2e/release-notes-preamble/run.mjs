// E2E test for the prose preamble half of `scripts/check-changelog-references.mjs`
// (`--release-notes <version>` composing `docs/release-notes/next.md` above the
// generated changelog section).
//
// WHY THIS SUITE EXISTS
//
// The script runs in exactly one place: `.release-it.json`'s `github.releaseNotes`,
// during a release cut. No pull request executes it, and `release-it --dry-run`
// skips `releaseNotes` entirely — the same coverage hole that shipped v0.28.0's
// bundle gate dead (see tests/e2e/release-bundle-gate). Its stdout IS the published
// release body, so a defect here is public before it is noticed.
//
// The load-bearing case is STALENESS. A missing preamble is deliberately advisory,
// so the residual risk is not an absent body — it is the PREVIOUS release's prose
// reappearing verbatim under a new version, which is a confidently wrong artefact
// rather than a thin one. Git decides: the file counts only if a commit touched it
// since the last tag. That is asserted here from both sides, because "included when
// it should be" and "dropped when it is stale" are different failures and only one
// of them is visible by reading the body.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/release-notes-preamble/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'check-changelog-references.mjs');
const PROSE_PATH = join('docs', 'release-notes', 'next.md');

/**
 * A minimal but VALID release section. The script's structural assertions require
 * the infile to carry at least one real issue link and one real commit link — "no
 * findings" over a file it could not parse is the same green as a clean one — so a
 * fixture that omits them would fail for the wrong reason.
 */
const SECTION = `# Changelog

## [0.28.0](https://github.com/gjsify/gjsify/compare/v0.27.1...v0.28.0) (2026-08-04)

### Bug Fixes

* gate changelog links on naming their target ([#975](https://github.com/gjsify/gjsify/issues/975)) ([c548435](https://github.com/gjsify/gjsify/commit/c548435c3629b333e678e23d9eb328dff9190fef))
`;

const git = (dir, ...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * A throwaway repo shaped like the real one at notes time: origin is the slug the
 * link detector compares text against, `v0.28.0` is the PREVIOUS release (the cut
 * has not tagged the new one yet — `--release-notes` runs at `github:beforeRelease`,
 * before `Git.release()`), and CHANGELOG.md already holds the regenerated section.
 *
 * `prose` is written and committed BEFORE the tag when `stale`, after it otherwise.
 */
function fixture({ prose = null, stale = false, tagged = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-relnotes-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'remote', 'add', 'origin', 'https://github.com/gjsify/gjsify.git');
    writeFileSync(join(dir, 'CHANGELOG.md'), SECTION);

    const writeProse = () => {
        mkdirSync(join(dir, 'docs', 'release-notes'), { recursive: true });
        writeFileSync(join(dir, PROSE_PATH), prose);
        git(dir, 'add', '-A');
        git(dir, 'commit', '-qm', 'prose');
    };

    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'changelog');
    if (prose !== null && stale) writeProse();
    if (tagged) git(dir, 'tag', 'v0.28.0');
    if (prose !== null && !stale) writeProse();
    return dir;
}

/**
 * `GITHUB_STEP_SUMMARY` is always set explicitly, never inherited.
 *
 * Not hygiene — the ambient one is a TRAP here. main.yml runs the e2e suites as
 * `testuser` via `su`, and the runner's `_runner_file_commands/step_summary_*` file
 * is root-owned, so an inherited path made every append raise EACCES and took the
 * whole run down. Pointing it into the fixture also turns the accident into an
 * assertion: the step summary is the ONLY channel an advisory here can use (stdout
 * is the release body, stderr is swallowed by release-it on success), so the tests
 * read it rather than trusting that claim.
 */
function run(dir, version = '0.28.0', summary = join(dir, 'step-summary.md')) {
    const r = spawnSync(process.execPath, [SCRIPT, '--release-notes', version], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    return {
        status: r.status,
        body: r.stdout,
        err: r.stderr,
        summary: existsSync(summary) ? readFileSync(summary, 'utf8') : null,
    };
}

const SECTION_BODY = SECTION.slice(SECTION.indexOf('## [0.28.0]')).trim();

describe('release notes preamble', () => {
    it('publishes the section alone when there is no preamble file', () => {
        const dir = fixture();
        try {
            const { status, body, err, summary } = run(dir);
            assert.equal(status, 0, err);
            assert.equal(body.trim(), SECTION_BODY);
            assert.match(err, /NO PREAMBLE — no preamble at/);
            // The advisory's only real channel — a cut's stderr is swallowed.
            assert.match(summary ?? '', /NO PREAMBLE — no preamble at/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('treats a comments-only file as no prose, not as an empty preamble', () => {
        // The reset state of the template. Publishing it would put a bare `---`
        // separator above the section — present, saying nothing.
        const dir = fixture({ prose: '<!-- write the next release notes here -->\n' });
        try {
            const { status, body, err } = run(dir);
            assert.equal(status, 0, err);
            assert.equal(body.trim(), SECTION_BODY);
            assert.match(err, /NO PREAMBLE — .*has no prose/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('publishes prose written during this cycle, with the section verbatim below it', () => {
        const dir = fixture({ prose: '## What changed\n\nThe bundles ship their libraries now.\n' });
        try {
            const { status, body, err, summary } = run(dir);
            assert.equal(status, 0, err);
            assert.match(body, /^## What changed/);
            assert.ok(body.includes('\n\n---\n\n'), 'separator between preamble and generated section');
            assert.ok(body.includes(SECTION_BODY), 'the generated section survives verbatim');
            assert.match(err, /preamble = docs\/release-notes\/next\.md \(\d+ chars\)/);
            assert.match(summary ?? '', /preamble = docs\/release-notes\/next\.md \(\d+ chars\)/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('still emits the body when the step summary cannot be written', () => {
        // An unwritable SINK must not decide whether a release happens. This is the
        // shape that failed the first CI run of this suite: EACCES on the runner's
        // root-owned summary file aborted a run whose body was perfectly good.
        const dir = fixture({ prose: '## Fine\n\nProse.\n' });
        try {
            const { status, body, err, summary } = run(dir, '0.28.0', join(dir, 'missing-dir', 'summary.md'));
            assert.equal(status, 0, err);
            assert.ok(body.includes(SECTION_BODY), 'the body still reaches stdout');
            assert.equal(summary, null);
            assert.match(err, /cannot write \$GITHUB_STEP_SUMMARY/);
            // Degraded, not dropped: the lines it could not file go to stderr.
            assert.match(err, /preamble = docs\/release-notes\/next\.md/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('DROPS prose untouched since the last tag — it belongs to that release', () => {
        // The failure this guard exists for: with a missing preamble merely advisory,
        // nothing else would stop the 0.28.0 text from being republished as 0.29.0's.
        const dir = fixture({ prose: '## Old news\n\nThis shipped with 0.28.0.\n', stale: true });
        try {
            const { status, body, err } = run(dir);
            assert.equal(status, 0, err);
            assert.equal(body.trim(), SECTION_BODY);
            assert.ok(!body.includes('Old news'), 'stale prose must not reach the body');
            assert.match(err, /unchanged since v0\.28\.0 — it belongs to that release/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('publishes prose in a repo with no tag at all (first release)', () => {
        const dir = fixture({ prose: '## First\n\nHello.\n', tagged: false });
        try {
            const { status, body, err } = run(dir);
            assert.equal(status, 0, err);
            assert.match(body, /^## First/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails on a fabricated link in the preamble — same detector as the infile', () => {
        // The whole point of the surrounding gate. A hand-written paragraph is exactly
        // where this gets typed, and it would otherwise be the one unchecked producer
        // of the published body.
        const dir = fixture({
            prose: 'See [pre-#955](https://github.com/gjsify/pre-/issues/955) for context.\n',
        });
        try {
            const { status, err } = run(dir);
            assert.equal(status, 1);
            assert.match(err, /next\.md would publish/);
            assert.match(err, /pre-/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails on a version heading in the preamble', () => {
        const dir = fixture({ prose: '## [0.29.0](https://github.com/gjsify/gjsify/releases)\n\nNope.\n' });
        try {
            const { status, err } = run(dir);
            assert.equal(status, 1);
            assert.match(err, /has a version heading/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails when the preamble pushes the composed body past GitHub cap', () => {
        // `extractTopSection` caps the SECTION; a preamble is the only way to exceed
        // the cap without the section itself growing, so the composed body is capped too.
        const dir = fixture({ prose: `## Long\n\n${'x'.repeat(124001)}\n` });
        try {
            const { status, err } = run(dir);
            assert.equal(status, 1);
            assert.match(err, /composed body is \d+ chars/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('still refuses a section that does not name the version being released', () => {
        // Pre-existing guarantee, re-asserted because the emit path changed around it.
        const dir = fixture({ prose: '## Fine\n\nProse.\n' });
        try {
            const { status, err } = run(dir, '0.29.0');
            assert.equal(status, 1);
            assert.match(err, /top section is 0\.28\.0 but the release is 0\.29\.0/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
