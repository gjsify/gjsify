// Unit test for the failure CLASSIFIER of `scripts/node-gi-consumer-harness.mjs`
// — the node-gi consumer survey harness (AGENTS.md "Axis 5 active track").
//
// Why this is worth pinning: the harness's grouped output IS
// `docs/reports/node-gi-consumer-survey.{md,json}`, and that report drives the
// prioritised P1/P2/P3 work list. A bucket assigned from the wrong text sends
// engine work at a root cause that isn't there.
//
// The bug this guards against: `classify()` used to match its rules against the
// samples PLUS the run's whole captured stdout —
//
//     const hay = (samples.join('\n') + '\n' + fullText).slice(0, 8000);
//
// — so a suite that is 95% GREEN could be filed under whatever a PASSING test
// name happened to mention. `@gjsify/node-globals` is the committed instance:
// three `structuredClone` assertion failures, filed under `mainloop-drain`
// because unrelated passing tests in the same run mention microtask/MainLoop.
//
// Two properties are pinned here, because both are load-bearing for the report:
//
//   1. SCOPE — a bucket may only come from the failure region (the failed
//      tests' messages, or the error lines of a build/load failure), never from
//      passing output; and a test NAME is prose, not a signature.
//   2. PRECEDENCE — `REASON_RULES` is an ordered ARRAY and the order decides;
//      it is never incidental to object-key order. The bucket NAMES are pinned
//      too: they are the report's committed vocabulary, so a rename has to be a
//      deliberate edit here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/node-gi-consumer-harness/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const HARNESS = join(MONOREPO_ROOT, 'scripts', 'node-gi-consumer-harness.mjs');

const { classify, collectFailures, formatFailure, parseSummary, stageTestAssets, REASON_RULES, STAGED_ASSET_DIRS } =
    await import(`file://${HARNESS}`);

/** Bucket a raw captured run, exactly as the harness does. */
const bucketOf = (stdout) => classify(collectFailures(stdout));

/** A run that is mostly green: `passing` test names, then the given failures. */
function run(passing, failures, summary) {
    const lines = passing.map((name) => `  ✔ ${name}  (0.4ms)`);
    for (const [name, message] of failures) {
        lines.push(`  ❌ ${name}  (1.2ms)`, message);
    }
    if (summary) lines.push('', summary);
    return lines.join('\n');
}

describe('node-gi consumer harness: classification scope', () => {
    it('ignores passing-test noise — the @gjsify/node-globals regression', () => {
        // Verbatim shape of the committed survey's node-globals[bun] row: three
        // structuredClone assertion failures in an otherwise green run whose
        // PASSING names mention microtask / MainLoop / g_main.
        const stdout = run(
            [
                'queueMicrotask should drain the microtask queue',
                'setTimeout should not need a MainLoop',
                'g_main context is not required for timers',
            ],
            [
                ['should clone Error with cause', 'Expected values to match using ==='],
                ['should clone Blob preserving type and size', 'Expected values to match using ==='],
                ['should clone File preserving name and lastModified', 'Expected values to match using ==='],
            ],
            '❌ [Node.js 24.3.0] 3 of 221 tests failed (2.4s)',
        );
        assert.equal(bucketOf(stdout), 'assertion-mismatch');
    });

    it('does not bucket on a passing test name that mentions a typelib', () => {
        const stdout = run(
            ['resolves a Typelib file for namespace Gtk lazily', 'cannot open display is reported as an error'],
            [['should compute the checksum', 'Expected values to match using ===']],
            '❌ [Node.js 24.15.0] 1 of 40 tests failed (0.9s)',
        );
        assert.equal(bucketOf(stdout), 'assertion-mismatch');
    });

    it('does not bucket on a FAILING test name either — only on its message', () => {
        // `@gjsify/unit`'s TimeoutError quotes the test name into its message,
        // which is the one way a name reaches the haystack at all.
        const stdout = run(
            [],
            [
                [
                    'should assert the typelib is marshalled',
                    'Timeout: "should assert the typelib is marshalled" exceeded 5000ms',
                ],
            ],
            '❌ [Node.js 24.15.0] 1 of 85 tests failed (5.1s)',
        );
        assert.equal(bucketOf(stdout), 'mainloop-drain');
    });

    it('keys off the failure region for a build/load failure with no per-test markers', () => {
        const stdout = [
            'file:///x/dist/test.node-gi.harness.http.mjs:12',
            'Error: Failed to require GjsifyHttpSoupBridge 1.0: Typelib file for namespace' +
                " 'GjsifyHttpSoupBridge', version '1.0' not found",
        ].join('\n');
        assert.equal(bucketOf(stdout), 'missing-typelib');
    });

    it('returns `other` rather than guessing when no rule matches the failure', () => {
        const stdout = run(
            ['round-trips a GBytes through the marshaller'], // would have matched marshalling-gap
            [['Int32Array', 'The value of "sourceStart" is out of range. It must be >= 0 && <= 17. Received 2445']],
            '❌ [Node.js 24.15.0] 1 of 60 tests failed (0.7s)',
        );
        assert.equal(bucketOf(stdout), 'other');
    });

    it('classifies exactly the samples the report prints beside the reason', () => {
        // The attribution has to be checkable by eye in the committed report:
        // if none of the listed samples carries the signature, the bucket is
        // wrong. Same records feed `classify()` and the report.
        const stdout = run(
            ['a microtask drains'],
            [['should read subprocess stdout', "Cannot read properties of undefined (reading 'fromGBytes')"]],
            '❌ [Node.js 24.15.0] 1 of 12 tests failed (0.5s)',
        );
        const failures = collectFailures(stdout);
        const samples = failures.map(formatFailure);
        assert.deepEqual(samples, [
            "should read subprocess stdout — Cannot read properties of undefined (reading 'fromGBytes')",
        ]);
        assert.equal(classify(failures), 'marshalling-gap');
    });

    it('does not treat the @gjsify/unit summary line as a failure sample', () => {
        // The summary also starts with ❌; it is a counter, and `parseSummary`
        // already reads it.
        const stdout = run(
            [],
            [['gunzip async should decompress concatenated gzip members', 'failed to write whole buffer']],
            '❌ [Node.js 24.15.0] 1 of 53375 tests failed (41.2s)',
        );
        const samples = collectFailures(stdout).map(formatFailure);
        assert.equal(samples.length, 1);
        assert.ok(!samples.some((s) => /tests failed/.test(s)), `summary leaked into samples: ${samples.join(' | ')}`);
        assert.deepEqual(parseSummary(stdout), { total: 53375, failed: 1, passed: 53374 });
    });
});

