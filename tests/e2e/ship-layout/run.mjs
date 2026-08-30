// E2E test for the `gjsify ship` LAYOUT axis — ADR 0024 § 2, issue #1354 M1.
//
// The claim under test is the one ADR 0024 § 2 makes and the one stages 4 and 5
// rest on: *one payload, a handful of layouts*. Up to here it was unfalsifiable,
// because exactly one layout existed. Three do now, so it can be stated as an
// equality and checked:
//
//   assemble the SAME project for linux, darwin and windows, and the staged file
//   SET must be identical modulo the layout map — same files, same bytes,
//   different places.
//
// The map is written out HERE, in this file, rather than imported from
// `utils/ship/layout.js`. Importing it would compare the implementation with
// itself and pass for any map at all, including one that puts every file in the
// same directory. What this suite asserts is that the three trees agree with a
// map a reader can see.
//
// THE SECOND ORACLE IS NOT OURS EITHER. `manifest-conformance`'s `binary.mjs`
// parses Mach-O from any host, so a Linux runner can read back what it staged
// for macOS: format, `cputype`, the `LC_ID_DYLIB`, the rpaths and the
// `LC_CODE_SIGNATURE`. The payload is a REAL darwin dylib — this repository's
// committed `libgwebgl.dylib` prebuild, standing in for whatever a third-party
// app would carry — so the assertion is over bytes an independent parser
// understood, not over a path string.
//
// Its control value, stated plainly because the issue's is a different one: ADR
// 0024 § A4's *106 images, 0 unresolved non-system deps* was measured over
// `@gjsify/gtk-runtime-darwin-arm64@0.41.0` plus `node-gi`'s addon, which is the
// batteries-included bundle a shipped `.app` will carry once M0's runtime
// packages exist. Nothing in this tree stages that bundle yet and this suite
// does NOT pretend to: it reads the darwin Mach-O images the fixture actually
// carries, refuses to pass if there are none, and leaves the 106 to the leg that
// can produce them.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCli, runCliSync } from '../mock-registry.mjs';
import {
    APP_ID,
    CLI_ENTRY,
    listPayload,
    MONOREPO_ROOT,
    scaffold,
    sha256,
    shipExpectingFailure,
    STAGE_MANIFEST_FILE,
} from '../ship/fixture.mjs';

const { readLibrary } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')).href
);

// The CLI's OWN classifier, imported rather than restated. The layout map above
// is deliberately re-derived here — importing `place()` would compare the
// implementation with itself — but this one is the opposite case: the thing under
// test is that the WARNING matches what the function decided, so a private copy of
// the rules would make a mutation of them invisible. Measured: with the expected
// set re-derived from a regex in this file, pointing one rule at a directory that
// matches nothing dropped a file from the printed warning and this suite stayed
// green at exit 0.
const { linuxInstallDependent } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'payload.js')).href
);

/**
 * A real darwin payload, borrowed from this repository's own committed prebuilds.
 *
 * Test DATA, not a default: nothing in `utils/ship/layout.ts` knows this
 * directory exists, and a consumer reaching the same code path points
 * `gjsify.ship.bundledTypelibs` at their own. It is copied INTO the scaffolded
 * project so the fixture is a self-contained third-party-shaped app rather than
 * one reaching back into the monorepo that happens to be testing it.
 */
const DARWIN_PREBUILD = join(MONOREPO_ROOT, 'packages', 'framework', 'webgl-darwin-arm64', 'prebuilds', 'darwin-arm64');
const DARWIN_PAYLOAD = ['libgwebgl.dylib', 'Gwebgl-0.1.typelib'];

/** The display name the fixture declares — and therefore the `.app` directory's. */
const APP_NAME = 'Ship Demo';
const BINARY = 'ship-demo';
/** The arch the borrowed dylib is built for; the three stages are labelled for it. */
const ARCH = 'arm64';

/**
 * The layout map, as a reader would state it.
 *
 * Deliberately NOT `place()` from the CLI. Each entry is one prefix rule, and
 * the rules are ordered the way the design orders them: the launcher first
 * (it is the one file whose NAME changes), then the carried native files, which
 * are the reason a layout is more than a prefix — on macOS they leave the bundle
 * directory for `Contents/Frameworks`.
 */
