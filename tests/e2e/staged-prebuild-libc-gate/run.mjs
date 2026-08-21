// E2E guard for `scripts/check-staged-prebuild-libc.mjs` — the gate that measures the glibc
// floor of what a build leg just staged.
//
// That script's header carries the incident (#924 for the gate, #1232 for the two zeros it
// has to tell apart) and is not restated here — a second copy is the one that drifts. What
// this file adds is the pairing: for every shape that must PASS there is the neighbouring
// shape that must still FAIL, because a gate only ever seen passing is how leniency gets in.
//
// EVERY case drives the REAL script. The accounting cases use a synthetic root (`--root`), so
// they are hermetic and never touch this repository's own `prebuilds/` directories; the two
// measurement cases stage a REAL committed artifact into it, so "the built ones are still
// gated" is a claim about bytes rather than about control flow.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const script = join(repoRoot, 'scripts', 'check-staged-prebuild-libc.mjs');
const workflow = join(repoRoot, '.github', 'workflows', 'prebuilds.yml');

/**
 * The committed artifact the measurement cases stage.
 *
 * `lightningcss-native` on purpose: it is the Rust bridge whose float maths made #924 — the
 * incident this whole gate exists for — and the one package in the tree guaranteed to record
 * versioned glibc symbols, which is what a floor comparison needs. Its own platform package
 * supplies `os`/`cpu`/`libc`/`glibcRequires`, so nothing here hard-codes a number that a
 * future base-image bump would silently invalidate.
 */
const FIXTURE_PKG = join(repoRoot, 'packages', 'infra', 'lightningcss-native-linux-x64');

