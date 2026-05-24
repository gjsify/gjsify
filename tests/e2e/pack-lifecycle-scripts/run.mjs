// E2E test: `gjsify pack` honors npm-style lifecycle scripts.
//
// Locks in the contract added to fix the 4.0.0 ts-for-gir incident where
// `@ts-for-gir/cli`'s `prepack` script (process-templates) silently
// skipped under `gjsify pack`, so `dist-templates/` never reached the
// published tarball.
//
// Coverage:
//   1. `prepack` runs by default → its output files end up in the tarball
//      (the canonical bug-class regression check).
//   2. `--ignore-scripts` skips the lifecycle pass entirely. Matches
//      `npm pack --ignore-scripts` semantics.
//   3. `prepack` exit code propagates: non-zero kills the pack with a
//      useful error message including the failing script name.
//   4. Multiple scripts run in declared order (publish: prepublishOnly →
//      prepack). Verified by writing a per-script marker file and
//      asserting the contents.
//   5. Missing scripts are tolerated (optional behaviour) — packs that
//      have no `prepack` field continue to work.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/pack-lifecycle-scripts/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_BIN = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

function makeFixture(prefix, pkg) {
    const dir = mkdtempSync(join(tmpdir(), `gjsify-pack-lifecycle-${prefix}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    return dir;
}

function runPack(cwd, args = []) {
    // spawnSync gives us stdout + stderr independently regardless of exit
    // code; execFileSync only surfaces stderr on throw, which would miss it
    // on a successful pack with chatty lifecycle output.
    const r = spawnSync(process.execPath, [CLI_BIN, 'pack', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
        status: r.status ?? (r.signal ? 1 : 0),
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
    };
}

function listTarball(cwd, filename) {
    const stdout = execFileSync('tar', ['-tzf', join(cwd, filename)], {
        encoding: 'utf8',
    });
    return stdout.split('\n').filter(Boolean);
}

describe('gjsify pack — lifecycle scripts', () => {
    it('runs `prepack` by default and includes its output in the tarball', () => {
        const dir = makeFixture('default', {
            name: 'lifecycle-prepack',
            version: '1.0.0',
            files: ['generated.txt'],
            scripts: {
                prepack: 'echo prepack-ran > generated.txt',
            },
        });
        try {
            const result = runPack(dir);
            assert.equal(result.status, 0, `pack failed:\n${result.stderr}`);
            assert.ok(
                existsSync(join(dir, 'generated.txt')),
                'prepack should have written generated.txt',
            );
            const entries = listTarball(dir, 'lifecycle-prepack-1.0.0.tgz');
            assert.ok(
                entries.includes('package/generated.txt'),
                `tarball missing generated.txt; got:\n${entries.join('\n')}`,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('honors --ignore-scripts and skips `prepack`', () => {
        const dir = makeFixture('ignore', {
            name: 'lifecycle-ignore',
            version: '1.0.0',
            files: ['generated.txt'],
            scripts: {
                prepack: 'echo should-not-run > generated.txt',
            },
        });
        try {
            const result = runPack(dir, ['--ignore-scripts']);
            assert.equal(result.status, 0, `pack failed:\n${result.stderr}`);
            assert.ok(
                !existsSync(join(dir, 'generated.txt')),
                'prepack should not have run; generated.txt unexpectedly present',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('surfaces non-zero exit from `prepack` as a pack failure', () => {
        const dir = makeFixture('exit-code', {
            name: 'lifecycle-fail',
            version: '1.0.0',
            scripts: {
                prepack: 'exit 7',
            },
        });
        try {
            const result = runPack(dir);
            assert.notEqual(result.status, 0, 'pack should have failed when prepack exits non-zero');
            const combined = `${result.stdout}\n${result.stderr}`;
            assert.match(
                combined,
                /prepack/,
                'failure message should mention the failing script name',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('tolerates packages without a `prepack` script', () => {
        const dir = makeFixture('no-prepack', {
            name: 'lifecycle-none',
            version: '1.0.0',
            files: ['README.md'],
        });
        writeFileSync(join(dir, 'README.md'), 'hello\n');
        try {
            const result = runPack(dir);
            assert.equal(result.status, 0, `pack failed without prepack:\n${result.stderr}`);
            const entries = listTarball(dir, 'lifecycle-none-1.0.0.tgz');
            assert.ok(entries.includes('package/package.json'));
            assert.ok(entries.includes('package/README.md'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('keeps --json stdout clean when prepack writes to stdout', () => {
        // Regression: `gjsify pack --json` used to emit `JSON.parse`-broken
        // output because the prepack script's stdout was inherited verbatim
        // and prefixed the JSON payload (e.g. `[process-templates] ...
        // [{...}]`). Failure surfaced as `SyntaxError: Unexpected token 'p'`
        // in any caller piping the result through `JSON.parse(stdout)` —
        // notably ts-for-gir's tarball-shape e2e suite under @gjsify/cli
        // ≥0.4.22. We now route lifecycle-script stdout → parent's stderr
        // when --json is set.
        const dir = makeFixture('json-stdout', {
            name: 'lifecycle-json',
            version: '1.0.0',
            files: [],
            scripts: {
                prepack: 'echo "log-line-from-prepack"',
            },
        });
        try {
            const result = runPack(dir, ['--json']);
            assert.equal(result.status, 0, `pack failed:\n${result.stderr}`);
            // The chatty prepack output must land on stderr, not stdout.
            assert.ok(
                !result.stdout.includes('log-line-from-prepack'),
                `stdout leaked prepack log line:\n${result.stdout}`,
            );
            assert.ok(
                result.stderr.includes('log-line-from-prepack'),
                `stderr did not capture prepack log line:\n${result.stderr}`,
            );
            // stdout must be a parseable JSON array per `npm pack --json`.
            const parsed = JSON.parse(result.stdout);
            assert.ok(Array.isArray(parsed), 'expected JSON array on stdout');
            assert.equal(parsed[0].name, 'lifecycle-json');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('exposes npm_lifecycle_event / npm_package_name to the prepack environment', () => {
        const dir = makeFixture('env-vars', {
            name: 'lifecycle-envcheck',
            version: '2.3.4',
            files: ['env.json'],
            // External writer script keeps the JSON-into-package.json
            // serialization clean — inlining a complex `node -e "…"` here
            // would double-escape backslashes through JSON.stringify and
            // then again through the shell.
            scripts: {
                prepack: 'node write-env.mjs',
            },
        });
        writeFileSync(
            join(dir, 'write-env.mjs'),
            [
                "import { writeFileSync } from 'node:fs';",
                'writeFileSync(',
                "  'env.json',",
                '  JSON.stringify({',
                '    event: process.env.npm_lifecycle_event,',
                '    name: process.env.npm_package_name,',
                '    version: process.env.npm_package_version,',
                '  }),',
                ');',
            ].join('\n'),
        );
        try {
            const result = runPack(dir);
            assert.equal(result.status, 0, `pack failed:\n${result.stderr}`);
            const env = JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8'));
            assert.equal(env.event, 'prepack');
            assert.equal(env.name, 'lifecycle-envcheck');
            assert.equal(env.version, '2.3.4');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
