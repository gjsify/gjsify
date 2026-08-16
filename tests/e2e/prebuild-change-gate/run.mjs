// E2E guard for the per-package prebuild gate.
//
// `.github/prebuild-toolchain/changed-packages.mjs` decides which native packages
// `prebuilds.yml` builds, so its failure modes are asymmetric: a wrong "build"
// costs minutes, a wrong "skip" ships a stale binary — the defect that let x86-64
// objects sit in ppc64 directories for weeks.
//
// Everything here drives the REAL script against the REAL workflow file with
// `--changed-from-stdin`, so a contract-breaking change to either fails here
// rather than on a 96-minute emulated leg.
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
// `release.yml` stages prebuilds too, in its two `napi-prebuild-*` legs. In scope
// here because the release path is where a hand-written `cp` list is least
// recoverable — its output is published before anything reads it, and its
// darwin-arm64 target is never committed (`gjsify.platformsUncommitted`), so those
// bytes have no second copy to compare against.
const releaseWorkflow = fileURLToPath(new URL('../../../.github/workflows/release.yml', import.meta.url));
// The two scripts `commit-prebuilds` runs, in the hand-staging scan set below
// because moving shell out of the YAML must not move it out from under the ban.
const syncAndStage = fileURLToPath(new URL('../../../.github/prebuild-toolchain/sync-and-stage.sh', import.meta.url));
const gatePushedTree = fileURLToPath(
    new URL('../../../.github/prebuild-toolchain/gate-pushed-tree.sh', import.meta.url),
);

