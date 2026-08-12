// E2E for the CLI on a host WITHOUT gjs.
//
// Why this suite exists: "is gjs on PATH" is an environment property that
// every Linux CI job answers YES to, so "does this work without gjs" is a
// question those jobs structurally cannot ask — the environment answers it
// before any test can. The only runners without gjs are macOS/Windows in
// `cli-cross-platform.yml`, which is main-only and measures the PUBLISHED
// CLI, so nothing gated PR code on it.
//
// That blind spot shipped #889: `gjsify showcase --runtime node` ran a
// system-dependency pre-flight marking `gjs` as required BEFORE resolving the
// runtime, making every showcase unreachable for every Windows / plain-Node
// user — on the default path too, since `defaultExampleRuntime()` falls back
// to the host runtime on exactly those hosts.
//
// The fix is not a gjs-less runner: it is to stop treating "gjs exists" as a
// host property and make it an INJECTED one. Same move the repo already makes
// for the OS axis, where `resolvePrebuildDirName`/`libraryPathVar` are pure
// functions of `(platform, arch, …)` so darwin/win32 branches are unit-tested
// from Linux by injecting foreign values. Here the injected value is PATH.
//
// The scrub REMOVES the directories that hold a `gjs` binary and keeps
// everything else — node stays reachable, which is what a real Windows or
// plain-Node host looks like. An empty PATH would prove something narrower
// and would break the launcher paths that legitimately spawn node.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../mock-registry.mjs';

const cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

/** PATH with every directory containing a `gjs` binary removed. */
function pathWithoutGjs() {
    const names = process.platform === 'win32' ? ['gjs.exe', 'gjs.cmd', 'gjs'] : ['gjs'];
    return (process.env.PATH ?? '')
        .split(delimiter)
        .filter((d) => d && !names.some((n) => existsSync(join(d, n))))
        .join(delimiter);
}

describe('gjsify CLI on a host without gjs', { timeout: 180_000 }, () => {
    let dir;
    let env;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gjs-less-'));
        env = { ...process.env, PATH: pathWithoutGjs() };
        // `gjsify build` resolves config upward from the entry and fails with
        // "Cannot find matching package.json" without one — the same reason
        // `cli-cross-platform.yml` runs `npm init -y` before building.
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: 'gjsify-e2e-gjs-less', version: '0.0.0', private: true }),
        );
        // Only a `node:` builtin: on the node target those stay native, so the
        // build needs no `@gjsify/*` resolution from this out-of-tree fixture.
        writeFileSync(
            join(dir, 'hello.ts'),
            "import { platform } from 'node:os';\nconsole.log('GJS_LESS_OK', platform());\n",
        );
    });

    // NEGATIVE CONTROL — without it a green suite could equally mean the scrub
    // never took effect and gjs was reachable all along, which is the failure
    // mode this whole suite exists to rule out. It also self-skips honestly on
    // a host that has no gjs to begin with: there the scrub is a no-op and the
    // remaining assertions are still exactly the ones we want.
    it('the PATH scrub actually hides gjs', () => {
        const before = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
        if (before.error) {
            // No gjs installed here — the scrub is vacuous but the suite still
            // measures the right thing.
            return;
        }
        const after = spawnSync('gjs', ['--version'], { stdio: 'ignore', env });
        assert.ok(after.error, 'gjs is still reachable after scrubbing PATH — the fixture is broken');
    });

    it('reports its version', async () => {
        const r = await runCli(cliEntry, ['--version'], { cwd: dir, env });
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /Missing system dependencies/);
    });

    it('builds an --app node bundle', async () => {
        const r = await runCli(cliEntry, ['build', 'hello.ts', '--app', 'node', '--outfile', 'hello.node.mjs'], {
            cwd: dir,
            env,
        });
        assert.doesNotMatch(r.stderr, /Missing system dependencies/);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(existsSync(join(dir, 'hello.node.mjs')), 'no bundle emitted');
    });

    // `gjsify run <file>` decides the runtime by SNIFFING the bundle
    // (`isLikelyGjsBundle`), so a `--app node` bundle must launch on the host
    // runtime and never reach for gjs. This is the path that legitimately
    // spawns `node`, which is why the scrub keeps the rest of PATH intact.
    it('runs an --app node bundle on the host runtime', async () => {
        const r = await runCli(cliEntry, ['run', 'hello.node.mjs'], { cwd: dir, env });
        assert.doesNotMatch(r.stderr, /Missing system dependencies/);
        assert.match(r.stdout + r.stderr, /GJS_LESS_OK/);
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });
});
