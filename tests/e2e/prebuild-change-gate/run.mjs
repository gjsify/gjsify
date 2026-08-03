// E2E guard for the per-package prebuild gate.
//
// `.github/prebuild-toolchain/changed-packages.mjs` decides which native
// packages `prebuilds.yml` builds. It is the only thing standing between a
// change set and a SKIPPED build, so its failure mode is the expensive one: a
// wrong "build" costs minutes, a wrong "skip" ships a stale binary — the class
// of defect that let x86-64 objects sit in ppc64 directories for weeks.
//
// Everything here drives the REAL script against the REAL workflow file with
// `--changed-from-stdin`, so a change to either that breaks the contract fails
// here rather than on a 96-minute emulated leg.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('../../../.github/prebuild-toolchain/changed-packages.mjs', import.meta.url));
const workflow = fileURLToPath(new URL('../../../.github/workflows/prebuilds.yml', import.meta.url));
const emulated = fileURLToPath(new URL('../../../.github/prebuild-toolchain/emulated-build.sh', import.meta.url));
const muslScript = fileURLToPath(new URL('../../../.github/prebuild-toolchain/musl-build.sh', import.meta.url));

// A scratch dir this suite owns, for the per-run GITHUB_OUTPUT files below.
const scratch = mkdtempSync(join(tmpdir(), 'prebuild-gate-out-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let outputSeq = 0;

/**
 * Spawn the classifier with a `GITHUB_OUTPUT` THIS TEST OWNS.
 *
 * Never inherit the runner's. `--format=github-actions` appends to whatever
 * `GITHUB_OUTPUT` names, and under `node --test` inside the CI container that
 * is the real `/__w/_temp/_runner_file_commands/set_output_*` file, which the
 * test user cannot write: `EACCES`, and ONLY in CI — locally the variable is
 * unset, so the branch is never taken and the suite passes on every machine
 * that is not the one that matters. Pointing it at our own file fixes the
 * cause AND makes the emitted key/value pairs assertable, which is stronger
 * than the stdout-only check this used to do.
 *
 * @returns {{stdout: string, stderr: string, status: number, outputFile: string}}
 */
function runScript(args, { cwd = repoRoot, input, exe = script } = {}) {
    const outputFile = join(scratch, `out-${outputSeq++}.txt`);
    writeFileSync(outputFile, '');
    const r = spawnSync(process.execPath, [exe, ...args], {
        cwd,
        input,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1, outputFile };
}

/** Parse a `$GITHUB_OUTPUT` file into a plain key → value map. */
function readOutputs(file) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return out;
}

/** The forced-everything report — the full package key set. Returns raw JSON text. */
function runAll() {
    const r = runScript(['--all', '--format=json']);
    assert.equal(r.status, 0, `classifier failed:\n${r.stderr}`);
    return r.stdout;
}

/** Run the classifier over an explicit file list; returns its JSON report. */
function classify(files) {
    // `--format=json` — this helper needs no GitHub outputs, so it does not ask
    // for them (the isolated GITHUB_OUTPUT above is belt and braces).
    const r = runScript(['--changed-from-stdin', '--format=json'], { input: `${files.join('\n')}\n` });
    assert.equal(r.status, 0, `classifier failed:\n${r.stderr}`);
    return JSON.parse(r.stdout);
}

describe('prebuild change gate — package discovery', () => {
    it('derives its package set from the workflow, and that set is BRIDGES', () => {
        const text = readFileSync(workflow, 'utf8');
        // Every package directory the workflow names a prebuild path for, in
        // EITHER spelling — the bridge (`…/webgl/prebuilds/linux-x64/`, a build
        // leg's scratch upload) or the per-target package
        // (`…/webgl-linux-x64/prebuilds/linux-x64/`, what `commit-prebuilds`
        // writes since ADR 0017).
        const namedDirs = [...text.matchAll(/^\s*path:\s*packages\/([^\s/]+)\/([^\s/]+)\/prebuilds\/([^\s/]+)/gm)].map(
            ([, pillar, dir]) => ({ pillar, dir }),
        );
        assert.ok(namedDirs.length > 0, 'the workflow must name prebuild paths at all');

        // An empty change set with no base is "nothing affected", so ask the
        // forced path for the full key set.
        const all = JSON.parse(runAll());

        // DELIBERATELY not "re-run the parser and compare": that proves only
        // f(x) === f(x), and a test that mirrors the derivation it checks drifts
        // with it while both stay green — which is exactly what happened here
        // when the download paths moved to the per-target packages and this
        // test's own regex kept reading them at face value. Assert the PROPERTY
        // the table must have instead: every key is a BRIDGE, a package with a
        // native build system whose sources a change can touch. A per-target
        // package has none — it is a re-tarballing of one directory.
        for (const key of all.build) {
            const hit = namedDirs.find(({ dir }) => dir === key || dir.startsWith(`${key}-`));
            assert.ok(hit, `${key} is not a package directory prebuilds.yml names`);
            const pkgDir = join(repoRoot, 'packages', hit.pillar, key);
            assert.ok(existsSync(join(pkgDir, 'package.json')), `${key}: no package.json at ${pkgDir}`);
            assert.ok(
                existsSync(join(pkgDir, 'meson.build')),
                `${key}: no meson.build — the table must hold bridges, whose sources a change can touch, never ` +
                    'the per-target packages their artifacts are published from',
            );
        }
        // The other direction: no bridge the workflow builds may be missing.
        for (const { pillar, dir } of namedDirs) {
            if (!existsSync(join(repoRoot, 'packages', pillar, dir, 'meson.build'))) continue;
            assert.ok(all.build.includes(dir), `${dir} is built by the workflow but missing from the table`);
        }
        assert.ok(all.build.length >= 10, 'the workflow owns ten native packages today');
        assert.deepEqual(classify([]).build, [], 'an empty change set builds nothing');
    });

    it('FAILS when the two `on: paths:` lists diverge', (t) => {
        // The check that a UNION cannot make. prebuilds.yml carries two
        // identical `paths:` blocks (push + pull_request) and says in a comment
        // that they must stay identical; deleting `refs/oxc` from ONE of them
        // left the union intact, so the gate-vs-trigger assertion passed while a
        // pin bump could no longer start the workflow on that event.
        //
        // Driven on a COPY of the repo layout so the real workflow is never
        // mutated — the script resolves the workflow relative to its own file,
        // so the copy needs the same two-level structure.
        const tmp = mkdtempSync(join(tmpdir(), 'prebuild-gate-'));
        t.after(() => rmSync(tmp, { recursive: true, force: true }));
        mkdirSync(join(tmp, '.github', 'workflows'), { recursive: true });
        mkdirSync(join(tmp, '.github', 'prebuild-toolchain'), { recursive: true });
        copyFileSync(script, join(tmp, '.github', 'prebuild-toolchain', 'changed-packages.mjs'));

        const text = readFileSync(workflow, 'utf8');
        const broken = text.replace("      - 'refs/oxc'\n", '');
        assert.notEqual(broken, text, 'the fixture must actually remove a line');
        writeFileSync(join(tmp, '.github', 'workflows', 'prebuilds.yml'), broken);
        // The package/refs derivation reads real package dirs, so symlink them in.
        symlinkSync(join(repoRoot, 'packages'), join(tmp, 'packages'), 'dir');

        // Through `runScript` so this spawn also gets its OWN GITHUB_OUTPUT —
        // the format is json here, but a case that asserts "the classifier
        // FAILED" must not be satisfiable by an unrelated EACCES on the
        // runner's output file. Isolating the env keeps the non-zero exit
        // attributable to the divergence and nothing else.
        const r = runScript(['--all', '--format=json'], {
            cwd: tmp,
            exe: join(tmp, '.github', 'prebuild-toolchain', 'changed-packages.mjs'),
        });
        assert.notEqual(r.status, 0, 'a diverged paths list must FAIL the classifier');
        assert.match(r.stderr, /lists?\s*#2 differs from list #1|MUST be identical/);
        assert.match(r.stderr, /refs\/oxc/);
    });

    it('holds every package to a trigger under its own directory', () => {
        // The invariant the script's own `selfCheck` enforces at CI time, and
        // the reason a gate cannot silently outlive its trigger: a package with
        // no `on: paths:` entry under its directory can never START this
        // workflow from its own sources, so gating it would turn a latent bug
        // into an invisible one.
        const text = readFileSync(workflow, 'utf8');
        for (const key of JSON.parse(runAll()).build) {
            const dirs = [...text.matchAll(/^\s*path:\s*(packages\/[^\s/]+\/[^\s/]+)\/prebuilds\//gm)]
                .map((m) => m[1])
                .filter((d) => d.endsWith(`/${key}`));
            assert.ok(dirs.length > 0, `${key} must map to a package directory`);
            const hasTrigger = new RegExp(`^\\s*- '${dirs[0]}/`, 'm').test(text);
            assert.ok(hasTrigger, `${key}: no on: paths: entry under ${dirs[0]}/ — it could never rebuild`);
        }
    });
});

describe('prebuild change gate — what counts as changed', () => {
    it('builds only the package whose own sources changed', () => {
        const { build, skip } = classify(['packages/node/terminal-native/src/vala/terminal.vala']);
        assert.deepEqual(build, ['terminal-native']);
        assert.ok(skip.includes('lightningcss-native'), 'the expensive package must be skipped');
        assert.equal(skip.length + build.length, 10);
    });

    it('derives the same refs/ set as the conformance rule that owns it', async () => {
        // `changed-packages.mjs` reimplements `linkedRefsSubmodules` in six
        // lines instead of importing it, ON PURPOSE: the `changes` job runs with
        // nothing but `actions/checkout` + the runner's node, and gating must
        // not acquire a module graph that can fail to load there. The
        // duplication is therefore held to the original HERE — if #847's rule
        // changes its derivation, this reds a 1-second test instead of silently
        // skipping a build.
        const { linkedRefsSubmodules } = await import(
            new URL('../../../scripts/manifest-conformance/rules/refs-pin.mjs', import.meta.url)
        );
        const dirs = [
            ...new Set(
                [
                    ...readFileSync(workflow, 'utf8').matchAll(
                        /^\s*path:\s*(packages\/[^\s/]+\/[^\s/]+)\/prebuilds\//gm,
                    ),
                ].map((m) => m[1]),
            ),
        ];
        assert.ok(dirs.length >= 10);
        for (const dir of dirs) {
            const theirs = linkedRefsSubmodules(join(repoRoot, dir));
            const mine = classify([`${dir}/meson.build`]); // forces the table to be built
            assert.ok(mine.report.length > 0);
            // Every submodule the rule finds must make the package rebuild.
            for (const ref of theirs) {
                const key = dir.split('/').pop();
                assert.deepEqual(
                    classify([ref]).build.includes(key),
                    true,
                    `${key}: the rule links ${ref} but a change to it does not rebuild the package`,
                );
            }
        }
    });

    it('builds a package when its refs/ submodule PIN moves', () => {
        // A gitlink change appears in a diff as the submodule path. Both
        // relations must be honoured: rolldown-native DECLARES the lockstep,
        // oxfmt-native only LINKS refs/oxc by Cargo path dependency (it has no
        // `gjsify.refsLockstep` — tracked as task #59), and neither may mean
        // "this package never rebuilds".
        assert.deepEqual(classify(['refs/rolldown']).build, ['rolldown-native']);
        assert.deepEqual(classify(['refs/oxc']).build, ['oxfmt-native']);
    });

    it('rebuilds every package when a shared input changes', () => {
        for (const shared of [
            '.github/workflows/prebuilds.yml',
            '.github/prebuild-toolchain/emulated-build.sh',
            'scripts/stage-prebuild.mjs',
            'scripts/check-refs-pin.mjs',
            'scripts/check-prebuild-loader-path.mjs',
            // #847 moved the SUBSTANCE of the three scripts above into the
            // conformance registry, leaving them as thin CLI entry points. A
            // rule change alters what every build verifies, so the registry has
            // to rebuild everything too — naming only the wrappers would let
            // the check move out from under the gate.
            'scripts/manifest-conformance/rules/refs-pin.mjs',
            'scripts/manifest-conformance/rules/platforms-ci.mjs',
            'scripts/manifest-conformance/unchecked-fields.mjs',
        ]) {
            const { build, skip } = classify([shared]);
            assert.deepEqual(skip, [], `${shared} must rebuild everything`);
            assert.equal(build.length, 10);
        }
    });

    it('counts a package.json edit but never lets it start a run', () => {
        // `gjsify.platforms` / `gjsify.refsLockstep` are build inputs, so a
        // package.json edit rebuilds that package — but it is deliberately NOT
        // in the trigger list, because release-it rewrites all of them on every
        // release and that would run three emulated legs per version bump.
        assert.deepEqual(classify(['packages/node/tls-native/package.json']).build, ['tls-native']);
        const text = readFileSync(workflow, 'utf8');
        assert.ok(
            !/^\s*- 'packages\/[^']*\/package\.json'/m.test(text),
            'no package.json may be in the on: paths: filter',
        );
    });

    it('builds nothing for a change no package owns', () => {
        assert.deepEqual(classify(['packages/node/fs/src/index.ts', 'README.md']).build, []);
    });

    it('treats a committed Cargo.lock as a change to its bridge', () => {
        // #852 commits `src/rust/Cargo.lock` for all three Rust bridges and adds
        // it to meson's `rust_sources` — a lock bump then changes the binary, so
        // it MUST rebuild that package. It already does: the per-package globs
        // are derived from this workflow's `on: paths:` filter, and all three
        // bridges are listed there as `<pkg>/src/**` rather than a narrower
        // `src/vala/**`. Asserted rather than assumed, because narrowing any of
        // those three entries would silently reopen exactly the registry-drift
        // hole the lockfile is being committed to close.
        for (const pkg of ['lightningcss-native', 'oxfmt-native', 'rolldown-native']) {
            const { build } = classify([`packages/infra/${pkg}/src/rust/Cargo.lock`]);
            assert.deepEqual(build, [pkg], `${pkg}: a Cargo.lock change must rebuild it`);
        }
    });
});

describe('prebuild change gate — fail open', () => {
    it('builds everything when the diff base cannot be resolved', () => {
        const r = runScript(['--base', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--format=json']);
        assert.equal(r.status, 0, r.stderr);
        const { build, skip, reason } = JSON.parse(r.stdout);
        assert.deepEqual(skip, []);
        assert.equal(build.length, 10);
        assert.match(reason, /not a commit/);
    });

    it('PUBLISHES the decision to $GITHUB_OUTPUT, not just stdout', () => {
        // The `changes` job reads the FILE, so the file is what this asserts —
        // stdout alone would pass even if the append were dropped entirely.
        const r = runScript(['--changed-from-stdin', '--format=github-actions'], {
            input: 'packages/node/terminal-native/src/vala/terminal.vala\n',
        });
        assert.equal(r.status, 0, r.stderr);

        const outputs = readOutputs(r.outputFile);
        assert.deepEqual(Object.keys(outputs).sort(), ['build', 'reason', 'report', 'skip']);
        assert.deepEqual(JSON.parse(outputs.build), ['terminal-native']);
        assert.equal(JSON.parse(outputs.skip).length, 9);
        assert.match(outputs.reason, /1 of 10/);
        // `report` is what `prebuilds-summary` renders — it must be one line of
        // parseable JSON covering every package with a per-package reason.
        const report = JSON.parse(outputs.report);
        assert.equal(report.length, 10);
        assert.ok(report.every((e) => typeof e.key === 'string' && typeof e.why === 'string'));
        assert.equal(report.find((e) => e.key === 'terminal-native').build, true);
        assert.equal(report.find((e) => e.key === 'lightningcss-native').build, false);
        // Every value is a SINGLE line — a `key=value` file has no multi-line
        // form without a heredoc delimiter, so an embedded newline would
        // silently truncate the output GitHub records.
        for (const [k, v] of Object.entries(outputs)) {
            assert.ok(!v.includes('\n'), `${k} must be single-line`);
        }

        // The gates are `!contains(needs.changes.outputs.skip, '"<key>"')` on
        // the RAW string: an unset output is '', contains is false, and the
        // package builds. That only holds if the keys are QUOTED in the output
        // — the quoting is also what stops `"http2-native"` matching
        // `"http2-native-x"`.
        assert.ok(outputs.skip.includes('"lightningcss-native"'));
        assert.ok(!outputs.skip.includes('"terminal-native"'));

        // stdout mirrors the file, so a failed publish is still diagnosable.
        assert.ok(r.stdout.includes(`skip=${outputs.skip}`));
    });

    it('FAILS LOUDLY when $GITHUB_OUTPUT is set but unwritable', () => {
        // Silently continuing would leave every gate reading '' — which BUILDS
        // everything, so it is safe, but it is a dead gate wearing a green
        // tick and nothing would ever say so. A hard failure is still fail-open
        // (the `changes` job's wrapper catches a non-zero exit and writes the
        // all-build fallback), it just refuses to be quiet.
        const dir = mkdtempSync(join(tmpdir(), 'prebuild-gate-ro-'));
        const r = spawnSync(process.execPath, [script, '--all', '--format=github-actions'], {
            cwd: repoRoot,
            encoding: 'utf8',
            // A DIRECTORY can never be opened for append — portable across
            // platforms and CI users, unlike chmod (root ignores mode bits).
            env: { ...process.env, GITHUB_OUTPUT: dir },
        });
        rmSync(dir, { recursive: true, force: true });
        assert.notEqual(r.status, 0, 'an unpublishable decision must fail the step');
        assert.match(r.stderr, /cannot publish outputs to GITHUB_OUTPUT/);
        // The decision still reached stdout, so the log says what it WOULD have
        // published — that is the difference between diagnosable and a mystery.
        assert.match(r.stdout, /^skip=/m);
    });

    it('every workflow gate names a key the classifier actually emits', () => {
        // A gate whose key the classifier never emits can never skip — safe —
        // but it is dead, and a TYPO would read exactly like a deliberate
        // always-build. Both are worth catching.
        const text = readFileSync(workflow, 'utf8');
        const keys = new Set(JSON.parse(runAll()).build);
        const gated = [...text.matchAll(/!contains\(needs\.changes\.outputs\.skip, '"([^"]+)"'\)/g)].map((m) => m[1]);
        assert.ok(gated.length > 50, 'the legs must actually be gated');
        for (const key of new Set(gated)) {
            assert.ok(keys.has(key), `workflow gates on "${key}", which changed-packages.mjs never emits`);
        }
    });

    it('gates every artifact step on its OWN package', () => {
        // The asymmetry that would break `commit-prebuilds`: an upload gated on
        // one decision and the matching download on another (or on none). A
        // download with no artifact is a HARD FAILURE of that job —
        // `download-artifact` throws `Artifact '<name>' not found` and has no
        // `if-no-artifact-found` input — so upload and download must turn on and
        // off together, per package, everywhere.
        //
        // SCOPED TO THE AUTOMATIC LEGS, because the decision it enforces only
        // exists there. A `workflow_dispatch`-only job is not in `needs: [changes]`
        // — `needs.changes.outputs.skip` is not in scope inside it, so requiring
        // the gate string would buy a dead `if:` that READS like a live decision,
        // which is worse than none. It is also unnecessary: an exploratory leg
        // uploads for a human to inspect, `commit-prebuilds` never downloads it,
        // and an artifact nothing consumes cannot desync from anything.
        //
        // Pairs are matched by JOB SCOPE rather than by artifact name on purpose:
        // uploads are matrix-parameterised (`…-prebuilds-linux-${{ matrix.arch }}`)
        // while the downloads spell each arch out, so a name-level set comparison
        // reports every automatic leg as unpaired — measured, and it is a property
        // of the spelling, not of the workflow.
        const text = readFileSync(workflow, 'utf8');
        // Two-space-indented `<name>:` on its own line = a job. `on:`'s children
        // match too and contribute no artifact steps, which is harmless.
        const jobs = text.split(/^ {2}(?=[a-z0-9-]+:\s*$)/m).slice(1);
        let checked = 0;
        let exempt = 0;
        for (const job of jobs) {
            const jobIf = /^ {4}if:\s*(.+)$/m.exec(job);
            const dispatchOnly = jobIf?.[1].trim() === "github.event_name == 'workflow_dispatch'";
            for (const step of job.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1)) {
                if (!/actions\/(up|down)load-artifact/.test(step)) continue;
                const artifact = /\n\s*name:\s*([\w-]+)-prebuilds-/.exec(step);
                if (!artifact) continue;
                if (dispatchOnly) {
                    exempt++;
                    continue;
                }
                const key = artifact[1];
                checked++;
                assert.ok(
                    step.includes(`'"${key}"'`),
                    `an artifact step for "${key}" is not gated on its own package:\n${step.slice(0, 200)}`,
                );
            }
        }
        // The exemption must stay a carve-out, not become the rule: the automatic
        // legs are ~60 steps and every one of them is still held to the gate.
        assert.ok(checked >= 60, `expected every automatic artifact step to be checked, saw ${checked}`);
        assert.ok(exempt < checked / 4, `too many artifact steps exempted as dispatch-only (${exempt})`);
    });
});

describe('prebuild change gate — the emulated leg obeys the same decision', () => {
    it('skips a package in PREBUILD_SKIP and builds everything when it is unset', () => {
        // The emulated build is a single `docker run`, so the decision travels
        // into the container as an env var and the script filters on it. Drive
        // the REAL helper out of the real file.
        const src = readFileSync(emulated, 'utf8');
        const helper = src.slice(src.indexOf('should_build() {'), src.indexOf('# Does this leg build anything'));
        assert.ok(helper.includes('case "$PREBUILD_SKIP"'), 'should_build must key on PREBUILD_SKIP');
        const probe = `${helper}
for d in packages/infra/lightningcss-native packages/node/http2-native packages/node/http-soup-bridge; do
  if should_build "$d"; then echo "BUILD $d"; else echo "SKIP $d"; fi
done`;
        const skipping = spawnSync('bash', ['-c', probe], {
            encoding: 'utf8',
            env: { ...process.env, PREBUILD_SKIP: '["lightningcss-native","http2-native"]' },
        });
        assert.equal(skipping.status, 0, skipping.stderr);
        assert.match(skipping.stdout, /SKIP packages\/infra\/lightningcss-native/);
        assert.match(skipping.stdout, /SKIP packages\/node\/http2-native/);
        // The near-miss the quoting exists for: http-soup-bridge is not
        // http2-native, and neither contains the other's quoted key.
        assert.match(skipping.stdout, /BUILD packages\/node\/http-soup-bridge/);

        const unset = spawnSync('bash', ['-c', `PREBUILD_SKIP="\${PREBUILD_SKIP:-[]}"\n${probe}`], {
            encoding: 'utf8',
            env: { ...process.env, PREBUILD_SKIP: '' },
        });
        assert.equal(unset.status, 0, unset.stderr);
        assert.ok(!unset.stdout.includes('SKIP '), 'an unset skip list must build everything');
    });

    it('is a real, executable file the workflow mounts', () => {
        assert.ok(existsSync(emulated));
        assert.equal(spawnSync('bash', ['-n', emulated]).status, 0, 'emulated-build.sh must parse');
    });

    it('the musl leg\u2019s script parses under POSIX sh and is executable', () => {
        // Checked with `sh -n`, not `bash -n`: it runs in `alpine:3.24`, whose
        // only shell is busybox ash. A bashism would pass a bash check and then
        // fail in the container, which is the one place this leg cannot be
        // debugged cheaply — it is dispatch-only and main-only in effect.
        assert.ok(existsSync(muslScript));
        assert.equal(spawnSync('sh', ['-n', muslScript]).status, 0, 'musl-build.sh must parse under POSIX sh');
        // Mounted and invoked as `sh <script>`, so the bit is not strictly
        // required — but its sibling has it, and a script a human is told to run
        // by hand (see its header) should be runnable.
        assert.ok(statSync(muslScript).mode & 0o111, 'musl-build.sh must be executable');
    });
});