const LAYOUT_MAP = {
    linux: (rel) => rel,
    darwin: (rel) => {
        const under = (dir, tail) => `${APP_NAME}.app/Contents/${dir}/${tail}`;
        if (rel === `bin/${BINARY}`) return under('MacOS', BINARY);
        if (rel.startsWith(`lib/${BINARY}/gi/`)) return under('Frameworks', rel.slice(`lib/${BINARY}/gi/`.length));
        if (rel.startsWith(`lib/${BINARY}/`)) return under('Resources/lib', rel.slice(`lib/${BINARY}/`.length));
        if (rel.startsWith('share/')) return under('Resources/share', rel.slice('share/'.length));
        throw new Error(`the darwin map has no rule for ${rel}`);
    },
    windows: (rel) => {
        if (rel === `bin/${BINARY}`) return `${BINARY}.cmd`;
        if (rel.startsWith(`lib/${BINARY}/gi/`)) return `lib/${rel.slice(`lib/${BINARY}/gi/`.length)}`;
        if (rel.startsWith(`lib/${BINARY}/`)) return `app/${rel.slice(`lib/${BINARY}/`.length)}`;
        if (rel.startsWith('share/')) return rel;
        throw new Error(`the windows map has no rule for ${rel}`);
    },
};

/**
 * What each layout adds that the map cannot produce — the second half of the
 * restated invariant (#1354 M2a).
 *
 * TWO ROUTES, and they are listed apart because they fail apart. The first is
 * `Layout.metadata`: files the LAYOUT owns, at the bundle root, with no
 * prefix-relative counterpart anywhere. The second is the compiled schema cache,
 * which IS prefix-relative and is added to the plan for any layout with no
 * install step — so it goes through the map like everything else and is an
 * addition only relative to Linux.
 *
 * Windows has an empty metadata row on purpose: a program directory has no
 * manifest of its own today, and a row that answers "this layout owns nothing" is
 * a different statement from a row nobody filled in.
 */
const LAYOUT_ADDITIONS = {
    darwin: [
        `${APP_NAME}.app/Contents/Info.plist`,
        `${APP_NAME}.app/Contents/PkgInfo`,
        `${APP_NAME}.app/Contents/Resources/share/glib-2.0/schemas/gschemas.compiled`,
    ],
    windows: ['share/glib-2.0/schemas/gschemas.compiled'],
};

/**
 * Why a pack of each non-Linux layout is refused FOR THIS FIXTURE, which is
 * `--app gjs`.
 *
 * The two were one string until #1354 M2a gave darwin two formats, and they were
 * two DIFFERENT strings until M3 gave windows two — "wait for a milestone" and
 * "change your project" are not the same advice, and a test asserting one regex
 * for both would have gone on passing while the command started giving the wrong
 * one. They are the same sentence again now, and that is the milestone landing
 * rather than the distinction dissolving: both layouts have formats, both sets are
 * `interpreters: ['node']`, and this fixture is `--app gjs`. The "no format wraps
 * this layout yet" branch is still REACHABLE — `assertPackable` prints it for any
 * layout `formatIdsFor` answers empty for — it is simply no longer reachable from
 * any of the three that exist, which is what stages 4 and 5 being done means.
 */
const UNPACKABLE = {
    darwin: /wrap the darwin layout, and neither can run this project/,
    windows: /wrap the windows layout, and neither can run this project/,
};

/** `<os>` → the `${process.platform}-${process.arch}` string its stage manifest records. */
const TARGET = { linux: `linux-${ARCH}`, darwin: `darwin-${ARCH}`, windows: `win32-${ARCH}` };

/**
 * Run the CLI and return both streams plus the status.
 *
 * `runCli`, not `runCliSync`: the sync helper returns stdout alone and throws on a
 * non-zero exit, and every assertion below is about a WARNING, which is on stderr.
 * A test reading stdout would pass whether or not the notice exists.
 */
function runCliCapture(args, cwd) {
    return runCli(CLI_ENTRY, args, { cwd });
}

