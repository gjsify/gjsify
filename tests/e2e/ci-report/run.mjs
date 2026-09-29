// Unit test for `scripts/lib/ci-report.mjs` (the shared GitHub Actions failure
// reporter `ci-why` reads via check-run annotations, docs/ci-selective.md) and for
// `scripts/e2e-annotate-reporter.mjs`, the `node --test` reporter built on it.
//
// Pure logic, no subprocess: like `tests/e2e/node-gi-consumer-harness/run.mjs`,
// this imports the modules' exports directly rather than spawning them, because
// there is nothing here a real CI run is needed to exercise — `GITHUB_ACTIONS` is
// read through `process.env`, which a test can set directly, and the reporter
// consumes an event list a test can hand it. What genuinely needs a real Actions
// run (does `ci-why` actually SURFACE an emitted annotation) is proved once, live,
// per the task's own "prove it" step — not re-litigated here.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-report/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const MODULE = join(MONOREPO_ROOT, 'scripts', 'lib', 'ci-report.mjs');
const REPORTER = join(MONOREPO_ROOT, 'scripts', 'e2e-annotate-reporter.mjs');

const { reportFailure, _resetAnnotationCountForTests } = await import(pathToFileURL(MODULE).href);
const { default: annotateReporter } = await import(pathToFileURL(REPORTER).href);

/** Captures every `console.log` call made during (possibly async) `fn()`, restoring it after. */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (line) => lines.push(line);
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines;
}

/** Drives the reporter over a synthetic `node --test` event list; it writes nothing itself. */
async function drain(events) {
    const chunks = [];
    for await (const chunk of annotateReporter(events)) chunks.push(chunk);
    return chunks;
}

/** The annotation's own `file=` value: repo-relative, `/`-separated, whatever the cwd. */
const annotationKey = (file) => relative(process.cwd(), file).split('\\').join('/');

const savedEnv = { GITHUB_ACTIONS: undefined };

beforeEach(() => {
    savedEnv.GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;
    _resetAnnotationCountForTests();
});

