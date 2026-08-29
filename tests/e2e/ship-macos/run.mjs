// E2E test for the macOS `<App>.app` and its zip — ADR 0024 stage 4, issue #1354 M2a.
//
// WHAT M1 LEFT AND THIS CLOSES. `gjsify ship darwin --stage` already wrote
// `<App>.app/Contents/{MacOS,Resources,Frameworks}` — and no `Contents/Info.plist`,
// so the tree was a directory whose name ends in `.app`. LaunchServices reads that
// file to learn which binary under `Contents/MacOS` to exec; without it the Finder
// shows a folder. Every assertion in this file exists because that hole was
// invisible to M1's suite: `tests/e2e/ship-layout` compares the three layouts
// against each other, and a file that no layout produces is a file no comparison
// between them can miss.
//
// THE ORACLES ARE NOT OURS, and both were chosen against a plausible alternative
// that measures nothing:
//
//   * `Contents/Info.plist` → CPython's `plistlib`, via
//     `.github/ship-oracle/verify-app-plist.py`. NOT `plistutil`, which accepts a
//     `<dict>` whose `<key>` has no value and prints `<dict/>` at exit 0; NOT
//     `xmllint --valid`, which exits 4 on a CORRECT plist because the DTD is a
//     remote URL. `plutil` is macOS-only. Measured on Fedora 44, all four.
//   * the zip → `zipinfo -l`, via `.github/ship-oracle/verify-app-zip.sh`. NOT
//     `unzip -Z1`, which prints names only and is therefore blind to the single
//     failure this format has: a launcher that extracts 0644 and will not run.
//
// AND EVERY ORACLE IS WATCHED RED HERE. Each `verify-*` run below has a sibling
// that mutates a COPY of the artifact and asserts the script exits 1 — a plist
// with one wrong character, a plist truncated mid-`<dict>`, a bundle with no
// plist at all (which is exactly what M1 staged), an archive whose launcher was
// planned 0644, and an archive that carries 0755 under a DOS version-made-by, so
// the mode is in the file and no reader will ever read it AS a mode. Without
// those, a `verify-*` script that returned 0 unconditionally would leave this
// whole file green.
//
// WHY THE FIXTURE IS `--app node`. The two macOS rows are `interpreters: ['node']`
// and that is a measured limit, not caution: there is no relocatable GJS to put
// inside a bundle a stranger downloads (ADR 0024 § 4, stage 7). So
// `assertFormatCanRunInterpreter` refuses the `--app gjs` project every other ship
// suite uses, and this one declares its own interpreter. The scaffold itself is
// shared — a second definition of "a shippable project" is two definitions that
// drift, and the drifted one keeps passing.
//
// WHAT THIS SUITE DOES NOT CLAIM. Nothing here runs the bundle. M2a assembles the
// SHAPE of a macOS application on Linux and stops; staging an interpreter and a
// GTK closure into it — and therefore "unzip it on macos-latest and open a
// window" — is M2b, whose work is the runtime, not the leg.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCli, runCliSync } from '../mock-registry.mjs';
import {
    APP_ID,
    CLI_ENTRY,
    listFiles,
    listPayload,
    MONOREPO_ROOT,
    NODE_BUNDLE,
    probe,
    scaffold,
    STAGE_MANIFEST_FILE,
} from '../ship/fixture.mjs';

/** The display name the shared scaffold declares — and therefore the bundle's own directory. */
const APP_NAME = 'Ship Demo';
const BINARY = 'ship-demo';
/**
 * The arch the two artifacts are labelled for.
 *
 * Passed explicitly rather than defaulted to the host, because the label is in
 * the zip's FILENAME: letting it follow `process.arch` would make every assertion
 * about that name true only on an x64 runner.
 */
const ARCH = 'arm64';
const ZIP_NAME = `${BINARY}-1.2.3-1.${ARCH}.zip`;

const ORACLE = join(MONOREPO_ROOT, '.github', 'ship-oracle');

/** The ZIP writer itself, for the two red runs no CLI invocation can produce. */
const { buildZip } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'zip.js')).href
);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Run one of the `.github/ship-oracle` scripts and return its output.
 *
 * `execFileSync` throws on a non-zero exit, which is what makes the GREEN calls
 * assertions in their own right: a `verify-*` script that starts failing fails
 * this suite without anything here having to inspect its words.
 */
