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
// THE FAKE `node`/`npm`/`npx` ON PATH are a cheap belt, NOT the proof that the
// GJS path was taken. `runNodeScript` branches on `hostRuntime()`, not on PATH:
// under `gjs -m cli.gjs.mjs` it bundles and spawns `gjs`, and nothing on that
// branch looks `node` up at all. The assertion is a guard against a future
// regression that starts shelling out — in `tests/e2e/node-free-bootstrap` the
// same device IS load-bearing, because that suite drives `install`, which can.
//
// NO SKIP GUARD. `dist/cli.gjs.mjs` is untracked since ADR 0002, so an
// `existsSync` predicate turns the one suite that measures this fix into a green
// run that measured nothing — exactly what `node-free-bootstrap` rejects in
// writing. The host requirements are HARD ASSERTS inside the test; only the
// non-Linux leg, which cannot host it at all, still skips.

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
const SUITE_OPTS = { skip: process.platform !== 'linux', timeout: 5 * 60 * 1000 };

// Only the non-Linux leg skips: it cannot host gjs + the GI prebuilds at all.
describe('node-script bundling against a cold workspace', SUITE_OPTS, () => {
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

        // The cold-clone shape: every package a real `gjsify install` would have
        // placed is PRESENT as a directory with a manifest, and none has a built
        // `lib/esm`. Both halves matter and the suite got this wrong once:
        // planting only `@gjsify/fs` is NOT a cold clone, it is an uninstalled
        // project, and `--globals auto` then SKIPS the register import for every
        // absent package with a warning — so the bundle came out without `URL`
        // and died at `normalizePath`, a failure that says nothing about the
        // resolution this suite is here to test.
        for (const name of ['fs', 'path', 'url', 'process', 'console', 'node-globals']) {
            const pkgDir = join(projectDir, 'node_modules', '@gjsify', name);
            mkdirSync(pkgDir, { recursive: true });
            writeFileSync(
                join(pkgDir, 'package.json'),
                JSON.stringify(
                    { name: `@gjsify/${name}`, version: '0.0.0', type: 'module', main: 'lib/esm/index.js' },
                    null,
                    2,
                ),
            );
        }

        const gjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
        assert.equal(gjs.status, 0, 'this suite needs gjs — it is the runtime under test');
        assert.ok(existsSync(CLI_BUNDLE), `${CLI_BUNDLE} missing — build it before running this suite`);

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

        // The rescue must leave a trace. Without this the suite cannot tell a build
        // that fell back to the CLI's copies from one whose project resolved
        // everything — the two would have byte-identical logs, which is the whole
        // reason the fallback warns.
        assert.match(
            output,
            /did not resolve from the project/,
            `every toolchain rescue must name itself in the log.\n${output}`,
        );

        const marker = join(projectDir, 'generated.txt');
        assert.ok(existsSync(marker), `The script must actually RUN, not merely bundle.\n${output}`);
        assert.match(readFileSync(marker, 'utf8'), /^ok string$/m, 'process.platform must be a real string under GJS');
    });
});
