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
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCliSync } from '../mock-registry.mjs';
import { APP_ID, CLI_ENTRY, MONOREPO_ROOT, listPayload, scaffold, STAGE_MANIFEST_FILE } from '../ship/fixture.mjs';

const { readLibrary } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')).href
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

/** `<os>` → the `${process.platform}-${process.arch}` string its stage manifest records. */
const TARGET = { linux: `linux-${ARCH}`, darwin: `darwin-${ARCH}`, windows: `win32-${ARCH}` };

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Run the CLI expecting a REFUSAL, and return everything it said.
 *
 * `runCliSync` throws on a non-zero exit and hangs the output off the error, so
 * a refusal has to be caught to be read. `assert.fail` inside the `try` is what
 * makes a run that unexpectedly SUCCEEDS fail the test — without it, a broken
 * gate reads as a passing assertion about an error that never happened.
 */
function shipExpectingFailure(args, cwd) {
    try {
        runCliSync(CLI_ENTRY, args, { cwd });
    } catch (error) {
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    assert.fail(`expected \`gjsify ${args.join(' ')}\` to fail`);
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
        it(`the ${os} file set is the Linux one modulo the layout map`, () => {
            const expected = listPayload(stages.linux).map(LAYOUT_MAP[os]).sort();
            assert.deepEqual(listPayload(stages[os]), expected);
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

    it('darwin: no readlink -f, no DYLD_, and the payload interpreter against Contents/Resources', () => {
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
        // `gjs -m`, on the macOS form too: the launcher execs what `settings.app`
        // says the payload was BUILT for, never what the layout's row says a
        // shipped artifact will eventually carry — see `execLine` in launcher.ts.
        assert.match(launcher, /exec gjs -m "\$contents\/Resources\/lib\/gjs\.js" "\$@"/);
    });

    it('windows: a CRLF .cmd that derives the program directory from %~dp0', () => {
        const raw = readFileSync(join(stages.windows, `${BINARY}.cmd`));
        const text = raw.toString('utf-8');
        assert.ok(text.startsWith('@echo off\r\n'), 'a batch file cmd.exe re-seeks through needs CRLF');
        assert.equal(raw.includes(0x0a) && !text.includes('\n\r'), true);
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
                // A matching target gets PAST the target check. Whether the run
                // then packs is a different question — darwin and windows have
                // no format yet, so those two still exit non-zero — which is why
                // the assertion is that the refusal is not THIS one.
                let output;
                try {
                    output = runCliSync(CLI_ENTRY, args, { cwd: projectDir });
                } catch (error) {
                    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
                }
                assert.ok(!output.includes('--expect-target'), `${os}: ${target} should have been accepted`);
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
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--out', 'ship-default'], { cwd: projectDir });
        const manifest = JSON.parse(
            readFileSync(join(projectDir, 'ship-default', 'stage', STAGE_MANIFEST_FILE), 'utf-8'),
        );
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
        assert.equal(manifest.target.os, 'linux');
        assert.deepEqual(listPayload(join(projectDir, 'ship-default', 'stage')), listPayload(stages.linux));
    });

    it('refuses to PACK a layout no format wraps, rather than exiting 0 with nothing', () => {
        for (const os of ['darwin', 'windows']) {
            const output = shipExpectingFailure(['ship', os, '--skip-build', '--out', `pack-${os}`], projectDir);
            assert.match(output, /no format wraps the .* layout yet/);
        }
    });

    it('refuses a --target belonging to another layout, and names both', () => {
        const output = shipExpectingFailure(
            ['ship', 'darwin', '--skip-build', '--stage', '--target', 'deb'],
            projectDir,
        );
        assert.match(output, /deb wraps the linux layout and this run assembles the darwin/);
    });

    it('takes `win32` as well as `windows`, because --expect-target prints the first', () => {
        runCliSync(CLI_ENTRY, ['ship', 'win32', '--skip-build', '--stage', '--arch', ARCH, '--out', 'ship-win32'], {
            cwd: projectDir,
        });
        assert.deepEqual(listPayload(join(projectDir, 'ship-win32', 'stage')), listPayload(stages.windows));
    });
});
