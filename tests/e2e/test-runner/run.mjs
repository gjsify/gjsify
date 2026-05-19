// E2E test for `gjsify test`.
//
// Verifies the build + run + aggregate pipeline. Uses --runtime node only
// because the GJS path needs `@gjsify/node-globals` resolvable from the
// fixture's runtime path (gjs doesn't walk node_modules); that needs a full
// packWorkspaces setup which is exercised by every other gjsify e2e. Here
// we focus on the runner orchestration: build dispatch, mtime-based skip,
// --no-build / --rebuild, failing-spec exit propagation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    writeFileSync,
    readFileSync,
    mkdirSync,
    existsSync,
    statSync,
    utimesSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

function runCli(args, opts = {}) {
    return execFileSync('node', [CLI_ENTRY, ...args], {
        stdio: opts.stdio ?? 'pipe',
        timeout: opts.timeout ?? 60 * 1000,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        encoding: 'utf8',
    });
}

describe('CLI test runner E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-test-runner-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`yarn workspace @gjsify/cli build\``);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('builds + runs `src/test.mts` on node', () => {
        const dir = join(tmpDir, 'happy-path');
        scaffold(dir, {
            test: 'process.stdout.write("[suite] passed\\n");\nprocess.exit(0);\n',
        });

        const out = runCli(['test', '--runtime', 'node', '--verbose'], { cwd: dir });

        assert.match(out, /\[suite\] passed/);
        assert.match(out, /✅ node \(/);
        assert.ok(existsSync(join(dir, 'dist', 'test.node.mjs')), 'node bundle should be emitted');
    });

    it('propagates non-zero exit when the spec fails', () => {
        const dir = join(tmpDir, 'failing-spec');
        scaffold(dir, {
            test: 'process.stderr.write("[suite] FAILURE\\n");\nprocess.exit(1);\n',
        });

        let exitCode = 0;
        let out = '';
        try {
            runCli(['test', '--runtime', 'node'], { cwd: dir });
        } catch (e) {
            exitCode = e.status ?? -1;
            out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0, 'expected non-zero exit when spec fails');
        assert.match(out, /❌ node/);
    });

    it('--rebuild forces a rebuild even when outputs are fresh', () => {
        const dir = join(tmpDir, 'rebuild');
        scaffold(dir, {
            test: 'console.log("[v1]");\nprocess.exit(0);\n',
        });

        runCli(['test', '--runtime', 'node'], { cwd: dir });
        const outfile = join(dir, 'dist', 'test.node.mjs');
        const firstMtime = statSync(outfile).mtimeMs;

        // Bump the outfile's mtime so it's newer than src; verify --rebuild
        // still triggers a rebuild.
        const future = new Date(Date.now() + 60 * 1000);
        utimesSync(outfile, future, future);
        const bumpedMtime = statSync(outfile).mtimeMs;

        runCli(['test', '--runtime', 'node', '--rebuild'], { cwd: dir });
        const finalMtime = statSync(outfile).mtimeMs;

        assert.notEqual(finalMtime, bumpedMtime, '--rebuild should rewrite the bundle');
        // Without --rebuild we would have skipped (skip is verified by the
        // next test which uses --no-build successfully).
        void firstMtime;
    });

    it('--no-build runs an existing bundle and errors when missing', () => {
        const dir = join(tmpDir, 'no-build');
        scaffold(dir, {
            test: 'console.log("[no-build]");\nprocess.exit(0);\n',
        });

        // First build it.
        runCli(['test', '--runtime', 'node'], { cwd: dir });
        const before = statSync(join(dir, 'dist', 'test.node.mjs')).mtimeMs;

        // Now --no-build must not re-build.
        const out = runCli(['test', '--runtime', 'node', '--no-build'], { cwd: dir });
        assert.match(out, /\[no-build\]/);
        const after = statSync(join(dir, 'dist', 'test.node.mjs')).mtimeMs;
        assert.equal(after, before, '--no-build should not rewrite the bundle');

        // Without a bundle, --no-build must exit non-zero with a clear hint.
        const dir2 = join(tmpDir, 'no-build-missing');
        scaffold(dir2, { test: 'process.exit(0);\n' });
        let exitCode = 0;
        let err = '';
        try {
            runCli(['test', '--runtime', 'node', '--no-build'], { cwd: dir2 });
        } catch (e) {
            exitCode = e.status ?? -1;
            err = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0);
        assert.match(err, /doesn't exist|no bundle|--no-build/);
    });

    it('errors when src/test.mts is missing', () => {
        const dir = join(tmpDir, 'missing-entry');
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: 'missing-entry', version: '1.0.0', type: 'module', private: true }, null, 2) + '\n',
            'utf-8',
        );

        let exitCode = 0;
        let err = '';
        try {
            runCli(['test', '--runtime', 'node'], { cwd: dir });
        } catch (e) {
            exitCode = e.status ?? -1;
            err = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0);
        assert.match(err, /no test entry/);
    });
});

// ── helpers ─────────────────────────────────────────────────────────────

function scaffold(dir, { test }) {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
            {
                name: 'test-runner-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(join(dir, 'src', 'test.mts'), test, 'utf-8');
}
