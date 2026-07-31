// E2E for `@gjsify/unit`'s `it.failing` — the expected-failure marker.
//
// `it.failing` exists for a test that asserts the CORRECT behaviour against a
// defect we cannot fix from here (an upstream bug, a platform gap). It is
// categorically not `it.skip`:
//
//   - a skip stops running the code, so it hides forever and nothing ever
//     tells you the day the bug is fixed;
//   - `it.failing` RUNS the test, tolerates the failure it was told to expect,
//     and FAILS THE SUITE the moment the test starts passing — because then
//     the marker has outlived its cause and must be removed.
//
// That second half is the whole value, and it is the half that cannot be
// asserted from inside the suite it would turn red. So it is asserted here, in
// a child process, on the EXIT CODE — the thing CI actually gates on.
//
// First consumer: `@gjsify/webrtc`'s "send/receive empty string" data-channel
// test. GStreamer's webrtcdatachannel sends a zero-length buffer for the
// STRING_EMPTY PPID while RFC 8831 §6.6 requires exactly one zero byte, which
// closes the channel and silently drops every later message. Not reachable
// from JS, so the test stays red until upstream is fixed — and this marker is
// what turns that from a permanently-red suite into a tracked, self-retiring
// exception.
//
// Harness shape mirrors `tests/e2e/unit-fail-attribution`: the fixture entry is
// built from inside `packages/gjs/unit/src` so the bare `@gjsify/unit`
// self-import resolves through the workspace, and each bundle runs in its own
// child process so the runner's module-global counters stay isolated.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, rmSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const UNIT_SRC = join(MONOREPO_ROOT, 'packages', 'gjs', 'unit', 'src');

let tmpDir;

function buildEntryFromUnitSrc(entryName, source, outFile) {
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

/** Run a built bundle, returning `{ status, out }` without throwing on non-zero. */
function runBundle(outFile) {
    try {
        const out = execFileSync('node', [outFile], { stdio: 'pipe', timeout: 60 * 1000, encoding: 'utf8' });
        return { status: 0, out };
    } catch (err) {
        return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

// A marked test that fails, as declared. The suite must stay GREEN.
const EXPECTED_FAILURE_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async XfailSuite() {
        await describe('upstream gap', async () => {
            await it.failing(
                'asserts the spec-correct behaviour upstream does not implement',
                async () => { expect('actual').toBe('spec-correct'); },
                'pretend upstream defect, tracked at example#1',
            );
            await it('an ordinary neighbour still passes', async () => { expect(1).toBe(1); });
        });
    },
});
`;

// A marked test that PASSES. Upstream is fixed, the marker is now a lie, and
// the run that proves it is the run that must say so.
const UNEXPECTED_PASS_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async XfailStaleSuite() {
        await describe('upstream gap', async () => {
            await it.failing(
                'asserts behaviour that upstream has since implemented',
                async () => { expect(1).toBe(1); },
                'pretend upstream defect, tracked at example#1',
            );
        });
    },
});
`;

// oxlint-disable-next-line no-control-regex -- ANSI SGR sequences are ESC-prefixed by design
const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

describe('@gjsify/unit it.failing', () => {
    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-it-failing-'));
    });
    after(() => {
        if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('an expected failure does not fail the suite', () => {
        const outFile = join(tmpDir, 'xfail.mjs');
        buildEntryFromUnitSrc('__e2e_xfail_entry.mts', EXPECTED_FAILURE_SUITE, outFile);
        const { status, out } = runBundle(outFile);
        const clean = stripAnsi(out);

        assert.equal(status, 0, `expected exit 0, got ${status}:\n${clean}`);
        assert.match(clean, /expected failure/, 'the marked test should report as an expected failure');
        assert.match(clean, /1 expected failure/, 'the summary should report the xfail count');
        assert.doesNotMatch(clean, /tests failed/, 'an expected failure must not be charged as a failure');
    });

    it('a marked test that PASSES fails the suite and says to remove the marker', () => {
        const outFile = join(tmpDir, 'xfail-stale.mjs');
        buildEntryFromUnitSrc('__e2e_xfail_stale_entry.mts', UNEXPECTED_PASS_SUITE, outFile);
        const { status, out } = runBundle(outFile);
        const clean = stripAnsi(out);

        // The self-retiring property, asserted on what CI gates on.
        assert.equal(status, 1, `expected exit 1 when a marker goes stale, got ${status}:\n${clean}`);
        assert.match(clean, /passed unexpectedly/, 'the failure must name the cause');
        assert.match(clean, /remove the marker/, 'the failure must say what to do about it');
        // The reason travels with the diagnostic so the reader need not dig.
        assert.match(clean, /pretend upstream defect, tracked at example#1/);
    });
});