describe('CLI ship layout axis E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    /** `<os>` → absolute stage directory. */
    const stages = {};

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        for (const file of DARWIN_PAYLOAD) {
            const source = join(DARWIN_PREBUILD, file);
            // A REQUIRED input, so its absence fails rather than skips: without
            // it the Mach-O assertions below would run over an empty set and the
            // suite would be green having read nothing.
            if (!existsSync(source)) {
                throw new Error(
                    `${source} is missing, and it is the only real Mach-O this suite has. Without it the ` +
                        'darwin-payload assertions are vacuous, so this fails instead of skipping.',
                );
            }
        }

        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-layout-'));
        projectDir = scaffold(join(tmpDir, 'app'), (pkg) => {
            // The one config key this suite adds, and it is the consumer's:
            // `bundledTypelibs` is how ANY app says "I carry these GI libraries
            // myself". Nothing about the layout is derived from it — it decides
            // WHICH files are native, not where native files go.
            pkg.gjsify.ship.bundledTypelibs = ['data/gi'];
        });
        mkdirSync(join(projectDir, 'data', 'gi'), { recursive: true });
        for (const file of DARWIN_PAYLOAD)
            copyFileSync(join(DARWIN_PREBUILD, file), join(projectDir, 'data', 'gi', file));

        for (const os of ['linux', 'darwin', 'windows']) {
            runCliSync(CLI_ENTRY, ['ship', os, '--skip-build', '--stage', '--arch', ARCH, '--out', `ship-${os}`], {
                cwd: projectDir,
            });
            stages[os] = join(projectDir, `ship-${os}`, 'stage');
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── one payload, three layouts ────────────────────────────────────────

    it('stages the Linux layout unchanged, native files included', () => {
        assert.deepEqual(listPayload(stages.linux), [
            'bin/ship-demo',
            'lib/ship-demo/gi/Gwebgl-0.1.typelib',
            'lib/ship-demo/gi/libgwebgl.dylib',
            'lib/ship-demo/gjs.js',
            `share/applications/${APP_ID}.desktop`,
            `share/glib-2.0/schemas/${APP_ID}.gschema.xml`,
            `share/icons/hicolor/scalable/apps/${APP_ID}.svg`,
            `share/metainfo/${APP_ID}.metainfo.xml`,
            `share/mime/packages/${APP_ID}.xml`,
        ]);
    });

    for (const os of ['darwin', 'windows']) {
        it(`the ${os} file set is the Linux one modulo the map, plus what that layout adds`, () => {
            // THE INVARIANT IS RESTATED, NOT RELAXED (#1354 M2a). It used to be a
            // bare `deepEqual` of the mapped sets, and M2a broke it in two
            // different ways at once — neither of them a bug:
            //
            //  * `Contents/Info.plist` and `Contents/PkgInfo` have no Linux
            //    counterpart to be mapped FROM. `planStage` emits one plan in the
            //    prefix-relative shape, `place()` sends everything unmatched to
            //    `dirs.other`, and `assertInsidePrefix` forbids escaping upward —
            //    so no plan entry and no `extraFiles` value can reach a bundle
            //    root. `Layout.metadata` is the seam that adds them, and a
            //    comparison between the three layouts is structurally blind to a
            //    file only one of them produces.
            //  * `gschemas.compiled` exists in the non-Linux stages and must NOT
            //    exist in the Linux one, because there the `.deb`/`.rpm` postinst
            //    compiles the SYSTEM directory at install time.
            //
            // The cheap repair — a subset check — would have stopped this suite
            // catching a real layout bug, which is the whole reason it exists. So
            // the additions are ENUMERATED here, by the route each arrives on, and
            // asserted in BOTH directions: every mapped file is present, every
            // addition is present, and nothing else is. A third file appearing
            // from anywhere reds until somebody writes it down.
            const expected = [...listPayload(stages.linux).map(LAYOUT_MAP[os]), ...LAYOUT_ADDITIONS[os]].sort();
            assert.deepEqual(listPayload(stages[os]), expected);
        });

        it(`the ${os} additions are absent from the Linux stage, which is what makes them additions`, () => {
            // Without this the enumeration above could be satisfied by a set that
            // is simply the Linux one — the mapped half would cover everything and
            // `LAYOUT_ADDITIONS` could be junk nobody notices.
            const linux = listPayload(stages.linux);
            for (const added of LAYOUT_ADDITIONS[os]) {
                assert.ok(!linux.includes(added), `${added} is in the Linux stage, so it is not an addition`);
                // …and the prefix-relative shape of it is absent too, which is the
                // check that catches `gschemas.compiled` leaking into a `.deb`.
                assert.ok(!linux.some((rel) => rel.endsWith('gschemas.compiled')));
            }
        });

        it(`every ${os} file is byte-identical to its Linux counterpart, except the launcher`, () => {
            // The launcher is the ONE file the layout is allowed to rewrite —
            // it is the per-OS half by construction. Everything else is the
            // payload, and a payload that changes between layouts is not one
            // payload. Asserting the launchers DIFFER is what keeps this from
            // passing on a run where the map quietly did nothing.
            const launcher = `bin/${BINARY}`;
            for (const rel of listPayload(stages.linux)) {
                const from = join(stages.linux, rel);
                const to = join(stages[os], LAYOUT_MAP[os](rel));
                if (rel === launcher) {
                    assert.notEqual(sha256(from), sha256(to), `${os}: the launcher must not be Linux's`);
                    continue;
                }
                assert.equal(sha256(to), sha256(from), `${os}: ${rel} changed on the way into the layout`);
            }
        });

        it(`the ${os} launcher is executable`, () => {
            const rel = LAYOUT_MAP[os](`bin/${BINARY}`);
            assert.equal(statSync(join(stages[os], rel)).mode & 0o777, 0o755);
        });
    }

    // ── the launcher forms ────────────────────────────────────────────────

    it('linux: the prefix-deriving /bin/sh launcher is unchanged', () => {
        const launcher = readFileSync(join(stages.linux, 'bin', BINARY), 'utf-8');
        assert.match(launcher, /^#!\/bin\/sh\n/);
        assert.match(launcher, /prefix=\$\(dirname "\$\(dirname "\$self"\)"\)/);
        assert.match(launcher, /exec gjs -m "\$prefix"\/lib\/ship-demo\/gjs\.js "\$@"/);
        // The carried GI directory reaches the loader through the environment on
        // Linux, which is exactly what macOS cannot do — see the next test.
        assert.match(launcher, /^LD_LIBRARY_PATH="\$prefix"\/lib\/ship-demo\/gi/m);
    });

    it("darwin: no readlink -f, no DYLD_, and the payload's own runtime", () => {
        const launcher = readFileSync(join(stages.darwin, `${APP_NAME}.app`, 'Contents', 'MacOS', BINARY), 'utf-8');
        assert.match(launcher, /^#!\/bin\/sh\n/);
        // `readlink -f` is GNU coreutils'; the BSD readlink macOS ships has no
        // `-f`, so under `set -e` the launcher would exit on its first command.
        assert.ok(!launcher.includes('readlink'), 'the macOS launcher must not call readlink');
        // ADR 0024 § 3: SIP strips an inherited DYLD_* at the /bin/sh exec, so a
        // launcher that exports one is claiming something the loader will not see.
        assert.ok(!launcher.includes('DYLD_'), 'the macOS launcher must not export a DYLD_ variable');
        assert.match(launcher, /contents=\$\(dirname -- "\$here"\)/);
        assert.match(launcher, /GI_TYPELIB_PATH="\$contents\/Frameworks"/);
        // `gjs -m`, not `node`, and this fixture is `--app gjs`. The launcher
        // execs what `settings.app` says the payload was BUILT for, on every
        // layout — never what the layout's row says a shipped artifact will
        // eventually carry (`Layout.shippedRuntime`, ADR 0024 § 4, #1354 M0).
        // Naming `node` here put a runtime that cannot parse
        // `import Gtk from 'gi://Gtk'` in front of a bundle that starts with
        // exactly that line, at exit 0.
        assert.match(launcher, /exec gjs -m "\$contents\/Resources\/lib\/gjs\.js" "\$@"/);
        assert.ok(!launcher.includes('exec node'), 'the launcher must not name a runtime the payload cannot use');
    });

    it('windows: a CRLF .cmd that derives the program directory from %~dp0', () => {
        const raw = readFileSync(join(stages.windows, `${BINARY}.cmd`));
        const text = raw.toString('utf-8');
        assert.ok(text.startsWith('@echo off\r\n'), 'a batch file cmd.exe re-seeks through needs CRLF');
        // Every LF is part of a CRLF pair: cmd.exe reads a batch file in chunks
        // and re-seeks by byte offset while running it, which is where the
        // documented LF-only `goto`/block failures come from.
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === 0x0a) assert.equal(raw[i - 1], 0x0d, `bare LF at byte ${i}`);
        }
        // ASCII only — a batch file is read in the console's active code page.
        assert.ok(
            raw.every((byte) => byte < 0x80),
            'the .cmd must be ASCII',
        );
        assert.match(text, /set "HERE=%~dp0"/);
        assert.match(text, /if defined PATH \(set "PATH=%HERE%lib;%PATH%"\)/);
        assert.match(text, /gjs -m "%HERE%app\\gjs\.js" %\*/);
    });

    // ── the stage manifest ────────────────────────────────────────────────

    for (const os of ['linux', 'darwin', 'windows']) {
        it(`${os}: the manifest records ${TARGET[os]}, not the constant it used to`, () => {
            const manifest = JSON.parse(readFileSync(join(stages[os], STAGE_MANIFEST_FILE), 'utf-8'));
            assert.equal(`${manifest.target.os}-${manifest.target.arch}`, TARGET[os]);
        });

        it(`${os}: --expect-target accepts ${TARGET[os]} and refuses the other two`, () => {
            for (const [other, target] of Object.entries(TARGET)) {
                const args = ['ship', '--from-stage', stages[os], '--expect-target', target];
                if (other !== os) {
                    assert.match(shipExpectingFailure(args, projectDir), /--expect-target/);
                    continue;
                }
                // A matching target gets PAST the target check, and the two
                // outcomes after it are DIFFERENT and both asserted positively.
                // "the output does not mention --expect-target" was the first
                // version and it is not a check: any failure lacking that literal
                // passes it, including a crash before the flag is read.
                if (os === 'linux') {
                    assert.match(runCliSync(CLI_ENTRY, args, { cwd: projectDir }), /\[gjsify ship\] packing/);
                } else {
                    // TWO DIFFERENT REFUSALS as of #1354 M2a, and asserting the
                    // same string for both would have hidden the change: darwin
                    // now HAS formats and this fixture cannot use them
                    // (`interpreters: ['node']`, and this project is `--app gjs`),
                    // while nothing wraps the windows layout at all. Byte-identical
                    // empty format lists, two different next steps.
                    assert.match(shipExpectingFailure(args, projectDir), UNPACKABLE[os]);
                }
            }
        });
    }

    // ── the darwin payload, read back by an independent parser ────────────

    it('reads every staged Mach-O back from Linux, and refuses an empty set', () => {
        const frameworks = join(stages.darwin, `${APP_NAME}.app`, 'Contents', 'Frameworks');
        const images = [];
        for (const rel of listPayload(stages.darwin)) {
            const info = readLibrary(join(stages.darwin, rel));
            if (info === null) continue;
            images.push([rel, info]);
        }
        // The discriminator. A `.app` staged from a payload with no native code
        // is a legal artifact, but a SUITE that asserts over zero images has
        // asserted nothing — and this fixture deliberately carries one.
        assert.ok(images.length > 0, 'no Mach-O reached the darwin stage — the oracle would be vacuous');

        for (const [rel, info] of images) {
            assert.equal(info.format, 'macho', `${rel} is not Mach-O`);
            assert.equal(info.os, 'darwin', `${rel} says it is for ${info.os}`);
            assert.equal(info.arch, ARCH, `${rel} is built for ${info.arch}`);
            // Where the layout claims it put them. `Contents/Frameworks` is the
            // half of this layout that a prefix substitution cannot express.
            assert.ok(join(stages.darwin, rel).startsWith(frameworks), `${rel} is not in Contents/Frameworks`);
        }
        console.log(`  read ${images.length} Mach-O image(s) with manifest-conformance/lib/binary.mjs`);
    });

    it('stages the Mach-O bytes unmodified — the pre-sign tree ADR 0024 § A4 describes', () => {
        // The baseline M6 will measure against: today `gjsify ship` copies a
        // Mach-O verbatim, so the stage digest and the source digest agree. When
        // the darwin leg re-signs the closure IN the stage, all of them change,
        // and that is the moment the arrival check has to become Mach-O-aware
        // rather than a per-file sha256.
        const staged = join(stages.darwin, `${APP_NAME}.app`, 'Contents', 'Frameworks', 'libgwebgl.dylib');
        assert.equal(sha256(staged), sha256(join(DARWIN_PREBUILD, 'libgwebgl.dylib')));
        const info = readLibrary(staged);
        // Already ad-hoc signed at bundle-build time, which is the fact § A4
        // turns into a design constraint. Read here so a change in that state is
        // noticed by the suite that stages it, not three milestones later.
        assert.equal(info.signed, true);
    });

    // ── what the layout axis must NOT have changed ────────────────────────

    it('a bare `gjsify ship` on Linux still defaults to exactly deb and rpm', () => {
        // The regression this milestone is most able to cause: three layouts
        // whose formats are all `finishOn: 'any'` would make one command emit
        // five artifacts. `defaultFormatIds` gained the layout as a SECOND
        // criterion so this list did not move.
        // `--arch` for the same reason every other run here passes it: this
        // fixture's payload is a real arm64 Mach-O, and the stage-time label
        // check two tests down refuses an x64 label over it. What is under test
        // is the FORMAT list, and the host's arch is not part of it.
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-default'], {
            cwd: projectDir,
        });
        const manifest = JSON.parse(
            readFileSync(join(projectDir, 'ship-default', 'stage', STAGE_MANIFEST_FILE), 'utf-8'),
        );
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
        assert.equal(manifest.target.os, 'linux');
        assert.deepEqual(listPayload(join(projectDir, 'ship-default', 'stage')), listPayload(stages.linux));
    });

    it('refuses to PACK what it cannot pack, rather than exiting 0 with nothing', () => {
        for (const os of ['darwin', 'windows']) {
            const output = shipExpectingFailure(['ship', os, '--skip-build', '--out', `pack-${os}`], projectDir);
            assert.match(output, UNPACKABLE[os]);
        }
    });

    it('refuses a --target belonging to another layout, and names both', () => {
        const output = shipExpectingFailure(
            ['ship', 'darwin', '--skip-build', '--stage', '--target', 'deb'],
            projectDir,
        );
        assert.match(output, /deb wraps the linux layout and this run assembles the darwin/);
    });

    it('stages every layout for a project that DECLARES `gjsify.app: "gjs"`', () => {
        // The regression this replaces refused exactly this project. Reading ADR
        // 0024 § 4's runtime table as a per-layout requirement made
        // `gjsify.app: "gjs"` — the honest declaration of the only build target
        // `ship` supports — an error for the macOS and Windows layouts, i.e. the
        // whole audience of the feature could not assemble either tree. Measured
        // then: exit 1. Measured now: three stages.
        const dir = scaffold(join(tmpDir, 'declared-gjs'), (pkg) => {
            pkg.gjsify.app = 'gjs';
        });
        for (const os of ['linux', 'darwin', 'windows']) {
            runCliSync(CLI_ENTRY, ['ship', os, '--skip-build', '--stage', '--out', `ship-${os}`], { cwd: dir });
        }
        const launcher = readFileSync(
            join(dir, 'ship-darwin', 'stage', `${APP_NAME}.app`, 'Contents', 'MacOS', BINARY),
            'utf-8',
        );
        assert.match(launcher, /exec gjs -m /);
    });

    it('stages a foreign layout for a project that configures `gjsify.ship.targets`', () => {
        // The other half of the same defect, and this repository was the proof:
        // `packages/infra/cli/package.json` declares `targets: ["deb", "rpm"]`,
        // and passing a configured list through the strict `--target` path made
        // `gjsify ship darwin --stage` exit 1 telling the author to run
        // `gjsify ship darwin --stage`. A configured list is a project DEFAULT,
        // so it is filtered to the layout; a typed `--target` still errors.
        const dir = scaffold(join(tmpDir, 'configured-targets'), (pkg) => {
            pkg.gjsify.ship.targets = ['deb', 'rpm'];
        });
        runCliSync(CLI_ENTRY, ['ship', 'darwin', '--skip-build', '--stage', '--out', 'ship-darwin'], { cwd: dir });
        const manifest = JSON.parse(readFileSync(join(dir, 'ship-darwin', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));
        assert.deepEqual(manifest.formats, []);
        assert.equal(manifest.target.os, 'darwin');
        // And the same project still packs its configured formats on Linux.
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--out', 'ship-linux'], { cwd: dir });
        // `all`, because THIS scaffold carries no native file — the arch label is
        // derived from the payload's bytes, not from the layout.
        assert.ok(existsSync(join(dir, 'ship-linux', 'out', 'ship-demo_1.2.3-1_all.deb')));
    });

    it('holds the payload against the arch label at STAGE time, not only at pack time', () => {
        // `assertPayloadMatchesArch` used to live only in `packOne`, which darwin
        // and windows stages never reach — so the one milestone in which the
        // STAGE is the deliverable was also the one where its label went
        // unchecked. Measured before this: `ship darwin --stage --arch x64` over
        // an arm64 Mach-O exited 0 and recorded `darwin-x64`, and
        // `--expect-target darwin-x64` then accepted the lie.
        for (const os of ['darwin', 'windows', 'linux']) {
            const output = shipExpectingFailure(
                ['ship', os, '--skip-build', '--stage', '--arch', 'x64', '--out', `mislabelled-${os}`],
                projectDir,
            );
            assert.match(output, /the payload is arm64, but the package would be labelled x64/);
        }
        // WHAT THIS DOES NOT PROVE: the fixture's native file is a Mach-O, so all
        // three legs exercise the LAYOUT and the same Mach-O branch of
        // `readBinaryArch`. When this was written that reader answered `null` for
        // PE, so a Windows payload whose one native file is a `.dll` could not trip
        // the check at all. #1354 M3 closed that: `readBinaryArch` reads the COFF
        // machine field now, `payload.spec.ts` covers the three PE machines, and
        // `tests/e2e/ship-windows` refuses an arm64 closure labelled x64 by name.
        // So the gap this paragraph recorded is somebody else's test now, not an
        // open item — what stays true is that THIS suite does not cover it.
    });

    it('classifies EVERY share/ entry the map carried, one severity apart', () => {
        // The half "same files, same bytes, modulo the map" is STRUCTURALLY BLIND
        // to, because sameness is the defect: most of these are correct on Linux
        // only because a .deb/.rpm scriptlet compiles or reindexes them at install
        // (`utils/ship/scripts.ts`), and two are freedesktop metadata neither OS
        // reads.
        //
        // Asserted against the CLI's own classifier and against the TREE, in both
        // directions: every `share/` file staged for a non-Linux layout — except
        // the one genuinely portable directory — must be named by the function.
        // The previous version compared a regex in this file against a count, so a
        // rule pointed at nothing changed neither side.
        for (const os of ['darwin', 'windows']) {
            const share = listPayload(stages[os]).filter(
                (rel) =>
                    /(^|\/)share\//.test(rel) &&
                    !rel.includes('/share/locale/') &&
                    !rel.startsWith('share/locale/') &&
                    // The compiled cache is the one `share/` file that is not a
                    // COST — it is what removes one, so `SHARE_PORTABLE` skips it
                    // and the warning never names it. Reported under a heading
                    // about files that need a package install step, it would name
                    // the fix as if it were the problem.
                    !rel.endsWith('gschemas.compiled'),
            );
            // The classifier reads PREFIX-RELATIVE paths, which is what `assemble`
            // hands it — the layout map runs after. Reconstructed here as the
            // Linux payload PLUS the cache #1354 M2a compiles into every
            // non-Linux stage, because that is the set `assemble` actually
            // classifies for these two layouts.
            const prefixRelative = [...listPayload(stages.linux), 'share/glib-2.0/schemas/gschemas.compiled'];
            const carried = linuxInstallDependent(prefixRelative.map((path) => ({ path })));
            assert.equal(carried.length, share.length, `${os}: ${share.length} share file(s), ${carried.length} named`);
            // ZERO aborting entries now, where M1 asserted exactly one. The schema
            // directory is the entry that used to kill the app at its first
            // `Gio.Settings.new()`, and M2a compiles the cache into the stage
            // rather than reclassifying the rule — which the next assertion is
            // what proves.
            assert.equal(carried.filter((entry) => entry.verdict === 'aborts').length, 0);
            const schemas = carried.find((entry) => entry.path.includes('glib-2.0/schemas'));
            assert.equal(schemas.verdict, 'inert');
            assert.match(schemas.why, /`gschemas\.compiled` is staged beside it/);
            // THE RULE STILL FIRES, which is the difference between fixing the
            // tree and deleting the check. Take the cache back out of the set and
            // the same classifier must say `aborts` again — otherwise M2a would
            // have bought a quiet warning rather than a working bundle.
            const withoutCache = linuxInstallDependent(listPayload(stages.linux).map((path) => ({ path })));
            assert.equal(withoutCache.filter((entry) => entry.verdict === 'aborts').length, 1);
            assert.ok(withoutCache[0].path.includes('glib-2.0/schemas'), 'the aborting entry must come first');
            // NO entry may be `unknown` for this fixture — every directory it
            // stages has a rule. This is the assertion that catches a rule
            // pointed at a directory matching nothing: the count alone does not,
            // because the exhaustive fallback still names the file, just with the
            // wrong verdict and the wrong reason. Measured both ways against the
            // built `lib/`.
            assert.deepEqual(
                carried.filter((entry) => entry.verdict === 'unknown').map((entry) => entry.path),
                [],
            );
        }
    });

    it('reports a share/ directory nothing classifies, rather than counting past it', async () => {
        // The allow-list direction, measured wrong: with a closed list of five, a
        // `share/dbus-1/services/*.service` added through `extraFiles` — meaningful
        // on Linux only because the package installs it into a system prefix —
        // left the warning still saying "carries 5 file(s)".
        const dir = scaffold(join(tmpDir, 'unclassified-share'), (pkg) => {
            pkg.gjsify.ship.extraFiles = { 'share/dbus-1/services/org.example.ShipDemo.service': 'data/svc' };
        });
        writeFileSync(join(dir, 'data', 'svc'), '[D-BUS Service]\n');
        const { status, stderr } = await runCliCapture(
            ['ship', 'darwin', '--skip-build', '--stage', '--out', 'ship'],
            dir,
        );
        assert.equal(status, 0);
        assert.match(stderr, /carries 6 file\(s\)/);
        assert.match(stderr, /UNCLASSIFIED: share\/dbus-1\/services\/org\.example\.ShipDemo\.service/);
    });

    // BOTH non-Linux layouts, not just darwin: the windows warning and its
    // `runtimeGap` went down a print path no test had ever executed.
    for (const [os, gap] of [
        ['darwin', /no RELOCATABLE GJS/],
        ['windows', /NO GJS host on Windows at all \(ADR 0024 § 4\)/],
    ]) {
        it(`${os}: SAYS so on the tree it staged, rather than leaving it in a comment`, async () => {
            const { status, stderr } = await runCliCapture(
                ['ship', os, '--skip-build', '--stage', '--arch', ARCH, '--out', `ship-notice-${os}`],
                projectDir,
            );
            assert.equal(status, 0);
            assert.match(stderr, /whose Linux correctness comes from a package install step/);
            // NO SEVERITY MARKER ANY MORE, and this is the assertion that changed
            // hands at #1354 M2a. M1 asserted `ABORTS:` here, because the staged
            // schema directory really did kill the app at its first
            // `Gio.Settings.new()`. M2a compiles the cache into the stage, so the
            // marker would now be a lie — and the warning that keeps its severity
            // after the severity is gone is the one nobody reads when it comes
            // back.
            assert.ok(!stderr.includes('ABORTS:'), 'the schema directory no longer aborts — the marker must go');
            assert.match(stderr, /`gschemas\.compiled` is staged beside it and that is what GSettings reads/);
            assert.match(stderr, gap);
            // The citation is ADR 0024 § 4 and not `docs/ci-selective.md`, which
            // contains no occurrence of the fact this string asserts.
            assert.ok(!stderr.includes('ci-selective'), 'the runtime gap must not cite a file without the fact');
        });
    }

    it('linux says neither: it has the install step and it has the runtime', async () => {
        const { status, stderr } = await runCliCapture(
            ['ship', 'linux', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-notice-linux'],
            projectDir,
        );
        assert.equal(status, 0);
        assert.ok(!stderr.includes('whose Linux correctness'));
        assert.ok(!stderr.includes('ABORTS:'));
    });

    it('takes `win32` as well as `windows`, because --expect-target prints the first', () => {
        runCliSync(CLI_ENTRY, ['ship', 'win32', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-win32'], {
            cwd: projectDir,
        });
        assert.deepEqual(listPayload(join(projectDir, 'ship-win32', 'stage')), listPayload(stages.windows));
    });
});
