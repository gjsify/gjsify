// E2E for `scripts/npm-install-published.mjs` — the retry that stops npm's own
// registry propagation lag from reading as a release verdict.
//
// WHY THIS SUITE EXISTS AT ALL. The defect it covers lives in `release.yml`, a
// workflow that never runs on a pull request, and the condition that triggers it —
// npm serving a packument that predates a PUT it already acknowledged — cannot be
// provoked from CI. So a green CI run proves nothing about the retry, and before this
// suite nothing did: the logic sat in inline YAML shell, which is held by no check and
// testable by nothing. Moving it into a script is what makes it assertable, and these
// are the assertions.
//
// TWO HALVES, because the failure has two independently breakable parts:
//
//   the CLASSIFIER — is this npm failure a lag or a verdict? Driven against the
//   VERBATIM stderr of the real incident (run 33735989472) plus the other message
//   shapes npm prints, so a rewording that silently degrades classification shows up
//   here rather than in a release.
//
//   the LOOP — does it re-query, back off, stop at the window, add `--prefer-online`
//   only on retries, and fail on the FIRST attempt for a non-lag? Driven through the
//   script's `--npm-bin` seam with a fake npm that records every argv it is handed,
//   which makes "attempt 1 is byte-identical to the old command" a measured claim.
//
// Plus one full-fidelity case: a REAL `npm install` against the shared mock registry,
// whose packument hides the dependency's version on the first request and offers it on
// the next. That is the incident's exact shape end to end — real npm, real ETARGET,
// real resolution on the re-query — and it is the case that would catch the retry loop
// passing the wrong flags to a real npm.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startMockRegistry } from '../mock-registry.mjs';
import {
    classifyNpmFailure,
    quoteForWin32Shell,
    unresolvedPackageNames,
} from '../../../scripts/npm-install-published.mjs';

const SCRIPT = fileURLToPath(new URL('../../../scripts/npm-install-published.mjs', import.meta.url));

/**
 * The stderr of `Publish @gjsify/node-runtime-darwin-arm64` in run 33735989472,
 * attempt 1, verbatim. This is the text the classifier has to get right; paraphrasing
 * it would make the suite assert against our own idea of npm's wording.
 */
const INCIDENT_STDERR = [
    'npm error code ETARGET',
    'npm error notarget No matching version found for @gjsify/child_process@^0.46.0.',
    "npm error notarget In most cases you or one of your dependencies are requesting a package version that doesn't exist.",
    'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-09-03T09_28_56_548Z-debug-0.log',
].join('\n');

/**
 * Run the script in a child and resolve with its outcome.
 *
 * ASYNC ON PURPOSE, and the first draft was not: `spawnSync` blocks this process's
 * event loop, so the in-process mock registry below never got to ACCEPT the
 * connection npm opened — npm sat in connect until the case timed out, `requests`
 * stayed empty, and the failure looked like a blocked localhost rather than a rig
 * that had stopped the server it was measuring against.
 */