function oracle(script, args) {
    const runner = script.endsWith('.py') ? 'python3' : 'bash';
    return execFileSync(runner, [join(ORACLE, script), ...args], { encoding: 'utf-8' });
}

/**
 * Run an oracle expecting a REFUSAL, and return everything it printed.
 *
 * `assert.fail` inside the `try` is what makes a run that unexpectedly SUCCEEDS
 * fail the test. Without it, a `verify-*` that stopped checking would read here
 * as a passing assertion about an error that never happened — the exact shape
 * these discriminators exist to rule out.
 */
function oracleExpectingFailure(script, args) {
    try {
        oracle(script, args);
    } catch (error) {
        assert.equal(error.status, 1, `${script} must exit 1, not ${error.status}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected ${script} to refuse ${args.join(' ')}`);
}

function shipExpectingFailure(args, cwd) {
    try {
        runCliSync(CLI_ENTRY, args, { cwd });
    } catch (error) {
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected \`gjsify ${args.join(' ')}\` to fail`);
}

/** The `--app node` project both phases of this suite pack. */
function scaffoldNodeApp(dir) {
    return scaffold(dir, (pkg, at) => {
        pkg.gjsify.app = 'node';
        pkg.gjsify.main = 'dist/app.node.mjs';
        pkg.main = 'dist/app.node.mjs';
        writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
    });
}

describe('CLI ship macOS bundle E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    /** `<name>.app` as `gjsify ship` wrote it, and the zip beside it. */
    let bundle;
    let zip;
    let stageDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        // A REQUIRED reader on Linux, and the reason is the one `fixture.mjs`'s
        // `probe()` states: every plist assertion below sits behind `python3`, so
        // a silent skip would leave this suite green having parsed nothing. Both
        // are baked into `.docker/ci-fedora.Dockerfile`.
        for (const tool of ['python3', 'zipinfo']) {
            if (!probe(tool) && process.platform === 'linux') {
                throw new Error(`${tool} is not on PATH, and it is how this suite reads the artifact back`);
            }
        }
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-macos-'));
        projectDir = scaffoldNodeApp(join(tmpDir, 'app'));
        runCliSync(CLI_ENTRY, ['ship', 'darwin', '--skip-build', '--arch', ARCH], { cwd: projectDir });
        stageDir = join(projectDir, 'ship', 'stage');
        bundle = join(projectDir, 'ship', 'out', `${APP_NAME}.app`);
        zip = join(projectDir, 'ship', 'out', ZIP_NAME);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── the staged bundle ─────────────────────────────────────────────────

    it('stages the two files that make the directory a bundle', () => {
        const staged = listPayload(stageDir);
        assert.ok(staged.includes(`${APP_NAME}.app/Contents/Info.plist`), 'no Info.plist — this is what M1 staged');
        assert.ok(staged.includes(`${APP_NAME}.app/Contents/PkgInfo`));
        // At the BUNDLE root's `Contents/`, which is the seam `place()`
        // structurally cannot provide: every prefix-relative plan entry maps into
        // one of the four `LayoutDirs`, and `Contents/` is none of them.
        assert.ok(!staged.some((rel) => rel.endsWith('/Contents/Contents/Info.plist')));
    });

    it('compiles gschemas.compiled into the stage, because there is no install step', () => {
        // The defect this closes is not cosmetic and `payload.ts` classified it as
        // `aborts` before anything fixed it: every launcher exports
        // `XDG_DATA_DIRS` at the staged `share/`, and `g_settings_new()` ABORTS on
        // a schema directory holding a `.gschema.xml` with no compiled cache. On
        // Linux the `.deb`/`.rpm` postinst runs `glib-compile-schemas` at install;
        // a `.app` has no postinst and nothing else was going to run it.
        const cache = join(stageDir, `${APP_NAME}.app`, 'Contents', 'Resources', 'share', 'glib-2.0', 'schemas');
        assert.ok(
            existsSync(join(cache, 'gschemas.compiled')),
            'the staged bundle would abort at its first Gio.Settings.new()',
        );
        // GVDB, read as bytes rather than as a filename: a zero-length or
        // truncated file would satisfy `existsSync` and abort just the same.
        const head = readFileSync(join(cache, 'gschemas.compiled')).subarray(0, 8).toString('latin1');
        assert.equal(head, 'GVariant', 'the compiled cache does not start with the GVDB signature');
    });

    it('the Linux layout still gets NO compiled cache, because its install step writes one', () => {
        // The other half of the same decision, and the one that would rot
        // silently: on Linux the postinst compiles the SYSTEM schema directory,
        // where this app's schemas merge with every other package's. A prebuilt
        // cache shipped there is a file the install step overwrites — and if it
        // were not overwritten it would be WRONG, because it would describe one
        // package's schemas as the whole directory's.
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--stage', '--out', 'ship-linux'], { cwd: projectDir });
        const staged = listPayload(join(projectDir, 'ship-linux', 'stage'));
        assert.ok(staged.includes(`share/glib-2.0/schemas/${APP_ID}.gschema.xml`));
        assert.ok(!staged.some((rel) => rel.endsWith('gschemas.compiled')));
    });

    it('says the schema directory is INERT now, where it used to say ABORTS', async () => {
        // M1's suite asserts the opposite string, and this is the assertion that
        // keeps the warning honest rather than merely quieter: the classifier's
        // `aborts` branch is still REACHABLE (a stage whose cache was deleted
        // classifies as `aborts` again), so what changed is the tree, not the
        // rule.
        const { status, stderr } = await runCli(
            CLI_ENTRY,
            ['ship', 'darwin', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-notice'],
            { cwd: projectDir },
        );
        assert.equal(status, 0);
        assert.match(stderr, /whose Linux correctness comes from a package install step/);
        assert.doesNotMatch(stderr, /ABORTS:/);
        assert.match(stderr, /`gschemas\.compiled` is staged beside it/);
    });

    // ── the `.app` artifact, read back by CPython plistlib ────────────────

    it('packs a bundle and not a directory containing one', () => {
        // MEASURED AS A DEFECT, at exit 0, with the zip beside it correct the
        // whole time. `writePayload` was handed the staged paths verbatim, and
        // every one of them already begins with `<App>.app/` — so the artifact
        // came out as `out/Ship Demo.app/Ship Demo.app/Contents/…`: a plain folder
        // holding a real bundle one level down, which the Finder does not treat as
        // an application and which no tree walk looking for `Contents/` notices.
        assert.ok(existsSync(join(bundle, 'Contents', 'Info.plist')));
        assert.ok(!existsSync(join(bundle, `${APP_NAME}.app`)), 'the .app is nested inside itself');
    });

    it('reads Info.plist and PkgInfo back with CPython plistlib', () => {
        const out = oracle('verify-app-plist.py', [bundle, join(stageDir, STAGE_MANIFEST_FILE)]);
        // The count is the oracle's, printed from what it parsed — not a number
        // this file also knows. Eleven keys, each cited to a file in `refs/node`
        // in `utils/ship/plist.ts`.
        assert.match(out, /plistlib parsed 11 key\(s\), all agreeing with the stage manifest/);
        assert.match(out, /APPL\?\?\?\? \(8 bytes, no terminator\)/);
    });

    for (const [what, mutate] of [
        [
            'one wrong character in CFBundleIdentifier',
            (at) => {
                const info = join(at, 'Contents', 'Info.plist');
                writeFileSync(info, readFileSync(info, 'utf-8').replace(APP_ID, `${APP_ID}X`));
            },
        ],
        [
            'a plist truncated mid-<dict>',
            (at) => writeFileSync(join(at, 'Contents', 'Info.plist'), '<plist version="1.0">\n<dict>\n<key>A</key>\n'),
        ],
        ['no Info.plist at all, which is what M1 staged', (at) => rmSync(join(at, 'Contents', 'Info.plist'))],
    ]) {
        it(`RED: the plist oracle refuses ${what}`, () => {
            // A COPY, so the green run above and the runs below keep their subject.
            const copy = join(tmpDir, `red-plist-${createHash('sha256').update(what).digest('hex').slice(0, 8)}.app`);
            cpSync(bundle, copy, { recursive: true });
            mutate(copy);
            const output = oracleExpectingFailure('verify-app-plist.py', [copy, join(stageDir, STAGE_MANIFEST_FILE)]);
            assert.match(output, /::error title=Ship \.app::/);
        });
    }

    // ── the zip, read back by zipinfo ─────────────────────────────────────

    it('reads the archive back with zipinfo, modes included', () => {
        const out = oracle('verify-app-zip.sh', [zip, bundle]);
        assert.match(out, /round-tripped byte for byte, 1 executable, modes read as POSIX/);
        // The one line `unzip -Z1` cannot produce, quoted here so a reader of this
        // suite can see WHY the oracle is `zipinfo`: the launcher's `x` bits are
        // the whole difference between an app and an archive of one.
        assert.match(out, new RegExp(`^-rwxr-xr-x .*${APP_NAME}\\.app/Contents/MacOS/${BINARY}$`, 'm'));
    });

    it('RED: the zip oracle refuses an archive whose launcher was planned 0644', () => {
        // The failure this format has, produced deliberately. `actions/upload-artifact`
        // has already proven the class inside this repository — it stores no POSIX
        // mode — so an archive built from a stage that lost its modes is not a
        // hypothetical.
        const bad = join(tmpDir, 'red-mode.zip');
        writeFileSync(bad, buildZip(bundleEntries().map(flatten0644), 1_700_000_000));
        const output = oracleExpectingFailure('verify-app-zip.sh', [bad, bundle]);
        assert.match(output, /is 644 in the archive and 755 in the \.app artifact/);
    });

    it('RED: the zip oracle refuses 0755 written under a DOS version-made-by', () => {
        // The subtler half, and the reason `VERSION_MADE_BY` is `0x0314`. The mode
        // is IN the archive here — the external attributes are byte-identical to
        // the green run's — but `unzip` reads that field as POSIX bits only when
        // the high byte says Unix. Under the DOS value every file extracts at the
        // umask default, and a reader that only compared permission strings would
        // pass: `zipinfo` renders DOS attribute bits in the same column.
        const bad = join(tmpDir, 'red-dos.zip');
        writeFileSync(bad, dosMadeBy(buildZip(bundleEntries(), 1_700_000_000)));
        const output = oracleExpectingFailure('verify-app-zip.sh', [bad, bundle]);
        assert.match(output, /reports host system `fat`, not `unx`/);
    });

    it('the archive expands to <App>.app/, never to a bare Contents/', () => {
        // A zip whose entries start at `Contents/` unpacks into whatever directory
        // the user happened to be in, scattering `MacOS/` and `Resources/` across
        // it — and it is the natural mistake, because the `.app` packer needs the
        // opposite rebase.
        const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf-8' }).trim().split('\n');
        assert.ok(names.length > 0);
        for (const name of names) assert.ok(name.startsWith(`${APP_NAME}.app/`), `${name} escapes the bundle`);
    });

    // ── determinism ───────────────────────────────────────────────────────

    it('packs the same stage to the same bytes twice', () => {
        // `mtime` comes from the stage manifest and never from `Date.now()` — the
        // rule `buildTimestamp` and `gzipDeterministic` already follow, restated
        // for a writer that has its own clock field. Two packs of one stage
        // disagreeing is how a "reproducible" claim dies quietly.
        const first = sha256(zip);
        runCliSync(CLI_ENTRY, ['ship', '--from-stage', stageDir, '--out', 'again'], { cwd: projectDir });
        assert.equal(sha256(join(projectDir, 'again', 'out', ZIP_NAME)), first);
    });

    it('packs from a stage with no project in reach, and the bundle still parses', () => {
        // The two-phase split (ADR 0024 § A2) applied to the new rows: the stage
        // plus its sidecar is the whole closure. `--expect-target` is passed
        // because a darwin stage packed on a Linux host is the supported path and
        // the flag is what makes the leg say which one it is.
        const away = join(tmpDir, 'elsewhere');
        cpSync(stageDir, join(away, 'stage'), { recursive: true });
        runCliSync(CLI_ENTRY, ['ship', '--from-stage', join(away, 'stage'), '--expect-target', `darwin-${ARCH}`], {
            cwd: away,
        });
        const packed = join(away, 'out', `${APP_NAME}.app`);
        oracle('verify-app-plist.py', [packed, join(away, 'stage', STAGE_MANIFEST_FILE)]);
        oracle('verify-app-zip.sh', [join(away, 'out', ZIP_NAME), packed]);
    });

    // ── what the two rows must NOT have changed ───────────────────────────

    it('a bare `gjsify ship` on Linux still defaults to exactly deb and rpm', () => {
        // The regression these rows are most able to cause. Both are
        // `finishOn: 'any'`, so on that criterion alone a bare `gjsify ship` on
        // Linux would emit four artifacts; `defaultFormatIds` filters on
        // `layoutOs` as a second criterion, which is what keeps this list at two.
        // `tests/e2e/ship-layout` asserts the same thing on a `--app gjs` project,
        // and this one adds the `--app node` half — the interpreter filter added
        // for the darwin rows runs on the linux list too.
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--out', 'ship-default'], { cwd: projectDir });
        const manifest = JSON.parse(
            readFileSync(join(projectDir, 'ship-default', 'stage', STAGE_MANIFEST_FILE), 'utf-8'),
        );
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
    });

    it('refuses a `--app gjs` project by name, and still stages its layout', () => {
        // BOTH HALVES, because the first cut of these rows got the second one
        // exactly wrong: `assertFormatCanRunInterpreter` ran over the DERIVED
        // default set, so `gjsify ship darwin --stage` began exiting 1 for every
        // `--app gjs` project — which is every project this command has, and the
        // whole audience of the layout M1 added. A typed `--target` is a claim
        // about this run and is still refused; a derived default is not, and is
        // filtered with the reason printed.
        const gjsProject = scaffold(join(tmpDir, 'app-gjs'));
        const refusal = shipExpectingFailure(
            ['ship', 'darwin', '--skip-build', '--stage', '--target', 'macos-app'],
            gjsProject,
        );
        assert.match(refusal, /the macos-app runtime cannot run it — it provides node/);
        // The row's own sentence, not the Flatpak paragraph this refusal used to
        // carry hardcoded — which told the first `.app` author about
        // `org.freedesktop.Sdk.Extension.node2x`.
        assert.match(refusal, /no relocatable GJS/);
        assert.doesNotMatch(refusal, /org\.gnome\.Platform/);

        runCliSync(CLI_ENTRY, ['ship', 'darwin', '--skip-build', '--stage', '--out', 'staged'], { cwd: gjsProject });
        const staged = listFiles(join(gjsProject, 'staged', 'stage'));
        assert.ok(staged.includes(`${APP_NAME}.app/Contents/Info.plist`));
        const manifest = JSON.parse(readFileSync(join(gjsProject, 'staged', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));
        assert.deepEqual(manifest.formats, [], 'a stage nothing can pack must record that, not a format it cannot use');
    });

    // ── helpers that build the two RED archives ───────────────────────────

    /** The packed bundle as `ZipEntry[]`, so a red run differs from the green one in ONE field. */
    function bundleEntries() {
        return listFiles(bundle).map((rel) => ({
            path: `${APP_NAME}.app/${rel}`,
            mode: statSync(join(bundle, rel)).mode & 0o7777,
            data: readFileSync(join(bundle, rel)),
        }));
    }

    /** What a stage that crossed an artifact upload looks like: the `x` bits gone. */
    function flatten0644(entry) {
        return entry.path.includes('/Contents/MacOS/') ? { ...entry, mode: 0o644 } : entry;
    }

    /**
     * Rewrite every central-directory header's `version made by` to the DOS value.
     *
     * A surgical byte edit rather than a second writer: the point is that
     * EVERYTHING ELSE is the green archive, so the run below can only be reacting
     * to this field.
     */
    function dosMadeBy(bytes) {
        const buf = Buffer.from(bytes);
        const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
        let at = 0;
        let rewritten = 0;
        while ((at = buf.indexOf(signature, at)) !== -1) {
            buf.writeUInt16LE(0x0014, at + 4);
            at += 4;
            rewritten += 1;
        }
        // A search that matched nothing would produce a byte-identical archive and
        // a red run that never reds — the discriminator failing open.
        assert.ok(rewritten > 0, 'no central-directory header was found, so this red run would be the green one');
        return buf;
    }
});
