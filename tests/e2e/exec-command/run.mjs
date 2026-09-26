// E2E: `gjsify exec <bin>` runs an installed npm bin on the runtime the CLI itself
// runs on (ADR 0076) — unchanged on Node, rebuilt `--app gjs` and cached on GJS.
//
// Driven from BOTH hosts on purpose. The Node rows prove the bin and the argv are
// right (nothing is built there); the GJS rows prove the rebuild, the cache and the
// passthrough — the half that is ours. A Node-only suite could not fail for any of it.
//
// The fixture is a hand-written `node_modules` — no registry, no install — because
// what is under test starts at a resolved bin, and a network step would only add a
// way to be red for an unrelated reason.
//
// NO SKIP GUARD on the GJS half: `dist/cli.gjs.mjs` is untracked since ADR 0002, and
// an `existsSync` predicate would turn the only suite measuring the rebuild into a
// green run that measured nothing (the same reasoning as `node-script-cold-workspace`).
// Only the non-Linux leg, which cannot host gjs + the GI prebuilds, skips.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_DIR = join(REPO_ROOT, 'packages', 'infra', 'cli');
const CLI_BUNDLE = join(CLI_DIR, 'dist', 'cli.gjs.mjs');
const CLI_NODE = join(CLI_DIR, 'lib', 'index.js');
const SUITE_OPTS = { skip: process.platform !== 'linux', timeout: 10 * 60 * 1000 };