function runScript(args, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (c) => {
            out += c;
        });
        child.stderr.on('data', (c) => {
            out += c;
        });
        const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('close', (status) => {
            clearTimeout(kill);
            resolve({ status, out });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

/**
 * Write a fake npm that fails `failures` times with `body`, then succeeds — and
 * appends every argv it was handed to a log.
 *
 * A fake rather than the real npm because the LOOP's questions are about our own
 * control flow (how many attempts, which flags, how long) and a real registry cannot
 * be made to lag on demand. The fidelity case below uses the real npm.
 */
function writeFakeNpm(dir, { failures, body, exitCode = 1 }) {
    const bin = join(dir, 'fake-npm.mjs');
    const log = join(dir, 'invocations.jsonl');
    const counter = join(dir, 'count');
    writeFileSync(
        bin,
        [
            '#!/usr/bin/env node',
            "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
            `const LOG = ${JSON.stringify(log)};`,
            `const COUNTER = ${JSON.stringify(counter)};`,
            `const FAILURES = ${failures};`,
            `const BODY = ${JSON.stringify(body)};`,
            `const EXIT = ${exitCode};`,
            'let n = 0;',
            'try { n = Number(readFileSync(COUNTER, "utf8")) || 0; } catch { n = 0; }',
            'n += 1;',
            'writeFileSync(COUNTER, String(n));',
            'appendFileSync(LOG, JSON.stringify(process.argv.slice(2)) + "\\n");',
            'if (n <= FAILURES) { process.stderr.write(BODY + "\\n"); process.exit(EXIT); }',
            'process.stdout.write("fake npm: installed\\n");',
        ].join('\n'),
    );
    chmodSync(bin, 0o755);
    return {
        bin,
        invocations: () =>
            readFileSync(log, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((l) => JSON.parse(l)),
    };
}

describe('npm-install-published: classifying an npm failure', () => {
    it('reads the real incident as a propagation lag and names the package', () => {
        assert.deepEqual(unresolvedPackageNames(INCIDENT_STDERR), ['@gjsify/child_process']);
        const { verdict, reason } = classifyNpmFailure({ code: 1, output: INCIDENT_STDERR });
        assert.equal(verdict, 'lag');
        assert.match(reason, /@gjsify\/child_process/);
    });

    it('reads the E404 URL shape as a lag too (a first-publish name, not yet served)', () => {
        const output = [
            'npm error code E404',
            'npm error 404 Not Found - GET https://registry.npmjs.org/@gjsify%2fnode-runtime-win32-x64',
        ].join('\n');
        assert.deepEqual(unresolvedPackageNames(output), ['@gjsify/node-runtime-win32-x64']);
        assert.equal(classifyNpmFailure({ code: 1, output }).verdict, 'lag');
    });

    it('reads the "is not in this registry" shape as a lag', () => {
        const output = [
            'npm error code E404',
            "npm error 404  '@gjsify/tls-native@^0.4.20' is not in this registry.",
        ].join('\n');
        assert.deepEqual(unresolvedPackageNames(output), ['@gjsify/tls-native']);
        assert.equal(classifyNpmFailure({ code: 1, output }).verdict, 'lag');
    });

    it('refuses to wait for a package outside the @gjsify scope', () => {
        // Nothing we published minutes ago can be called `yargs`, so the lag argument
        // does not reach it and the manifest bug should surface immediately.
        const output = [
            'npm error code ETARGET',
            'npm error notarget No matching version found for yargs@^99.0.0.',
        ].join('\n');
        const { verdict, reason } = classifyNpmFailure({ code: 1, output });
        assert.equal(verdict, 'fatal');
        assert.match(reason, /yargs/);
    });

    it('treats any non-lag code as an answer, not a delay', () => {
        for (const output of [
            'npm error code EACCES\nnpm error Missing write access to /usr/lib/node_modules',
            'npm error code ENOSPC\nnpm error nospc There appears to be insufficient space',
            'npm error code EINTEGRITY\nnpm error sha512 integrity checksum failed',
        ]) {
            assert.equal(classifyNpmFailure({ code: 1, output }).verdict, 'fatal', output);
        }
    });

    it('retries an ETARGET whose prose it cannot parse', () => {
        // The polarity that matters: npm's messages are English and change between
        // majors, so an unrecognised wording must NOT quietly become fail-fast — that
        // is the behaviour this script exists to remove.
        const { verdict, reason } = classifyNpmFailure({
            code: 1,
            output: 'npm error code ETARGET\nnpm error some future wording nobody has seen yet',
        });
        assert.equal(verdict, 'lag');
        assert.match(reason, /npm wording not recognised/);
    });
});

describe('npm-install-published: the cmd.exe command line', () => {
    // The loop cases above all run on Linux, where argv is passed as argv. On Windows
    // the shell is mandatory (npm is npm.cmd) and Node joins argv with spaces without
    // quoting, so a `--prefix` under a path with a space would split into two
    // arguments and npm would install into the wrong place — or nowhere. Asserted
    // here because no runner in this suite is a Windows one.
    it('leaves ordinary arguments untouched and quotes only what would split', () => {
        assert.equal(quoteForWin32Shell('@gjsify/cli@0.46.0'), '@gjsify/cli@0.46.0');
        assert.equal(quoteForWin32Shell('--no-save'), '--no-save');
        assert.equal(quoteForWin32Shell(String.raw`D:\a\_temp\bootstrap-cli`), String.raw`D:\a\_temp\bootstrap-cli`);
        assert.equal(
            quoteForWin32Shell(String.raw`C:\Program Files\bootstrap-cli`),
            String.raw`"C:\Program Files\bootstrap-cli"`,
        );
        // A redirection character would otherwise be interpreted by cmd.exe itself.
        assert.equal(quoteForWin32Shell('a>b'), '"a>b"');
    });
});

describe('npm-install-published: the retry loop', () => {
    it('re-queries a lag until it resolves, and says so', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-retry-lag-'));
        try {
            const npm = writeFakeNpm(dir, { failures: 2, body: INCIDENT_STDERR });
            const { status, out } = await runScript([
                '--npm-bin',
                npm.bin,
                '--cwd',
                dir,
                '--initial-delay-ms',
                '50',
                '--max-delay-ms',
                '50',
                '--',
                '@gjsify/cli@0.46.0',
                '--no-audit',
                '--no-fund',
                '--no-save',
            ]);
            assert.equal(status, 0, out);
            const calls = npm.invocations();
            assert.equal(calls.length, 3, `expected 3 attempts, got ${calls.length}: ${out}`);
            // Attempt 1 must be exactly the command that has shipped every release so
            // far — the retry is additive, so a regression here is a behaviour change
            // on the path that almost always succeeds.
            assert.deepEqual(calls[0], ['install', '@gjsify/cli@0.46.0', '--no-audit', '--no-fund', '--no-save']);
            // And every RETRY must force the staleness check, or it re-reads the same
            // cached packument it just failed on and the loop measures nothing.
            for (const call of calls.slice(1)) assert.ok(call.includes('--prefer-online'), JSON.stringify(call));
            assert.match(out, /registry propagation, not a defect/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('gives up inside the window and reports rounds + elapsed, not a bare failure', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-retry-exhaust-'));
        try {
            const npm = writeFakeNpm(dir, { failures: 99, body: INCIDENT_STDERR });
            const { status, out } = await runScript([
                '--npm-bin',
                npm.bin,
                '--cwd',
                dir,
                '--attempts',
                '3',
                '--initial-delay-ms',
                '20',
                '--max-delay-ms',
                '20',
                '--',
                '@gjsify/cli@0.46.0',
            ]);
            assert.equal(status, 1, out);
            assert.equal(npm.invocations().length, 3);
            assert.match(out, /still unresolved after 3 attempt\(s\) over \d+s/);
            // A reader must not be sent hunting for a lag that was not one.
            assert.match(out, /genuinely\s+absent/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('spends no window at all on a failure that is an answer', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-retry-fatal-'));
        try {
            const npm = writeFakeNpm(dir, {
                failures: 99,
                body: 'npm error code EACCES\nnpm error Missing write access to /usr/lib',
            });
            const { status, out } = await runScript([
                '--npm-bin',
                npm.bin,
                '--cwd',
                dir,
                '--initial-delay-ms',
                '20',
                '--',
                '@gjsify/cli@0.46.0',
            ]);
            assert.equal(status, 1, out);
            assert.equal(npm.invocations().length, 1, 'a non-lag failure must not be retried once');
            assert.match(out, /failing immediately/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--dry-run prints the argv and runs nothing', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-retry-dry-'));
        try {
            const npm = writeFakeNpm(dir, { failures: 0, body: '' });
            const { status, out } = await runScript([
                '--npm-bin',
                npm.bin,
                '--cwd',
                dir,
                '--dry-run',
                '--',
                '@gjsify/cli@1.0.0',
            ]);
            assert.equal(status, 0, out);
            assert.match(out, /install @gjsify\/cli@1\.0\.0/);
            assert.throws(() => npm.invocations(), /ENOENT/, 'nothing may be executed under --dry-run');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses an invocation with no `--` separator instead of guessing', async () => {
        const { status, out } = await runScript(['--cwd', '/tmp', '@gjsify/cli@1.0.0']);
        assert.equal(status, 1);
        assert.match(out, /missing `--` separator/);
    });
});

describe('npm-install-published: a real npm against a lagging registry', () => {
    it('installs once the hidden version appears on the re-query', async () => {
        // The fidelity case. The registry offers @gjsify/fixture-cli@1.0.0, which
        // depends on @gjsify/fixture-dep@^1.0.0 — and withholds that dep's 1.0.0 while
        // still offering 0.9.0, which is precisely the document npm served at 09:29:06
        // in the incident: complete, well-formed, and older than the publish it was
        // asked about. It starts serving 1.0.0 at a wall-clock instant, the way the
        // real registry did.
        //
        // WALL CLOCK, NOT A REQUEST COUNT, and the first draft used the count: hide
        // 1.0.0 from the FIRST packument request. That case passed while exercising no
        // retry at all — npm asks for the same dep packument TWICE inside ONE install
        // (measured: /@gjsify%2ffixture-dep twice, then both tarballs), so the hidden
        // round was consumed mid-install and resolution used the second answer. It was
        // green with `--attempts 1`. Hence also the two assertions below on the
        // script's own log: a case that can only pass BY retrying cannot go quiet.
        const revealAt = Date.now() + 2_000;
        let depRequests = 0;
        const registry = await startMockRegistry(
            {
                '@gjsify/fixture-cli': { '1.0.0': { dependencies: { '@gjsify/fixture-dep': '^1.0.0' } } },
                '@gjsify/fixture-dep': { '0.9.0': {}, '1.0.0': {} },
            },
            {
                onPackument(doc, { name }) {
                    if (name !== '@gjsify/fixture-dep') return;
                    depRequests += 1;
                    if (Date.now() < revealAt) delete doc.versions['1.0.0'];
                },
            },
        );
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-retry-real-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                `${JSON.stringify({ name: 'retry-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
            );
            const { status, out } = await runScript(
                [
                    '--cwd',
                    dir,
                    '--initial-delay-ms',
                    '400',
                    '--max-delay-ms',
                    '400',
                    '--attempts',
                    '12',
                    '--window-ms',
                    '30000',
                    '--',
                    '@gjsify/fixture-cli@1.0.0',
                    // BOTH spellings, and the scoped one is the load-bearing half: npm
                    // resolves a scoped package through `@scope:registry` and ignores a
                    // plain `--registry` for it, so the first draft of this case went to
                    // registry.npmjs.org and 404'd on the fixture names.
                    '--registry',
                    registry.url,
                    `--@gjsify:registry=${registry.url}`,
                    // A private cache, so the case neither reads nor pollutes the host's
                    // ~/.npm and cannot pass because of a previous run.
                    '--cache',
                    join(dir, 'npm-cache'),
                    '--no-audit',
                    '--no-fund',
                    '--no-save',
                ],
                { timeoutMs: 120_000 },
            );
            assert.equal(status, 0, out);
            assert.match(out, /npm error code ETARGET/, 'the first attempt must really have failed');
            assert.match(out, /re-querying in/, 'the install must have been re-queried, not merely succeeded');
            assert.match(out, /registry propagation, not a defect/, 'success must have come from a RETRY');
            assert.ok(depRequests >= 3, `expected a second install's requests, saw ${depRequests}: ${out}`);
            const installed = JSON.parse(
                readFileSync(join(dir, 'node_modules', '@gjsify', 'fixture-dep', 'package.json'), 'utf8'),
            );
            assert.equal(installed.version, '1.0.0', 'the resolved dep must be the version the first packument hid');
        } finally {
            rmSync(dir, { recursive: true, force: true });
            await registry.close();
        }
    });
});
