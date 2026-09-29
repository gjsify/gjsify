// Unit test for `scripts/lib/ci-report.mjs` — the shared GitHub Actions failure
// reporter `ci-why` reads via check-run annotations (docs/ci-selective.md).
//
// Pure logic, no subprocess: like `tests/e2e/node-gi-consumer-harness/run.mjs`,
// this imports the module's exports directly rather than spawning it, because
// there is nothing here a real CI run is needed to exercise — `GITHUB_ACTIONS`/
// `GITHUB_STEP_SUMMARY` are read through `process.env`, which a test can set
// directly. What genuinely needs a real Actions run (does `ci-why` actually
// SURFACE an emitted annotation) is proved once, live, per the task's own "prove
// it" step — not re-litigated here.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-report/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const MODULE = join(MONOREPO_ROOT, 'scripts', 'lib', 'ci-report.mjs');

const { reportFailure, summary, _resetAnnotationCountForTests } = await import(pathToFileURL(MODULE).href);

/** Captures every `console.log` call made during `fn()`, restoring it after. */
function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (line) => lines.push(line);
    try {
        fn();
    } finally {
        console.log = original;
    }
    return lines;
}

const savedEnv = { GITHUB_ACTIONS: undefined, GITHUB_STEP_SUMMARY: undefined };

beforeEach(() => {
    savedEnv.GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;
    savedEnv.GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
    _resetAnnotationCountForTests();
});

afterEach(() => {
    if (savedEnv.GITHUB_ACTIONS === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = savedEnv.GITHUB_ACTIONS;
    if (savedEnv.GITHUB_STEP_SUMMARY === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = savedEnv.GITHUB_STEP_SUMMARY;
});

describe('reportFailure: off CI is silent', () => {
    it('emits nothing when GITHUB_ACTIONS is unset', () => {
        delete process.env.GITHUB_ACTIONS;
        const lines = captureLog(() => reportFailure({ title: 't', message: 'm' }));
        assert.deepEqual(lines, []);
    });

    it('emits nothing when GITHUB_ACTIONS is "false" (a matrix leg opting out, not just unset)', () => {
        process.env.GITHUB_ACTIONS = 'false';
        const lines = captureLog(() => reportFailure({ title: 't', message: 'm' }));
        assert.deepEqual(lines, []);
    });
});

describe('reportFailure: on CI', () => {
    beforeEach(() => {
        process.env.GITHUB_ACTIONS = 'true';
    });

    it('emits a bare ::error:: with just a message', () => {
        const lines = captureLog(() => reportFailure({ message: 'plain failure' }));
        assert.deepEqual(lines, ['::error::plain failure']);
    });

    it('carries file, line and title as one comma-joined property list', () => {
        const lines = captureLog(() =>
            reportFailure({ title: 'check-x', file: 'scripts/check-x.mjs', line: 42, message: 'went wrong' }),
        );
        assert.deepEqual(lines, ['::error file=scripts/check-x.mjs,line=42,title=check-x::went wrong']);
    });

    it('omits file/line when not given, without leaving a stray comma', () => {
        const lines = captureLog(() => reportFailure({ title: 'check-x', message: 'went wrong' }));
        assert.deepEqual(lines, ['::error title=check-x::went wrong']);
    });

    it('escapes %, \\r and \\n in the message body', () => {
        const lines = captureLog(() => reportFailure({ message: '100% done\r\nnext line' }));
        assert.deepEqual(lines, ['::error::100%25 done%0D%0Anext line']);
    });

    it('escapes %, \\r, \\n AND :/, in a property value', () => {
        const lines = captureLog(() => reportFailure({ title: 'describe: nested, case', file: 'a,b:c', message: 'm' }));
        // A raw `:` or `,` in a property would split or drop the field silently —
        // this is the exact defect class `ci-report` exists to close (see the
        // module header). Assert the RAW annotation line rather than re-parsing
        // it, so the test fails loudly if the escaping regresses.
        assert.deepEqual(lines, ['::error file=a%2Cb%3Ac,title=describe%3A nested%2C case::m']);
    });

    it('caps at 10 annotations per process and states the truncation once', () => {
        const lines = captureLog(() => {
            for (let i = 0; i < 13; i++) reportFailure({ message: `failure ${i}` });
        });
        assert.equal(lines.length, 11, `expected 10 annotations + 1 truncation line, got:\n${lines.join('\n')}`);
        for (let i = 0; i < 10; i++) assert.match(lines[i], new RegExp(`failure ${i}$`));
        assert.match(lines[10], /annotations truncated/);
        assert.match(lines[10], /suppressed/);
    });

    it('the cap is per PROCESS state, not per call — a reset starts a fresh budget', () => {
        captureLog(() => {
            for (let i = 0; i < 10; i++) reportFailure({ message: `a${i}` });
        });
        const swallowed = captureLog(() => reportFailure({ message: 'past the cap' }));
        assert.deepEqual(swallowed, []);
        _resetAnnotationCountForTests();
        const afterReset = captureLog(() => reportFailure({ message: 'fresh budget' }));
        assert.deepEqual(afterReset, ['::error::fresh budget']);
    });
});

describe('summary()', () => {
    let dir;
    let file;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ci-report-summary-'));
        file = join(dir, 'summary.md');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('is a no-op off CI, even with GITHUB_STEP_SUMMARY set', () => {
        delete process.env.GITHUB_ACTIONS;
        process.env.GITHUB_STEP_SUMMARY = file;
        summary('# should not appear');
        assert.equal(existsOrEmpty(file), true, 'no-op must not even create the file');
    });

    it('is a no-op on CI with no GITHUB_STEP_SUMMARY destination', () => {
        process.env.GITHUB_ACTIONS = 'true';
        delete process.env.GITHUB_STEP_SUMMARY;
        // Must not throw for lack of a destination — a local `act` run or a step
        // that stripped the var is not a reporting failure.
        assert.doesNotThrow(() => summary('# should not appear'));
    });

    it('appends markdown to the summary file, adding a trailing newline', () => {
        process.env.GITHUB_ACTIONS = 'true';
        process.env.GITHUB_STEP_SUMMARY = file;
        summary('# heading');
        summary('- item (already has one)\n');
        assert.equal(readFileSync(file, 'utf8'), '# heading\n- item (already has one)\n');
    });
});

/** True whether `path` is absent OR empty — either way, nothing was written. */
function existsOrEmpty(path) {
    try {
        return readFileSync(path, 'utf8').length === 0;
    } catch (error) {
        if (error.code === 'ENOENT') return true;
        throw error;
    }
}
