// E2E: a repo build script bundles for GJS even when the WORKSPACE copy of the
// `@gjsify/*` it needs is not built yet.
//
// THE DEFECT. `node scripts/x.mjs` in a package script is re-entered as `gjsify
// run --node-script` on a Node-less host (`ensureGjsifyShimOnPath()`), which
// bundles the script `--app gjs`. That build substitutes `node:fs` →
// `@gjsify/fs` and injects a register subpath per global `--globals auto`
// detects — and every one of those has to RESOLVE. Anchored at the script, they
// resolve to the workspace's own packages, whose `lib/esm` a cold clone has not
// built. Measured on postmarketOS/aarch64 (gjs 1.88.1, musl, no node): the ADR
// 0002 bootstrap dies at its third step, `gjsify run build:infra`, inside
// `unresolved-workspace-import` — and the same failure hits
// `check-refs-pin.mjs`, so `build:prebuilds` cannot start either.
//
// THE FIX under test: a bundle the CLI makes of its OWN toolchain may fall back
// to the `@gjsify/*` installed beside the running CLI, which is built by
// construction. Project first, always — the fallback is consulted only after
// normal resolution returns null, so a warm tree is byte-unchanged.
//
// WHY THE FIXTURE PLANTS A BROKEN PACKAGE. A cold clone is expensive to
// reproduce (install + a multi-minute build), and what actually matters is one
// bit: the project's copy does not resolve. A `node_modules/@gjsify/fs` whose
// `main` names a file that does not exist is exactly that bit, in a directory
// the suite owns.
//
// The FAKE `node` on PATH exits 127 and announces itself, so any fallback to
// Node is a loud failure rather than a test that passed while proving nothing.
//
// SKIP when off a capable host (non-Linux / no gjs / no built CLI bundle).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const SKIP = process.platform !== 'linux' || !hasGjs() || !existsSync(CLI_BUNDLE);

describe('node-script bundling against a cold workspace', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let fakeBinDir;
    let env;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-cold-node-script-'));
        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'scripts'), { recursive: true });

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                { name: 'cold-node-script-fixture', version: '0.0.0', private: true, type: 'module' },
                null,
                2,
            ),
        );

        // The script under test: `node:` builtins plus `process`, which is what
        // every repo build script actually uses. It writes a marker so a silent
        // no-op cannot pass.
        writeFileSync(
            join(projectDir, 'scripts', 'gen.mjs'),
            [
                "import { writeFileSync } from 'node:fs';",
                "import { join, dirname } from 'node:path';",
                "import { fileURLToPath } from 'node:url';",
                'const here = dirname(fileURLToPath(import.meta.url));',
                "writeFileSync(join(here, '..', 'generated.txt'), `ok ${typeof process.platform}\\n`);",
                '',
            ].join('\n'),
        );

        // A workspace copy that RESOLVES AS A PACKAGE and whose entry is absent —
        // the cold-clone shape, planted deterministically.
        const brokenPkg = join(projectDir, 'node_modules', '@gjsify', 'fs');
        mkdirSync(brokenPkg, { recursive: true });
        writeFileSync(
            join(brokenPkg, 'package.json'),
            JSON.stringify({ name: '@gjsify/fs', version: '0.0.0', type: 'module', main: 'lib/esm/index.js' }, null, 2),
        );

        // FAKE node/npm/npx: present, on PATH, and fatal if used.
        fakeBinDir = join(tmpDir, 'fakebin');
        mkdirSync(fakeBinDir, { recursive: true });
        for (const name of ['node', 'npm', 'npx']) {
            const p = join(fakeBinDir, name);
            writeFileSync(p, `#!/bin/sh\necho "FAKE ${name} CALLED" >&2\nexit 127\n`, { mode: 0o755 });
        }

        env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` };
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('runs the script under GJS and never touches Node', () => {
        const r = spawnSync('gjs', ['-m', CLI_BUNDLE, 'run', '--node-script', 'scripts/gen.mjs'], {
            cwd: projectDir,
            env,
            encoding: 'utf8',
            timeout: 4 * 60 * 1000,
        });
        const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

        assert.equal(
            r.status,
            0,
            `--node-script should bundle and run against a cold workspace.\nExit: ${r.status}\n${output}`,
        );
        assert.ok(!output.includes('FAKE node CALLED'), `The GJS path must not shell out to Node.\n${output}`);
        assert.ok(
            !/unresolved-workspace-import/i.test(output),
            `The unbuilt workspace @gjsify/fs must be rescued from the CLI's own install, not reported.\n${output}`,
        );

        const marker = join(projectDir, 'generated.txt');
        assert.ok(existsSync(marker), `The script must actually RUN, not merely bundle.\n${output}`);
        assert.match(readFileSync(marker, 'utf8'), /^ok string$/m, 'process.platform must be a real string under GJS');
    });
});
