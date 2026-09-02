// E2E test for the Windows program directory and its zip — ADR 0024 stage 5, issue #1354 M3.
//
// WHAT M1 LEFT AND THIS CLOSES. `gjsify ship windows --stage` already wrote the
// program directory's shape — `app\`, `lib\`, `share\`, a CRLF `.cmd` at the root
// — and that `.cmd` exec'd the bare name `node`. Windows ships no Node and no GJS
// at all (ADR 0024 § 4), so the tree was an application in shape and in no other
// sense: its first act on a stranger's machine is `'node' is not recognized as an
// internal or external command`. M3 gives it two format rows and a runtime it
// carries.
//
// THE ORACLES ARE NOT OURS, and the pair is different from the macOS one because
// the artifact is:
//
//   * the program directory → CPython, via `.github/ship-oracle/verify-program-dir.py`.
//     There is no `Info.plist` here to parse — a Windows installer's metadata
//     lives in the `.msi`'s own tables (#1354 M5) — so what that script reads is
//     the launcher's BYTES (CRLF, ASCII, and the interpreter it names being a
//     file the directory carries) and the PE headers of everything staged.
//   * the zip → `zipinfo -l`, via `.github/ship-oracle/verify-app-zip.sh`, the
//     SAME script the `.app` zip uses with a third argument naming the kind. One
//     writer, one reader; a second copy would be a second set of assertions that
//     drift.
//
// AND EVERY ORACLE IS WATCHED RED HERE. Each `verify-*` run below has a sibling
// that mutates a COPY of the artifact and asserts the script exits 1 — a launcher
// rewritten with LF endings, a launcher whose interpreter was deleted, an arm64
// image in an x64 tree, and an archive whose entries were written at the root
// instead of under the program directory. Without those, a `verify-*` that
// returned 0 unconditionally would leave this whole file green.
//
// WHAT THIS SUITE STRUCTURALLY CANNOT CLAIM, and the macOS sibling can. A Mach-O
// records its dependencies as `LC_LOAD_DYLIB` strings, so `tests/e2e/ship-macos`
// asserts from Linux that every non-system dependency of a staged image resolves
// INSIDE the bundle — and watches that go red by flattening the tree. A PE records
// its imports in a data directory reached through the section table, and
// `manifest-conformance/lib/binary.mjs` deliberately does not parse one
// (`inspectable: false`, with its reason written down there). So "every DLL this
// directory needs is inside it" has exactly one reader, `LoadLibrary`, and it
// lives in `.github/workflows/node-gi.yml`'s `windows-dir-selfcontained` leg. What
// IS checkable from here is the machine of every image and the SHAPE of the
// closure — `<gtk>/bin` + `<gtk>/girepository-1.0`, which is the probe
// `resolveGtkRuntimeBundle()` runs before it will use a directory at all, and the
// depth of the pixbuf loaders, which is what `loaders.cache` addresses.
//
// A LINUX-GREEN RUN IS NOT EVIDENCE ABOUT WINDOWS. Everything below assembles on
// Linux and reads bytes back. Whether the artifact opens a window is the same
// assertion on another OS, and it is a leg, not a test.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { pe, SUBSYSTEM } from '../pe.mjs';
import { runCli, runCliSync } from '../mock-registry.mjs';
import {
    CLI_ENTRY,
    listFiles,
    listPayload,
    MONOREPO_ROOT,
    oracle,
    oracleExpectingFailure,
    probe,
    scaffold,
    sha256,
    shipExpectingFailure,
    STAGE_MANIFEST_FILE,
} from '../ship/fixture.mjs';
// The SUBJECT, shared with `tests/e2e/ship-msi`: one definition of the Windows
// project both suites pack and of the runtime packages it resolves through.
import {
    APP_NAME,
    ARCH,
    BINARY,
    closureFiles,
    installRuntimePackages,
    scaffoldNodeApp,
    TARGET,
} from '../ship/windows-fixture.mjs';

const ZIP_NAME = `${BINARY}-1.2.3-1.${ARCH}.zip`;

