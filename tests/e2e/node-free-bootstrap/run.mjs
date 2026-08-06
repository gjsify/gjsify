// E2E: a host with ONLY gjs can bootstrap this repo (ADR 0002).
//
// This is the path the committed `dist/cli.gjs.mjs` is being removed in favour
// of, and the path a contributor without Node already uses:
//
//     gjs -m install.mjs            # published bundle, SHA-256 verified
//     gjsify install --immutable    # that bundle installs the clone
//     gjsify run build:infra        # …and builds it; the fresh CLI takes over
//
// TWO PROPERTIES, AND WHY NEITHER WAS COVERED BEFORE
//
//  1. THE INSTALL RUNS WITHOUT NODE. Until ADR 0002 all nine CI `install` sites
//     ran `gjs -m <bundle> install --immutable`, so every CI run was a live
//     proof of this. Those sites now fetch the published bundle instead, which
//     is the point — but it means CI no longer demonstrates the Node-free half
//     as a side effect, and MEASURED, no e2e suite covered it:
//     `workspace-node-free-gjs` covers Node-free ORCHESTRATION (build/run), not
//     installing. So this drives it directly, with a `node` on PATH that exits
//     127 — any silent fallback to Node is a loud failure rather than a test
//     that passed while proving nothing.
//
//  2. THE PUBLISHED CLI CAN READ THIS REPO'S LOCKFILE. That is the ONE thing
//     that can break property 1, and it is not hypothetical: `LOCKFILE_VERSION`
//     moved twice in four releases (2 → 3 → 4), and a reader that predates the
//     writer rejects a lockfile that plainly exists.
//     `scripts/check-lockfile-reader-lead.mjs` guards it in CI against the live
//     registry; what is tested here is its PARSER, which is where a silently
//     wrong answer would come from and which needs no network.
//
// SPAWN DISCIPLINE (docs/build-artifacts.md): every `spawnSync` carries a
// `timeout`, and any hand-built `env` carries `HOME`, built ONCE and shared with
// the probe that gates it. A `bash` spawned with the environment reduced to
// `{PATH}` alone does not return — it forks without bound (measured: one
// 3-second call left 12794 processes; a suite run reached 4329 holding 78.7 GB
// and the kernel resolved it by killing unrelated desktop processes). The bug
// hid because the probe and the call it gated were built from DIFFERENT env
// objects, so the call that hung was never the one under test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const TIMEOUT_MS = 120_000;

/**
 * A timeout must REPORT as a timeout. Without this it arrives at the assertions
 * as `status: null` with empty stdout and gets diagnosed as the wrong failure —
 * which is how an unbounded spawn costs a day instead of a minute.
 */
function assertSpawnCompleted(r, what) {
    if (r.error && r.error.code === 'ETIMEDOUT') assert.fail(`${what}: timed out after ${TIMEOUT_MS}ms`);
    if (r.error) assert.fail(`${what}: ${r.error.message}`);
    assert.notEqual(r.status, null, `${what}: killed by ${r.signal ?? 'unknown signal'} (no exit status)`);
}

