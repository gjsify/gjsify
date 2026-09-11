// E2E test for `gjsify test`'s bundle-freshness decision (#1651).
//
// The defect this pins was invisible to every existing guard, and CI is the
// reason: a fresh container has no `dist/`, so `isFresh` returns false and the
// bundle is always built. The only party that meets a wrong freshness answer is
// whoever runs `gjsify test` locally — i.e. the person verifying a dependency
// bump or a refactor before pushing. So the suite must drive the REAL command
// twice over a tree that already has a bundle; a unit test on the predicate
// cannot see the argument the command passes it, and the argument was the bug
// (`dirname(<test entry>)` — `tests/`, never `src/`).
//
// Both arms, and the negative one is not optional:
//   POSITIVE — an edit under `src/` must rebuild. Before the fix this suite is
//              red: `gjsify test` reran the previous bundle and reported ✅ on
//              a version of the code that was no longer on disk.
//   NEGATIVE — a file OUTSIDE the input set must NOT rebuild. Without it the
//              suite also passes against `isFresh() { return false }`, which is
//              not a fix, it is the freshness check deleted.
//
// The marker is a STRING, deliberately. A comment does not survive
// minification, a genuine rebuild then comes out byte-identical, and an A/B
// over file hashes proves nothing.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/**
 * A package whose suite lives in `tests/` and whose code under test lives in
 * `src/` — the split that made `dirname(entry)` the wrong root. It is also the
 * layout `gjsify create` leaves behind and the one the consumer that found this
 * (postbote) has.
 */
function writeProject(projectDir, marker) {
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    mkdirSync(join(projectDir, 'tests'), { recursive: true });
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify(
            {
                name: 'test-freshness-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
                gjsify: { test: { entry: 'tests/test.mts' } },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeMarker(projectDir, marker);
    writeFileSync(
        join(projectDir, 'tests', 'test.mts'),
        ["import { MARKER } from '../src/lib.js';", 'console.log(`fixture marker: ${MARKER}`);', ''].join('\n'),
        'utf-8',
    );
}

function writeMarker(projectDir, marker) {
    writeFileSync(join(projectDir, 'src', 'lib.ts'), `export const MARKER = '${marker}';\n`, 'utf-8');
}

const bundleOf = (projectDir) => readFileSync(join(projectDir, 'dist', 'test.node.mjs'), 'utf-8');

describe('gjsify test — bundle freshness (#1651)', { timeout: 300_000 }, () => {
    let projectDir;

    const runTest = () =>
        runCli(CLI_ENTRY, ['test', '--runtime', 'node', '--verbose'], { cwd: projectDir, timeoutMs: 120_000 });

    /** What the run decided, read off the verbose log rather than inferred. */
    const rebuilt = (result) => {
        assert.equal(result.status, 0, `gjsify test failed:\n${result.stdout}\n${result.stderr}`);
        const log = `${result.stdout}${result.stderr}`;
        const built = log.includes('building →');
        const skipped = log.includes('bundle is up-to-date');
        assert.ok(built !== skipped, `log says neither built nor skipped:\n${log}`);
        return built;
    };

    before(async () => {
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-test-freshness-'));
        writeProject(projectDir, 'ALPHA_MARKER');
        assert.ok(rebuilt(await runTest()), 'the cold run must build');
        assert.match(bundleOf(projectDir), /ALPHA_MARKER/);
    });

    after(() => {
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('rebuilds when the code UNDER TEST changes (positive arm)', async () => {
        writeMarker(projectDir, 'BRAVO_MARKER');
        assert.ok(rebuilt(await runTest()), 'an edit under src/ must invalidate the bundle');
        // The artifact, not the log: the run has to have MEASURED the new code.
        const bundle = bundleOf(projectDir);
        assert.match(bundle, /BRAVO_MARKER/);
        assert.doesNotMatch(bundle, /ALPHA_MARKER/);
    });

    it('rebuilds for an input in a directory no allow-list anticipated', async () => {
        // `src/` and `tests/` are not privileged names — anything in the package
        // that is not an output is an input. A build genuinely may read `po/`,
        // `files/`, `data/`; `@gjsify/adwaita-fonts` has no `src/` at all.
        mkdirSync(join(projectDir, 'po'), { recursive: true });
        writeFileSync(join(projectDir, 'po', 'de.po'), 'msgid ""\n', 'utf-8');
        assert.ok(rebuilt(await runTest()), 'a file outside src/ and tests/ is still an input');
    });

    it('rebuilds when the dependency tree moves (lockfile)', async () => {
        // The bump that surfaced #1651 touched no file in the package at all.
        // `node_modules` is too large to stat per run, so the lockfile stands
        // in for it.
        writeFileSync(join(projectDir, 'gjsify-lock.json'), '{}\n', 'utf-8');
        assert.ok(rebuilt(await runTest()), 'a lockfile write must invalidate the bundle');
    });

    it('does NOT rebuild for its own output, or for node_modules and dot-dirs (negative arm)', async () => {
        assert.equal(rebuilt(await runTest()), false, 'an untouched tree must not rebuild');

        writeFileSync(join(projectDir, 'dist', 'stray.txt'), 'output\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'the command’s own outdir is not an input');

        mkdirSync(join(projectDir, 'node_modules', 'dep'), { recursive: true });
        writeFileSync(join(projectDir, 'node_modules', 'dep', 'index.js'), '// dep\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'node_modules is not walked');

        mkdirSync(join(projectDir, '.cache'), { recursive: true });
        writeFileSync(join(projectDir, '.cache', 'blob'), 'x\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'dot-entries are tool state, not inputs');

        mkdirSync(join(projectDir, 'lib'), { recursive: true });
        writeFileSync(join(projectDir, 'lib', 'out.js'), '// built\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'a conventional output dir is not an input');
    });

    it('still rebuilds after the negative arm, so the cache was not simply switched off', async () => {
        writeMarker(projectDir, 'CHARLIE_MARKER');
        assert.ok(rebuilt(await runTest()));
        assert.match(bundleOf(projectDir), /CHARLIE_MARKER/);
    });
});
