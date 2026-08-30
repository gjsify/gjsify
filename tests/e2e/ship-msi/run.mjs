// E2E test for the Windows installer — ADR 0024 stage 5, issue #1354 M5.
//
// WHAT M3 LEFT AND THIS CLOSES. `gjsify ship windows` produces a program
// directory and a zip around it. Both are usable, and neither does the three
// things a Windows user expects of an application: land somewhere the machine
// knows about, appear in the Start Menu, and come off again. This adds the third
// row over that layout — `msi` — and every assertion below is about one of those
// three or about the artifact being the same payload as the other two.
//
// WHAT THIS SUITE IS, EXACTLY, AND WHAT IT IS NOT. `wixl` compiles here and
// `msiinfo` reads back, and those are two programs out of ONE package
// (`msitools`). Read as "the artifact was verified", that would be a self-oracle
// — the thing ADR 0024 § A3 names and § A6 designed this format's backends
// around. So the honest split, and the suite is written to it:
//
//   * what runs HERE is a VALIDATION of the authored document. `wixl` is a second
//     implementation of WiX v3's schema: a `.wxs` it refuses is a `.wxs` this tree
//     got wrong, and that failure is loud. Everything the suite then asserts with
//     `msiinfo` is "the compiler put our rows where we said", which is a real
//     question about `utils/ship/msi.ts` and a weak one about the MSI format.
//   * the ORACLE is elsewhere and is two legs. `msiexec` INSTALLS the wixl-built
//     file on `windows-latest` and the leg RUNS the installed launcher, then
//     removes it and asserts nothing is left; and a Linux job reads back, with
//     `msiinfo`, the file WiX v3 built on that runner from the SAME document.
//     Neither is a package agreeing with itself. Both are in
//     `.github/workflows/node-gi.yml`.
//
// A LINUX-GREEN RUN IS NOT EVIDENCE ABOUT WINDOWS. Nothing below installs
// anything. Whether the database Windows Installer receives does what it says is
// the same assertion on another OS, and it is a leg, not a test.
//
// AND EVERY ORACLE CALL IS WATCHED RED. Each green `verify-msi.sh` run has a
// sibling that mutates a COPY of the pair and asserts exit 1 — a file removed from
// the directory, a producer the file does not claim, an architecture it was not
// built for. Without those, a script returning 0 unconditionally would leave this
// whole file green.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliSync } from '../mock-registry.mjs';
import { CLI_ENTRY, listFiles, MONOREPO_ROOT, probe } from '../ship/fixture.mjs';
import { APP_NAME, ARCH, BINARY, installRuntimePackages, scaffoldNodeApp } from '../ship/windows-fixture.mjs';

const MSI_NAME = `${BINARY}-1.2.3-1.${ARCH}.msi`;
const ORACLE = join(MONOREPO_ROOT, '.github', 'ship-oracle');

/**
 * The two programs `msitools` ships, and they are REQUIRED on Linux rather than
 * probed.
 *
 * `.docker/ci-fedora.Dockerfile` bakes the package, so an absence here is a
 * broken image and not a lean one — and a silent skip would leave every assertion
 * below vacuous, which is `fixture.mjs`'s `probe()` rule for exactly this family.
 */
const READERS = ['wixl', 'msiinfo', 'msiextract'];

function oracle(args) {
    return execFileSync('bash', [join(ORACLE, 'verify-msi.sh'), ...args], { encoding: 'utf-8' });
}

