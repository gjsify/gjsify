// E2E test for `--shebang` / `shebang: true` on the Node app target.
//
// A single `shebang: true` config must resolve to a TARGET-APPROPRIATE line:
// `#!/usr/bin/env node` for `--app node`, `#!/usr/bin/env -S gjs -m` for
// `--app gjs`. This is what lets a CLI ship one bin built for Node (e.g.
// ts-for-gir's `bin/ts-for-gir` migrating off esbuild) as a directly
// executable file — npm's bin shim symlinks it and the kernel reads the
// shebang to pick the interpreter, so the line must be correct per target.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('CLI shebang-node E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-shebang-node-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'shebang-node-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-shebang-node',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
                // `shebang: true` (not a string) so the resolved line is decided purely
                // by the build target — the behavior the node-target migration relies on.
                gjsify: { shebang: true },
            },
            tarballsDir,
            tarballMap,
        );

        writeFileSync(join(projectDir, 'src', 'app.ts'), `console.log('hi');\n`);
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('emits the Node shebang and chmod +x for --app node', () => {
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'node', '--outfile', 'bin/app'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        const out = join(projectDir, 'bin', 'app');
        assert.ok(existsSync(out), 'bin/app missing');
        const firstLine = readFileSync(out, 'utf-8').split('\n')[0];
        assert.equal(firstLine, '#!/usr/bin/env node', `expected Node shebang, got: ${firstLine}`);
        assert.ok((statSync(out).mode & 0o111) !== 0, 'bin/app is not executable');
    });

    it('the SAME shebang:true config emits the GJS shebang for --app gjs', () => {
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'gjs', '--outfile', 'dist/app.js'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        const out = join(projectDir, 'dist', 'app.js');
        assert.ok(existsSync(out), 'dist/app.js missing');
        const firstLine = readFileSync(out, 'utf-8').split('\n')[0];
        assert.equal(firstLine, '#!/usr/bin/env -S gjs -m', `expected GJS shebang, got: ${firstLine}`);
    });
});