await describe('node-free bootstrap (ADR 0002)', async () => {
    await it('still installs under GJS with no node on PATH', async () => {
        // Resolved against whatever `dist/cli.gjs.mjs` is on disk — the tracked
        // one today, the one CI builds and ships as a run artifact once ADR 0002
        // untracks it. Either way it is a same-tree bundle, which is what makes
        // this a test of the INSTALL rather than of the download.
        //
        // A hard assert, never an `existsSync` guard: a suite that quietly does
        // not run is the failure mode this whole migration is about.
        const gjs = spawnSync('gjs', ['--version'], { timeout: TIMEOUT_MS });
        assert.equal(gjs.status, 0, 'this suite needs gjs — it is the runtime under test');
        const bundle = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
        assert.ok(existsSync(bundle), `${bundle} missing — build it before running this suite`);

        const fixture = mkdtempSync(join(tmpdir(), 'gjsify-nodefree-'));
        try {
            const fakeBin = join(fixture, 'fakebin');
            execFileSync('mkdir', ['-p', fakeBin], { timeout: TIMEOUT_MS });
            // A `node` that exits 127 makes ANY silent fallback to Node a loud
            // failure instead of a passing test that proved nothing.
            execFileSync(
                'sh',
                ['-c', `printf '#!/bin/sh\\nexit 127\\n' > "${fakeBin}/node" && chmod +x "${fakeBin}/node"`],
                {
                    timeout: TIMEOUT_MS,
                },
            );
            execFileSync(
                'sh',
                [
                    '-c',
                    `printf '{"name":"nodefree-fixture","private":true,"version":"0.0.0"}\\n' > "${fixture}/package.json"`,
                ],
                {
                    timeout: TIMEOUT_MS,
                },
            );
            execFileSync(
                'sh',
                [
                    '-c',
                    `printf '{"lockfileVersion":4,"requested":[],"packages":{}}\\n' > "${fixture}/gjsify-lock.json"`,
                ],
                {
                    timeout: TIMEOUT_MS,
                },
            );

            // Build the child env ONCE and carry HOME. A `bash` spawned with the
            // environment reduced to `{PATH}` alone does not return — it forks
            // without bound (measured: 4329 processes / 78.7 GB / a global OOM
            // that killed unrelated desktop processes). The probe and the call it
            // gates must also share this object; two env literals is how that
            // incident hid. See docs/build-artifacts.md.
            const env = {
                ...process.env,
                HOME: fixture,
                PATH: `${fakeBin}:/usr/bin:/bin`,
                XDG_CACHE_HOME: join(fixture, '.cache'),
            };
            const probe = spawnSync('sh', ['-c', 'command -v node && node --version'], {
                env,
                encoding: 'utf8',
                timeout: TIMEOUT_MS,
            });
            assertSpawnCompleted(probe, 'fake-node probe');
            assert.equal(probe.status, 127, 'the fake node must be the one on PATH, and must fail');

            const r = spawnSync('gjs', ['-m', bundle, 'install', '--immutable', '--quiet'], {
                cwd: fixture,
                env,
                encoding: 'utf8',
                timeout: TIMEOUT_MS,
            });
            assertSpawnCompleted(r, 'gjs install --immutable');
            assert.equal(r.status, 0, `Node-free install failed:\n${r.stdout}\n${r.stderr}`);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    await it('ships @gjsify/tsc as a RUNTIME dependency of the CLI', async () => {
        // The fact the whole Node-free BUILD rests on, and the one a fixture
        // cannot prove about itself.
        //
        // `build:infra` begins with `gjsify tsc`, which resolves
        // `@gjsify/tsc/bundle` from two anchors (`commands/tsc.ts`): the
        // project, then the running CLI's own location. On a Node-free host the
        // project has no `@gjsify/tsc` and there is no npm `typescript` to fall
        // back to, so ONLY the second anchor can answer — and it can only answer
        // because a global `gjsify install -g @gjsify/cli` puts `@gjsify/tsc`
        // beside the CLI. That happens for exactly one reason: the manifest
        // declares it in `dependencies`.
        //
        // Demote it to devDependencies (or peer, or optional) and every Node-free
        // host loses `gjsify tsc` while every CI leg stays green, because CI has
        // node and takes the `typescript` fallback. `tests/e2e/install-script`
        // covers the other half — that the install really does lay the sibling
        // down and that the subpath resolves from there.
        const manifest = JSON.parse(
            await readFile(join(REPO_ROOT, 'packages', 'infra', 'cli', 'package.json'), 'utf8'),
        );
        assert.equal(
            manifest.dependencies?.['@gjsify/tsc'],
            'workspace:^',
            '@gjsify/cli must depend on @gjsify/tsc at runtime — it is how the toolchain reaches a Node-free host',
        );
        for (const kind of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
            assert.equal(
                manifest[kind]?.['@gjsify/tsc'],
                undefined,
                `@gjsify/tsc must not ALSO sit in ${kind} — two declarations is where the runtime one gets dropped`,
            );
        }
    });

    await it('parses the lockfile contract of every shipped CLI shape', async () => {
        const mod = await import(join(REPO_ROOT, 'scripts', 'check-lockfile-reader-lead.mjs'));
        const { parseLockfileContract: parse } = mod;

        // Current shape: the readable set references the numeric constant.
        assert.deepEqual(
            parse('const LOCKFILE_VERSION = 4;\nconst READABLE_LOCKFILE_VERSIONS = new Set([2, 3, LOCKFILE_VERSION]);'),
            { writes: 4, reads: [2, 3, 4] },
        );
        // Pre-v0.27 shape: no readable set at all. Its reader was
        // `if (parsed.lockfileVersion !== LOCKFILE_VERSION) return null`, i.e.
        // exactly one accepted version — knowable, not unparseable.
        assert.deepEqual(parse('const LOCKFILE_VERSION = 2;'), { writes: 2, reads: [2] });
        // Renamed away: the check has gone blind, which must not read as a pass.
        assert.equal(parse('const SOMETHING_ELSE = 4;'), null);
    });
});
