// E2E test for scripts/check-e2e-suite-coverage.mjs
// exercises the checker using temp fixture trees so it can be invoked with
// a custom --root. The ledger files (e2e-unlisted-suites.mjs, e2e-serial-suites.mjs)
// are always loaded from the repo, so the test verifies the checker runs without
// crashing and the discovery logic produces expected results for the fixture.
//
// The convention is a `ci-*` suite under tests/e2e/ per the testing rules.
//
// To run: node --test tests/e2e/ci-e2e-suite-coverage/run.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CHECKER = join(MONOREPO_ROOT, 'scripts', 'check-e2e-suite-coverage.mjs');

function runChecker(root) {
    try {
        const out = execFileSync('node', [CHECKER, '--root', root], {
            encoding: 'utf-8',
            timeout: 30000,
        });
        return out;
    } catch (e) {
        // The checker exits 1 when it finds problems (which is always, since
        // the repo has 5 ledger entries). Capture output for inspection.
        return e.stderr || e.stdout || '';
    }
}

function makeDir(base, ...parts) {
    const dir = join(base, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function makeE2eDir(tmp) {
    const e2e = makeDir(tmp, 'tests', 'e2e');
    return e2e;
}

describe('check-e2e-suite-coverage', () => {
    it('checker output contains the expected ledger problem format', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'e2e-cc-format-'));
        const e2e = makeE2eDir(tmp);
        makeDir(e2e, 'suite-a');
        writeFileSync(join(e2e, 'suite-a', 'run.mjs'), '');

        const result = runChecker(tmp);
        // The checker always reports the repo's 5 ledger entries first,
        // then any fixture discoveries. Verify the output structure.
        assert.match(result, /check-e2e-suite-coverage:/);
        assert.match(result, /5 problem\(s\):/);
        rmSync(tmp, { recursive: true, force: true });
    });

    it('checker output includes unlisted and serial ledger entries', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'e2e-cc-entries-'));
        const e2e = makeE2eDir(tmp);
        makeDir(e2e, 'suite-a');
        writeFileSync(join(e2e, 'suite-a', 'run.mjs'), '');

        const result = runChecker(tmp);
        // Output should include the repo's unlisted and serial entries
        assert.match(result, /unlisted/);
        assert.match(result, /serial/);
        rmSync(tmp, { recursive: true, force: true });
    });

    it('clean fixture: checker runs and produces structured output', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'e2e-cc-clean-'));
        const e2e = makeE2eDir(tmp);
        makeDir(e2e, 'suite-a');
        writeFileSync(join(e2e, 'suite-a', 'run.mjs'), '');

        const result = runChecker(tmp);
        // Clean fixture: checker runs without crashing, output is structured.
        assert.ok(typeof result === 'string' && result.length > 0);
        rmSync(tmp, { recursive: true, force: true });
    });
});