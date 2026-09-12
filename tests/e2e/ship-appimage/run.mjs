// E2E test for `gjsify ship --target appimage` — ADR 0024 § A24, JumpLink/Learn6502#93.
//
// ADR 0024 § Consequences wrote the rule this suite obeys: "the e2e suites to
// prove an artifact INSTALLS … is not optional. The reference tests only that its
// manifests render, and no CI job of theirs ever builds a package. A `ship` that
// asserted on rendered YAML would be this repo's green-CI-that-checked-nothing
// class on a new surface." An AppImage makes that harder than a `.deb` did,
// because the artifact is written by `appimagetool` — which no distribution
// packages and which is on no CI image here. So the assertions are TIERED, and
// the two cheap tiers are not decoration; each one can fail on a real defect:
//
//   1. STRUCTURAL (always). The format is out of the default target set, the host
//      gate fires with the tool hidden and names it, and the payload a `--stage`
//      run produces is the SAME one the `.deb` is built from — which is the claim
//      "a row plus a packer, no new staging" reduces to.
//
//   2. SEMANTIC (always). The AppDir this packer would lay down is assembled from
//      the staged payload, written to a temp directory, and its `AppRun` is RUN by
//      the real `/bin/sh` against a stub interpreter on PATH. What that proves is
//      the one thing no listing can: the prefix a mounted AppImage computes.
//      `AppRun` execs `usr/bin/<name>`, the staged launcher resolves its own
//      prefix two `dirname`s up, and the stub records the argv it was handed. Two
//      NEGATIVE CONTROLS run beside it, because a check that cannot fail proves
//      nothing: with the interpreter absent `AppRun` must exit 127 and NAME what
//      the file does not carry, and an AppDir whose payload was written at the
//      root instead of under `usr/` must fail to launch at all.
//
//   3. REAL (only where `appimagetool` is installed — a workstation, not this
//      project's Fedora CI image, and the skip is PRINTED). Build the image, read
//      it back with `.github/ship-oracle/verify-appimage.py` — an ELF
//      section-header parse plus `unsquashfs`, neither of them appimagetool — RUN
//      it, and pack it twice to prove the two artifacts are byte-identical.
//
// THE DETERMINISM ASSERTION IN TIER 3 IS NOT A FORMALITY: it is the check that
// found a real defect while this format was being built. appimagetool creates
// `.DirIcon` itself when the AppDir has none, as a symlink, with the wall clock,
// AFTER the packer has stamped every path — so two packs of one build differed in
// sha256 with every listing, mode, size and content byte identical. `appDirPayload`
// writes `.DirIcon` for that reason, and this is the assertion that would notice
// if it stopped.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hasCommand } from '../helpers.mjs';
import { runCliSync } from '../mock-registry.mjs';
// The same fixture `tests/e2e/ship`, `ship-from-stage` and `ship-flatpak` build.
// A second scaffold would be a second definition of "a shippable project", and
// the drifted copy is the one that keeps passing while proving something else.
import { APP_ID, CLI_ENTRY, MONOREPO_ROOT, listPayload, scaffold, STAGE_MANIFEST_FILE } from '../ship/fixture.mjs';

/**
 * The packer's own vocabulary, IMPORTED rather than restated.
 *
 * `appDirPayload` is what tier 2 assembles and what `packOne` writes, so the
 * AppDir this suite runs is the AppDir `gjsify ship` produces — not a second
 * implementation of one that would keep agreeing with itself after the first
 * moved. Same reason `fixture.mjs` imports `STAGE_MANIFEST_FILE` from the CLI.
 */
const { appDirPayload, appImageHostRequirements, DIR_ICON_NAME, EXTRACT_AND_RUN } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'appimage.js')).href
);

const BINARY = 'ship-demo';
// DERIVED, the way `ship-flatpak` derives its ref: the label is `APPIMAGE_ARCH`'s
// and `packOne` takes it from the host unless `--arch` says otherwise. Hardcoding
// `x86_64` made tier 3 fail on an aarch64 workstation with "was not produced" —
// a message about a filename, for a reason that has nothing to do with the format.
const ARCH_LABEL = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const ARTIFACT = `${BINARY}-1.2.3-1.${ARCH_LABEL}.AppImage`;
const ORACLE = join(MONOREPO_ROOT, '.github', 'ship-oracle', 'verify-appimage.py');

