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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function shipExpectingFailure(args, cwd, env) {
    try {
        runCliSync(CLI_ENTRY, args, { cwd, ...(env ? { env } : {}) });
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

// ── M2b: the runtime the bundle CARRIES ───────────────────────────────────────
//
// WHAT M2a COULD NOT CLAIM, in its own words: "Nothing here runs the bundle. M2a
// assembles the SHAPE of a macOS application on Linux and stops; staging an
// interpreter and a GTK closure into it — and therefore 'unzip it on macos-latest
// and open a window' — is M2b, whose work is the runtime, not the leg."
//
// THIS HALF IS THE LINUX HALF, AND IT IS NOT A CLAIM ABOUT macOS. Everything
// below reads the staged tree with `manifest-conformance/lib/binary.mjs`'s
// `readLibrary()`, which parses a Mach-O from any host and is what ADR 0024 § A4
// used to count 106 of 106 signed images and 0 unresolved non-system dependencies
// in the real closure. A green run here says the wiring is right — the layout, the
// modes, the launcher, the arch label. It does NOT say dyld resolves any of it:
// that is the same assertion on a different OS, and it lives in
// `.github/workflows/node-gi.yml`'s `macos-app-selfcontained` leg, which unzips
// this artifact on a runner with no Homebrew GTK and no Node on `PATH`.
//
// THE FIXTURE CLOSURE IS SYNTHETIC AND ITS DEPENDENCIES ARE REAL. Each staged
// image names its backers the way a relocated one does — `@loader_path/<leaf>`,
// `@loader_path/../../../<leaf>` from four levels down, `@rpath/<leaf>` against an
// `LC_RPATH` of `@loader_path/gtk/lib` — so "every dependency resolves inside the
// staged tree" is FALSE the moment the tree is flattened. That is what makes this
// a measurement of the staging rather than of a path string.

import { createRequire } from 'node:module';

import { machO, LC_CODE_SIGNATURE, LC_ID_DYLIB, LC_LOAD_DYLIB, LC_RPATH, SYSTEM_DYLIB } from '../macho.mjs';

/** The real package, whose `exports` map this suite holds the staging rule against. */
const NODE_GI_DIR = join(MONOREPO_ROOT, 'packages', 'node-gi', 'node-gi');

const BINARY_READER = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs');
const { readLibrary } = await import(pathToFileURL(BINARY_READER).href);

/** Where the staged runtime lives inside the bundle — node-gi's own sibling layout. */
const FRAMEWORKS = `${APP_NAME}.app/Contents/Frameworks/node-gi/prebuilds/darwin-${ARCH}`;

/**
 * The closure, as a map of bundle-relative path → bytes.
 *
 * Every Mach-O here is `arm64`, which is what `ARCH` labels the stage, and every
 * one of its non-system dependencies is expressed relative to the image that
 * loads it. The deepest is the point: `libpixbufloader-svg.so` sits four levels
 * under `gtk/` and reaches `libglib-2.0.0.dylib` with `@loader_path/../../../` —
 * a reference that is correct in the tree and nonsense in a flattened copy.
 */
function closureFiles() {
    const dylib = (leaf, deps, extra = []) =>
        machO(
            [
                { cmd: LC_ID_DYLIB, str: `@loader_path/${leaf}` },
                ...deps.map((str) => ({ cmd: LC_LOAD_DYLIB, str })),
                SYSTEM_DYLIB,
                ...extra,
                // Ad-hoc signed at bundle-build time, because `install_name_tool`
                // invalidates the original and Apple silicon requires it — ADR 0024
                // § A4 read that off all 106 images of the real closure.
                { cmd: LC_CODE_SIGNATURE },
            ],
            { arch: ARCH },
        );
    return {
        'gtk/lib/libglib-2.0.0.dylib': dylib('libglib-2.0.0.dylib', []),
        'gtk/lib/libgtk-4.1.dylib': dylib('libgtk-4.1.dylib', ['@loader_path/libglib-2.0.0.dylib']),
        'gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so': dylib('libpixbufloader-svg.so', [
            '@loader_path/../../../libglib-2.0.0.dylib',
        ]),
        // Toplevel-relative, exactly as `scripts/pixbuf-loader-cache.mjs` writes it.
        'gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache': Buffer.from(
            '"@loader_path/../../../gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so"\n"svg" 4 "gdk-pixbuf" "" ""\n',
        ),
        'gtk/girepository-1.0/Gtk-4.0.typelib': Buffer.from('GOBJ\nMETA'),
        // Extensionless, and a PROGRAM: GStreamer forks it out-of-process so a
        // plugin that crashes on load cannot take the app down with it.
        'gtk/libexec/gstreamer-1.0/gst-plugin-scanner': dylib('gst-plugin-scanner', []),
        'gtk/share/glib-2.0/schemas/gschemas.compiled': Buffer.from('GVariant fixture'),
        'gtk/manifest.json': Buffer.from(JSON.stringify({ platform: `darwin-${ARCH}`, windowing: true }, null, 2)),
        // `@rpath` against `@loader_path/gtk/lib` — the addon's real link shape, and
        // the reason the addon and the closure have to stay SIBLINGS.
        'node_gi.node': machO(
            [
                { cmd: LC_LOAD_DYLIB, str: '@rpath/libgtk-4.1.dylib' },
                SYSTEM_DYLIB,
                { cmd: LC_RPATH, str: '@loader_path/gtk/lib' },
                { cmd: LC_CODE_SIGNATURE },
            ],
            { arch: ARCH },
        ),
    };
}

/**
 * Plant the three packages a self-contained `.app` needs in a project's own
 * `node_modules`, and nothing else.
 *
 * BY NAME, through the consumer's tree — the contract `docs/publishing.md` states
 * and `website/src/content/docs/ship/index.mdx` now spells out for app authors:
 * `@gjsify/gtk-runtime-*` and `@gjsify/node-runtime-*` carry no
 * `optionalDependencies` edge anywhere, so whoever SHIPS declares them. A fixture
 * that reached into this monorepo's own packages would prove the resolution works
 * HERE and say nothing about a stranger's project.
 */
function installRuntimePackages(projectDir, { closure = true, interpreter = true, addon = true } = {}) {
    const modules = join(projectDir, 'node_modules', '@gjsify');
    const manifest = (dir, name, exports) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({
                name,
                version: '0.44.0',
                type: 'module',
                main: './index.js',
                ...(exports ? { exports } : {}),
            }),
        );
        writeFileSync(join(dir, 'index.js'), 'export default {};\n');
    };
    const write = (root, rel, data) => {
        const target = join(root, ...rel.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
    };

    // The closure and the addon come out of ONE package here, which is node-gi's
    // own `prebuilds/<target>/` sibling layout and the shape `node-gi.yml`'s macOS
    // legs assemble by hand before every conformance run.
    const nodeGi = join(modules, 'node-gi');
    // The `exports` map matters: `@gjsify/node-gi/gi` is what a `--app node` bundle
    // `require`s, and it is the map — not a filename — that resolves it.
    manifest(nodeGi, '@gjsify/node-gi', { '.': './index.js', './gi': './gi.js', './globals': './globals.js' });
    writeFileSync(join(nodeGi, 'gi.js'), 'export const requireGi = () => ({});\n');
    writeFileSync(join(nodeGi, 'globals.js'), 'export default {};\n');
    const files = closureFiles();
    for (const [rel, data] of Object.entries(files)) {
        if (!closure && rel.startsWith('gtk/')) continue;
        if (!addon && rel === 'node_gi.node') continue;
        write(nodeGi, `prebuilds/darwin-${ARCH}/${rel}`, data);
    }

    if (interpreter) {
        const runtime = join(modules, `node-runtime-darwin-${ARCH}`);
        manifest(runtime, `@gjsify/node-runtime-darwin-${ARCH}`);
        write(runtime, 'bin/node', machO([SYSTEM_DYLIB, { cmd: LC_CODE_SIGNATURE }], { arch: ARCH }));
        write(runtime, 'bin/LICENSE', Buffer.from('Node.js is licensed for use as follows:\n'));
    }
    return projectDir;
}

/**
 * Resolve one recorded dependency against the STAGED tree.
 *
 * `@loader_path` is the directory of the image that records it and `@rpath` is
 * each `LC_RPATH` expanded the same way — which is dyld's own rule, and the whole
 * reason a relocated closure survives being moved. Absolute paths under
 * `/usr/lib` and `/System` are macOS's own and are reported as system rather than
 * resolved: `binary.mjs`'s `SYSTEM_DYLIB_ROOTS` draws exactly that line.
 */
function resolveDependency(dep, imageRel, searchPaths) {
    const dir = posixDirname(imageRel);
    if (dep.startsWith('/usr/lib/') || dep.startsWith('/System/')) return { kind: 'system' };
    const expand = (spec) => normalisePosix(spec.replace('@loader_path', dir));
    if (dep.startsWith('@loader_path/')) return { kind: 'file', path: expand(dep) };
    if (dep.startsWith('@rpath/')) {
        const leaf = dep.slice('@rpath/'.length);
        return { kind: 'candidates', paths: searchPaths.map((rpath) => `${expand(rpath)}/${leaf}`) };
    }
    return { kind: 'foreign', path: dep };
}

const posixDirname = (rel) => rel.split('/').slice(0, -1).join('/');

function normalisePosix(rel) {
    const out = [];
    for (const part of rel.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return out.join('/');
}

describe('CLI ship macOS self-contained runtime E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let stageDir;
    let bundle;
    let shipOutput;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-runtime-'));
        projectDir = installRuntimePackages(scaffoldNodeApp(join(tmpDir, 'app')));
        // `runCliSync` returns stdout as a STRING (`encoding: 'utf8'`), so this is
        // the whole of what the command said on that channel — the `carries its
        // own …` lines this suite reads back are `console.log`.
        shipOutput = runCliSync(CLI_ENTRY, ['ship', 'darwin', '--skip-build', '--arch', ARCH], { cwd: projectDir });
        stageDir = join(projectDir, 'ship', 'stage');
        bundle = join(projectDir, 'ship', 'out', `${APP_NAME}.app`);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("stages the closure in node-gi's sibling layout, at every original depth", () => {
        const staged = listPayload(stageDir);
        for (const rel of Object.keys(closureFiles())) {
            assert.ok(staged.includes(`${FRAMEWORKS}/${rel}`), `${rel} is not staged where node-gi looks for it`);
        }
        // The probe `resolveGtkRuntimeBundle()` runs before it will use a directory
        // at all: `<dir>/lib` AND `<dir>/girepository-1.0`. A staging that produced
        // neither would pass every other assertion in this file.
        assert.ok(staged.some((rel) => rel.startsWith(`${FRAMEWORKS}/gtk/lib/`)));
        assert.ok(staged.some((rel) => rel.startsWith(`${FRAMEWORKS}/gtk/girepository-1.0/`)));
        // SIBLINGS. The addon's `LC_RPATH` is `@loader_path/gtk/lib`, so anything
        // that separated these two would break the link with both files present.
        assert.ok(staged.includes(`${FRAMEWORKS}/node_gi.node`));
        // The depth that carries a reference: four levels, not a basename.
        assert.ok(
            staged.includes(`${FRAMEWORKS}/gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so`),
            'the loader was flattened, and `loaders.cache` now points three levels above it',
        );
    });

    it('stages the JavaScript the bundle `require`s, where Node looks for it', () => {
        // NOT an afterthought and not a convenience: `@gjsify/node-gi/*` is EXTERNAL
        // in every `--app node` bundle by design (`rolldown-plugin-gjsify`'s
        // `app/node.ts` — the reverse-bridge modules "must resolve at runtime
        // against the consumer's node_modules"), so a `gi://Gtk` import compiles to
        // `require('@gjsify/node-gi/gi')` in the shipped file. A `.app` has no
        // consumer node_modules.
        const staged = listPayload(stageDir);
        const pkg = `${APP_NAME}.app/Contents/Resources/lib/node_modules/@gjsify/node-gi`;
        assert.ok(staged.includes(`${pkg}/package.json`));
        assert.ok(staged.includes(`${pkg}/gi.js`));
        // Resolved for real, by Node's own resolver, from the staged bundle's own
        // directory — the question a path assertion only approximates.
        //
        // `startsWith(<the bundle>)` rather than "it resolved", and the difference is
        // the whole assertion. `require` walks `node_modules` UPWARD, so a bare
        // "it resolved" would be a statement about every directory above the bundle
        // as much as about the bundle — and this repository has a tree where that
        // matters: `node-gi.yml`'s consumer jobs link `@gjsify/node-gi` at the
        // workspace root. Nothing outside the `.app` can satisfy the predicate below,
        // so the answer is a fact about the STAGING and not about the machine.
        const bundleFile = join(stageDir, `${APP_NAME}.app`, 'Contents', 'Resources', 'lib', 'app.node.mjs');
        const resolved = createRequire(bundleFile).resolve('@gjsify/node-gi/gi');
        assert.ok(resolved.startsWith(join(stageDir, `${APP_NAME}.app`)), `resolved outside the bundle: ${resolved}`);
    });

    it("holds the staging rule against the REAL package's exports map", () => {
        // THE MECHANISM, not the fix. `resolveNodeGiPackage` stages `package.json`,
        // the root `.js` and `overrides/` — a rule derived from what
        // `require('@gjsify/node-gi/<subpath>')` can reach, not from the `files`
        // list (which also carries `src/`, `binding.gyp` and `scripts/install.mjs`,
        // inputs to a `node-gyp` run a `.app` never performs). A node-gi release
        // that added an export outside that set would ship a `.app` failing at
        // `require` on a stranger's Mac; it fails here instead.
        const manifest = JSON.parse(readFileSync(join(NODE_GI_DIR, 'package.json'), 'utf-8'));
        const targets = [];
        const collect = (value) => {
            if (typeof value === 'string') targets.push(value);
            else if (value && typeof value === 'object') for (const nested of Object.values(value)) collect(nested);
        };
        collect(manifest.exports);
        assert.ok(targets.length > 0, 'node-gi declares no exports, so this gate would check nothing');
        for (const target of targets) {
            const rel = target.replace(/^\.\//, '');
            assert.ok(
                rel.endsWith('.d.ts') || (!rel.includes('/') && rel.endsWith('.js')),
                `${target} is an exports target the staging rule does not copy — see resolveNodeGiPackage`,
            );
        }
    });

    it('stages the interpreter beside the launcher, with its licence', () => {
        const staged = listPayload(stageDir);
        assert.ok(staged.includes(`${APP_NAME}.app/Contents/MacOS/node`));
        // Redistribution with no terms attached is what `ResolvedNodeRuntime` makes
        // structurally hard by carrying the licence in the same result.
        assert.ok(staged.includes(`${APP_NAME}.app/Contents/Resources/share/licenses/node/LICENSE`));
        assert.equal(statSync(join(bundle, 'Contents', 'MacOS', 'node')).mode & 0o777, 0o755);
    });

    it('reads every staged Mach-O back with binary.mjs, from Linux', () => {
        // ADR 0024 § A4's own instrument, pointed at the tree this milestone
        // produces. Three numbers, each printed from what was parsed rather than
        // restated here: how many images, how many the reader could not parse, and
        // how many non-system dependencies do not resolve INSIDE the bundle.
        const staged = listPayload(stageDir);
        const images = [];
        for (const rel of staged) {
            const info = readLibrary(join(stageDir, rel));
            if (info !== null) images.push({ rel, info });
        }
        // The fixture closure plus the addon plus the interpreter.
        assert.equal(images.length, 6, `expected 6 Mach-O images in the stage, read ${images.length}`);
        for (const { rel, info } of images) {
            assert.equal(info.format, 'macho', `${rel} is not a Mach-O`);
            assert.equal(info.os, 'darwin', `${rel} is not a darwin image`);
            assert.equal(info.arch, ARCH, `${rel} is ${info.arch}, and the stage is labelled ${ARCH}`);
        }
        const unresolved = [];
        const present = new Set(staged);
        for (const { rel, info } of images) {
            for (const dep of info.needed) {
                const resolved = resolveDependency(dep, rel, info.searchPaths);
                if (resolved.kind === 'system') continue;
                if (resolved.kind === 'file' && present.has(resolved.path)) continue;
                if (resolved.kind === 'candidates' && resolved.paths.some((path) => present.has(path))) continue;
                unresolved.push(`${rel} → ${dep}`);
            }
        }
        assert.deepEqual(unresolved, [], 'a staged image names a library the bundle does not carry');
    });

    it('RED: the same reader finds the dependencies UNRESOLVED once the tree is flattened', () => {
        // The discriminator for the assertion above, and the reason it is a
        // measurement rather than a restatement. Flattening every staged path to
        // its basename is exactly what `gjsify.ship.bundledTypelibs` does
        // (`plan.ts`: `posix.join(libDir, 'gi', basename(file))`), and it is the
        // design this module exists to refuse. Without this run, "0 unresolved"
        // would also be the answer for a tree with no `@loader_path` in it at all.
        const staged = listPayload(stageDir).filter((rel) => rel.startsWith(`${FRAMEWORKS}/`));
        const flattened = new Set(staged.map((rel) => `${FRAMEWORKS}/${rel.split('/').pop()}`));
        const unresolved = [];
        for (const rel of staged) {
            const info = readLibrary(join(stageDir, rel));
            if (info === null) continue;
            const flatRel = `${FRAMEWORKS}/${rel.split('/').pop()}`;
            for (const dep of info.needed) {
                const resolved = resolveDependency(dep, flatRel, info.searchPaths);
                if (resolved.kind === 'system') continue;
                if (resolved.kind === 'file' && flattened.has(resolved.path)) continue;
                if (resolved.kind === 'candidates' && resolved.paths.some((path) => flattened.has(path))) continue;
                unresolved.push(`${rel} → ${dep}`);
            }
        }
        // The deep loader escapes the bundle entirely and the addon's `@rpath` no
        // longer names a directory that exists.
        assert.ok(unresolved.length > 0, 'flattening the tree broke nothing, so the tree was never load-bearing');
        assert.ok(
            unresolved.some((line) => line.includes('libpixbufloader-svg.so')),
            unresolved.join('\n'),
        );
        assert.ok(
            unresolved.some((line) => line.includes('node_gi.node')),
            unresolved.join('\n'),
        );
    });

    it('writes a launcher that names what the bundle carries, and no DYLD variable', () => {
        const launcher = readFileSync(join(bundle, 'Contents', 'MacOS', BINARY), 'utf-8');
        assert.match(launcher, /^exec "\$here\/node" "\$contents\/Resources\/lib\/app\.node\.mjs" "\$@"$/m);
        assert.match(
            launcher,
            new RegExp(`^GJSIFY_GTK_RUNTIME="\\$contents/Frameworks/node-gi/prebuilds/darwin-${ARCH}/gtk"$`, 'm'),
        );
        assert.match(
            launcher,
            new RegExp(
                `^NODE_GI_NATIVE="\\$contents/Frameworks/node-gi/prebuilds/darwin-${ARCH}/node_gi\\.node"$`,
                'm',
            ),
        );
        // The rule, with the reason that holds: under hardened runtime a
        // Developer-ID-signed main executable is restricted and dyld strips every
        // `DYLD_*`, so a launcher depending on one works unsigned and breaks the
        // day it is signed (ADR 0024 § A4, § A16 — #1354 M6).
        assert.doesNotMatch(launcher, /DYLD_/);
    });

    it('says what it carries, and drops the gap it no longer has', async () => {
        const output = shipOutput;
        assert.match(output, /carries its own interpreter from @gjsify\/node-runtime-darwin-arm64/);
        assert.match(output, /carries its own GTK closure from @gjsify\/node-gi\/prebuilds\/darwin-arm64/);
        assert.match(output, /carries its own node-gi addon from @gjsify\/node-gi/);
        assert.match(output, /carries its own node-gi runtime \(\d+ file\(s\)\) from @gjsify\/node-gi/);
        // `Layout.runtimeGap` says "the staged launcher execs an interpreter off
        // `PATH`, which a downloaded `.app` cannot assume". Printing that over a
        // tree that carries its own interpreter would be the command telling the
        // author something untrue about what it had just written.
        //
        // Asserted over BOTH channels, through a second run, because the gap is a
        // `console.warn` and this file's `shipOutput` holds stdout alone — an
        // absence assertion against the wrong stream is the emptiest kind of green.
        const both = await runCli(
            CLI_ENTRY,
            ['ship', 'darwin', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-gap'],
            {
                cwd: projectDir,
            },
        );
        assert.equal(both.status, 0);
        assert.doesNotMatch(`${both.stdout}${both.stderr}`, /execs an interpreter off `PATH`/);
        assert.match(`${both.stdout}${both.stderr}`, /carries its own GTK closure/);
    });

    it('the zip carries the interpreter executable, read back by zipinfo', () => {
        const zip = join(projectDir, 'ship', 'out', ZIP_NAME);
        const out = oracle('verify-app-zip.sh', [zip, bundle]);
        // SEVEN, and the number is the oracle's own count of entries whose Unix
        // mode has an execute bit: the two under `Contents/MacOS` (the launcher and
        // the interpreter it execs) plus the five staged images that arrive without
        // one whenever the closure crossed an `actions/upload-artifact`.
        assert.match(out, /round-tripped byte for byte, 7 executable, modes read as POSIX/);
        assert.match(out, new RegExp(`^-rwxr-xr-x .*${APP_NAME}\\.app/Contents/MacOS/node$`, 'm'));
    });

    it('RED: refuses an arm64 closure labelled x64, naming the file', () => {
        // The check `assertPayloadMatchesArch` has always done, made non-vacuous by
        // this milestone: before the runtime was staged, a darwin payload was
        // JavaScript and text, and nothing in it had a `cputype` to disagree with
        // the label at all.
        //
        // Reached through `GJSIFY_GTK_RUNTIME`, which is the only way an operator
        // CAN produce this — resolution by name derives the target from `--arch`, so
        // `--arch x64` alone simply finds no `darwin-x64` closure and stages none.
        // The override names a DIRECTORY and nothing in that directory's name says
        // which architecture it holds, which is exactly the mistake this refusal is
        // for.
        const closure = join(projectDir, 'node_modules', '@gjsify', 'node-gi', 'prebuilds', `darwin-${ARCH}`, 'gtk');
        const refusal = shipExpectingFailure(
            ['ship', 'darwin', '--skip-build', '--stage', '--arch', 'x64', '--out', 'ship-x64'],
            projectDir,
            { ...process.env, GJSIFY_GTK_RUNTIME: closure },
        );
        assert.match(refusal, /the payload is arm64, but the package would be labelled x64/);
        assert.match(
            refusal,
            /libgtk-4\.1\.dylib is built for arm64|libglib-2\.0\.0\.dylib is built for arm64|libpixbufloader-svg\.so is built for arm64|gst-plugin-scanner is built for arm64/,
        );
    });

    it('CONTROL: a project without the packages stages no runtime and says which to install', async () => {
        // The other half of every assertion above. Without this, "the bundle
        // carries a runtime" could be true of any project the command touches, and
        // an author whose bundle is NOT self-contained would have no way to learn
        // it from the output.
        const bare = scaffoldNodeApp(join(tmpDir, 'bare'));
        const { status, stdout, stderr } = await runCli(
            CLI_ENTRY,
            ['ship', 'darwin', '--skip-build', '--stage', '--arch', ARCH],
            { cwd: bare },
        );
        assert.equal(status, 0, 'a bundle with no runtime is an intermediate, not an error');
        // The two runtime packages are published and installed NOWHERE in this tree,
        // so their lines are unconditional; `@gjsify/node-gi` is named either way,
        // because its `prebuilds/` are gitignored and the ADDON is missing even in a
        // tree where the JavaScript resolves. What is NOT asserted is that node-gi's
        // JavaScript went unstaged — `require` walks upward, so that would be a claim
        // about the machine rather than about this project.
        const output = `${stdout}${stderr}`;
        for (const name of [
            `@gjsify/node-runtime-darwin-${ARCH}`,
            `@gjsify/gtk-runtime-darwin-${ARCH}`,
            '@gjsify/node-gi',
        ]) {
            assert.ok(output.includes(name), `the output never names ${name}`);
        }
        // And the gap is printed again, because this tree really does have it.
        assert.match(output, /execs an interpreter off `PATH`/);
        const staged = listPayload(join(bare, 'ship', 'stage'));
        assert.ok(!staged.some((rel) => rel.includes('/Frameworks/node-gi/')));
        assert.ok(!staged.includes(`${APP_NAME}.app/Contents/MacOS/node`));
        const launcher = readFileSync(
            join(bare, 'ship', 'stage', `${APP_NAME}.app`, 'Contents', 'MacOS', BINARY),
            'utf-8',
        );
        assert.match(launcher, /^exec node "\$contents\/Resources\/lib\/app\.node\.mjs" "\$@"$/m);
    });
});
