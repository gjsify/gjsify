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

// oxlint-disable-next-line no-control-regex -- ANSI SGR sequences are ESC-prefixed by design
const ANSI = /\x1B\[[0-9;]*m/g;
const stripAnsi = (s) => s.replace(ANSI, '');

function runBundle(outFile) {
    try {
        const stdout = execFileSync('node', [outFile], { stdio: 'pipe', timeout: 60 * 1000, encoding: 'utf8' });
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
        const itFailureLines = plain.split('\n').filter((l) => /❌\s+\S/.test(l) && !/tests failed/.test(l));
        assert.deepStrictEqual(itFailureLines, [], 'no real it() should be marked failed');

        // The count must equal the number of strays (1) — no divergence between
        // the summary count and the printed failures.
        assert.match(plain, /1 of \d+ tests failed/, 'count should reflect the 1 stray');

        // A genuine failure (the leak IS a real test bug) → non-zero exit.
        assert.notStrictEqual(code, 0, 'run with a stray must exit non-zero');
    });

    it('a clean suite (incl. toThrow-wrapped matcher) reports zero failures', () => {
        const out = join(tmpDir, 'clean.node.mjs');
        buildEntryFromUnitSrc('__e2e_clean_attribution.mts', CLEAN_SUITE, out);
        const { code, out: stdout } = runBundle(out);
        const plain = stripAnsi(stdout);

        // The summary's "N completed" counts expect() calls, not it()s. The
        // point is that it reports completed (0 failures), with all three it()s
        // green and no stray.
        assert.match(plain, /✔ \d+ completed/, 'clean run reports completed, 0 failed');
        assert.match(plain, /✔ passes 1/);
        assert.match(plain, /✔ toThrow does not leak/);
        assert.doesNotMatch(plain, /tests failed/, 'no failure summary');
        assert.doesNotMatch(plain, /outside any it\(\)/, 'no stray');
        assert.strictEqual(code, 0, 'clean run exits 0');
    });
});