// A scratch dir this suite owns, for the per-run GITHUB_OUTPUT files below.
const scratch = mkdtempSync(join(tmpdir(), 'prebuild-gate-out-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let outputSeq = 0;

/**
 * Spawn the classifier with a `GITHUB_OUTPUT` THIS TEST OWNS — never the runner's.
 *
 * `--format=github-actions` appends to whatever `GITHUB_OUTPUT` names, and under
 * `node --test` in the CI container that is the real
 * `/__w/_temp/_runner_file_commands/set_output_*`, which the test user cannot write:
 * `EACCES`, and ONLY in CI, since locally the variable is unset and the branch is
 * never taken. Our own file also makes the emitted key/value pairs assertable.
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

/**
 * How many native packages the gate owns, DERIVED from the classifier's own
 * forced-everything key set — never written down. It was the literal `10` in four
 * assertions; ADR 0022 added an eleventh package and all four kept the old number,
 * so the suite went red on a COUNT rather than the contract — invisibly, because the
 * E2E leg is path-filtered and skipped on the PR that caused it.
 *
 * `--all` is a different code path from the change-driven classification every caller
 * below exercises, so this is a partition check, not `f(x) === f(x)`. That the key set
 * matches the WORKFLOW is held separately by `— package discovery` below, which is
 * where a genuinely missing bridge fails.
 */
let packageCountCache;
function packageCount() {
    packageCountCache ??= JSON.parse(runAll()).build.length;
    return packageCountCache;
}

/** Run the classifier over an explicit file list; returns its JSON report. */
function classify(files) {
    const r = runScript(['--changed-from-stdin', '--format=json'], { input: `${files.join('\n')}\n` });
    assert.equal(r.status, 0, `classifier failed:\n${r.stderr}`);
    return JSON.parse(r.stdout);
}

describe('prebuild change gate — package discovery', () => {
    it('derives its package set from the workflow, and that set is BRIDGES', () => {
        const text = readFileSync(workflow, 'utf8');
        // Both spellings the workflow names a prebuild path in: the bridge
        // (`…/webgl/prebuilds/linux-x64/`, a build leg's scratch upload) and the
        // per-target package (`…/webgl-linux-x64/…`, what `commit-prebuilds` writes
        // since ADR 0017).
        const namedDirs = [...text.matchAll(/^\s*path:\s*packages\/([^\s/]+)\/([^\s/]+)\/prebuilds\/([^\s/]+)/gm)].map(
            ([, pillar, dir]) => ({ pillar, dir }),
        );
        assert.ok(namedDirs.length > 0, 'the workflow must name prebuild paths at all');

        // An empty change set with no base is "nothing affected", so ask the forced path.
        const all = JSON.parse(runAll());

        // DELIBERATELY not "re-run the parser and compare": that proves only
        // f(x) === f(x), and a test mirroring the derivation it checks drifts with it
        // while both stay green — which is what happened when the download paths moved to
        // the per-target packages and this test's regex kept reading them at face value.
        // The PROPERTY instead: every key is a BRIDGE, a package with a native build
        // system whose sources a change can touch. A per-target package has none.
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
        assert.ok(all.build.length >= 10, 'the workflow owns at least ten native packages');
        assert.deepEqual(classify([]).build, [], 'an empty change set builds nothing');
    });

    it('FAILS when the two `on: paths:` lists diverge', (t) => {
        // The check a UNION cannot make: prebuilds.yml carries two `paths:` blocks (push
        // + pull_request) that must stay identical, and deleting `refs/oxc` from ONE left
        // the union intact — the gate-vs-trigger assertion passed while a pin bump could
        // no longer start the workflow on that event.
        //
        // Driven on a COPY of the repo layout so the real workflow is never mutated; the
        // script resolves the workflow relative to its own file, so the copy needs the
        // same two-level structure.
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

        // Through `runScript` for its OWN GITHUB_OUTPUT: a case asserting "the classifier
        // FAILED" must not be satisfiable by an unrelated EACCES on the runner's output
        // file, which would make the non-zero exit unattributable.
        const r = runScript(['--all', '--format=json'], {
            cwd: tmp,
            exe: join(tmp, '.github', 'prebuild-toolchain', 'changed-packages.mjs'),
        });
        assert.notEqual(r.status, 0, 'a diverged paths list must FAIL the classifier');
        assert.match(r.stderr, /lists?\s*#2 differs from list #1|MUST be identical/);
        assert.match(r.stderr, /refs\/oxc/);
    });

    it('holds every package to a trigger under its own directory', () => {
        // A gate must not outlive its trigger: a package with no `on: paths:` entry under
        // its directory can never START this workflow from its own sources, so gating it
        // turns a latent bug into an invisible one. Also `selfCheck`'s invariant at CI time.
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
        assert.equal(skip.length + build.length, packageCount());
    });

    it('derives the same refs/ set as the conformance rule that owns it', async () => {
        // `changed-packages.mjs` reimplements `linkedRefsSubmodules` in six lines instead
        // of importing it ON PURPOSE: the `changes` job runs with nothing but
        // `actions/checkout` + the runner's node, and gating must not acquire a module
        // graph that can fail to load there. The duplication is held to the original HERE,
        // so a change to the rule's derivation reds a 1-second test instead of silently
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
        // A gitlink change appears in a diff as the submodule path. Both relations that can
        // tie a bridge to a submodule must be honoured — a `gjsify.refsLockstep`
        // declaration and a bare Cargo path dependency (`linkedRefsSubmodules`) — and
        // neither may mean "this package never rebuilds".
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
            // The three scripts above are thin CLI entry points; their substance lives in
            // the conformance registry. A rule change alters what every build verifies, so
            // naming only the wrappers would let the check move out from under the gate.
            'scripts/manifest-conformance/rules/refs-pin.mjs',
            'scripts/manifest-conformance/rules/platforms-ci.mjs',
            'scripts/manifest-conformance/unchecked-fields.mjs',
        ]) {
            const { build, skip } = classify([shared]);
            assert.deepEqual(skip, [], `${shared} must rebuild everything`);
            assert.equal(build.length, packageCount());
        }
    });

    it('counts a package.json edit but never lets it start a run', () => {
        // `gjsify.platforms` / `gjsify.refsLockstep` are build inputs, so a package.json
        // edit rebuilds that package — but it is deliberately NOT in the trigger list,
        // because release-it rewrites all of them on every release and that would run three
        // emulated legs per version bump.
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
        // `src/rust/Cargo.lock` is committed for all three Rust bridges and is in meson's
        // `rust_sources`, so a lock bump changes the binary and MUST rebuild the package.
        // It does, via `on: paths:` entries spelled `<pkg>/src/**` rather than a narrower
        // `src/vala/**` — asserted because narrowing any of the three would silently reopen
        // the registry-drift hole the lockfile was committed to close.
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
        assert.equal(build.length, packageCount());
        assert.match(reason, /not a commit/);
    });

    it('PUBLISHES the decision to $GITHUB_OUTPUT, not just stdout', () => {
        // The `changes` job reads the FILE: stdout alone would pass even with the append
        // dropped entirely.
        const r = runScript(['--changed-from-stdin', '--format=github-actions'], {
            input: 'packages/node/terminal-native/src/vala/terminal.vala\n',
        });
        assert.equal(r.status, 0, r.stderr);

        const outputs = readOutputs(r.outputFile);
        assert.deepEqual(Object.keys(outputs).sort(), ['build', 'reason', 'report', 'skip']);
        assert.deepEqual(JSON.parse(outputs.build), ['terminal-native']);
        assert.equal(JSON.parse(outputs.skip).length, packageCount() - 1);
        assert.match(outputs.reason, new RegExp(`1 of ${packageCount()}`));
        // `report` is what `prebuilds-summary` renders: one line of parseable JSON covering
        // every package with a per-package reason.
        const report = JSON.parse(outputs.report);
        assert.equal(report.length, packageCount());
        assert.ok(report.every((e) => typeof e.key === 'string' && typeof e.why === 'string'));
        assert.equal(report.find((e) => e.key === 'terminal-native').build, true);
        assert.equal(report.find((e) => e.key === 'lightningcss-native').build, false);
        // A `key=value` file has no multi-line form without a heredoc delimiter, so an
        // embedded newline silently truncates the output GitHub records.
        for (const [k, v] of Object.entries(outputs)) {
            assert.ok(!v.includes('\n'), `${k} must be single-line`);
        }

        // The gates are `!contains(needs.changes.outputs.skip, '"<key>"')` on the RAW
        // string: an unset output is '', contains is false, and the package builds. That
        // holds only if the keys are QUOTED — which is also what stops `"http2-native"`
        // matching `"http2-native-x"`.
        assert.ok(outputs.skip.includes('"lightningcss-native"'));
        assert.ok(!outputs.skip.includes('"terminal-native"'));

        // stdout mirrors the file, so a failed publish is still diagnosable.
        assert.ok(r.stdout.includes(`skip=${outputs.skip}`));
    });

    it('FAILS LOUDLY when $GITHUB_OUTPUT is set but unwritable', () => {
        // Silently continuing leaves every gate reading '' — which BUILDS everything, so it
        // is safe, but it is a dead gate wearing a green tick. A hard failure is still
        // fail-open (the `changes` job's wrapper catches a non-zero exit and writes the
        // all-build fallback), it just refuses to be quiet.
        const dir = mkdtempSync(join(tmpdir(), 'prebuild-gate-ro-'));
        const r = spawnSync(process.execPath, [script, '--all', '--format=github-actions'], {
            cwd: repoRoot,
            encoding: 'utf8',
            // A DIRECTORY can never be opened for append — portable across platforms and CI
            // users, unlike chmod (root ignores mode bits).
            env: { ...process.env, GITHUB_OUTPUT: dir },
        });
        rmSync(dir, { recursive: true, force: true });
        assert.notEqual(r.status, 0, 'an unpublishable decision must fail the step');
        assert.match(r.stderr, /cannot publish outputs to GITHUB_OUTPUT/);
        // The decision still reaches stdout, so the log says what it WOULD have published.
        assert.match(r.stdout, /^skip=/m);
    });

    it('every workflow gate names a key the classifier actually emits', () => {
        // A gate whose key the classifier never emits can never skip — safe, but dead, and
        // a TYPO reads exactly like a deliberate always-build.
        const text = readFileSync(workflow, 'utf8');
        const keys = new Set(JSON.parse(runAll()).build);
        const gated = [...text.matchAll(/!contains\(needs\.changes\.outputs\.skip, '"([^"]+)"'\)/g)].map((m) => m[1]);
        assert.ok(gated.length > 50, 'the legs must actually be gated');
        for (const key of new Set(gated)) {
            assert.ok(keys.has(key), `workflow gates on "${key}", which changed-packages.mjs never emits`);
        }
    });

    it('gates every artifact step on its OWN package', () => {
        // The asymmetry that would break `commit-prebuilds`: an upload gated on one decision
        // and the matching download on another (or none). A download with no artifact is a
        // HARD FAILURE of that job — `download-artifact` throws `Artifact '<name>' not
        // found` and has no `if-no-artifact-found` input — so the two must turn on and off
        // together, per package, everywhere.
        //
        // SCOPED TO THE AUTOMATIC LEGS: a `workflow_dispatch`-only job is not in
        // `needs: [changes]`, so `needs.changes.outputs.skip` is out of scope there and
        // requiring the gate string would buy a dead `if:` that READS like a live decision.
        // It is also unnecessary — `commit-prebuilds` never downloads an exploratory leg's
        // artifact, and an artifact nothing consumes cannot desync.
        //
        // Pairs are matched by JOB SCOPE, not artifact name: uploads are
        // matrix-parameterised (`…-prebuilds-linux-${{ matrix.arch }}`) while downloads
        // spell each arch out, so a name-level set comparison reports every automatic leg
        // as unpaired — a property of the spelling, not of the workflow.
        const text = readFileSync(workflow, 'utf8');
        // Two-space-indented `<name>:` on its own line = a job. `on:`'s children match too
        // and contribute no artifact steps, which is harmless.
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
        // The exemption must stay a carve-out, not become the rule.
        assert.ok(checked >= 60, `expected every automatic artifact step to be checked, saw ${checked}`);
        assert.ok(exempt < checked / 4, `too many artifact steps exempted as dispatch-only (${exempt})`);
    });
});

// Staging goes through the SHARED stager (AGENTS.md § Prebuilds: "never a hand-written
// `cp`"), asserted on the workflow TEXT. The drift it caught: the linux `cp` lists for
// `webgl` and `webrtc-native` omitted the `.gir` while darwin's included it, so ten of
// the sixty per-target directories had a different file shape from every other one and
// nothing said so.
//
// A hand-written body also skips everything the stager DOES: the target comes from the
// package's own `gjsify.platforms` rather than a literal a job can get wrong, artifacts
// are matched by EXTENSION (so a library renamed in `meson.build` cannot ship a stale
// set), and it ends in `checkPrebuildDir()` — the staged-sibling +
// `$ORIGIN`/`@loader_path` check that is the whole of #832.
//
// Here rather than in a conformance rule: `platforms-ci` reads the same file but asks
// "which targets does CI build" and is deliberately advisory, so an unparsed shape can
// never fail a package nobody touched. "Was this staged by hand" is a HARD property.
describe('prebuild change gate — staging goes through the shared stager', () => {
    /**
     * The workflow's step bodies, with comment lines dropped.
     *
     * Comments are stripped because several of them NAME the anti-pattern in order to
     * explain why it is forbidden (the musl leg's header, the Linux leg's guard). A shell
     * comment stages nothing, so reading one as a violation would make the rule
     * unstatable in the very place it is justified.
     */
    function stepBodies(text) {
        const steps = [];
        for (const raw of text.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1)) {
            const name = (/^name:\s*(.+)$/m.exec(raw)?.[1] ?? '(unnamed)').trim();
            const body = raw
                .split('\n')
                .filter((l) => !/^\s*(#|rem\s)/.test(l))
                .join('\n');
            steps.push({ name, body });
        }
        return steps;
    }

    // Both spellings of "make the directory and copy into it by hand": `mkdir -p` for
    // POSIX and `New-Item -ItemType Directory` for pwsh, since the win32 legs are pwsh and
    // leaving it out would make "move the cp to Windows" the trivial escape.
    const HAND_STAGING = [
        { label: 'mkdir -p …prebuilds/', re: /mkdir\s+-p\s+\S*prebuilds\// },
        { label: 'New-Item …prebuilds…', re: /New-Item[^\n]*prebuilds/i },
    ];

    for (const file of [workflow, releaseWorkflow, emulated, muslScript, syncAndStage, gatePushedTree]) {
        it(`no step in ${file.split('/').pop()} stages a prebuild by hand`, () => {
            const text = readFileSync(file, 'utf8');
            // `.sh` files are one body; `.yml` splits into steps. Either way the unit
            // reported is what a reviewer would go and read.
            const units = file.endsWith('.yml')
                ? stepBodies(text)
                : [{ name: file.split('/').pop(), body: text.replace(/^\s*#.*$/gm, '') }];
            assert.ok(units.length > 0, `${file}: nothing to scan — the parser no longer understands it`);
            for (const unit of units) {
                for (const { label, re } of HAND_STAGING) {
                    assert.ok(
                        !re.test(unit.body),
                        `${file}: step "${unit.name}" stages a prebuild by hand (${label}).\n` +
                            '  Use `node scripts/stage-prebuild.mjs <pkg-dir> [--scratch]` instead: it derives the\n' +
                            "  target from the package's own `gjsify.platforms`, matches artifacts by EXTENSION\n" +
                            '  (so a renamed library cannot ship a stale set) and runs checkPrebuildDir() over\n' +
                            '  what it wrote. AGENTS.md § Prebuilds: "never a hand-written `cp`".',
                    );
                }
            }
        });
    }

    it('every build leg that stages DOES call the shared stager', () => {
        // The other direction, not redundant: deleting a collect step outright also
        // satisfies the ban above, and a leg that stages nothing uploads an empty artifact
        // that `commit-prebuilds` commits as a DELETION — the failure its own "Refuse to
        // delete a committed prebuild" guard exists for, one job too late.
        const text = readFileSync(workflow, 'utf8');
        const collectSteps = stepBodies(text).filter((s) => s.name.startsWith('Collect @gjsify/'));
        assert.ok(collectSteps.length >= 18, `expected the per-package collect steps, saw ${collectSteps.length}`);
        for (const step of collectSteps) {
            assert.match(
                step.body,
                /scripts\/stage-prebuild\.mjs/,
                `step "${step.name}" collects a prebuild without the shared stager`,
            );
        }
        // And the emulated leg, whose single `build_pkg` helper is its collect step.
        assert.match(readFileSync(emulated, 'utf8'), /scripts\/stage-prebuild\.mjs/);
    });

    // The release path's own version of both directions, plus the property `prebuilds.yml`
    // gets for free and `release.yml` does not: a prebuild never LOADED in CI is a prebuild
    // nobody tested. These two legs ended at `cp` + `upload-artifact`, and their consumer
    // `publish-napi` checks four files with `test -f` — which proves the bytes EXIST and
    // nothing about whether they open. The gap widened when
    // `packages/napi/napi-linux-x64/prebuilds/` stopped being committed:
    // `prebuild-artifacts`' env-free dlopen was the one check that actually executed the
    // artifact, and napi.yml's own gates load out of `build/`, not the staged path.
    //
    // Asserted per JOB rather than per step name, so renaming a step cannot silently drop
    // the gate.
    it('both napi release legs stage through the stager and load-test what they ship', () => {
        const text = readFileSync(releaseWorkflow, 'utf8');
        for (const job of ['napi-prebuild-linux', 'napi-prebuild-darwin-arm64']) {
            const start = text.indexOf(`\n  ${job}:\n`);
            assert.notEqual(start, -1, `release.yml no longer defines the \`${job}\` job`);
            // Up to the next job key at two-space indent, or EOF for the last one.
            const rest = text.slice(start + 1);
            const nextJob = /\n {2}[a-z][\w-]*:\n/.exec(rest.slice(1));
            const body = nextJob ? rest.slice(0, nextJob.index + 1) : rest;

            assert.match(
                body,
                /scripts\/stage-prebuild\.mjs/,
                `release.yml job "${job}" stages its prebuild without the shared stager.\n` +
                    '  Use `node ../../../scripts/stage-prebuild.mjs .` — it derives the target from the\n' +
                    "  package's own `gjsify.platforms`, matches artifacts by EXTENSION and runs\n" +
                    '  checkPrebuildDir() over what it wrote.',
            );
            // `is_available()` and not merely `imports.gi.GjsifyNapi`: the namespace carries
            // no GObject class, so resolving it proves only that the typelib was FOUND.
            // Calling a function is what makes GI dlopen the library the typelib records.
            assert.match(
                body,
                /GjsifyNapi[\s\S]*?is_available\(\)/,
                `release.yml job "${job}" ships a prebuild it never loads.\n` +
                    '  Add a step that runs `gjs -c "imports.gi.GjsifyNapi.is_available()"` against the\n' +
                    '  STAGED directory (GI_TYPELIB_PATH + the platform loader variable), so a release\n' +
                    '  cannot publish bytes nothing has opened. AGENTS.md § Prebuilds: "ANY new prebuild\n' +
                    '  job MUST end in a load test."',
            );
        }
    });
});

// The darwin verify steps read ONE table,
// `.github/prebuild-toolchain/darwin-bridges.mjs`. `build-prebuilds-macos` used to verify
// its output through four steps with four hand-written package lists, and they drifted:
// `packages/infra/rolldown-native` was in two and absent from the other two, so the
// bridge whose #832 incident IS the reason the loader-path check exists was the one
// bridge that check never opened.
describe('prebuild change gate — the darwin verify steps share one table', () => {
    const darwinTable = fileURLToPath(
        new URL('../../../.github/prebuild-toolchain/darwin-bridges.mjs', import.meta.url),
    );

    it('the table covers exactly what the macOS job collects', () => {
        // The script's own `--check`, driven from here so a bridge promoted into
        // `build-prebuilds-macos` without a table row reds a one-second test instead of
        // shipping a prebuild whose typelib leaf, loader path, GI load and env-free dlopen
        // were never checked.
        const r = spawnSync(process.execPath, [darwinTable, '--check'], { encoding: 'utf8' });
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /table matches `build-prebuilds-macos`/);
    });

    it('no step in the macOS job carries its own list of bridges', () => {
        // Stated as a PROPERTY, not a list of step names — a list of step names is the same
        // drift one level up. A step that iterates over the bridge set is exactly a step
        // whose body names TWO OR MORE package directories; a per-package step names one
        // (its `working-directory`), a table-reading step none.
        const text = readFileSync(workflow, 'utf8');
        const jobs = text.slice(text.search(/^jobs:\s*$/m)).split(/^ {2}(?=[a-z0-9-]+:\s*$)/m);
        const job = jobs.find((j) => j.startsWith('build-prebuilds-macos:'));
        assert.ok(job, 'the macOS job must exist');

        let readsTable = 0;
        for (const step of job.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1)) {
            const name = /^name:\s*(.+)$/m.exec(step)?.[1].trim() ?? '(unnamed)';
            if (/darwin-bridges\.mjs/.test(step)) readsTable++;
            // Comment lines may still MENTION packages — they explain the incident. A shell
            // line naming them is the copy.
            const code = step
                .split('\n')
                .filter((l) => !/^\s*#/.test(l))
                .join('\n');
            const named = [
                ...new Set(
                    [...code.matchAll(/\bpackages\/(?:infra|node|web|framework)\/[a-z0-9-]+/g)].map((m) => m[0]),
                ),
            ];
            assert.ok(
                named.length <= 1,
                `step "${name}" hard-codes ${named.length} bridge directories (${named.join(', ')}) — ` +
                    'a step that walks the bridge set must read `.github/prebuild-toolchain/darwin-bridges.mjs`',
            );
        }
        // The table must actually be consumed by all four verify steps, or the ban above is
        // satisfiable by deleting the verification instead.
        assert.equal(readsTable, 4, `expected 4 steps to read the darwin table, saw ${readsTable}`);
    });
});

// A macOS job's shell is bash 3.2, and `bash -n` on any Linux host says otherwise. Apple
// ships no GPLv3 bash, so `/bin/bash` on every macos runner is 3.2.57 — and `shell: bash`
// in Actions is `/bin/bash`, not the Homebrew bash 5 also on the image. A bash-4 builtin
// therefore syntax-checks clean everywhere a developer or a Linux CI leg would test it and
// dies at run time with `command not found`, exit 127: `mapfile -t dirs < <(…)` in
// `build-prebuilds-macos`' loader-path step passed `bash -n` locally on bash 5.3 and failed
// the darwin-arm64 leg at 127, skipping the GI load test, the env-free dlopen and all eight
// uploads.
//
// Scoped to jobs that ACTUALLY run on macOS (derived from a `runs-on:`/`runner:` naming a
// `macos-*` image): on a Linux leg these builtins are fine.
describe('prebuild change gate — macOS steps stay bash-3.2 clean', () => {
    // Each entry: what bash 4+ added, and the 3.2-safe spelling to use instead.
    const BASH4_ONLY = [
        { re: /\bmapfile\b/, what: 'mapfile', instead: 'dirs=(); while IFS= read -r d; do dirs+=("$d"); done < <(…)' },
        { re: /\breadarray\b/, what: 'readarray', instead: 'the same `while read` + `+=` loop' },
        {
            re: /\bdeclare\s+-A\b/,
            what: 'declare -A (associative arrays)',
            instead: 'two parallel arrays, or a `case`',
        },
        { re: /\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)\}/, what: '${var^^} / ${var,,}', instead: 'tr' },
        { re: /&>>/, what: '&>> (append both streams)', instead: '>>file 2>&1' },
        { re: /\bcoproc\b/, what: 'coproc', instead: 'a plain pipeline or process substitution' },
    ];

    it('no macOS job uses a bash-4-only builtin', () => {
        const text = readFileSync(workflow, 'utf8');
        const jobs = text
            .slice(text.search(/^jobs:\s*$/m))
            .split(/^ {2}(?=[a-z0-9-]+:\s*$)/m)
            .slice(1);
        let macosJobs = 0;
        for (const job of jobs) {
            const name = /^([a-z0-9-]+):/.exec(job)?.[1] ?? '(unnamed)';
            // Directly or through a matrix `runner:` entry.
            if (!/^\s*(runs-on|-?\s*runner):\s*\S*macos/m.test(job)) continue;
            macosJobs++;
            for (const step of job.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1)) {
                const stepName = /^name:\s*(.+)$/m.exec(step)?.[1].trim() ?? '(unnamed)';
                const code = step
                    .split('\n')
                    .filter((l) => !/^\s*#/.test(l))
                    .join('\n');
                for (const { re, what, instead } of BASH4_ONLY) {
                    assert.ok(
                        !re.test(code),
                        `job "${name}" step "${stepName}" uses ${what}, which does not exist in bash 3.2 — ` +
                            `the version /bin/bash IS on every macos runner (Apple ships no GPLv3 bash). ` +
                            `\`bash -n\` on a Linux host cannot catch this. Use ${instead}.`,
                    );
                }
            }
        }
        // A shape change that made the runner unrecognisable would turn this into a silent pass.
        assert.ok(macosJobs >= 2, `expected the macOS jobs to be recognised, saw ${macosJobs}`);
    });
});

// `commit-prebuilds` never merges a binary, and never pushes an ungated tree.
//
// Its `git pull --rebase origin main` used to fail with `Cannot merge binary files:
// …/darwin-x64/libgjsifytls.dylib` and push nothing. DETERMINISTIC, not a race between
// runs: Mach-O output is not byte-reproducible, so every run rewrites all 16 committed
// darwin dylibs, and git has no merge driver for a binary. Measured across two consecutive
// bot commits: all 16 changed at identical size, and every differing byte on darwin-x64 is
// the `LC_UUID` payload or an `N_OSO` debug-map stab's object-file mtime — zero bytes of
// code.
//
// The repair is ordering: sync onto `origin/main` BEFORE staging, so no rebase exists to
// conflict. These assertions hold that shape, because "the steps are in the right order" is
// otherwise a property of a file nothing reads back.
describe('prebuild change gate — commit-prebuilds never rebases, never pushes an ungated tree', () => {
    /** The `commit-prebuilds` job text, and the ordered names of its steps. */
    function commitJob() {
        const text = readFileSync(workflow, 'utf8');
        const jobs = text
            .slice(text.search(/^jobs:\s*$/m))
            .split(/^ {2}(?=[a-z0-9-]+:\s*$)/m)
            .slice(1);
        const job = jobs.find((j) => j.startsWith('commit-prebuilds:'));
        assert.ok(job, 'commit-prebuilds job not found — this suite no longer understands the workflow');
        const steps = job
            .split(/^ {6}- (?=name:|uses:|run:)/m)
            .slice(1)
            .map((raw) => ({
                name: (/^name:\s*(.+)$/m.exec(raw)?.[1] ?? '(unnamed)').trim(),
                body: raw
                    .split('\n')
                    .filter((l) => !/^\s*#/.test(l))
                    .join('\n'),
            }));
        assert.ok(steps.length > 20, `expected the download steps plus the commit path, saw ${steps.length}`);
        return { job, steps };
    }

    it('no step in the job rebases or pulls', () => {
        // A `git pull`/`git rebase` anywhere in this job asks git to merge whatever the run
        // downloaded, and 16 of those files are unmergeable by construction on every run.
        const { steps } = commitJob();
        for (const step of steps) {
            assert.ok(
                !/\bgit\s+(pull|rebase)\b/.test(step.body),
                `step "${step.name}" runs git pull/rebase. This job commits BINARIES: git has no merge driver for ` +
                    'them, Mach-O output is not byte-reproducible, so a replay onto a moved `main` conflicts on the ' +
                    'first dylib on every run (run 30864276535). Sync with fetch + `reset --hard` BEFORE staging ' +
                    'instead — see .github/prebuild-toolchain/sync-and-stage.sh.',
            );
        }
    });

    it('the sync script fetches and resets BEFORE it stages anything', () => {
        // Asserted on POSITION rather than presence: both halves being in the file is
        // exactly the state the old job was in, and it was the ORDER that was wrong.
        const src = readFileSync(syncAndStage, 'utf8').replace(/^\s*#.*$/gm, '');
        const reset = src.search(/git reset .*--hard/);
        const firstAdd = src.search(/git add\b/);
        assert.ok(reset > 0, 'sync-and-stage.sh must reset the worktree onto origin/main');
        assert.ok(firstAdd > 0, 'sync-and-stage.sh must stage the artifacts');
        assert.ok(
            reset < firstAdd,
            'sync-and-stage.sh stages before it syncs. The artifacts must be re-applied over a tree that is ' +
                'ALREADY origin/main; staging first is what forced the rebase this job used to fail on.',
        );
        // The snapshot must be re-applied after the reset, or the reset discards the
        // downloads and the job commits main's own bytes.
        const restore = src.search(/tar -xf/);
        assert.ok(
            restore > reset && restore < firstAdd,
            'the snapshot must be restored between the reset and the staging',
        );
    });

    it('the gate step sits between the commit and the push, and the push checks its stamp', () => {
        const { steps } = commitJob();
        const names = steps.map((s) => s.name);
        const commit = names.indexOf('Commit prebuilds');
        const gate = names.indexOf('Gate the tree being pushed');
        const push = names.indexOf('Push');
        assert.ok(commit >= 0 && gate >= 0 && push >= 0, `missing one of the commit-path steps: ${names.slice(-6)}`);
        assert.ok(commit < gate && gate < push, `step order is ${names.slice(commit, push + 1).join(' -> ')}`);
        // Position is the readable form; the STAMP is the enforced one. The gate writes the
        // tree hash it audited and the push refuses anything else, so a future step that
        // mutates the tree between them — what the old `git pull --rebase` did — cannot go
        // unnoticed.
        const gateBody = steps[gate].body;
        assert.match(gateBody, /gate-pushed-tree\.sh/, 'the gate step must run the gate script');
        assert.match(
            readFileSync(gatePushedTree, 'utf8'),
            /git rev-parse 'HEAD\^\{tree\}' > "\$PREBUILD_GATED_TREE"/,
            'the gate script must stamp the tree it audited',
        );
        const pushBody = steps[push].body;
        assert.match(pushBody, /\$PREBUILD_GATED_TREE/, 'the push step must read the gated-tree stamp');
        assert.match(
            pushBody,
            /HEAD\^\{tree\}/,
            'the push step must compare HEAD’s tree against the stamp, or the stamp certifies nothing',
        );
    });

    it('the push RE-STAGES on retry and re-gates before every further push', () => {
        // A retry of the push ALONE pushes a tree built on a stale base — the old rebase
        // defect one layer out. And a re-staged tree the gate never read reopens the
        // `[skip ci]` hole, since nothing else runs on this commit.
        const { steps } = commitJob();
        const push = steps.find((s) => s.name === 'Push');
        assert.ok(push, 'no Push step');
        assert.match(push.body, /sync-and-stage\.sh/, 'the retry must re-sync and re-stage, not just re-push');
        assert.match(push.body, /gate-pushed-tree\.sh/, 'the retry must re-gate the tree it re-staged');
        assert.match(push.body, /while \[ "\$attempt" -le "\$attempts" \]/, 'the retry must be BOUNDED');
    });

    it('no job-level `env:` reads a context that only exists inside steps', () => {
        // MEASURED: `PREBUILD_SNAPSHOT: ${{ runner.temp }}/…` in `jobs.commit-prebuilds.env`
        // made GitHub refuse to load the whole file — the `runner` context exists only in
        // steps. The cost is the interesting part: an unloadable workflow surfaces as a run
        // titled "This run likely failed because of a workflow file issue", attached to
        // whatever event it could not filter, and it is NOT a PR check — `gh pr checks`
        // showed green. The standing hazard `status/open-todos.md` records; a file that
        // cannot be parsed cannot check itself, so the check lives here.
        //
        // Scoped to job-level `env:`, the only place the mistake is available: step-level
        // `env:` and `run:` may read `runner` freely.
        const text = readFileSync(workflow, 'utf8');
        const jobs = text
            .slice(text.search(/^jobs:\s*$/m))
            .split(/^ {2}(?=[a-z0-9-]+:\s*$)/m)
            .slice(1);
        let scanned = 0;
        for (const job of jobs) {
            const name = /^([a-z0-9-]+):/.exec(job)?.[1] ?? '(unnamed)';
            // A four-space `env:` is the job's own; a step's is indented deeper.
            const block = /^ {4}env:\n((?: {6}\S[^\n]*\n)+)/m.exec(job);
            if (!block) continue;
            scanned++;
            const bad = /\$\{\{\s*(runner|steps)\./.exec(block[1]);
            assert.ok(
                !bad,
                `job "${name}" reads \`${bad?.[1]}\` in its job-level \`env:\`. That context does not exist ` +
                    'there, and GitHub then refuses to load the ENTIRE workflow — surfaced as a bare "workflow ' +
                    'file issue" run that is not a PR check, so the PR reads green. Publish the value from a ' +
                    'step instead (`echo "K=$RUNNER_TEMP/…" >> "$GITHUB_ENV"`).',
            );
        }
        // A shape change that found nothing would turn this into a pass.
        assert.ok(scanned >= 1, 'no job-level `env:` block was recognised — the parser no longer understands the file');
    });

    it('both commit-path scripts parse and are the files the job names', () => {
        for (const script of [syncAndStage, gatePushedTree]) {
            assert.ok(existsSync(script), `${script} is missing`);
            assert.equal(spawnSync('bash', ['-n', script]).status, 0, `${script} must parse under bash`);
        }
        // `runs-on: ubuntu-latest`, so bash 5 builtins are fine here and the 3.2 ban above
        // does not apply — asserted so nobody "fixes" the process substitution these use.
        const { job } = commitJob();
        assert.match(job, /runs-on: ubuntu-latest/);
    });
});

describe('prebuild change gate — the emulated leg obeys the same decision', () => {
    it('skips a package in PREBUILD_SKIP and builds everything when it is unset', () => {
        // The emulated build is a single `docker run`, so the decision travels into the
        // container as an env var and the script filters on it.
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
        // The near-miss the quoting exists for: neither key contains the other's quoted form.
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

    // DERIVED, not listed. This assertion used to name `musl-build.sh` alone, and a
    // hand-maintained list of scripts is the same shape as a hand-maintained list of
    // packages in a workflow: the entry that is missing is invisible, and the one added
    // later is the one nobody remembers. Splitting the committed-artifact check out of
    // `musl-build.sh` produced exactly that miss — a second Alpine script, covered by
    // nothing. Reading the directory means the next one is covered on arrival.
    it('every prebuild-toolchain shell script parses and is executable', () => {
        const dir = fileURLToPath(new URL('../../../.github/prebuild-toolchain/', import.meta.url));
        const scripts = readdirSync(dir)
            .filter((f) => f.endsWith('.sh'))
            .sort();
        // A directory read that finds nothing would make this a silent no-op — the failure
        // mode this repository keeps paying for.
        assert.ok(scripts.length >= 4, `expected several .sh scripts in ${dir}, found ${scripts.length}`);
        for (const name of scripts) {
            const path = join(dir, name);
            // `sh -n`, not `bash -n`, for anything that runs in `alpine:3.24`, whose only
            // shell is busybox ash: a bashism passes a bash check and then fails inside the
            // container, the one place these legs cannot be debugged cheaply. The shebang
            // decides which parser is the honest one.
            const shell = readFileSync(path, 'utf8').startsWith('#!/bin/bash') ? 'bash' : 'sh';
            assert.equal(spawnSync(shell, ['-n', path]).status, 0, `${name} must parse under ${shell}`);
            // Invoked as `sh <script>`, so the bit is not strictly required — but every one
            // of these headers tells a human to run it by hand, and that should work.
            assert.ok(statSync(path).mode & 0o111, `${name} must be executable`);
        }
    });
});