const scratch = mkdtempSync(join(tmpdir(), 'staged-libc-gate-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let seq = 0;

/**
 * A throwaway repo root holding one platform package per spec, and — when `staged` — the
 * bridge scratch directory a collect step would have written.
 *
 * @param {Array<{dir: string, target: string, staged?: boolean, floor?: string}>} bridges
 */
function withRoot(bridges) {
    const root = join(scratch, `root-${seq++}`);
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*/*'] }),
    );
    const fixture = JSON.parse(readFileSync(join(FIXTURE_PKG, 'package.json'), 'utf8'));
    for (const b of bridges) {
        const [, pillar, name] = b.dir.split('/');
        const bridgeDir = join(root, 'packages', pillar, name);
        mkdirSync(bridgeDir, { recursive: true });
        writeFileSync(
            join(bridgeDir, 'package.json'),
            JSON.stringify({ name: `@t/${name}`, version: '0.0.0', private: true }),
        );
        const platformDir = join(root, 'packages', pillar, `${name}-${b.target}`);
        mkdirSync(platformDir, { recursive: true });
        writeFileSync(
            join(platformDir, 'package.json'),
            JSON.stringify({
                name: `@t/${name}-${b.target}`,
                version: '0.0.0',
                os: fixture.os,
                cpu: fixture.cpu,
                libc: fixture.libc,
                gjsify: {
                    prebuilds: 'prebuilds',
                    platforms: [b.target],
                    glibcRequires: { [b.target]: b.floor ?? fixture.gjsify.glibcRequires[b.target] },
                },
            }),
        );
        if (!b.staged) continue;
        const stagedDir = join(bridgeDir, 'prebuilds', b.target);
        mkdirSync(stagedDir, { recursive: true });
        for (const file of readdirSync(join(FIXTURE_PKG, 'prebuilds', 'linux-x64'))) {
            copyFileSync(join(FIXTURE_PKG, 'prebuilds', 'linux-x64', file), join(stagedDir, file));
        }
    }
    return root;
}

/** Run the gate against `root`, with the leg wiring the workflow supplies. */
function runGate(root, { target, report } = {}) {
    const env = { ...process.env };
    delete env.PREBUILD_TARGET;
    delete env.PREBUILD_REPORT;
    if (target !== undefined) env.PREBUILD_TARGET = target;
    if (report !== undefined) env.PREBUILD_REPORT = typeof report === 'string' ? report : JSON.stringify(report);
    const r = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', env });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** One `changes`-job report row, in the shape `changed-packages.mjs --format=json` emits. */
const row = (dir, build) => ({
    key: dir.split('/').pop(),
    dir,
    build,
    why: build ? 'src changed' : `no change under ${dir}/`,
});

describe('check-staged-prebuild-libc', () => {
    it('passes when every candidate was skipped as unchanged — AND says so', () => {
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-x64' },
            { dir: 'packages/demo/beta', target: 'linux-x64' },
        ]);
        const r = runGate(root, {
            target: 'linux-x64',
            report: [row('packages/demo/alpha', false), row('packages/demo/beta', false)],
        });
        assert.equal(r.status, 0, `expected a pass, got ${r.status}: ${r.stderr}`);
        // A SILENT pass is the thing this gate exists to remove, so the zero has to be legible:
        // the count, the target, and every package it stands for, by name.
        assert.match(r.stdout, /0 targets measured for linux-x64/);
        assert.match(r.stdout, /SKIPPED AS UNCHANGED/);
        assert.match(r.stdout, /skipped {2}@t\/alpha-linux-x64/);
        assert.match(r.stdout, /skipped {2}@t\/beta-linux-x64/);
    });

    it('still fails when a package it was told to BUILD staged nothing', () => {
        // The neighbouring shape, and the one the gate was written for: same zero, opposite
        // verdict. `beta` was in the build set and produced no bytes.
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-x64' },
            { dir: 'packages/demo/beta', target: 'linux-x64' },
        ]);
        const r = runGate(root, {
            target: 'linux-x64',
            report: [row('packages/demo/alpha', false), row('packages/demo/beta', true)],
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /was told to BUILD staged nothing for linux-x64/);
        assert.match(r.stderr, /@t\/beta-linux-x64/);
        assert.doesNotMatch(r.stderr, /@t\/alpha-linux-x64/);
    });

    it('a partial skip is not a blanket exemption — the built ones are still measured', () => {
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-x64', staged: true },
            { dir: 'packages/demo/beta', target: 'linux-x64' },
        ]);
        const r = runGate(root, {
            target: 'linux-x64',
            report: [row('packages/demo/alpha', true), row('packages/demo/beta', false)],
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /measuring 1 freshly staged target/);
        assert.match(r.stdout, /@t\/alpha-linux-x64 {2}←/);
        // The skipped half stays visible: a reader comparing two runs' target counts is owed
        // the reason for the difference, and "9 fewer, no explanation" is how a skip that was
        // NOT meant slips through unread.
        assert.match(r.stdout, /skipped {2}@t\/beta-linux-x64/);
    });

    it('and that measurement is not a no-op — a false floor on the built one fails', () => {
        // The discriminator. Without it every assertion above would also hold for a gate that
        // measured nothing at all, which is this repository's most expensive defect class.
        // `2.2.5` is the lowest glibc release there is, so the artifact's real floor is above
        // it whatever the base image becomes.
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-x64', staged: true, floor: '2.2.5' },
            { dir: 'packages/demo/beta', target: 'linux-x64' },
        ]);
        const r = runGate(root, {
            target: 'linux-x64',
            report: [row('packages/demo/alpha', true), row('packages/demo/beta', false)],
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /requires glibc ≥ .* but `gjsify\.glibcRequires\["linux-x64"\]` promises 2\.2\.5/);
    });

    it('never reports a candidate belonging to another leg', () => {
        // THE #1232 ROOT CAUSE, as a regression test. `oxfmt-native` and `rolldown-native`
        // have no `-linux-ppc64` platform package, so on an emulated leg they are not
        // candidates at all — and a leg's verdict must not depend on a package it does not
        // build. Here `beta` is a linux-x64 package on a ppc64 leg, in the build set, staging
        // nothing: correct, and not a finding.
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-ppc64' },
            { dir: 'packages/demo/beta', target: 'linux-x64' },
        ]);
        const r = runGate(root, {
            target: 'linux-ppc64',
            report: [row('packages/demo/alpha', false), row('packages/demo/beta', true)],
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /0 targets measured for linux-ppc64/);
        assert.doesNotMatch(r.stdout, /beta/);
    });

    it('ignores a platform package this workflow does not build', () => {
        // `@gjsify/napi` has linux platform packages and its own workflow. An empty
        // `packages/napi/napi/prebuilds/` is not a prebuilds.yml leg's business, and the
        // report's `dir` set — derived by the classifier from this workflow's own upload
        // steps — is what says so.
        const root = withRoot([
            { dir: 'packages/demo/alpha', target: 'linux-x64' },
            { dir: 'packages/other/napi', target: 'linux-x64' },
        ]);
        const r = runGate(root, { target: 'linux-x64', report: [row('packages/demo/alpha', false)] });
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout, /napi/);
    });

    it('fails closed when it was told nothing at all', () => {
        // Today's invocation, and what a broken wire in the workflow degrades to. A zero the
        // gate cannot EXPLAIN is a failure — the alternative is a green tick that means "I had
        // no idea", which is exactly the verdict this gate exists to refuse.
        const root = withRoot([{ dir: 'packages/demo/alpha', target: 'linux-x64' }]);
        const r = runGate(root, {});
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no freshly staged prebuild directory/);
        assert.match(r.stderr, /PREBUILD_TARGET was empty/);
    });

    it('treats the classifier’s fail-open report as "build everything", not "skip everything"', () => {
        // `changes` publishes `report=[]` when `changed-packages.mjs` could not decide, and
        // that path builds EVERY package. Reading `[]` as "nothing to build" would invert the
        // one decision the classifier deliberately makes fail-safe.
        const root = withRoot([{ dir: 'packages/demo/alpha', target: 'linux-x64' }]);
        const r = runGate(root, { target: 'linux-x64', report: '[]' });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /classifier failed open/);
    });

    it('fails closed on a report it cannot parse', () => {
        const root = withRoot([{ dir: 'packages/demo/alpha', target: 'linux-x64' }]);
        for (const bad of ['not json', '{"dir":"x"}', '[{"dir":"packages/demo/alpha"}]']) {
            const r = runGate(root, { target: 'linux-x64', report: bad });
            assert.equal(r.status, 1, `PREBUILD_REPORT=${bad} must not pass`);
            assert.match(r.stderr, /PREBUILD_REPORT/);
        }
    });

    it('prebuilds.yml hands the gate both keys, in every leg that runs it', () => {
        // THE WIRE IS THE OTHER HALF OF THE FIX. The script above fails closed without these
        // two values, so a step that lost them would red every leg whose packages were all
        // skipped — the original defect, back. Derived from the workflow rather than listed
        // here, so a third leg adopting the gate is covered on arrival.
        const text = readFileSync(workflow, 'utf8');
        const steps = text
            .split(/^ {6}- (?=name:|uses:|run:)/m)
            .filter((s) => s.startsWith('name: Gate on the glibc floor'));
        assert.ok(steps.length >= 2, `expected the gate in both build legs, found ${steps.length}`);
        for (const step of steps) {
            assert.match(step, /PREBUILD_TARGET: linux-\$\{\{ matrix\.arch \}\}/);
            assert.match(step, /PREBUILD_REPORT: \$\{\{ needs\.changes\.outputs\.report \}\}/);
        }
        // …and the values have to exist. `report` is a `changes` output and both jobs need it.
        assert.match(text, /^ {6}report: \$\{\{ steps\.detect\.outputs\.report \}\}$/m);
    });

    it('the fixture it measures is actually there', () => {
        // A suite whose fixture quietly vanished would pass its control-flow cases and stop
        // measuring bytes, which is the failure this file is otherwise built to catch.
        assert.ok(existsSync(join(FIXTURE_PKG, 'package.json')), `${FIXTURE_PKG} must exist`);
        const libs = readdirSync(join(FIXTURE_PKG, 'prebuilds', 'linux-x64')).filter((f) => f.endsWith('.so'));
        assert.ok(libs.length > 0, 'the fixture platform package must carry committed .so files');
    });
});