/** The ZIP writer itself, for the red run no CLI invocation can produce. */
const { buildZip } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'zip.js')).href
);

const BINARY_READER = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs');
const { readLibrary } = await import(pathToFileURL(BINARY_READER).href);

describe('CLI ship Windows program directory E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    /** The program directory as `gjsify ship` wrote it, and the zip beside it. */
    let programDir;
    let zip;
    let stageDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        // A REQUIRED reader on Linux, and the reason is `fixture.mjs`'s `probe()`:
        // every assertion below sits behind one of these, so a silent skip would
        // leave this suite green having read nothing. Both are baked into
        // `.docker/ci-fedora.Dockerfile`.
        for (const tool of ['python3', 'zipinfo']) {
            if (!probe(tool) && process.platform === 'linux') {
                throw new Error(`${tool} is not on PATH, and it is how this suite reads the artifact back`);
            }
        }
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-windows-'));
        projectDir = installRuntimePackages(scaffoldNodeApp(join(tmpDir, 'app')));
        runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--arch', ARCH], { cwd: projectDir });
        stageDir = join(projectDir, 'ship', 'stage');
        programDir = join(projectDir, 'ship', 'out', APP_NAME);
        zip = join(projectDir, 'ship', 'out', ZIP_NAME);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── the artifact's shape ──────────────────────────────────────────────

    it('packs the program directory as the stage CONTENTS, with no wrapper level', () => {
        // The asymmetry `Layout.root` records, and the one place it is visible as
        // an artifact. A `<App>.app` carries its own directory in the stage,
        // because it is dragged to `/Applications` as one object; a Windows
        // program directory does not, because an installer chooses
        // `C:\Program Files\<Publisher>\<App>` and lays the contents into it. So
        // the staged paths start at `app/` and `share/`, and the artifact
        // directory's NAME comes from the format row.
        assert.ok(existsSync(join(programDir, `${BINARY}.cmd`)));
        assert.ok(existsSync(join(programDir, 'app', 'app.node.mjs')));
        assert.ok(!existsSync(join(programDir, APP_NAME)), 'the program directory is nested inside itself');
        const staged = listPayload(stageDir);
        assert.ok(staged.includes(`${BINARY}.cmd`), 'the launcher is not at the stage root');
        assert.ok(!staged.some((rel) => rel.startsWith(`${APP_NAME}/`)), 'the stage carries a wrapper directory');
    });

    it('compiles gschemas.compiled into the stage, because there is no install step', () => {
        // The same defect the `.app` closes, and `payload.ts` classifies it as
        // `aborts` rather than `inert`: every launcher exports `XDG_DATA_DIRS` at
        // the staged `share/`, and `g_settings_new()` ABORTS on a schema directory
        // holding a `.gschema.xml` with no compiled cache. Windows has no postinst
        // and nothing else was going to run `glib-compile-schemas`.
        const cache = join(programDir, 'share', 'glib-2.0', 'schemas', 'gschemas.compiled');
        assert.ok(existsSync(cache), 'the program directory would abort at its first Gio.Settings.new()');
        assert.equal(readFileSync(cache).subarray(0, 8).toString('latin1'), 'GVariant');
    });

    // ── the program directory, read back by CPython ───────────────────────

    it('reads the launcher and every staged image back with CPython', () => {
        const out = oracle('verify-program-dir.py', [programDir, join(stageDir, STAGE_MANIFEST_FILE)]);
        // Printed by the oracle from what it parsed, not restated here.
        assert.match(out, new RegExp(`${BINARY}\\.cmd runs %HERE%node\\.exe \\(CRLF, ASCII\\)`));
        assert.match(out, new RegExp(`\\d+ PE image\\(s\\) all ${ARCH}`));
    });

    it('reports the interpreter subsystem it READ, not a constant', () => {
        // THE MEASUREMENT NO CI LEG CAN MAKE, and the discriminator that keeps the
        // oracle honest about it. `node.exe` is a CONSOLE-subsystem image
        // (Subsystem=3) and `nodew.exe` does not exist in the Node release, so a
        // GUI launch of this artifact pops a console window — and every Windows CI
        // leg starts the app from a shell and therefore inherits one, so no leg can
        // observe the defect (#1354 M3, status/open-todos.md).
        //
        // What this suite CAN do is prove the oracle reads the field rather than
        // printing a constant: the same tree with a GUI-subsystem interpreter must
        // report 2. The real number for the real binary is measured where the real
        // binary is, on the assemble leg.
        assert.match(
            oracle('verify-program-dir.py', [programDir, join(stageDir, STAGE_MANIFEST_FILE)]),
            /interpreter subsystem 3 \(CONSOLE\)/,
        );
        const copy = join(tmpDir, 'gui-subsystem');
        cpSync(programDir, copy, { recursive: true });
        writeFileSync(join(copy, 'node.exe'), pe({ arch: ARCH, subsystem: SUBSYSTEM.gui }));
        assert.match(
            oracle('verify-program-dir.py', [copy, join(stageDir, STAGE_MANIFEST_FILE)]),
            /interpreter subsystem 2 \(GUI\)/,
        );
    });

    for (const [what, mutate, expected] of [
        [
            'a launcher rewritten with LF endings',
            (at) => {
                const file = join(at, `${BINARY}.cmd`);
                writeFileSync(file, readFileSync(file, 'utf-8').replace(/\r\n/g, '\n'));
            },
            /carries a bare LF/,
        ],
        [
            'a launcher whose interpreter is not in the directory',
            (at) => rmSync(join(at, 'node.exe')),
            /is not in the artifact/,
        ],
        [
            'a launcher that runs a bare name off PATH, which is what M1 wrote',
            (at) => {
                const file = join(at, `${BINARY}.cmd`);
                writeFileSync(file, readFileSync(file, 'utf-8').replace('"%HERE%node.exe" ', 'node '));
            },
            /is not a path inside the program directory/,
        ],
        [
            'an arm64 image in an x64 tree',
            (at) => writeFileSync(join(at, 'node.exe'), pe({ arch: 'arm64' })),
            /node\.exe is arm64, and the stage is labelled x64/,
        ],
        ['no launcher at all', (at) => rmSync(join(at, `${BINARY}.cmd`)), /nothing in it tells Windows what to start/],
        [
            // The console-window fix IS this one field, and it is a claim about a
            // file this repository writes — so the oracle judges it rather than
            // printing it, and this is the mutation that makes the judgement real.
            'a GUI launcher rewritten back to the console subsystem',
            (at) => {
                const file = join(at, `${BINARY}.exe`);
                const image = readFileSync(file);
                image.writeUInt16LE(3, image.readUInt32LE(0x3c) + 24 + 68);
                writeFileSync(file, image);
            },
            /has Subsystem 3 \(CONSOLE\), and the whole point of the file is that it is 2/,
        ],
        [
            'no GUI launcher at all, which is the artifact before ADR 0040',
            (at) => rmSync(join(at, `${BINARY}.exe`)),
            /gives every double-click and every installer shortcut a console window/,
        ],
    ]) {
        it(`RED: the program-directory oracle refuses ${what}`, () => {
            // A COPY, so the green runs keep their subject.
            const copy = join(tmpDir, `red-dir-${createHash('sha256').update(what).digest('hex').slice(0, 8)}`);
            cpSync(programDir, copy, { recursive: true });
            mutate(copy);
            const output = oracleExpectingFailure('verify-program-dir.py', [copy, join(stageDir, STAGE_MANIFEST_FILE)]);
            assert.match(output, /::error title=Ship program directory::/);
            assert.match(output, expected);
        });
    }

    // ── the zip, read back by zipinfo ─────────────────────────────────────

    it('reads the archive back with zipinfo, modes included', () => {
        const out = oracle('verify-app-zip.sh', [zip, programDir, 'program directory']);
        assert.match(out, /round-tripped byte for byte, \d+ executable, modes read as POSIX/);
        // The interpreter's `x` bit survived the writer. Windows decides
        // executability from the extension, so this matters to whoever unzips the
        // artifact on Linux or macOS to look at it — and it is the end of the chain
        // that begins with the mode PLAN in the sidecar.
        assert.match(out, new RegExp(`^-rwxr-xr-x .*${APP_NAME}/node\\.exe$`, 'm'));
    });

    it('the archive expands to one top level, which the STAGE does not carry', () => {
        // THE FAILURE THIS FORMAT HAS, and the one the `.app` zip cannot have. The
        // staged paths begin at `app/` and `share/` — there is no `Layout.root` to
        // inherit — so an archive written from them verbatim unpacks into whatever
        // directory the user happened to be in, scattering `app\`, `share\` and a
        // loose `.cmd` across it. Every entry would be individually correct and no
        // listing of NAMES would read as wrong.
        const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf-8' }).trim().split('\n');
        assert.ok(names.length > 0);
        assert.deepEqual([...new Set(names.map((name) => name.split('/')[0]))], [APP_NAME]);
    });

    it('RED: the zip oracle refuses an archive written at the root', () => {
        // The mistake produced deliberately, through the writer itself: the same
        // payload with no top level. This is what `zipEntriesFromPayload(payload)`
        // does without its second argument, which is the correct call for darwin
        // and the silent defect for windows.
        const bad = join(tmpDir, 'red-no-top-level.zip');
        writeFileSync(
            bad,
            buildZip(
                programEntries().map((entry) => ({ ...entry, path: entry.path.split('/').slice(1).join('/') })),
                1_700_000_000,
            ),
        );
        const output = oracleExpectingFailure('verify-app-zip.sh', [bad, programDir, 'program directory']);
        assert.match(output, /is outside Ship Demo\/, so unzipping this archive would drop a file beside/);
    });

    it('RED: the zip oracle refuses an archive whose modes were flattened', () => {
        // `actions/upload-artifact` stores no POSIX mode, so an archive built from
        // a stage that crossed one is not hypothetical — and this reader is where
        // that is caught for both formats.
        const bad = join(tmpDir, 'red-mode.zip');
        writeFileSync(
            bad,
            buildZip(
                programEntries().map((entry) => (entry.path.endsWith('.exe') ? { ...entry, mode: 0o644 } : entry)),
                1_700_000_000,
            ),
        );
        const output = oracleExpectingFailure('verify-app-zip.sh', [bad, programDir, 'program directory']);
        assert.match(output, /is 644 in the archive and 755 in the program directory artifact/);
    });

    // ── determinism and the two-phase split ───────────────────────────────

    it('packs the same stage to the same bytes twice', () => {
        // `mtime` comes from the stage manifest and never from `Date.now()`. Two
        // packs of one stage disagreeing is how a "reproducible" claim dies quietly.
        const first = sha256(zip);
        runCliSync(CLI_ENTRY, ['ship', '--from-stage', stageDir, '--out', 'again'], { cwd: projectDir });
        assert.equal(sha256(join(projectDir, 'again', 'out', ZIP_NAME)), first);
    });

    it('packs from a stage with no project in reach, and the directory still reads', () => {
        // ADR 0024 § A2's two-phase split applied to the new rows: the stage plus
        // its sidecar is the whole closure. `--expect-target` is passed because a
        // win32 stage packed on a Linux host is the supported path and the flag is
        // what makes a leg say which one it is.
        const away = join(tmpDir, 'elsewhere');
        cpSync(stageDir, join(away, 'stage'), { recursive: true });
        runCliSync(CLI_ENTRY, ['ship', '--from-stage', join(away, 'stage'), '--expect-target', TARGET], { cwd: away });
        const packed = join(away, 'out', APP_NAME);
        oracle('verify-program-dir.py', [packed, join(away, 'stage', STAGE_MANIFEST_FILE)]);
        oracle('verify-app-zip.sh', [join(away, 'out', ZIP_NAME), packed, 'program directory']);
    });

    // ── what the two rows must NOT have changed ───────────────────────────

    it('a bare `gjsify ship` on Linux still defaults to exactly deb and rpm', () => {
        // The regression these rows are most able to cause. Both are
        // `finishOn: 'any'`, so on that criterion alone a bare `gjsify ship` on
        // Linux would now emit SIX artifacts; `defaultFormatIds` filters on
        // `layoutOs` as a second criterion, which is what keeps this list at two.
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--out', 'ship-default'], { cwd: projectDir });
        const manifest = JSON.parse(
            readFileSync(join(projectDir, 'ship-default', 'stage', STAGE_MANIFEST_FILE), 'utf-8'),
        );
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
    });

    it('refuses a `--app gjs` project by name, and still stages its layout', () => {
        // BOTH HALVES. A typed `--target` is a claim about this run and is refused;
        // a derived default is not, and is filtered with the reason printed — so
        // the whole audience of M1 keeps being able to assemble the layout M1
        // added. The refusal's body is the ROW's own sentence, which for windows is
        // the stronger of the two: macOS has a GJS (Homebrew's) and no relocatable
        // one, Windows has none at all.
        const gjsProject = scaffold(join(tmpDir, 'app-gjs'));
        const refusal = shipExpectingFailure(
            ['ship', 'windows', '--skip-build', '--stage', '--target', 'windows-dir'],
            gjsProject,
        );
        assert.match(refusal, /the windows-dir runtime cannot run it — it provides node/);
        assert.match(refusal, /no GJS host on Windows at all/);
        assert.doesNotMatch(refusal, /org\.gnome\.Platform/);

        runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--stage', '--out', 'staged'], { cwd: gjsProject });
        const staged = listFiles(join(gjsProject, 'staged', 'stage'));
        assert.ok(staged.includes(`${BINARY}.cmd`));
        const manifest = JSON.parse(readFileSync(join(gjsProject, 'staged', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));
        assert.deepEqual(manifest.formats, [], 'a stage nothing can pack must record that, not a format it cannot use');
    });

    it('refuses to PACK an architecture no Windows GTK exists for, naming the blocker', () => {
        // #1117, and it is upstream: `wingtk/gvsbuild` hardcodes
        // `self.platform = "x64"` and its releases publish two assets each, both
        // x64. So there is nothing to build `@gjsify/gtk-runtime-win32-arm64` out
        // of, and on Windows that bundle is the only GTK there is.
        const bare = scaffoldNodeApp(join(tmpDir, 'arm64'));
        const refusal = shipExpectingFailure(['ship', 'windows', '--skip-build', '--arch', 'arm64'], bare);
        assert.match(refusal, /the windows layout is not assemblable for `--arch arm64`/);
        assert.match(refusal, /gjsify\/gjsify#1117/);
    });

    it('WARNS at --stage for that architecture rather than refusing, and says nothing can pack it', async () => {
        // The other half, and the reason the refusal is not at stage time: a stage
        // is a build intermediate, and `tests/e2e/ship-layout` assembles all three
        // layouts from ONE payload on purpose — that payload's native file has an
        // architecture, so a stage-time refusal would ban the suite that proves the
        // layout map. What must not leave is an ARTIFACT.
        const bare = scaffoldNodeApp(join(tmpDir, 'arm64-stage'));
        const { status, stdout, stderr } = await runCli(
            CLI_ENTRY,
            ['ship', 'windows', '--skip-build', '--stage', '--arch', 'arm64'],
            { cwd: bare },
        );
        assert.equal(status, 0);
        assert.match(`${stdout}${stderr}`, /this stage is labelled arm64 and the windows layout has no runtime/);
        assert.match(`${stdout}${stderr}`, /gjsify\/gjsify#1117/);
    });

    /** The packed directory as `ZipEntry[]`, so a red run differs from the green one in ONE field. */
    function programEntries() {
        return listFiles(programDir).map((rel) => ({
            path: `${APP_NAME}/${rel}`,
            mode: statSync(join(programDir, rel)).mode & 0o7777,
            data: readFileSync(join(programDir, rel)),
        }));
    }
});

// ── the runtime the program directory CARRIES ─────────────────────────────────
//
// THE LINUX HALF, AND IT IS NOT A CLAIM ABOUT WINDOWS. Everything below reads the
// staged tree with `manifest-conformance/lib/binary.mjs`'s `readLibrary()`, which
// parses a PE from any host. A green run here says the wiring is right — the
// layout, the modes, the launcher, the arch label. It does NOT say `LoadLibrary`
// resolves any of it: that is the same assertion on a different OS, and it lives
// in `.github/workflows/node-gi.yml`'s `windows-dir-selfcontained` leg, which
// unzips this artifact on a runner with no gvsbuild GTK and no Node on `PATH`.

describe('CLI ship Windows self-contained runtime E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let stageDir;
    let shipOutput;

    /** Where the staged runtime lives inside the program directory — node-gi's own sibling layout. */
    const PREBUILDS = `lib/node-gi/prebuilds/${TARGET}`;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-win-runtime-'));
        projectDir = installRuntimePackages(scaffoldNodeApp(join(tmpDir, 'app')));
        shipOutput = runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--stage', '--arch', ARCH], {
            cwd: projectDir,
        });
        stageDir = join(projectDir, 'ship', 'stage');
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("stages the closure in node-gi's sibling layout, at every original depth", () => {
        const staged = listPayload(stageDir);
        for (const rel of Object.keys(closureFiles())) {
            assert.ok(staged.includes(`${PREBUILDS}/${rel}`), `${rel} is not staged where node-gi looks for it`);
        }
        // The probe `resolveGtkRuntimeBundle()` runs before it will use a directory
        // at all — and on win32 the loadable-code directory is `bin`, not `lib`.
        // A staging that produced neither would pass every other assertion here.
        assert.ok(staged.some((rel) => rel.startsWith(`${PREBUILDS}/gtk/bin/`)));
        assert.ok(staged.some((rel) => rel.startsWith(`${PREBUILDS}/gtk/girepository-1.0/`)));
        // SIBLINGS: the addon sits beside `gtk/`, which is the relation
        // `GJSIFY_GTK_RUNTIME` and `NODE_GI_NATIVE` are both derived from.
        assert.ok(staged.includes(`${PREBUILDS}/node_gi.node`));
        // The depth that carries a reference: four levels, not a basename.
        // `loaders.cache` addresses each loader relative to the bundle TOPLEVEL
        // (#996), so flattening this leaves the cache pointing three levels above
        // the file it names.
        assert.ok(
            staged.includes(`${PREBUILDS}/gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.dll`),
            'the loader was flattened, and `loaders.cache` now points three levels above it',
        );
    });

    it('stages the JavaScript the bundle `require`s, where Node looks for it', () => {
        // `@gjsify/node-gi/*` is EXTERNAL in every `--app node` bundle by design
        // (`rolldown-plugin-gjsify`'s `app/node.ts`: the reverse-bridge modules
        // "must resolve at runtime against the consumer's node_modules"), so a
        // `gi://Gtk` import compiles to `require('@gjsify/node-gi/gi')` in the
        // shipped file. A program directory has no consumer node_modules.
        const staged = listPayload(stageDir);
        assert.ok(staged.includes('app/node_modules/@gjsify/node-gi/package.json'));
        assert.ok(staged.includes('app/node_modules/@gjsify/node-gi/gi.js'));
        // Resolved for real, by Node's own resolver, from the staged bundle's own
        // directory. `startsWith(<the stage>)` rather than "it resolved" is the
        // whole assertion: `require` walks `node_modules` UPWARD, so a bare "it
        // resolved" would be a statement about every directory above the stage.
        const bundleFile = join(stageDir, 'app', 'app.node.mjs');
        const resolved = createRequire(bundleFile).resolve('@gjsify/node-gi/gi');
        assert.ok(resolved.startsWith(join(stageDir, 'app')), `resolved outside the program directory: ${resolved}`);
    });

    it('stages node.exe beside the launcher, under the name the release uses', () => {
        const staged = listPayload(stageDir);
        // `node.exe`, from `nodeRuntimeBinaryName(target)` — the same function that
        // decided the SOURCE file's name, so the two cannot drift into a copy that
        // renames the interpreter out from under the launcher.
        assert.ok(staged.includes('node.exe'));
        assert.ok(!staged.includes('node'), 'the interpreter was staged under the POSIX name');
        // Redistribution with no terms attached is what `ResolvedNodeRuntime` makes
        // structurally hard by carrying the licence in the same result.
        assert.ok(staged.includes('share/licenses/node/LICENSE'));
        assert.equal(statSync(join(stageDir, 'node.exe')).mode & 0o777, 0o755);
    });

    it('reads every staged PE back with binary.mjs, from Linux', () => {
        // Two numbers, both printed from what was parsed: how many images, and how
        // many disagree with the label.
        const staged = listPayload(stageDir);
        const images = [];
        for (const rel of staged) {
            const info = readLibrary(join(stageDir, rel));
            if (info !== null) images.push({ rel, info });
        }
        // The closure's three DLLs plus the addon plus the interpreter plus the GUI
        // launcher — the one of the six this repository writes itself.
        assert.equal(images.length, 6, `expected 6 PE images in the stage, read ${images.length}`);
        for (const { rel, info } of images) {
            assert.equal(info.format, 'pe', `${rel} is not a PE`);
            assert.equal(info.os, 'win32', `${rel} is not a win32 image`);
            assert.equal(info.arch, ARCH, `${rel} is ${info.arch}, and the stage is labelled ${ARCH}`);
            // STATED BESIDE THE TEST THAT WOULD OTHERWISE IMPLY COVERAGE. The macOS
            // sibling of this case goes on to resolve every recorded dependency
            // inside the staged tree; a PE's imports live in a data directory
            // reached through the section table, and `binary.mjs` does not parse
            // one. `inspectable: false` is that fact as a field — asserting it is
            // what keeps a reader of this suite from taking `needed: []` for "this
            // image depends on nothing".
            assert.equal(info.inspectable, false, `${rel} claims its imports were read, and binary.mjs reads none`);
            assert.deepEqual(info.needed, []);
        }
    });

    it('writes a launcher that names what the directory carries', () => {
        const launcher = readFileSync(join(stageDir, `${BINARY}.cmd`), 'utf-8');
        assert.match(launcher, /^"%HERE%node\.exe" "%HERE%app\\app\.node\.mjs" %\*$/m);
        assert.match(
            launcher,
            new RegExp(`^set "GJSIFY_GTK_RUNTIME=%HERE%lib\\\\node-gi\\\\prebuilds\\\\${TARGET}\\\\gtk"$`, 'm'),
        );
        assert.match(
            launcher,
            new RegExp(`^set "NODE_GI_NATIVE=%HERE%lib\\\\node-gi\\\\prebuilds\\\\${TARGET}\\\\node_gi\\.node"$`, 'm'),
        );
        // NOT on `PATH`, and the omission is deliberate: node-gi's
        // `maybePrependGtkRuntimeDllPath()` runs at its index.js top level, ABOVE
        // `loadNative()`, because Windows re-reads the DLL search path at every
        // `LoadLibrary`. A launcher-set `PATH` would be a second copy of a directory
        // node-gi already derives from `GJSIFY_GTK_RUNTIME` — two truths, and the
        // stale one wins whenever the layout moves.
        assert.doesNotMatch(launcher, /PATH=%HERE%lib\\node-gi/);
    });

    it('says what it carries, and drops the gap it no longer has', async () => {
        assert.match(shipOutput, new RegExp(`carries its own interpreter from @gjsify/node-runtime-${TARGET}`));
        assert.match(shipOutput, new RegExp(`carries its own GTK closure from @gjsify/node-gi/prebuilds/${TARGET}`));
        assert.match(shipOutput, /carries its own node-gi addon from @gjsify\/node-gi/);
        assert.match(shipOutput, /carries its own node-gi runtime \(\d+ file\(s\)\) from @gjsify\/node-gi/);
        // `Layout.runtimeGap` says "the staged launcher execs an interpreter off
        // `PATH`". Printing that over a tree that carries its own interpreter would
        // be the command telling the author something untrue about what it just
        // wrote. Asserted over BOTH channels, because the gap is a `console.warn`
        // and `shipOutput` holds stdout alone — an absence assertion against the
        // wrong stream is the emptiest kind of green.
        const both = await runCli(
            CLI_ENTRY,
            ['ship', 'windows', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-gap'],
            { cwd: projectDir },
        );
        assert.equal(both.status, 0);
        assert.doesNotMatch(`${both.stdout}${both.stderr}`, /execs an interpreter off `PATH`/);
        assert.match(`${both.stdout}${both.stderr}`, /carries its own GTK closure/);
    });

    it('RED: refuses an arm64 closure labelled x64, naming the file', () => {
        // The check `assertPayloadMatchesArch` has always done, made non-vacuous by
        // this milestone in TWO steps: nothing staged native code into a windows
        // tree before M3, and `readBinaryArch` recognised `MZ` and stopped — so it
        // was blind to PE, which is the one layout whose native format IS PE.
        //
        // Reached through `GJSIFY_GTK_RUNTIME`, the only way an operator CAN produce
        // this: resolution by name derives the target from `--arch`, and `--arch
        // arm64` is refused one phase earlier by `Layout.arches`. The override names
        // a DIRECTORY and nothing in that name says which architecture it holds,
        // which is exactly the mistake this refusal is for.
        const foreign = join(tmpDir, 'arm64-closure');
        for (const [rel, data] of Object.entries(closureFiles('arm64'))) {
            if (!rel.startsWith('gtk/')) continue;
            const target = join(foreign, ...rel.slice('gtk/'.length).split('/'));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, data);
        }
        const refusal = shipExpectingFailure(
            ['ship', 'windows', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-foreign'],
            projectDir,
            { ...process.env, GJSIFY_GTK_RUNTIME: foreign },
        );
        assert.match(refusal, /the payload is arm64, but the package would be labelled x64/);
        assert.match(refusal, /libglib-2\.0-0\.dll is built for arm64|libgtk-4-1\.dll is built for arm64/);
    });

    it('CONTROL: a project without the packages stages no runtime and says which to install', async () => {
        // The other half of every assertion above. Without this, "the directory
        // carries a runtime" could be true of any project the command touches, and
        // an author whose artifact is NOT self-contained would have no way to learn
        // it from the output.
        const bare = scaffoldNodeApp(join(tmpDir, 'bare'));
        const { status, stdout, stderr } = await runCli(
            CLI_ENTRY,
            ['ship', 'windows', '--skip-build', '--stage', '--arch', ARCH],
            { cwd: bare },
        );
        assert.equal(status, 0, 'a directory with no runtime is an intermediate, not an error');
        const output = `${stdout}${stderr}`;
        for (const name of [`@gjsify/node-runtime-${TARGET}`, `@gjsify/gtk-runtime-${TARGET}`, '@gjsify/node-gi']) {
            assert.ok(output.includes(name), `the output never names ${name}`);
        }
        // And the gap is printed again, because this tree really does have it.
        assert.match(output, /execs an interpreter off `PATH`/);
        const staged = listPayload(join(bare, 'ship', 'stage'));
        assert.ok(!staged.some((rel) => rel.startsWith('lib/node-gi/')));
        assert.ok(!staged.includes('node.exe'));
        assert.match(
            readFileSync(join(bare, 'ship', 'stage', `${BINARY}.cmd`), 'utf-8'),
            /^node "%HERE%app\\app\.node\.mjs" %\*$/m,
        );
    });
});
