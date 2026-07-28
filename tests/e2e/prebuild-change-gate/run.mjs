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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('../../../.github/prebuild-toolchain/changed-packages.mjs', import.meta.url));
const workflow = fileURLToPath(new URL('../../../.github/workflows/prebuilds.yml', import.meta.url));
const emulated = fileURLToPath(new URL('../../../.github/prebuild-toolchain/emulated-build.sh', import.meta.url));

/** Run the classifier over an explicit file list; returns its JSON report. */
function classify(files) {
    const out = execFileSync(process.execPath, [script, '--changed-from-stdin', '--format=json'], {
        cwd: repoRoot,
        input: `${files.join('\n')}\n`,
        encoding: 'utf8',
    });
    return JSON.parse(out);
}

describe('prebuild change gate — package discovery', () => {
    it('derives its package set from the workflow, not a hand-written list', () => {
        const text = readFileSync(workflow, 'utf8');
        const fromWorkflow = new Set(
            [...text.matchAll(/^\s*path:\s*packages\/[^\s/]+\/([^\s/]+)\/prebuilds\//gm)].map((m) => m[1]),
        );
        const { build } = classify([]);
        // An empty change set with no base is "nothing affected", so ask the
        // forced path for the full key set instead.
        const all = JSON.parse(
            execFileSync(process.execPath, [script, '--all', '--format=json'], { cwd: repoRoot, encoding: 'utf8' }),
        );
        assert.deepEqual(new Set(all.build), fromWorkflow);
        assert.ok(all.build.length >= 10, 'the workflow owns ten native packages today');
        assert.deepEqual(build, [], 'an empty change set builds nothing');
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

        const r = spawnSync(
            process.execPath,
            [join(tmp, '.github', 'prebuild-toolchain', 'changed-packages.mjs'), '--all', '--format=json'],
            { cwd: tmp, encoding: 'utf8' },
        );
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
        for (const key of JSON.parse(
            execFileSync(process.execPath, [script, '--all', '--format=json'], { cwd: repoRoot, encoding: 'utf8' }),
        ).build) {
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
});

describe('prebuild change gate — fail open', () => {
    it('builds everything when the diff base cannot be resolved', () => {
        const out = execFileSync(
            process.execPath,
            [script, '--base', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--format=json'],
            { cwd: repoRoot, encoding: 'utf8' },
        );
        const { build, skip, reason } = JSON.parse(out);
        assert.deepEqual(skip, []);
        assert.equal(build.length, 10);
        assert.match(reason, /not a commit/);
    });

    it('emits a skip list the workflow gates can match without parsing', () => {
        // The gates are `!contains(needs.changes.outputs.skip, '"<key>"')` on
        // the RAW string: an unset output is '', contains is false, and the
        // package builds. That only holds if the keys are quoted in the output
        // — and the quoting is also what stops `"http2-native"` matching
        // `"http2-native-x"`.
        const out = execFileSync(process.execPath, [script, '--changed-from-stdin', '--format=github-actions'], {
            cwd: repoRoot,
            input: 'packages/node/terminal-native/src/vala/terminal.vala\n',
            encoding: 'utf8',
        });
        const line = out.split('\n').find((l) => l.startsWith('skip='));
        assert.ok(line, 'a skip= line must be emitted');
        const json = line.slice('skip='.length);
        assert.ok(json.includes('"lightningcss-native"'));
        assert.ok(!json.includes('"terminal-native"'));
        assert.deepEqual(JSON.parse(json).length, 9);
    });

    it('every workflow gate names a key the classifier actually emits', () => {
        // A gate whose key the classifier never emits can never skip — safe —
        // but it is dead, and a TYPO would read exactly like a deliberate
        // always-build. Both are worth catching.
        const text = readFileSync(workflow, 'utf8');
        const keys = new Set(
            JSON.parse(
                execFileSync(process.execPath, [script, '--all', '--format=json'], {
                    cwd: repoRoot,
                    encoding: 'utf8',
                }),
            ).build,
        );
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
        const text = readFileSync(workflow, 'utf8');
        const steps = text.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1);
        let checked = 0;
        for (const step of steps) {
            if (!/actions\/(up|down)load-artifact/.test(step)) continue;
            const artifact = /\n\s*name:\s*([\w-]+)-prebuilds-/.exec(step);
            if (!artifact) continue;
            const key = artifact[1];
            checked++;
            assert.ok(
                step.includes(`'"${key}"'`),
                `an artifact step for "${key}" is not gated on its own package:\n${step.slice(0, 200)}`,
            );
        }
        assert.ok(checked >= 60, `expected every artifact step to be checked, saw ${checked}`);
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
});
