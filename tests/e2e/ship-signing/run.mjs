// E2E test for `gjsify ship --sign` / `--notarize` — ADR 0024 § A12–§ A17, issue #1354 M6.
//
// WHAT THIS SUITE IS, AND WHAT IT DELIBERATELY IS NOT
//
// It has two halves, and they measure different things on purpose:
//
//   * THE HALF THAT RUNS EVERYWHERE. The flag surface, every refusal, the loud
//     skip, the arrival comparator's red and green runs, and § A17's ordering
//     constraint measured against `readStage`. All of it is deterministic on
//     Linux, which is where every CI leg is — and none of it claims anything
//     about macOS.
//   * THE HALF THAT NEEDS `codesign`. Signing a real Mach-O closure ad-hoc
//     inside the payload and reading the arrival back. It runs only where
//     `codesign` exists, i.e. on a macOS host.
//
// AND THE SECOND HALF CANNOT SILENTLY NOT RUN. `GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1`
// turns "no codesign here" into a failure, and that is how the macOS CI leg
// invokes this file. Without it a broken darwin leg would report green having
// skipped the only thing it was added for — the failure class this repository
// calls green-CI-that-checked-nothing, and the one every ship suite is written
// against.
//
// WHY AD-HOC IS ENOUGH, AND WHY IT IS THE POINT (§ A17). `codesign --sign -`
// needs no Apple Developer Program membership: `docs/poc/webkit-hardened-runtime-darwin.sh`
// uses it "because it needs no developer identity, so this runs on any machine
// and in CI", and `refs/node/test/common/sea.js` does the same in a test helper.
// So the whole pipeline plus its oracle is a green CI leg with NO SECRET IN IT.
// A real Developer ID later is a different VALUE for the same flag, not a
// different code path — which is exactly what the config-resolution tests below
// hold the implementation to.
//
// WHAT IS NOT PROVEN HERE, stated rather than implied:
//   * Windows. `signtool` has no ad-hoc mode and needs a certificate, so the
//     flag, the config default, the skip and the refusals are covered and the
//     INVOCATION is not. Marked UNVERIFIED on `SIGNERS.win32` too.
//   * Notarisation. It needs an Apple account, which is the credential § A17
//     says M6 does without. The argv, the guard and both refusals are covered;
//     `xcrun notarytool` has never run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    appendFileSync,
    cpSync,
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

import { hasCommand } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';
import { CLI_ENTRY, MONOREPO_ROOT, NODE_BUNDLE, scaffold } from '../ship/fixture.mjs';
import { signedMachO, TEXT_BODY_OFFSET } from '../macho.mjs';

const APP_NAME = 'Ship Demo';
const BINARY = 'ship-demo';
const COMPARATOR = join(MONOREPO_ROOT, '.github', 'ship-oracle', 'verify-signed-arrival.mjs');

/**
 * `codesign` is the whole of the darwin half.
 *
 * `xcrun -f codesign` is deliberately NOT how this is asked: `xcrun` resolves
 * through the active developer directory and answers for a toolchain that may
 * not be on `PATH`, while what the CLI execs is the bare name.
 */
const HAS_CODESIGN = hasCommand('codesign');
const REQUIRE_CODESIGN = process.env.GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN === '1';

/** The `--app node` project the darwin formats need (`interpreters: ['node']`). */
function scaffoldNodeApp(dir, shipExtras = {}) {
    return scaffold(dir, (pkg, at) => {
        pkg.gjsify.app = 'node';
        pkg.gjsify.main = 'dist/app.node.mjs';
        pkg.main = 'dist/app.node.mjs';
        Object.assign(pkg.gjsify.ship, shipExtras);
        writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
    });
}

/**
 * A synthetic Mach-O in the payload, so the signer has something to INVOKE
 * `codesign` on.
 *
 * MEASURED ON THE FIRST DARWIN RUN, and it is why this exists: with no image in
 * the payload the signer prints *"nothing in this payload is a Mach-O image, so
 * codesign signed 0 file(s)"* and exits 0 — correctly, because a `--app gjs`
 * payload really is JavaScript and a launcher. An identity is only ever
 * validated by the tool that consumes it, so a run with nothing to sign cannot
 * tell a real Developer ID from `Nobody At All`. Both refusals below therefore
 * need a signable file, and they get a SYNTHETIC one rather than a compiled
 * dylib: they are about the IDENTITY, they must fail on Linux too (where they
 * never reach `codesign` at all), and `cc` is not on every host that runs this.
 */