/** Write an AppDir from the packer's own list, the way `packOne` does. */
function writeAppDir(root, entries) {
    rmSync(root, { recursive: true, force: true });
    for (const entry of entries) {
        const target = join(root, entry.path.split('/').join(sep));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.data);
        chmodSync(target, entry.mode);
    }
    return root;
}

/**
 * A `gjs` that records its argv instead of running anything.
 *
 * The interpreter is what `AppRun` probes for and what the staged launcher execs,
 * so a stub is what lets tier 2 assert the whole chain on a host with no GTK — and
 * it records `$0`, which is the mounted prefix this tier exists to check.
 */
function stubInterpreter(dir, log, version = '') {
    mkdirSync(dir, { recursive: true });
    const stub = join(dir, 'gjs');
    // TWO BEHAVIOURS, because `AppRun` asks two questions: `--version` decides
    // whether the floor is met, and everything else is the real exec. `version`
    // defaults to answering NOTHING, which is the fail-open path — the stub that
    // predates the floor check keeps meaning what it meant.
    writeFileSync(
        stub,
        `#!/bin/sh\n` +
            `if [ "$1" = "--version" ]; then\n` +
            (version === '' ? '    exit 1\n' : `    echo ${JSON.stringify(version)}\n    exit 0\n`) +
            `fi\n` +
            `printf '%s\\n' "$@" >> ${JSON.stringify(log)}\n`,
    );
    chmodSync(stub, 0o755);
    // The launcher itself needs coreutils, so PATH cannot be the stub alone —
    // `readlink` and `dirname` are how it finds its prefix. `/usr/bin` carries a
    // real `gjs` on a GNOME workstation, so the stub directory goes FIRST and the
    // absent-interpreter control below uses this directory without the stub.
    return stub;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('CLI ship AppImage E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let stageDir;
    let staged;
    let defaultStage;
    let defaultPayload;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-appimage-'));
        projectDir = scaffold(join(tmpDir, 'app'));
        mkdirSync(projectDir, { recursive: true });
        stageDir = join(projectDir, 'ship', 'stage');
        // TWICE, and the pair IS a measurement rather than setup: a BARE stage,
        // whose format list is what a project gets when it asks for nothing, and
        // one that names this format. Their payloads are compared below. `--stage`
        // alone either way, which is the point of the first two tiers — assembly
        // needs no `appimagetool`, so everything up to the container is checkable
        // on a host that has none.
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--stage'], { cwd: projectDir });
        defaultStage = JSON.parse(readFileSync(join(stageDir, STAGE_MANIFEST_FILE), 'utf-8'));
        defaultPayload = listPayload(stageDir);
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--stage', '--target', 'deb,rpm,appimage'], {
            cwd: projectDir,
        });
        staged = listPayload(stageDir);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── tier 1: structural ────────────────────────────────────────────────────

    it('stays out of a bare `gjsify ship linux`, so no project grows a new tool requirement', () => {
        // The rule Flatpak established and this row inherits: a bare `gjsify ship`
        // must keep working for every project that only ever packaged a `.deb` —
        // including `release-cut.yml`, which packs `@gjsify/cli` on a bare runner.
        assert.deepEqual([...defaultStage.formats].sort(), ['deb', 'rpm']);
    });

    it('needs NOTHING staged of its own — the AppImage wraps the payload the .deb wraps', () => {
        // ADR 0024 § 2's claim, on the fourth linux format: "a target that needs an
        // extra file gets an overlay, never a branch in the staging code". Here
        // there is not even an overlay beyond the licence every format gets, so the
        // stage a `--target appimage` run packs is byte-for-byte the one a
        // `--target deb` run packs. If that stopped being true, a new file would
        // appear here and this assertion is where.
        assert.deepEqual(staged, defaultPayload);
        assert.ok(staged.includes('bin/ship-demo'));
        assert.ok(staged.includes(`share/applications/${APP_ID}.desktop`));
        assert.ok(staged.some((path) => path.startsWith('share/icons/hicolor/')));
        assert.equal(
            staged.some((path) => path === 'AppRun' || path === DIR_ICON_NAME),
            false,
            'the AppDir root files are the PACKER’s, never the stage’s',
        );
    });

    it('refuses to pack when appimagetool is absent, and names the tool and the way across', () => {
        // The gate fires BEFORE the project's build script, so an absent
        // `appimagetool` does not cost a full build to discover. And the hint has
        // to be honest: no distribution packages this one, so a refusal saying
        // `dnf install appimagetool` would send the reader to "no match".
        const emptyPath = join(tmpDir, 'no-tools');
        mkdirSync(emptyPath, { recursive: true });
        let stderr = '';
        let status = 0;
        try {
            // `runCliSync` execs `process.execPath` by absolute path, so an empty
            // PATH still starts node — it only starves the CLI's probe.
            runCliSync(CLI_ENTRY, ['ship', '--from-stage', 'ship/stage', '--target', 'appimage'], {
                cwd: projectDir,
                env: { ...process.env, PATH: emptyPath },
            });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        }
        assert.notEqual(status, 0, 'packing an AppImage with no appimagetool must fail');
        assert.match(stderr, /appimagetool/);
        assert.match(stderr, /--stage/);
        assert.equal(existsSync(join(projectDir, 'ship', 'out')), false, 'a refused pack writes no artifact');
    });

    it('refuses a `kind: "cli"` project BEFORE running its build script', () => {
        // THE CLAIM IS THE ORDER, so the assertion has to be able to see it: the
        // fixture's build script writes a marker, and the marker's ABSENCE is what
        // separates "refused up front" from "refused after building everything".
        // This refusal used to live in the packer, past `runProjectBuild`, which
        // made a CLI project pay a full build to be told its payload could never
        // have become an AppImage — while the tool gate two lines up had been
        // firing early since Flatpak, on exactly this argument.
        const cliDir = scaffold(join(tmpDir, 'cli-app'), (pkg, dir) => {
            pkg.gjsify.ship.kind = 'cli';
            pkg.scripts.build = 'node build.mjs && node marker.mjs';
            writeFileSync(
                join(dir, 'marker.mjs'),
                "import { writeFileSync } from 'node:fs';\nwriteFileSync('built.marker', 'x');\n",
            );
        });
        let stderr = '';
        let status = 0;
        try {
            runCliSync(CLI_ENTRY, ['ship', 'linux', '--target', 'appimage'], { cwd: cliDir });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        }
        assert.notEqual(status, 0, 'a CLI project must not be packaged as an AppImage');
        assert.match(stderr, /gjsify\.ship\.kind/);
        assert.equal(
            existsSync(join(cliDir, 'built.marker')),
            false,
            'the refusal must fire BEFORE the project build script runs',
        );
    });

    // ── tier 2: the AppDir, executed ──────────────────────────────────────────

    it('mounts as a prefix the staged launcher can resolve — AppRun, run for real', () => {
        // WHAT NO LISTING CAN SEE. Every other assertion in this file is about
        // names and modes; this one is about the one number that decides whether
        // the application starts: how far up `readlink -f "$0"` plus two
        // `dirname`s lands. The staged launcher expects `<prefix>/bin/<name>`, and
        // the AppDir puts the prefix at `usr/` — get that wrong and the app looks
        // for its schemas one directory too high, at exit 0, until the first
        // `Gio.Settings.new()`.
        const payload = staged.map((path) => ({
            path,
            mode: statSync(join(stageDir, path.split('/').join(sep))).mode & 0o777,
            data: readFileSync(join(stageDir, path.split('/').join(sep))),
        }));
        const settings = JSON.parse(readFileSync(join(stageDir, STAGE_MANIFEST_FILE), 'utf-8')).settings;
        const needs = appImageHostRequirements({ ...settings, namespaces: ['Gtk-4.0'] });
        const appDir = writeAppDir(join(tmpDir, 'AppDir'), appDirPayload(settings, payload, needs));

        const binDir = join(tmpDir, 'stub-bin');
        const log = join(tmpDir, 'gjs-argv.txt');
        stubInterpreter(binDir, log);
        execFileSync(join(appDir, 'AppRun'), ['--flag'], {
            env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
            stdio: 'pipe',
        });

        const argv = readFileSync(log, 'utf-8').trim().split('\n');
        // The launcher execs `gjs -m <prefix>/<bundle>` and forwards `"$@"`. The
        // assertion is THIS AppDir's `usr/` and not "a path containing /usr/",
        // which `/usr/bin/gjs` would satisfy on any host.
        assert.ok(
            argv.some((arg) => arg.startsWith(`${join(appDir, 'usr')}${sep}`)),
            `the bundle path must sit under the AppDir’s usr/, got ${JSON.stringify(argv)}`,
        );
        assert.ok(argv.includes('--flag'), 'AppRun must forward its arguments');
    });

    it('NEGATIVE CONTROL: refuses with a sentence, not a loader error, when the interpreter is missing', () => {
        // Without this the assertion above passes over an `AppRun` that has no
        // check at all. ADR 0024 § 9's objection to this format is that "runs
        // anywhere" is a claim the file cannot keep — so the file says what it
        // does not carry, at launch, to the person who downloaded it.
        const appDir = join(tmpDir, 'AppDir');
        const bare = join(tmpDir, 'bare-bin');
        mkdirSync(bare, { recursive: true });
        // coreutils but NO interpreter: `AppRun` needs `readlink` and `dirname` to
        // find itself, and a PATH with neither would fail one line earlier and for
        // a reason this test is not about.
        for (const tool of ['readlink', 'dirname']) {
            // A forwarding stub rather than a symlink, and resolved with `sh -c`
            // rather than `execFileSync(tool, {shell: true})` — the latter
            // concatenates argv into a shell line (DEP0190) and this suite must
            // not model the anti-pattern the repo's own spawn rules forbid.
            const resolved = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).trim();
            writeFileSync(join(bare, tool), `#!/bin/sh\nexec ${resolved} "$@"\n`);
            chmodSync(join(bare, tool), 0o755);
        }
        let status = 0;
        let stderr = '';
        try {
            execFileSync(join(appDir, 'AppRun'), [], { env: { ...process.env, PATH: bare }, stdio: 'pipe' });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}`;
        }
        assert.equal(status, 127, 'a missing interpreter must exit 127, the shell’s own "not found"');
        assert.match(stderr, /carries the application, not its runtime/);
        assert.match(stderr, /gjs/);
    });

    it('REFUSES a too-old interpreter, and RUNS on every answer it cannot parse', () => {
        // THE FLOOR, EXECUTED. `command -v gjs` alone accepted 1.70 while the
        // message beside it said `gjs (>= 1.86)` — a requirement the `.deb`
        // enforces through `Depends:` and this artifact only printed. Four real
        // `/bin/sh` runs, because the risk here is not "does it refuse" but "does
        // it refuse something that works": a version comparison in shell that gets
        // it wrong bricks a good machine, and the user cannot argue with a file.
        const appDir = join(tmpDir, 'AppDir');
        // `spawnSync` AND NOT `execFileSync`, because half of what this test asks
        // is only visible on the SUCCESS path: `execFileSync` returns stdout and
        // drops stderr unless it throws, so a `stderr === ''` assertion written
        // around it is vacuous exactly where it matters — measured, it passed with
        // the fail-open gate deleted.
        const attempt = (version) => {
            const dir = mkdtempSync(join(tmpDir, 'floor-'));
            stubInterpreter(dir, join(dir, 'argv.txt'), version);
            const run = spawnSync(join(appDir, 'AppRun'), [], {
                env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
                encoding: 'utf-8',
            });
            assert.equal(run.error, undefined, `AppRun could not be started: ${run.error?.message ?? ''}`);
            return { status: run.status, stderr: run.stderr ?? '' };
        };

        // BELOW the floor: refused, and NOT with 127 — that is "not found", and
        // this runtime was found. 126 is the shell's own "found and cannot run".
        const old = attempt('gjs 1.70.0');
        assert.equal(old.status, 126, 'an interpreter below the floor must exit 126, not 127');
        assert.match(old.stderr, /1\.86 or newer, and this system has 1\.70/);
        assert.match(old.stderr, /carries the application, not its runtime/);

        // AND A MAJOR THAT DECIDES ON ITS OWN, both ways. Without these two the
        // comparison is only ever exercised on its MINOR arm: measured, inverting
        // `-lt` to `-gt` on the major left every other case in this test green,
        // because `1.70` against a `1.86` floor is settled by `-eq` plus the minor
        // either way.
        assert.equal(attempt('gjs 0.99.0').status, 126, 'a lower MAJOR must be refused');
        assert.equal(attempt('gjs 2.0.0').status, 0, 'a higher MAJOR must be accepted');

        // AT the floor and above it: runs. `1.86` itself is the boundary the
        // comparison is most likely to get wrong, so it is asserted rather than
        // assumed from `1.88`.
        assert.equal(attempt('gjs 1.86.0').status, 0, 'the floor itself must be accepted');
        assert.equal(attempt('gjs 1.88.1').status, 0, 'a newer interpreter must be accepted');

        // FAIL-OPEN, the two ways. An interpreter whose `--version` this `sed`
        // cannot read, and one that fails `--version` outright, both RUN the
        // application: a distro build with an unexpected banner is not a reason to
        // refuse a machine that can run the app perfectly well.
        // SILENTLY, which is the half a status code cannot see. Measured: with the
        // `[ -n "$major" ]` gate removed the launcher still runs the application —
        // `[ "" -lt 1 ]` errors and the condition comes out false — so the exit
        // code alone cannot tell the gate from its absence. What it leaves behind
        // is `/bin/sh: integer expression expected` on stderr at EVERY launch, in
        // the one file nobody reads until something has already gone wrong.
        for (const answer of ['some unversioned build', '']) {
            const open = attempt(answer);
            assert.equal(open.status, 0, `an unreadable version (${answer || 'no output'}) must not refuse`);
            assert.equal(open.stderr, '', 'the fail-open path must be silent, not merely non-fatal');
        }
    });

    it('NEGATIVE CONTROL: an AppDir without the `usr/` prefix does not launch', () => {
        // The discriminator for the prefix assertion two tests up. Written flat,
        // the launcher is at `<AppDir>/bin/<name>` and resolves the MOUNTPOINT as
        // its prefix — so `AppRun`'s `usr/bin/<name>` is simply not there, and the
        // failure is loud. A layout check that cannot produce this failure is not
        // checking the layout.
        const payload = staged.map((path) => ({
            path,
            mode: statSync(join(stageDir, path.split('/').join(sep))).mode & 0o777,
            data: readFileSync(join(stageDir, path.split('/').join(sep))),
        }));
        const settings = JSON.parse(readFileSync(join(stageDir, STAGE_MANIFEST_FILE), 'utf-8')).settings;
        const flat = appDirPayload(settings, payload, []).map((entry) => ({
            ...entry,
            path: entry.path.startsWith('usr/') ? entry.path.slice('usr/'.length) : entry.path,
        }));
        const appDir = writeAppDir(join(tmpDir, 'AppDir-flat'), flat);
        // ITS OWN STUB, not the one the prefix test left behind. Two reasons, and
        // both are ways this control goes green while blind: borrowing a directory
        // another `it()` created makes it depend on the order `node:test` happens
        // to run them in, and on a host with no `gjs` at all `AppRun` would refuse
        // at its FIRST line — exit 127 with the requirement list, the layout never
        // reached, and the assertion below satisfied by the wrong failure.
        const binDir = join(tmpDir, 'flat-bin');
        stubInterpreter(binDir, join(tmpDir, 'flat-argv.txt'));
        let status = 0;
        let stderr = '';
        try {
            execFileSync(join(appDir, 'AppRun'), [], {
                env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
                stdio: 'pipe',
            });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}`;
        }
        assert.notEqual(status, 0, 'an AppDir with no usr/ prefix must fail to launch');
        assert.doesNotMatch(
            stderr,
            /carries the application, not its runtime/,
            'this control must fail on the missing `usr/bin/<name>`, not on the interpreter probe above it',
        );
    });

    // ── tier 3: the real artifact ─────────────────────────────────────────────

    it('builds, reads back and RUNS a real AppImage', function () {
        if (!hasCommand('appimagetool')) {
            // PRINTED, never silent: a skipped tier that says nothing is
            // indistinguishable from a tier that passed.
            console.log('  ↳ SKIPPED: appimagetool is not on PATH (no distribution packages it).');
            return;
        }
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--target', 'appimage'], { cwd: projectDir });
        const artifact = join(projectDir, 'ship', 'out', ARTIFACT);
        assert.ok(existsSync(artifact), `${ARTIFACT} was not produced`);
        assert.equal(statSync(artifact).mode & 0o111 ? true : false, true, 'an AppImage must be executable');

        // THE INDEPENDENT READER (ADR 0024 § A3): an ELF section-header parse for
        // the offset and `unsquashfs` for the tree — neither of them appimagetool,
        // and neither of them the runtime the artifact carries.
        const read = execFileSync('python3', [ORACLE, artifact, join(stageDir, STAGE_MANIFEST_FILE), APP_ID], {
            encoding: 'utf-8',
        });
        assert.match(read, /superblock found at \d+, derived from the ELF section-header table/);
        assert.match(read, /at exactly the planned mode, plus AppRun, entry, icon and a regular-file \.DirIcon/);

        // AND IT STARTS. An AppImage that was built and does not run is not a
        // result — the whole promise of the format is that a stranger downloads
        // one file and it works.
        //
        // `--appimage-extract-and-run` IS THE ASSERTED PATH, and that is a
        // measurement rather than caution: an AppImage mounts itself through FUSE,
        // and a container without `/dev/fuse` cannot — measured on `fedora:44`,
        // where the mount exits non-zero and the extract path prints the app's
        // output. So the path that works on every host is the one every run
        // checks, and the MOUNT is checked only where the kernel device exists.
        const extracted = execFileSync(artifact, ['--appimage-extract-and-run'], {
            encoding: 'utf-8',
            stdio: 'pipe',
            cwd: tmpDir,
        });
        assert.match(extracted, /GIRepositoryNamespace/);
        if (existsSync('/dev/fuse')) {
            // WITHOUT THE PACKER'S OWN VARIABLE IN THE ENVIRONMENT. `appImageToolEnv`
            // sets `APPIMAGE_EXTRACT_AND_RUN` for appimagetool and the ARTIFACT reads
            // the same name — so inherited from a shell or a CI step that exported it,
            // this "mount" leg extracts instead and passes with FUSE never touched.
            // The one assertion in this file that is about the kernel device has to
            // be the one that cannot be answered by a variable.
            const mountEnv = { ...process.env };
            delete mountEnv[EXTRACT_AND_RUN];
            assert.match(
                execFileSync(artifact, [], { encoding: 'utf-8', stdio: 'pipe', env: mountEnv, cwd: tmpDir }),
                /GIRepositoryNamespace/,
            );
        } else {
            console.log('  ↳ the MOUNT path was not exercised: this host has no /dev/fuse.');
        }

        // THE PINNED RUNTIME, which is the other half of "two packs agree".
        //
        // `.DirIcon` was the tree the tool edits; this is the ~940 KB the tool
        // FETCHES — from `type2-runtime`'s rolling `continuous` tag, with no
        // digest anywhere in this repository, on every pack (ADR 0024 § A26.1).
        // Pinned, the pack embeds bytes this tree named and needs no network.
        //
        // DERIVED FROM THE ARTIFACT JUST BUILT rather than downloaded, so this
        // assertion runs wherever `appimagetool` does instead of only inside the
        // CI image that bakes one. The first `e_shoff + e_shentsize * e_shnum`
        // bytes ARE the runtime — the same read the oracle makes — and measured,
        // appimagetool rewrites the embedded digest either way, so a pack from the
        // derived file and one from the pristine release asset are byte-identical.
        const runtimeDir = mkdtempSync(join(tmpDir, 'runtime-'));
        const built = readFileSync(artifact);
        const runtimeEnd = Number(built.readBigUInt64LE(0x28)) + built.readUInt16LE(0x3a) * built.readUInt16LE(0x3c);
        writeFileSync(join(runtimeDir, `runtime-${ARCH_LABEL}`), built.subarray(0, runtimeEnd));

        // WITH THE NETWORK CUT, which is what turns this from a string assertion
        // into an effect one. Asserting only the printed "pinned" line passed a
        // packer whose `--runtime-file` never reached appimagetool — measured, by
        // deleting that flag from the arg vector: the log still said pinned and
        // the tool still downloaded. A dead proxy makes any fetch fail (measured:
        // `Failed to download runtime: server returned status code 0`, exit 1, no
        // artifact), so this pack can only succeed if the flag arrived.
        const pinnedEnv = {
            ...process.env,
            GJSIFY_APPIMAGE_RUNTIME_DIR: runtimeDir,
            https_proxy: 'http://127.0.0.1:1',
            http_proxy: 'http://127.0.0.1:1',
            all_proxy: 'http://127.0.0.1:1',
        };
        const pinnedLog = runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--target', 'appimage'], {
            cwd: projectDir,
            env: pinnedEnv,
        });
        // SAID, on every pack and never behind --verbose: the person who can pin a
        // runtime is the one reading a pack log.
        assert.match(pinnedLog, /the AppImage runtime is pinned/);
        assert.match(pinnedLog, new RegExp(`runtime-${ARCH_LABEL}`));
        const pinnedFirst = sha256(artifact);

        // AND IT STILL RUNS. An embedded runtime is the ELF the file STARTS with,
        // so getting it wrong produces something that cannot execute at all.
        assert.match(
            execFileSync(artifact, ['--appimage-extract-and-run'], { encoding: 'utf-8', stdio: 'pipe', cwd: tmpDir }),
            /GIRepositoryNamespace/,
        );

        // TWO PINNED PACKS, byte-identical — which is the claim that was NOT
        // checkable while the runtime came from a rolling tag: the old assertion
        // could only ever compare two packs close enough together that the tag had
        // not moved.
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--target', 'appimage'], {
            cwd: projectDir,
            env: pinnedEnv,
        });
        assert.equal(sha256(artifact), pinnedFirst, 'two packs with a pinned runtime must be byte-identical');

        // DETERMINISM, which is where `.DirIcon` was caught — see the header.
        const first = sha256(artifact);
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--target', 'appimage'], { cwd: projectDir });
        assert.equal(sha256(artifact), first, 'two packs of one build must be byte-identical');
        // AND THE FILE THAT MAKES IT SO IS OURS, IN THE IMAGE — which the sha256
        // above cannot say. Two packs a second apart agree whenever the tool edits
        // the tree the SAME way both times, so identical bytes are consistent with
        // the repair having been removed. The oracle is what distinguishes the two:
        // `.DirIcon` reaches its listing only as a regular file, and appimagetool's
        // own is a symlink. The line this replaced compared `DIR_ICON_NAME` to its
        // own literal and looked in no image at all.
        assert.match(
            execFileSync('python3', [ORACLE, artifact, join(stageDir, STAGE_MANIFEST_FILE), APP_ID], {
                encoding: 'utf-8',
            }),
            new RegExp(`regular-file \\${DIR_ICON_NAME}`),
        );
    });

    it('NEGATIVE CONTROL: the oracle refuses an AppImage with nothing behind the runtime', () => {
        // The failure this format's reader exists for, produced on purpose: an
        // executable ELF of plausible size whose filesystem is not there. It
        // mounts an empty directory, `file` calls it an ELF, and every check that
        // stops at "the artifact exists and is non-empty" passes it.
        if (!hasCommand('appimagetool')) {
            console.log('  ↳ SKIPPED: appimagetool is not on PATH.');
            return;
        }
        const artifact = join(projectDir, 'ship', 'out', ARTIFACT);
        const hollow = join(tmpDir, 'hollow.AppImage');
        const bytes = readFileSync(artifact);
        const offset = Number(bytes.readBigUInt64LE(0x28)) + bytes.readUInt16LE(0x3a) * bytes.readUInt16LE(0x3c);
        writeFileSync(hollow, bytes.subarray(0, offset));
        let status = 0;
        let output = '';
        try {
            execFileSync('python3', [ORACLE, hollow, join(stageDir, STAGE_MANIFEST_FILE), APP_ID], {
                encoding: 'utf-8',
                stdio: 'pipe',
            });
        } catch (error) {
            status = error.status ?? 1;
            output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        assert.equal(status, 1, 'the oracle must refuse a hollow AppImage');
        assert.match(output, /no squashfs superblock/);
    });
});