describe('gjsify exec', SUITE_OPTS, () => {
    let tmpDir;
    let projectDir;
    let subDir;
    let cacheRoot;

    const onGjs = (args, cwd = projectDir) =>
        spawnSync('gjs', ['-m', CLI_BUNDLE, 'exec', ...args], { cwd, encoding: 'utf8', timeout: 5 * 60 * 1000 });
    const onNode = (args, cwd = projectDir) =>
        spawnSync(process.execPath, [CLI_NODE, 'exec', ...args], { cwd, encoding: 'utf8', timeout: 60 * 1000 });
    /** The bin prints one JSON line; everything else on stdout would be a leak. */
    const report = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));
    const describeRun = (r) => `exit ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;

    before(() => {
        assert.equal(spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status, 0, 'this suite needs gjs');
        assert.ok(existsSync(CLI_BUNDLE), `${CLI_BUNDLE} missing — build it before running this suite`);
        assert.ok(existsSync(CLI_NODE), `${CLI_NODE} missing — build @gjsify/cli before running this suite`);

        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-exec-'));
        projectDir = join(tmpDir, 'project');
        subDir = join(projectDir, 'src', 'deep');
        mkdirSync(subDir, { recursive: true });
        cacheRoot = join(projectDir, 'node_modules', '.cache', 'gjsify', 'exec');
        writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'exec-fixture', private: true }));
        writeFileSync(join(projectDir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, v: 1 }));

        // A CommonJS bin with a `.cjs` entry (prettier's shape) that reads its own
        // package.json, reports argv + cwd, and exits with the code it is told to.
        const echo = join(projectDir, 'node_modules', 'echo-bin');
        mkdirSync(join(echo, 'bin'), { recursive: true });
        writeFileSync(
            join(echo, 'package.json'),
            JSON.stringify({ name: 'echo-bin', version: '1.2.3', bin: { 'echo-bin': 'bin/echo.cjs' } }),
        );
        writeFileSync(
            join(echo, 'bin', 'echo.cjs'),
            [
                '#!/usr/bin/env node',
                "'use strict';",
                "const { version } = require('../package.json');",
                'const args = process.argv.slice(2);',
                "const at = args.indexOf('--exit');",
                'console.log(JSON.stringify({ version, args, cwd: process.cwd() }));',
                'process.exit(at === -1 ? 0 : Number(args[at + 1]));',
                '',
            ].join('\n'),
        );

        // A bin that cannot be bundled: the rebuild must fail loudly and run nothing.
        const broken = join(projectDir, 'node_modules', 'broken-bin');
        mkdirSync(broken, { recursive: true });
        writeFileSync(
            join(broken, 'package.json'),
            JSON.stringify({ name: 'broken-bin', version: '0.0.1', type: 'module', bin: { 'broken-bin': 'cli.js' } }),
        );
        writeFileSync(join(broken, 'cli.js'), "console.log('ran');\nexport const = ;\n");

        const binDir = join(projectDir, 'node_modules', '.bin');
        mkdirSync(binDir, { recursive: true });
        symlinkSync(join('..', 'echo-bin', 'bin', 'echo.cjs'), join(binDir, 'echo-bin'));
        symlinkSync(join('..', 'broken-bin', 'cli.js'), join(binDir, 'broken-bin'));
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('on Node: runs the bin unchanged — argv, cwd and exit code pass through, nothing is built', () => {
        const r = onNode(['echo-bin', 'a', 'b c', '--flag', '--exit', '3'], subDir);
        assert.equal(r.status, 3, describeRun(r));
        assert.deepEqual(report(r), { version: '1.2.3', args: ['a', 'b c', '--flag', '--exit', '3'], cwd: subDir });
        assert.ok(!existsSync(cacheRoot), `a Node host must not rebuild anything\n${describeRun(r)}`);
    });

    it('on GJS: rebuilds once, then runs the bundle with argv, cwd and exit code intact', () => {
        const r = onGjs(['echo-bin', 'a', 'b c', '--flag', '--exit', '3'], subDir);
        assert.equal(r.status, 3, describeRun(r));
        assert.match(r.stderr, /rebuilding echo-bin@1\.2\.3/, describeRun(r));
        assert.deepEqual(report(r), { version: '1.2.3', args: ['a', 'b c', '--flag', '--exit', '3'], cwd: subDir });
        const entries = readdirSync(cacheRoot);
        assert.equal(entries.length, 1, `one artifact directory: ${entries.join(', ')}`);
        // `.cjs` → `.mjs`: the artifact is ESM whatever the entry was.
        assert.deepEqual(readdirSync(join(cacheRoot, entries[0])), ['echo.mjs']);
    });

    it('on GJS: a second run reuses the artifact', () => {
        const r = onGjs(['echo-bin', 'again']);
        assert.equal(r.status, 0, describeRun(r));
        assert.doesNotMatch(r.stderr, /rebuilding/, `the cache must hit\n${describeRun(r)}`);
        assert.deepEqual(report(r).args, ['again']);
    });

    it('on GJS: a lockfile change invalidates the artifact, and replaces it', () => {
        writeFileSync(join(projectDir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, v: 2 }));
        const r = onGjs(['echo-bin']);
        assert.equal(r.status, 0, describeRun(r));
        assert.match(r.stderr, /rebuilding/, `a moved lockfile must miss\n${describeRun(r)}`);
        assert.equal(readdirSync(cacheRoot).length, 1, 'the stale artifact is pruned');
    });

    it("on GJS: --rebuild forces a rebuild; options after the bin stay the bin's", () => {
        const r = onGjs(['--rebuild', 'echo-bin', '--rebuild']);
        assert.equal(r.status, 0, describeRun(r));
        assert.match(r.stderr, /rebuilding/, describeRun(r));
        assert.deepEqual(report(r).args, ['--rebuild']);
    });

    it('on GJS: --runtime node runs the bin on Node without building', () => {
        const r = onGjs(['--runtime', 'node', 'echo-bin', 'x']);
        assert.equal(r.status, 0, describeRun(r));
        assert.doesNotMatch(r.stderr, /rebuilding/, describeRun(r));
        assert.deepEqual(report(r).args, ['x']);
    });

    it('on GJS: a failing rebuild names the bin and the diagnostics, and runs nothing', () => {
        const r = onGjs(['broken-bin']);
        assert.notEqual(r.status, 0, describeRun(r));
        assert.match(r.stderr, /rebuilding "broken-bin" \(broken-bin@0\.0\.1\) for GJS failed/, describeRun(r));
        assert.match(r.stderr, /Bundler diagnostics:/, describeRun(r));
        assert.match(r.stderr, /Nothing was run/, describeRun(r));
        assert.doesNotMatch(r.stdout, /ran/, `no fallback may run the bin\n${describeRun(r)}`);
    });

    it('reports an unknown bin as command-not-found (127)', () => {
        const r = onNode(['no-such-bin']);
        assert.equal(r.status, 127, describeRun(r));
        assert.match(r.stderr, /no bin named "no-such-bin"/, describeRun(r));
    });
});