function plantSyntheticImage(project) {
    mkdirSync(join(project, 'native'), { recursive: true });
    writeFileSync(
        join(project, 'native', 'libsynthetic.dylib'),
        signedMachO({ signature: Buffer.alloc(64, 0xaa), uuid: Buffer.alloc(16, 0x33), arch: 'x64' }),
    );
}

/** The `extraFiles` block staging {@link plantSyntheticImage}'s file into `Contents/Frameworks`. */
const SYNTHETIC_IMAGE_FILES = { [`lib/${BINARY}/gi/libsynthetic.dylib`]: 'native/libsynthetic.dylib' };

/** Run the CLI and require it to FAIL, returning everything it said. */
async function shipFailing(args, cwd) {
    const result = await runCli(CLI_ENTRY, args, { cwd, timeoutMs: 300_000 });
    assert.notEqual(result.status, 0, `expected \`gjsify ${args.join(' ')}\` to fail:\n${result.stdout}`);
    return `${result.stdout}${result.stderr}`;
}

/** Run the CLI and require it to SUCCEED, returning both streams separately. */
async function shipOk(args, cwd) {
    const result = await runCli(CLI_ENTRY, args, { cwd, timeoutMs: 300_000 });
    assert.equal(result.status, 0, `\`gjsify ${args.join(' ')}\` failed:\n${result.stdout}\n${result.stderr}`);
    return result;
}

/** The comparator, expecting exit 0. */
function compare(args) {
    return execFileSync(process.execPath, [COMPARATOR, ...args], { encoding: 'utf-8' });
}

/**
 * The comparator, expecting a REFUSAL.
 *
 * `assert.fail` inside the `try` is what makes an unexpectedly-successful run
 * fail the test: without it a comparator that stopped comparing would read here
 * as a passing assertion about an error that never happened.
 */