describe('node-gi consumer harness: rule precedence', () => {
    it('is an ordered array, so precedence cannot drift with key order', () => {
        assert.ok(Array.isArray(REASON_RULES));
        for (const [pattern, group] of REASON_RULES) {
            assert.ok(pattern instanceof RegExp);
            assert.equal(typeof group, 'string');
        }
    });

    it('pins the bucket vocabulary + order the committed report depends on', () => {
        assert.deepEqual(
            REASON_RULES.map(([, group]) => group),
            [
                'needs-GTK-display',
                'needs-GStreamer',
                'needs-Soup-typelib',
                'needs-WebKit',
                'needs-Manette',
                'missing-typelib',
                'needs-gjs-imports-runtime',
                'marshalling-gap',
                'runtime-typeerror-or-unimpl',
                'mainloop-drain',
                'assertion-mismatch',
                'build-error',
            ],
        );
    });

    it('prefers the specific signature when a message matches several rules', () => {
        // "…(reading 'fromGBytes')" is both a GBytes marshalling signature and
        // the generic `Cannot read propert…` TypeError shape — marshalling wins.
        assert.equal(
            classify([{ name: 'x', message: "Cannot read properties of undefined (reading 'fromGBytes')" }]),
            'marshalling-gap',
        );
        // A NAMED typelib beats the generic typelib catch-all.
        assert.equal(
            classify([{ name: 'x', message: "Typelib file for namespace 'Gtk', version '4.0' not found" }]),
            'needs-GTK-display',
        );
        // A timed-out test never reached its assertion.
        assert.equal(
            classify([{ name: 'x', message: 'Timeout: "expect toBe eventually" exceeded 5000ms' }]),
            'mainloop-drain',
        );
    });
});

// A suite resolves its on-disk assets RELATIVE TO THE BUNDLE. The package's own
// test bundle sits at the package root; the harness builds into `dist/`, so
// every such path is off by one directory unless the harness bridges it. When
// it does not, the suite fails for a HARNESS reason and lands in the survey as
// if it were a node-gi finding — `@gjsify/fs` was recorded as a hard fail for
// exactly this (`join(__dirname, 'test/watch.js')`, survey gap 7), so what is
// pinned here is the SET of bridged dirs, not just that bridging happens.
describe('node-gi consumer harness: test-asset staging', () => {
    it('bridges every on-disk asset dir the suite may resolve from the bundle', () => {
        assert.ok(STAGED_ASSET_DIRS.includes('fixtures'), 'fixtures/ must stay bridged');
        assert.ok(
            STAGED_ASSET_DIRS.includes('test'),
            'test/ must be bridged — @gjsify/fs writes join(__dirname, "test/watch.js") (survey gap 7)',
        );
    });

    it('links each present dir to its package-root original, and skips absent ones', () => {
        const pkgDir = mkdtempSync(join(tmpdir(), 'gjsify-harness-assets-'));
        const distDir = join(pkgDir, 'dist');
        mkdirSync(distDir);
        // `fixtures/` and `test/` present, a third name absent.
        mkdirSync(join(pkgDir, 'fixtures'));
        mkdirSync(join(pkgDir, 'test'));
        writeFileSync(join(pkgDir, 'test', 'file.txt'), 'asset\n');
        writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'probe' }));

        stageTestAssets(pkgDir, distDir, 'gjsify-not-invoked', 1000);

        for (const name of STAGED_ASSET_DIRS) {
            assert.equal(readlinkSync(join(distDir, name)), `../${name}`, `${name} must link to the package root`);
        }
        // The link RESOLVES — the whole point is that the bundle's own relative
        // path lands on the real asset, not merely that a symlink exists.
        assert.equal(readFileSync(join(distDir, 'test', 'file.txt'), 'utf-8'), 'asset\n');
        assert.ok(!existsSync(join(distDir, 'absent')), 'a dir the package does not have must not be invented');

        rmSync(pkgDir, { recursive: true, force: true });
    });

    it('is idempotent — a second stage over an existing link is a no-op', () => {
        const pkgDir = mkdtempSync(join(tmpdir(), 'gjsify-harness-assets-'));
        const distDir = join(pkgDir, 'dist');
        mkdirSync(distDir);
        mkdirSync(join(pkgDir, 'test'));
        writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'probe' }));

        stageTestAssets(pkgDir, distDir, 'gjsify-not-invoked', 1000);
        stageTestAssets(pkgDir, distDir, 'gjsify-not-invoked', 1000);

        assert.equal(readlinkSync(join(distDir, 'test')), '../test');
        rmSync(pkgDir, { recursive: true, force: true });
    });
});
