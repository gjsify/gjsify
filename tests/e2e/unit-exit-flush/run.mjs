// E2E regression for @gjsify/unit's exit on Node: the recap must reach a SLOW pipe (#1999).
//
// `process.exit()` discards output still queued in a stream, and on macOS a stdout pipe is
// asynchronous in Node. Every CI log is a pipe, so a run that wrote more than the pipe held
// before the runner read it lost its TAIL — the recap, which is the only place a failure is
// named. The react-native suite on darwin exited 1 with its log cut off after a PASSING case,
// and "exited with code 1" was the whole report. A file redirect is synchronous, which is why
// every local reproduction attempt that saved the log came back green.
//
// The fixture writes far more than a pipe buffer holds, then fails one case. The harness holds
// off reading — the CI runner's reader falling behind — and asserts the recap still arrives.
// On Linux a stdout pipe is synchronous in Node, so there this passes with or without the fix;
// it is a regression test for the hosts where the queue exists.
//
// Built from inside packages/gjs/unit/src so the bare `@gjsify/unit` self-import resolves
// through the workspace, as unit-fail-attribution does.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, existsSync, rmSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const UNIT_SRC = join(MONOREPO_ROOT, 'packages', 'gjs', 'unit', 'src');

/** How long the reader stays away: far longer than the run takes to reach its exit. */
const READER_DELAY_MS = 1500;

const LOUD_FAILING_SUITE = `
import { run, describe, it, expect } from '@gjsify/unit';
run({
    async LoudSuite() {
        await describe('a run whose log outgrows the pipe', async () => {
            await it('writes about 2 MB', async () => {
                const line = 'x'.repeat(199);
                for (let i = 0; i < 10000; i++) console.log(line);
            });
            await it('the failure only the recap names', async () => {
                expect('actual').toBe('expected');
            });
        });
    },
});
`;

// oxlint-disable-next-line no-control-regex -- ANSI SGR sequences are ESC-prefixed by design
const ANSI = /\x1B\[[0-9;]*m/g;
const stripAnsi = (s) => s.replace(ANSI, '');

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

/** Run the bundle on a pipe that nobody reads for `READER_DELAY_MS`, then read all of it. */
function runBehindSlowReader(outFile) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.GITHUB_ACTIONS;
        const child = spawn('node', [outFile], { stdio: ['ignore', 'pipe', 'pipe'], env });
        const chunks = [];
        child.stdout.pause();
        child.stderr.pause();
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => chunks.push(chunk));
        const resume = setTimeout(() => {
            child.stdout.resume();
            child.stderr.resume();
        }, READER_DELAY_MS);
        child.on('error', reject);
        child.on('close', (code, signal) => {
            clearTimeout(resume);
            resolve({ code, signal, out: Buffer.concat(chunks).toString('utf8') });
        });
    });
}

describe('@gjsify/unit exit flush E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli build\``);
        }
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-unit-exit-flush-'));
    });

    after(() => {
        if (tmpDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('a failing run reports its failure to a reader that fell behind', async () => {
        const out = join(tmpDir, 'loud.node.mjs');
        buildEntryFromUnitSrc('__e2e_exit_flush.mts', LOUD_FAILING_SUITE, out);
        const { code, signal, out: log } = await runBehindSlowReader(out);
        const plain = stripAnsi(log);

        // The tail, not the 2 MB: what a truncated log ends in IS the diagnosis.
        const tail = `the log ends in: ${JSON.stringify(plain.slice(-160))}`;
        assert.equal(signal, null);
        assert.equal(code, 1);
        assert.ok(/✖ a run whose log outgrows the pipe › the failure only the recap names/.test(plain), tail);
        assert.ok(/1 of 2 tests failed/.test(plain), tail);
    });
});