function compareExpectingFailure(args) {
    try {
        compare(args);
    } catch (error) {
        assert.equal(error.status, 1, `the comparator must exit 1, not ${error.status}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected the comparator to refuse ${args.join(' ')}`);
}

describe('CLI ship signing E2E', { timeout: 20 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gjsify-ship-signing-'));
    });
    after(() => {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    });

    // ── the flag surface (ADR 0024 § A12–§ A15) ─────────────────────────────
    describe('the flag surface', () => {
        it('refuses --sign on the phase that produces nothing to sign', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'stage-sign-')));
            const said = await shipFailing(['ship', 'darwin', '--stage', '--skip-build', '--sign', '-'], project);
            assert.match(said, /--sign belongs to the finish phase/);
            assert.match(said, /--from-stage/);
        });

        it('refuses --sign for a layout whose artifact carries no signature', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'linux-sign-')));
            const said = await shipFailing(
                ['ship', 'linux', '--target', 'deb', '--skip-build', '--sign', 'Whoever'],
                project,
            );
            // The message has to name the mechanism, not merely refuse: a `.deb`
            // IS signed, by the repository that serves it, and a reader who is
            // told only "not supported" reasonably concludes the opposite.
            assert.match(said, /--sign has nothing to sign in the linux layout/);
            assert.match(said, /debsigs/);
        });

        it('refuses --notarize without an identity to sign with', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'notarize-alone-')));
            const said = await shipFailing(
                ['ship', 'darwin', '--target', 'macos-app', '--skip-build', '--arch', 'x64', '--notarize', 'profile'],
                project,
            );
            assert.match(said, /--notarize was given without an identity to sign with/);
        });

        it('refuses --notarize for a layout Apple does not notarise', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'notarize-win-')));
            const said = await shipFailing(
                ['ship', 'windows', '--target', 'windows-dir', '--skip-build', '--arch', 'x64', '--notarize', 'p'],
                project,
            );
            assert.match(said, /--notarize has no meaning in the win32 layout/);
        });

        it('skips loudly and exits 0 when no identity is given', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'unsigned-')));
            const result = await shipOk(
                ['ship', 'darwin', '--target', 'macos-app', '--skip-build', '--arch', 'x64'],
                project,
            );
            // § A13's three properties, each asserted separately because each was
            // a decision: not an error, printed, and on stderr.
            assert.match(result.stderr, /no identity was given — skipping codesign/);
            assert.match(result.stderr, /legitimate deliverable/);
            assert.doesNotMatch(result.stdout, /skipping codesign/);
            assert.ok(existsSync(join(project, 'ship', 'out', `${APP_NAME}.app`)), 'the unsigned artifact is built');
        });

        it('skips loudly when the project declares an EMPTY identity', async () => {
            // The reference's `[ -z "$SIGN" ]`, reached from the config side. A
            // declared-but-empty key is the shape a CI job produces when the
            // variable it interpolates is unset, and it must not read as "signed".
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'empty-identity-')), {
                sign: { darwin: { identity: '' } },
            });
            const result = await shipOk(
                ['ship', 'darwin', '--target', 'macos-app', '--skip-build', '--arch', 'x64'],
                project,
            );
            assert.match(result.stderr, /an empty identity was set in `gjsify\.ship\.sign\.darwin\.identity`/);
        });

        it('resolves the identity from gjsify.ship.sign.<os>.identity', async () => {
            // A REAL Developer ID string, and the assertion is that the run gets
            // as far as needing a keychain — which is what makes "a real
            // Developer ID later is a different VALUE for the same flag" (§ A17)
            // a checked claim rather than a hope. On Linux the refusal names the
            // host; on macOS it names the tool or the identity.
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'config-identity-')), {
                sign: { darwin: { identity: 'Developer ID Application: Example GmbH (ABCDE12345)' } },
                extraFiles: SYNTHETIC_IMAGE_FILES,
            });
            plantSyntheticImage(project);
            const said = await shipFailing(
                ['ship', 'darwin', '--target', 'macos-app', '--skip-build', '--arch', 'x64'],
                project,
            );
            assert.match(said, /codesign/);
            if (process.platform !== 'darwin') {
                assert.match(said, /which runs on darwin and this host is linux/);
                // NOT "unsigned artifact produced anyway": a declared identity
                // this host cannot honour has to stop the run.
                assert.doesNotMatch(said, /skipping codesign/);
            }
        });

        it('lets --sign override the project default', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'flag-wins-')), {
                sign: { darwin: { identity: 'Developer ID Application: Example GmbH (ABCDE12345)' } },
            });
            const result = await runCli(
                CLI_ENTRY,
                ['ship', 'darwin', '--target', 'macos-app', '--skip-build', '--arch', 'x64', '--sign', ''],
                { cwd: project, timeoutMs: 300_000 },
            );
            assert.equal(result.status, 0, `an empty --sign must skip, not fail:\n${result.stderr}`);
            assert.match(result.stderr, /an empty identity was passed to --sign/);
        });
    });

    // ── the order § A17 fixes ───────────────────────────────────────────────
    describe('the ordering constraint § A17 states', () => {
        it('readStage refuses a stage whose file SIZE changed', async () => {
            // The measurement behind § A17: `readStage` compares SIZES against
            // `.gjsify-ship-stage.json`, so a stage that was re-signed in place
            // is refused before it can be packed — whether a Developer ID
            // signature happens to be the same length as the ad-hoc one it
            // replaces is not measured anywhere and the design must not bet on
            // it. This is why the signer takes `readStage`'s OUTPUT and writes to
            // scratch, and never touches the arriving stage.
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'order-')));
            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', 'x64'], project);
            const stage = join(project, 'ship', 'stage');
            appendFileSync(join(stage, `${APP_NAME}.app`, 'Contents', 'MacOS', BINARY), '\n');
            const said = await shipFailing(['ship', '--from-stage', stage, '--target', 'macos-app'], project);
            assert.match(said, /bytes in the stage and \d+ in its manifest/);
        });

        it('leaves the arriving stage untouched when it signs', async () => {
            // The other half of the same property, and the one a reader cannot
            // get from the refusal above: a signed run must be re-runnable. If
            // the signer wrote into the stage, the SECOND `--from-stage` would
            // fail the size check — so this passes only because the mutation
            // happens in scratch.
            if (!HAS_CODESIGN) return;
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'rerun-')));
            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', process.arch], project);
            const stage = join(project, 'ship', 'stage');
            await shipOk(['ship', '--from-stage', stage, '--target', 'macos-app', '--sign', '-'], project);
            await shipOk(['ship', '--from-stage', stage, '--target', 'macos-app', '--sign', '-'], project);
        });
    });

    // ── the arrival comparator, red before green ────────────────────────────
    describe('the arrival comparator', () => {
        const uuidA = Buffer.alloc(16, 0x11);
        const uuidB = Buffer.alloc(16, 0x22);

        /** Two trees: `before/` as staged, `after/` as a signer that behaved would leave it. */
        function trees(name) {
            const root = join(tmpDir, `cmp-${name}`);
            const b = join(root, 'before');
            const a = join(root, 'after');
            mkdirSync(join(b, 'Contents', 'MacOS'), { recursive: true });
            mkdirSync(join(a, 'Contents', 'MacOS'), { recursive: true });
            const image = signedMachO({ signature: Buffer.alloc(64, 0xaa), uuid: uuidA });
            const resigned = signedMachO({ signature: Buffer.alloc(96, 0xbb), uuid: uuidB });
            writeFileSync(join(b, 'Contents', 'MacOS', 'libdemo.dylib'), image);
            writeFileSync(join(a, 'Contents', 'MacOS', 'libdemo.dylib'), resigned);
            writeFileSync(join(b, 'Contents', 'MacOS', BINARY), '#!/bin/sh\nexec ./node "$@"\n');
            writeFileSync(join(a, 'Contents', 'MacOS', BINARY), '#!/bin/sh\nexec ./node "$@"\n');
            writeFileSync(join(b, 'Contents', 'Info.plist'), '<plist/>\n');
            writeFileSync(join(a, 'Contents', 'Info.plist'), '<plist/>\n');
            return [b, a];
        }

        it('accepts a tree that changed only inside the signature', () => {
            const [b, a] = trees('green');
            const out = compare([b, a, '--min-signed', '1']);
            assert.match(out, /2 identical, 1 signature-only, 0 declared-added, 0 problem/);
            // Two non-Mach-O files were compared and one image — the count is in
            // the line, so a comparator that silently stopped walking is visible.
            assert.match(out, /signature-only: Contents\/MacOS\/libdemo\.dylib/);
        });

        it('refuses a Mach-O whose __TEXT changed', () => {
            const [b, a] = trees('text');
            const file = join(a, 'Contents', 'MacOS', 'libdemo.dylib');
            const bytes = readFileSync(file);
            bytes[TEXT_BODY_OFFSET + 3] ^= 0xff;
            writeFileSync(file, bytes);
            const said = compareExpectingFailure([b, a]);
            assert.match(said, /first difference outside the signature at file offset/);
        });

        it('refuses a Mach-O whose signature was REMOVED rather than replaced', () => {
            const [b, a] = trees('unsigned');
            // A tree that arrived with the load command gone is not "identical
            // outside the signature" — every byte after the header moved — and
            // reporting it as a shifted diff would be unreadable.
            writeFileSync(join(a, 'Contents', 'MacOS', 'libdemo.dylib'), Buffer.from('not a mach-o at all'));
            const said = compareExpectingFailure([b, a]);
            assert.match(said, /not comparable as Mach-O|bytes changed/);
        });

        it('refuses a non-Mach-O file whose bytes changed', () => {
            const [b, a] = trees('plist');
            writeFileSync(join(a, 'Contents', 'Info.plist'), '<plist><!-- edited --></plist>\n');
            const said = compareExpectingFailure([b, a]);
            assert.match(said, /is not a Mach-O image and its bytes changed/);
        });

        it('refuses a file that appeared, and accepts one that was declared', () => {
            const [b, a] = trees('added');
            mkdirSync(join(a, 'Contents', 'Resources'), { recursive: true });
            writeFileSync(join(a, 'Contents', 'Resources', 'LICENSE'), 'MIT\n');
            const said = compareExpectingFailure([b, a]);
            assert.match(said, /is in the signed tree and not in the tree it was signed from/);
            assert.match(compare([b, a, '--allow-added', 'Contents/Resources/LICENSE']), /1 declared-added/);
        });

        it('refuses a file that vanished', () => {
            const [b, a] = trees('removed');
            rmSync(join(a, 'Contents', 'Info.plist'));
            const said = compareExpectingFailure([b, a]);
            assert.match(said, /missing from the signed one/);
        });

        it('refuses a run in which nothing was signed at all — the anti-vacuity floor', () => {
            // THE RED THAT MATTERS MOST. A comparator over a tree nothing touched
            // reports "everything identical" and exits 0, which is the loudest
            // possible instance of this repository's most expensive failure
            // class. `--min-signed` is what stops it, so it is watched failing.
            const [b] = trees('vacuous');
            const said = compareExpectingFailure([b, b, '--min-signed', '1']);
            assert.match(said, /came back signature-only and at least 1 was required/);
        });
    });

    // ── ad-hoc signing, on a host that has codesign ─────────────────────────
    describe('ad-hoc signing a real Mach-O closure', () => {
        it('has codesign, or says the leg proved nothing', () => {
            if (HAS_CODESIGN) return;
            assert.equal(
                REQUIRE_CODESIGN,
                false,
                'GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1 was set and `codesign` is not on PATH — this leg was ' +
                    'asked to prove the darwin half and could not run a single assertion of it.',
            );
            console.log('    (no codesign on this host: the darwin half of this suite did not run)');
        });

        it('signs every image, changes nothing else, and codesign verifies the result', async () => {
            if (!HAS_CODESIGN) return;
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'adhoc-')), {
                extraFiles: {
                    [`lib/${BINARY}/gi/libmarked.dylib`]: 'native/libmarked.dylib',
                    [`lib/${BINARY}/gi/libplain.dylib`]: 'native/libplain.dylib',
                },
            });
            mkdirSync(join(project, 'native'), { recursive: true });
            const source = join(project, 'native', 'demo.c');
            writeFileSync(source, 'int gjsify_ship_demo(void) { return 42; }\n');
            for (const leaf of ['libmarked.dylib', 'libplain.dylib']) {
                execFileSync('cc', ['-dynamiclib', '-o', join(project, 'native', leaf), source], { stdio: 'pipe' });
            }
            // PRE-SIGNED, and with a marker identifier on one of the two, because
            // the state this leg has to reproduce is the shipped closure's: § A4
            // measured 106 of 106 darwin images already carrying an ad-hoc
            // `LC_CODE_SIGNATURE`, because `install_name_tool` invalidates the
            // original during relocation and the relocator re-signs. A fresh
            // `cc` output would put the pipeline in front of a case that never
            // occurs. The marker also guarantees the re-sign is OBSERVABLE: an
            // ad-hoc signature over an unchanged file is reproducible, so without
            // a differing identifier the new blob can come out byte-identical
            // and `signature-only` would never be reached.
            execFileSync(
                'codesign',
                [
                    '--force',
                    '--sign',
                    '-',
                    '--identifier',
                    'gjsify.pre-stage.marker',
                    join(project, 'native', 'libmarked.dylib'),
                ],
                { stdio: 'pipe' },
            );
            execFileSync('codesign', ['--force', '--sign', '-', join(project, 'native', 'libplain.dylib')], {
                stdio: 'pipe',
            });

            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', process.arch], project);
            const stage = join(project, 'ship', 'stage');
            const staged = join(stage, `${APP_NAME}.app`);

            // WHAT AN AD-HOC RE-SIGN DOES TO A FILE'S SIZE — the number § A17
            // says the design must not depend on, measured rather than assumed.
            const scratch = join(project, 'size-probe.dylib');
            cpSync(join(staged, 'Contents', 'Frameworks', 'libmarked.dylib'), scratch);
            const sizeBefore = statSync(scratch).size;
            execFileSync('codesign', ['--force', '--sign', '-', scratch], { stdio: 'pipe' });
            const sizeAfter = statSync(scratch).size;
            // MEASURED darwin-arm64 / macos-latest, 2026-08-30: 34816 -> 34848,
            // delta +32. So an ad-hoc re-sign is NOT size-preserving, and
            // `readStage`'s size comparison WOULD refuse a stage re-signed in
            // place — § A17's ordering is required, not defensive. Printed and
            // asserted nowhere all the same: the design is correct either way,
            // and an assertion on it would be a claim about codesign's blob
            // layout rather than about this command.
            console.log(
                `    ad-hoc re-sign size: ${sizeBefore} -> ${sizeAfter} bytes (delta ${sizeAfter - sizeBefore})`,
            );

            const packed = await shipOk(
                ['ship', '--from-stage', stage, '--target', 'macos-app', '--sign', '-', '--verbose'],
                project,
            );
            // A FLOOR, not an equality. The two dylibs are what this fixture
            // plants, and `resolveCarriedRuntime` may stage an interpreter
            // beside them when the workspace's `@gjsify/node-runtime-darwin-*`
            // payload happens to be fetched — a number that depends on the
            // runner's state is a number this assertion must not encode.
            const signedLine = /codesign signed (\d+) of \d+ payload file\(s\) as ad-hoc/.exec(packed.stdout);
            assert.ok(signedLine, `no signing line in:\n${packed.stdout}`);
            assert.ok(
                Number(signedLine[1]) >= 2,
                `codesign signed ${signedLine[1]} file(s); the fixture plants two Mach-O images`,
            );

            const artifact = join(project, 'ship', 'out', `${APP_NAME}.app`);
            // APPLE'S OWN READER, on the artifact rather than on the scratch tree:
            // our comparator says the mutation was confined, `codesign --verify`
            // says the signature it made is a valid one. Neither answers the
            // other's question.
            for (const leaf of ['libmarked.dylib', 'libplain.dylib']) {
                execFileSync('codesign', ['--verify', '--strict', join(artifact, 'Contents', 'Frameworks', leaf)], {
                    stdio: 'pipe',
                });
            }

            // THE ARRIVAL. The format's overlay licence is legitimately NEW in
            // the artifact — it is planned per format and merged in `packOne`,
            // so it is in the artifact and not in the stage — and it is
            // therefore DECLARED rather than tolerated. An undeclared addition
            // is a failure, which is what the first darwin run demonstrated.
            const report = compare([
                staged,
                artifact,
                '--allow-added',
                // WHERE THE OVERLAY ACTUALLY LANDS, measured rather than guessed:
                // `planOverlay` writes `macos-app`'s licence at the format's own
                // prefix-relative destination (`share/licenses/<binary>/LICENSE`)
                // and `place()` then maps `share/` onto `Contents/Resources/`.
                // The first darwin run got this wrong and the comparator named
                // the exact path — the mechanism working, not a fixture detail.
                `Contents/Resources/share/licenses/${BINARY}/LICENSE`,
                '--min-signed',
                '1',
            ]);
            // POSITIVE, and the counts are named. `assert.doesNotMatch(…, /problem/)`
            // was the first cut and it is the wrong shape twice over: the summary
            // line says "0 problem(s)" on a clean run, so the assertion failed on
            // a PASS — measured on the darwin leg — and `compare()` already throws
            // on a non-zero exit, so the negative was checking nothing that was
            // not already checked.
            //
            // `libmarked` is `signature-only` and `libplain` is `identical`, which
            // is the predicted split rather than a surprise: an ad-hoc signature
            // over an unchanged file is reproducible, so only the image whose
            // previous signature carried a different `--identifier` comes back
            // with different bytes. That is exactly what the marker is for, and
            // asserting BOTH is what makes the fixture's reason checkable.
            assert.match(report, /signature-only: Contents\/Frameworks\/libmarked\.dylib/);
            assert.match(report, /\d+ identical, 1 signature-only, 1 declared-added, 0 problem\(s\)/, report);
        });

        it('refuses an identity this host does not hold', async () => {
            // The discriminator for every assertion above: without it, a signing
            // step that had silently become a no-op would leave the whole darwin
            // half green — the comparator would report "all identical" and
            // `codesign --verify` would pass on the signatures the FIXTURE made.
            if (!HAS_CODESIGN) return;
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'no-identity-')), {
                extraFiles: SYNTHETIC_IMAGE_FILES,
            });
            plantSyntheticImage(project);
            // `--arch x64` matches the synthetic image's `cputype`, not the host:
            // `assertPayloadMatchesArch` compares the payload with the LABEL, and
            // a label is not a claim about where the stage was assembled.
            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', 'x64'], project);
            const said = await shipFailing(
                [
                    'ship',
                    '--from-stage',
                    join(project, 'ship', 'stage'),
                    '--target',
                    'macos-app',
                    '--sign',
                    'Developer ID Application: Nobody At All (ZZZZZZZZZZ)',
                ],
                project,
            );
            assert.match(said, /codesign/);
        });
    });
});