afterEach(() => {
    if (savedEnv.GITHUB_ACTIONS === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = savedEnv.GITHUB_ACTIONS;
});

describe('reportFailure: off CI is silent', () => {
    it('emits nothing when GITHUB_ACTIONS is unset', async () => {
        delete process.env.GITHUB_ACTIONS;
        const lines = await captureLog(() => reportFailure({ title: 't', message: 'm' }));
        assert.deepEqual(lines, []);
    });

    it('emits nothing when GITHUB_ACTIONS is "false" (a matrix leg opting out, not just unset)', async () => {
        process.env.GITHUB_ACTIONS = 'false';
        const lines = await captureLog(() => reportFailure({ title: 't', message: 'm' }));
        assert.deepEqual(lines, []);
    });
});

describe('reportFailure: on CI', () => {
    beforeEach(() => {
        process.env.GITHUB_ACTIONS = 'true';
    });

    it('emits a bare ::error:: with just a message', async () => {
        const lines = await captureLog(() => reportFailure({ message: 'plain failure' }));
        assert.deepEqual(lines, ['::error::plain failure']);
    });

    it('carries file, line and title as one comma-joined property list', async () => {
        const lines = await captureLog(() =>
            reportFailure({ title: 'check-x', file: 'scripts/check-x.mjs', line: 42, message: 'went wrong' }),
        );
        assert.deepEqual(lines, ['::error file=scripts/check-x.mjs,line=42,title=check-x::went wrong']);
    });

    it('omits file/line when not given, without leaving a stray comma', async () => {
        const lines = await captureLog(() => reportFailure({ title: 'check-x', message: 'went wrong' }));
        assert.deepEqual(lines, ['::error title=check-x::went wrong']);
    });

    it('escapes %, \\r and \\n in the message body', async () => {
        const lines = await captureLog(() => reportFailure({ message: '100% done\r\nnext line' }));
        assert.deepEqual(lines, ['::error::100%25 done%0D%0Anext line']);
    });

    it('escapes %, \\r, \\n AND :/, in a property value', async () => {
        const lines = await captureLog(() =>
            reportFailure({ title: 'describe: nested, case', file: 'a,b:c', message: 'm' }),
        );
        // A raw `:` or `,` in a property would split or drop the field silently —
        // this is the exact defect class `ci-report` exists to close (see the
        // module header). Assert the RAW annotation line rather than re-parsing
        // it, so the test fails loudly if the escaping regresses.
        assert.deepEqual(lines, ['::error file=a%2Cb%3Ac,title=describe%3A nested%2C case::m']);
    });

    it('caps at 10 annotations + one truncation notice, and escapes that notice title too', async () => {
        const lines = await captureLog(() => {
            for (let i = 0; i < 13; i++) reportFailure({ message: `failure ${i}` });
        });
        assert.equal(lines.length, 11, `expected 10 annotations + 1 truncation line, got:\n${lines.join('\n')}`);
        for (let i = 0; i < 10; i++) assert.match(lines[i], new RegExp(`failure ${i}$`));
        // The notice's own `title=` goes through escapeProperty like any other —
        // a raw `:` there is the defect class this module exists to close.
        assert.ok(
            lines[10].startsWith('::error title=ci-report%3A annotations truncated::'),
            `notice title must be escaped: ${lines[10]}`,
        );
        assert.match(lines[10], /annotations truncated/);
        assert.match(lines[10], /suppressed/);
    });

    it('the cap is per PROCESS state, not per call — a reset starts a fresh budget', async () => {
        await captureLog(() => {
            for (let i = 0; i < 10; i++) reportFailure({ message: `a${i}` });
        });
        const swallowed = await captureLog(() => reportFailure({ message: 'past the cap' }));
        assert.deepEqual(swallowed, []);
        _resetAnnotationCountForTests();
        const afterReset = await captureLog(() => reportFailure({ message: 'fresh budget' }));
        assert.deepEqual(afterReset, ['::error::fresh budget']);
    });
});

describe('e2e-annotate-reporter: one annotation per file, first failing LEAF', () => {
    beforeEach(() => {
        process.env.GITHUB_ACTIONS = 'true';
    });

    const failEvent = (file, name, message, nesting) => ({
        type: 'test:fail',
        data: { name, nesting, file, details: { error: { message } } },
    });

    it('annotates the nested failing test itself, not the suite wrapper that follows it', async () => {
        const file = join(MONOREPO_ROOT, 'tests', 'e2e', 'example', 'run.mjs');
        const events = [
            // A child fails BEFORE its enclosing `describe` does, so the wrapper's
            // event arrives second — with only "1 subtest failed" as its message.
            failEvent(file, 'nested boom', 'boom nested', 1),
            failEvent(file, 'outer suite', '1 subtest failed', 0),
        ];
        const lines = await captureLog(() => drain(events));
        assert.deepEqual(lines, [
            `::error file=${annotationKey(file)},title=e2e%3A ${annotationKey(file)}::nested boom: boom nested`,
        ]);
    });

    it('keeps one annotation per file, and gives a second failing file its own', async () => {
        const a = join(MONOREPO_ROOT, 'tests', 'e2e', 'a-suite', 'run.mjs');
        const b = join(MONOREPO_ROOT, 'tests', 'e2e', 'b-suite', 'run.mjs');
        const events = [
            failEvent(a, 'first test', 'first error', 0),
            failEvent(a, 'second test', 'second error', 1),
            failEvent(b, 'other suite test', 'other error', 1),
        ];
        const lines = await captureLog(() => drain(events));
        assert.equal(lines.length, 2, `expected exactly one annotation per file, got:\n${lines.join('\n')}`);
        assert.ok(lines[0].startsWith(`::error file=${annotationKey(a)},`), lines[0]);
        assert.ok(lines[0].endsWith('::first test: first error'), lines[0]);
        assert.ok(lines[1].startsWith(`::error file=${annotationKey(b)},`), lines[1]);
        assert.ok(lines[1].endsWith('::other suite test: other error'), lines[1]);
    });
});
