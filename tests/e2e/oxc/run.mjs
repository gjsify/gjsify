// E2E for `gjsify format` / `gjsify lint` / `gjsify fix` (oxc toolchain).
//
// Strategy: install the real `oxlint` + `oxfmt` (along with their transitive
// per-platform `@oxlint/binding-*` / `@oxfmt/binding-*` napi packages) and run
// our CLI against them. Verifies the launcher-resolution + spawn pipeline
// end-to-end without stubbing oxc — the resolver is the load-bearing new code
// path; oxlint/oxfmt's actual format/lint output is their own job.
//
// Note: unlike Biome (a self-contained binary we spawned directly), oxlint's
// JS-plugin host lives in its Node launcher, so we spawn `node
// node_modules/{oxlint,oxfmt}/bin/{oxlint,oxfmt}` for both tools.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

const OXLINT_VERSION = '^1.66.0';
const OXFMT_VERSION = '^0.51.0';

describe('CLI gjsify format/lint/fix E2E (oxc native-spawn)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;
    let workspaceRoot;
    let subWorkspaceDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-oxc-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        // === Standalone project (no workspaces) ===
        projectDir = join(tmpDir, 'standalone');
        mkdirSync(projectDir, { recursive: true });
        setupProject(
            projectDir,
            {
                name: 'standalone-oxc-smoke',
                version: '0.0.1',
                type: 'module',
                private: true,
                devDependencies: {
                    '@gjsify/cli': '^0.1.0',
                    oxlint: OXLINT_VERSION,
                    oxfmt: OXFMT_VERSION,
                },
            },
            tarballsDir,
            tarballMap,
        );

        // === Workspace setup: root + one sub-workspace ===
        workspaceRoot = join(tmpDir, 'workspace');
        mkdirSync(join(workspaceRoot, 'packages', 'pkg-a', 'src'), { recursive: true });
        setupProject(
            workspaceRoot,
            {
                name: 'workspace-root',
                version: '0.0.1',
                type: 'module',
                private: true,
                workspaces: ['packages/*'],
                devDependencies: {
                    '@gjsify/cli': '^0.1.0',
                    oxlint: OXLINT_VERSION,
                    oxfmt: OXFMT_VERSION,
                },
            },
            tarballsDir,
            tarballMap,
        );
        subWorkspaceDir = join(workspaceRoot, 'packages', 'pkg-a');
        writeFileSync(
            join(subWorkspaceDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'pkg-a',
                    version: '0.0.1',
                    type: 'module',
                    private: true,
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('format --init writes recommended .oxlintrc.json + .oxfmtrc.json with GJS-tuned defaults', () => {
        const out = execFileSync('npx', ['gjsify', 'format', '--init'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        }).toString();

        assert.match(out, /wrote .+\.oxlintrc\.json/);
        assert.match(out, /wrote .+\.oxfmtrc\.json/);
        assert.ok(existsSync(join(projectDir, '.oxlintrc.json')));
        assert.ok(existsSync(join(projectDir, '.oxfmtrc.json')));

        const fmt = JSON.parse(readFileSync(join(projectDir, '.oxfmtrc.json'), 'utf-8'));
        // Tuned defaults — 4-space, single quotes, printWidth 120, semicolons, trailing-comma all
        assert.equal(fmt.tabWidth, 4);
        assert.equal(fmt.printWidth, 120);
        assert.equal(fmt.singleQuote, true);
        assert.equal(fmt.semi, true);
        assert.equal(fmt.trailingComma, 'all');
        assert.equal(fmt.arrowParens, 'always');

        const lint = JSON.parse(readFileSync(join(projectDir, '.oxlintrc.json'), 'utf-8'));
        assert.equal(lint.categories.correctness, 'error');
        assert.equal(lint.rules['unicorn/prefer-node-protocol'], 'error');
        assert.equal(lint.rules['typescript/no-explicit-any'], 'warn');
    });

    it('format --init does not overwrite existing config without --force', () => {
        const sentinel = JSON.stringify({ tabWidth: 99 }, null, 2);
        writeFileSync(join(projectDir, '.oxfmtrc.json'), sentinel);

        const out = execFileSync('npx', ['gjsify', 'format', '--init'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        }).toString();
        assert.match(out, /exists.*--force/i);
        assert.equal(readFileSync(join(projectDir, '.oxfmtrc.json'), 'utf-8'), sentinel);

        // With --force, overwrite
        execFileSync('npx', ['gjsify', 'format', '--init', '--force'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        const fmt = JSON.parse(readFileSync(join(projectDir, '.oxfmtrc.json'), 'utf-8'));
        assert.equal(fmt.tabWidth, 4, '.oxfmtrc.json should be overwritten with the template');
    });

    it('format --write formats source files in place via the native oxfmt binding', () => {
        writeFileSync(join(projectDir, 'test.ts'), 'const x={a:1,b:2};\n');

        execFileSync('npx', ['gjsify', 'format', '--write', 'test.ts'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        const out = readFileSync(join(projectDir, 'test.ts'), 'utf-8');
        // Tuned defaults: single quotes, 4-space, space inside braces
        assert.match(out, /const x = \{ a: 1, b: 2 \};/);
    });

    it('format --check exits non-zero on drift (CI semantic)', () => {
        writeFileSync(join(projectDir, 'unformatted.ts'), 'const y={x:1};\n');

        const res = spawnSync('npx', ['gjsify', 'format', '--check', 'unformatted.ts'], {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
        assert.notStrictEqual(res.status, 0, 'expected --check to exit non-zero on drift');
    });

    it('format resolves oxfmt launcher from workspace-root node_modules when run from sub-workspace', () => {
        writeFileSync(join(subWorkspaceDir, 'src', 'main.ts'), 'const z={a:1};\n');

        // Write the config at workspace root (not in sub-workspace)
        execFileSync('npx', ['gjsify', 'format', '--init'], {
            cwd: workspaceRoot,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        // Run format from sub-workspace — oxfmt lives at workspace root's node_modules
        execFileSync('npx', ['gjsify', 'format', '--write', 'src/main.ts'], {
            cwd: subWorkspaceDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        const out = readFileSync(join(subWorkspaceDir, 'src', 'main.ts'), 'utf-8');
        assert.match(out, /const z = \{ a: 1 \};/);
    });

    it('format surfaces a clear install hint when oxfmt is missing', () => {
        const noOxcDir = join(tmpDir, 'no-oxc');
        mkdirSync(noOxcDir, { recursive: true });
        setupProject(
            noOxcDir,
            {
                name: 'no-oxc',
                version: '0.0.1',
                type: 'module',
                private: true,
                devDependencies: {
                    '@gjsify/cli': '^0.1.0',
                    // Deliberately NO oxlint / oxfmt
                },
            },
            tarballsDir,
            tarballMap,
        );

        writeFileSync(join(noOxcDir, 'test.ts'), 'const x=1;\n');

        const res = spawnSync('npx', ['gjsify', 'format', '--write', 'test.ts'], {
            cwd: noOxcDir,
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
        assert.notStrictEqual(res.status, 0);
        const merged = (res.stdout ?? '') + (res.stderr ?? '');
        assert.match(merged, /oxfmt not found/i);
        assert.match(merged, /gjsify install -D oxfmt/);
    });

    it('lint reports diagnostics; --fix applies safe fixes (prefer-node-protocol)', () => {
        execFileSync('npx', ['gjsify', 'format', '--init', '--force'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        // `'path'` → `'node:path'` (unicorn/prefer-node-protocol) is a safe oxlint fix.
        writeFileSync(
            join(projectDir, 'lint-test.ts'),
            `import { join } from 'path';\nexport const p = join('a', 'b');\n`,
        );

        const reportRes = spawnSync('npx', ['gjsify', 'lint', 'lint-test.ts'], {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 60 * 1000,
        });
        const reportOut = (reportRes.stdout ?? '') + (reportRes.stderr ?? '');
        assert.match(reportOut, /prefer-node-protocol|node:path/i);

        execFileSync('npx', ['gjsify', 'lint', '--fix', 'lint-test.ts'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        const after = readFileSync(join(projectDir, 'lint-test.ts'), 'utf-8');
        assert.match(after, /from 'node:path'/, "'path' should be rewritten to 'node:path'");
    });

    it('fix runs oxfmt --write then oxlint --fix', () => {
        writeFileSync(join(projectDir, 'fix-test.ts'), `import {join} from 'path';\nexport const x=join('a','b');\n`);

        execFileSync('npx', ['gjsify', 'fix', 'fix-test.ts'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        const out = readFileSync(join(projectDir, 'fix-test.ts'), 'utf-8');
        // Formatted (single-quote, spacing) AND node: protocol applied
        assert.match(out, /from 'node:path'/);
        assert.match(out, /join\('a', 'b'\)/);
    });
});