function oracleExpectingFailure(args) {
    try {
        oracle(args);
    } catch (error) {
        assert.equal(error.status, 1, `verify-msi.sh must exit 1, not ${error.status}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected verify-msi.sh to refuse ${args.join(' ')}`);
}

function shipExpectingFailure(args, cwd) {
    try {
        runCliSync(CLI_ENTRY, args, { cwd });
    } catch (error) {
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return assert.fail(`expected \`gjsify ${args.join(' ')}\` to fail`);
}

/**
 * One table out of the database, as rows of columns.
 *
 * `msiinfo export` writes the MSI **IDT** text format, whose terminator is CRLF by
 * specification. The `\r` therefore lands on the LAST column of every row, which
 * makes a comparison between two tables fail on rows that agree — the defect this
 * suite's first run found in `verify-msi.sh`. Three header lines come first: the
 * column names, the column types, and a `<table>\t<key columns>` line.
 */
function table(msi, name) {
    return execFileSync('msiinfo', ['export', msi, name], { encoding: 'utf-8' })
        .replace(/\r/g, '')
        .split('\n')
        .slice(3)
        .filter((line) => line.trim().length > 0)
        .map((line) => line.split('\t'));
}

describe('CLI ship Windows installer E2E', () => {
    let tmpDir;
    let projectDir;
    let programDir;
    let msi;
    let wxs;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        for (const tool of READERS) {
            if (!probe(tool) && process.platform === 'linux') {
                throw new Error(
                    `${tool} is not on PATH. It is how this suite builds and reads the artifact, so skipping ` +
                        'it would make every assertion behind it vacuous. `msitools` is baked into ' +
                        '.docker/ci-fedora.Dockerfile.',
                );
            }
        }
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-msi-'));
        projectDir = installRuntimePackages(scaffoldNodeApp(join(tmpDir, 'app')));
        // BOTH ROWS, in one run. `windows-dir` is what the installer is compared
        // against — the whole point of the format is that it carries the same tree
        // — so asking for only `msi` would leave nothing to compare with.
        runCliSync(
            CLI_ENTRY,
            ['ship', 'windows', '--skip-build', '--arch', ARCH, '--target', 'windows-dir,msi'],
            { cwd: projectDir },
        );
        programDir = join(projectDir, 'ship', 'out', APP_NAME);
        msi = join(projectDir, 'ship', 'out', MSI_NAME);
        wxs = join(projectDir, 'ship', 'msi', `${BINARY}.wxs`);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── the artifact exists and a second implementation accepted our document ──

    it('compiles the authored .wxs into a single-file installer', () => {
        // `wixl` exiting 0 IS the assertion here, and it is not ours: a document
        // with an illegal identifier, a duplicate row or an unknown element is
        // refused by it, and this run is the first thing that would notice.
        assert.ok(existsSync(msi), `${MSI_NAME} was not produced`);
        assert.ok(statSync(msi).size > 0);
        // The Compound File Binary magic. A `.msi` is a CFB container, and the
        // first eight bytes are what every reader dispatches on.
        assert.deepEqual([...readFileSync(msi).subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    });

    it('keeps the .wxs it compiled, because that is the file a bug report carries', () => {
        // Not a temporary: it is the one artifact of this milestone a human can
        // read, and the Windows leg compiles this same file a SECOND time with WiX.
        assert.ok(existsSync(wxs));
        const text = readFileSync(wxs, 'utf-8');
        assert.match(text, /xmlns="http:\/\/schemas\.microsoft\.com\/wix\/2006\/wi"/);
        assert.match(text, /<MajorUpgrade /);
    });

    // ── read back, row by row ─────────────────────────────────────────────────

    it('reads the whole installer back and rebuilds the payload out of its cabinet', () => {
        const out = oracle([msi, programDir, 'msitools']);
        // Printed by the oracle from what it parsed, not restated here.
        assert.match(out, /round-tripped byte for byte out of the embedded cabinet/);
        assert.match(out, new RegExp(`INSTALLDIR = ProgramFiles64Folder\\\\${APP_NAME}`));
    });

    it('carries one component per file, each with its own GUID', () => {
        const files = table(msi, 'File');
        const components = table(msi, 'Component');
        const onDisk = listFiles(programDir);
        assert.equal(files.length, onDisk.length);
        assert.equal(components.length, onDisk.length);
        // Reference counting keys on the component id, so a shared GUID makes one
        // uninstall strand another product's files.
        const guids = new Set(components.map((row) => row[1]));
        assert.equal(guids.size, components.length);
    });

    it('is DETERMINISTIC: the same project packs to the same product and component codes', () => {
        // `Product Id="*"` is what WiX documents and it would give every rebuild a
        // different ProductCode — an artifact that cannot be compared with the one
        // published yesterday, and an upgrade path that changes for no reason.
        const first = table(msi, 'Property').find((row) => row[0] === 'ProductCode');
        const firstComponents = table(msi, 'Component').map((row) => `${row[0]}\t${row[1]}`);
        const again = join(tmpDir, 'again');
        cpSync(projectDir, again, { recursive: true });
        rmSync(join(again, 'ship'), { recursive: true, force: true });
        runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--arch', ARCH, '--target', 'msi'], { cwd: again });
        const second = table(join(again, 'ship', 'out', MSI_NAME), 'Property').find((row) => row[0] === 'ProductCode');
        assert.deepEqual(second, first);
        assert.deepEqual(
            table(join(again, 'ship', 'out', MSI_NAME), 'Component').map((row) => `${row[0]}\t${row[1]}`),
            firstComponents,
        );
    });

    it('moves the ProductCode with the version and holds the UpgradeCode still', () => {
        // The upgrade story, read off two real databases rather than off the
        // deriving function. A moving UpgradeCode leaves the old version installed
        // beside the new one; a still ProductCode makes the upgrade a no-op.
        const bumped = join(tmpDir, 'bumped');
        cpSync(projectDir, bumped, { recursive: true });
        rmSync(join(bumped, 'ship'), { recursive: true, force: true });
        const pkg = JSON.parse(readFileSync(join(bumped, 'package.json'), 'utf-8'));
        pkg.version = '1.3.0';
        writeFileSync(join(bumped, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
        runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--arch', ARCH, '--target', 'msi'], { cwd: bumped });
        const next = join(bumped, 'ship', 'out', `${BINARY}-1.3.0-1.${ARCH}.msi`);
        const prop = (file, key) => (table(file, 'Property').find((row) => row[0] === key) ?? [])[1];
        assert.equal(prop(next, 'UpgradeCode'), prop(msi, 'UpgradeCode'));
        assert.notEqual(prop(next, 'ProductCode'), prop(msi, 'ProductCode'));
        assert.equal(prop(next, 'ProductVersion'), '1.3.0');
    });

    it('gives the user exactly one Start-Menu entry, on the launcher’s component', () => {
        const shortcuts = table(msi, 'Shortcut');
        assert.equal(shortcuts.length, 1);
        const [, directory, name, component] = shortcuts[0];
        assert.equal(directory, 'ProgramMenuFolder');
        assert.equal(name, APP_NAME);
        // The component the shortcut hangs on must be the launcher's, so the two
        // are installed and removed together. Read through the File table rather
        // than by naming the id, which is a hash.
        const launcherRow = table(msi, 'File').find((row) => row[2] === `${BINARY}.cmd`);
        assert.ok(launcherRow, 'the installer carries no launcher row');
        assert.equal(component, launcherRow[1]);
    });

    it('installs under ProgramFiles64Folder as the directory the zip also expands to', () => {
        const directories = table(msi, 'Directory');
        const installDir = directories.find((row) => row[0] === 'INSTALLDIR');
        assert.ok(installDir);
        assert.equal(installDir[1], 'ProgramFiles64Folder');
        assert.equal(installDir[2].split('|').pop(), APP_NAME);
        // No publisher level: the installed tree IS the tree `windows-dir-zip`
        // expands to, which is what lets the two artifacts be compared at all.
        assert.equal(
            directories.filter((row) => row[1] === 'ProgramFiles64Folder').length,
            1,
            'something else hangs directly off the program files directory',
        );
    });

    it('shows the publisher without an email address in it', () => {
        // `PackSettings.maintainer` is `Name <email>` because that is what
        // `Maintainer:`/`Packager:` want. Add/Remove Programs prints Manufacturer
        // to a human, and an address there reads as a mistake.
        const manufacturer = table(msi, 'Property').find((row) => row[0] === 'Manufacturer');
        assert.equal(manufacturer[1], 'Example Dev');
    });

    // ── the refusals ──────────────────────────────────────────────────────────

    it('REFUSES a prerelease version rather than truncating it into a collision', () => {
        const pre = join(tmpDir, 'prerelease');
        cpSync(projectDir, pre, { recursive: true });
        rmSync(join(pre, 'ship'), { recursive: true, force: true });
        const pkg = JSON.parse(readFileSync(join(pre, 'package.json'), 'utf-8'));
        pkg.version = '1.2.0-rc.1';
        writeFileSync(join(pre, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
        const out = shipExpectingFailure(['ship', 'windows', '--skip-build', '--arch', ARCH, '--target', 'msi'], pre);
        assert.match(out, /ProductVersion/);
        assert.match(out, /gjsify\.ship\.version/);
    });

    it('refuses to pack an msi for the linux layout', () => {
        // The row wraps `win32`, and `gjsify ship linux --target msi` is a mistake
        // worth naming rather than dropping.
        const out = shipExpectingFailure(['ship', 'linux', '--skip-build', '--target', 'msi'], projectDir);
        assert.match(out, /msi wraps the win32 layout/);
        // …and names the one-word replacement, which is the difference between a
        // refusal and a dead end.
        assert.match(out, /gjsify ship windows --target msi/);
    });

    it('keeps the installer OUT of a bare `gjsify ship windows`', () => {
        // `defaultFormatIds` filters on `finishOn === 'any'`, and this row is
        // `['linux', 'win32']`. A bare run must not start demanding a compiler of
        // every project that ever packaged a program directory.
        const bare = join(tmpDir, 'bare');
        cpSync(projectDir, bare, { recursive: true });
        rmSync(join(bare, 'ship'), { recursive: true, force: true });
        runCliSync(CLI_ENTRY, ['ship', 'windows', '--skip-build', '--arch', ARCH], { cwd: bare });
        assert.ok(!existsSync(join(bare, 'ship', 'out', MSI_NAME)), 'a bare run produced an installer');
        assert.ok(existsSync(join(bare, 'ship', 'out', APP_NAME)), 'a bare run produced no program directory');
    });

    // ── the oracle, watched red ───────────────────────────────────────────────

    it('the oracle refuses a producer the file does not claim', () => {
        // The third argument is what makes this script something other than
        // msitools reading msitools. If it did not compare, the cross-read job
        // would be green against the wrong artifact.
        const out = oracleExpectingFailure([msi, programDir, 'Windows Installer XML']);
        assert.match(out, /msitools/);
    });

    it('the oracle refuses to read a file written by the package doing the reading', () => {
        // The NEGATIVE form, which is what the cross-family read on Linux uses.
        // Pointed at the wixl-built file it must say so.
        const out = oracleExpectingFailure([msi, programDir, '!msitools']);
        assert.match(out, /self-oracle/);
    });

    it('the oracle refuses an installer and a directory that disagree', () => {
        // The copy keeps the program directory's NAME: `INSTALLDIR`'s
        // `DefaultDir` is compared against `basename`, so a copy called anything
        // else reds on that check instead and this case would prove nothing about
        // the file count it is written for.
        const short = join(tmpDir, 'short', APP_NAME);
        cpSync(programDir, short, { recursive: true });
        rmSync(join(short, 'app', 'app.node.mjs'));
        const out = oracleExpectingFailure([msi, short, 'msitools']);
        assert.match(out, /file row/);
    });

    it('the oracle refuses an installer whose cabinet holds different bytes', () => {
        const tampered = join(tmpDir, 'tampered', APP_NAME);
        cpSync(programDir, tampered, { recursive: true });
        writeFileSync(join(tampered, `${BINARY}.cmd`), 'not what was packed\r\n');
        const out = oracleExpectingFailure([msi, tampered, 'msitools']);
        assert.match(out, new RegExp(`${BINARY}\\.cmd differs`));
    });

    it('the oracle refuses a file it cannot read at all', () => {
        const notAnMsi = join(tmpDir, 'not-an.msi');
        writeFileSync(notAnMsi, 'this is not a compound file\n');
        try {
            oracle([notAnMsi, programDir, 'msitools']);
            assert.fail('verify-msi.sh accepted a file that is not an MSI');
        } catch (error) {
            assert.notEqual(error.status, 0);
        }
    });
});
