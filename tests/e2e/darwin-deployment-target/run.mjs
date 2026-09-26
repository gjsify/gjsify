// ADR 0074 — every shipped darwin image targets one declared macOS floor.
//
// WHAT THIS HOLDS. Three pieces must agree for the floor to mean anything, and each one
// failed silently before it existed:
//   1. the READER — `readLibrary().minOs` out of `LC_BUILD_VERSION` (current linkers) and
//      `LC_VERSION_MIN_MACOSX` (rustc's x86_64 cdylibs still write it), and never a
//      non-macOS build-version record;
//   2. the RULE — `prebuild-darwin-target` fails an image above the floor and an image it
//      could not measure, passes one below it, and in report mode prints instead of fails;
//   3. the STAGER — `scripts/stage-prebuild.mjs`, which every shipped darwin artifact passes
//      through, fails an image above the floor in CI and only warns on a local build. That
//      is what catches a job compiling without `.github/actions/darwin-deployment-target`,
//      in its own run, from the bytes — so no test parses the workflows for the action.
//
// Synthetic Mach-O fixtures (tests/e2e/macho.mjs), so the suite runs on Linux CI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildVersion, machO, versionMinMacOS, LC_ID_DYLIB, SYSTEM_DYLIB } from '../macho.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const LIB = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib');

const { readLibrary } = await import(`file://${join(LIB, 'binary.mjs')}`);
const { checkDarwinFloor } = await import(`file://${join(MONOREPO_ROOT, 'scripts', 'stage-prebuild.mjs')}`);
const { DARWIN_DEPLOYMENT_TARGET, createContext, auditPrebuildDarwinTarget, measureDarwinTargets } = await import(
    `file://${join(LIB, 'index.mjs')}`
);

/** A dylib whose only interesting record is its deployment target. */
function dylib(leaf, versionCmd, arch = 'arm64') {
    const cmds = [{ cmd: LC_ID_DYLIB, str: `@rpath/${leaf}` }, SYSTEM_DYLIB];
    if (versionCmd) cmds.push(versionCmd);
    return machO(cmds, { arch });
}

describe('readLibrary().minOs', () => {
    let dir;
    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'darwin-minos-'));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    const cases = [
        ['LC_BUILD_VERSION', buildVersion('26.0', { sdk: '26.5' }), '26.0'],
        ['LC_BUILD_VERSION with a patch component', buildVersion('13.5.1'), '13.5.1'],
        ['LC_VERSION_MIN_MACOSX (rustc x86_64)', versionMinMacOS('10.12'), '10.12'],
        ['no version record', null, null],
        // An iOS build-version record says nothing about which macOS can load the image.
        ['a non-macOS LC_BUILD_VERSION', buildVersion('17.0', { platform: 2 }), null],
    ];
    for (const [label, cmd, expected] of cases) {
        it(`reads ${label} as ${expected}`, () => {
            const file = join(dir, `${label.replace(/\W+/g, '_')}.dylib`);
            writeFileSync(file, dylib('libx.dylib', cmd));
            assert.equal(readLibrary(file).minOs, expected);
        });
    }
});

describe('prebuild-darwin-target rule', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'darwin-floor-'));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: 'root', private: true, workspaces: ['pkgs/*'] }),
        );
        const pkg = (name, target, files) => {
            const pdir = join(root, 'pkgs', name);
            mkdirSync(join(pdir, 'prebuilds', target), { recursive: true });
            writeFileSync(
                join(pdir, 'package.json'),
                JSON.stringify({ name, gjsify: { platforms: [target], prebuilds: 'prebuilds' } }),
            );
            for (const [leaf, bytes] of Object.entries(files))
                writeFileSync(join(pdir, 'prebuilds', target, leaf), bytes);
        };
        pkg('at-floor-darwin-arm64', 'darwin-arm64', {
            'libok.dylib': dylib('libok.dylib', buildVersion(DARWIN_DEPLOYMENT_TARGET)),
            // Older is fine: webkit-native pins 11.0, rustc defaults to 11.0 / 10.12.
            'libold.dylib': dylib('libold.dylib', versionMinMacOS('10.12', {}), 'x64'),
            'Ok-1.0.typelib': Buffer.from('not a library'),
        });
        pkg('too-new-darwin-arm64', 'darwin-arm64', {
            'libnew.dylib': dylib('libnew.dylib', buildVersion('26.0')),
        });
        pkg('unmeasured-darwin-x64', 'darwin-x64', {
            'libbare.dylib': dylib('libbare.dylib', null, 'x64'),
        });
        // A Linux directory is out of scope, whatever it holds.
        pkg('linux-only-linux-x64', 'linux-x64', { 'libz.so': Buffer.from('\x7fELF') });
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('fails an image above the floor and an unmeasured one, and passes the rest', () => {
        const res = auditPrebuildDarwinTarget(createContext({ root }));
        assert.equal(res.failures.length, 2, res.failures.join('\n'));
        assert.match(res.failures.join('\n'), /too-new-darwin-arm64 \[darwin-arm64\].*libnew\.dylib needs macOS 26\.0/);
        assert.match(
            res.failures.join('\n'),
            /unmeasured-darwin-x64 \[darwin-x64\].*libbare\.dylib — deployment target not measured/,
        );
        assert.equal(res.stats.images, 4);
        assert.equal(res.stats.directories, 3);
    });

    it('report mode prints every finding as a note and fails nothing', () => {
        const res = auditPrebuildDarwinTarget(createContext({ root, extra: { darwinDeploymentTarget: 'report' } }));
        assert.deepEqual(res.failures, []);
        assert.match(res.notes[0], /REPORT MODE — 2 darwin image\(s\)/);
        assert.equal(res.notes.length, 3);
    });

    it('compares versions numerically, not lexically', () => {
        const m = measureDarwinTargets(join(root, 'pkgs', 'at-floor-darwin-arm64', 'prebuilds', 'darwin-arm64'), '9.0');
        // '10.12' < '9.0' as strings; numerically both 10.12 and 15.0 exceed 9.0.
        assert.equal(m.tooNew.length, 2);
        assert.equal(m.max, DARWIN_DEPLOYMENT_TARGET);
    });
});

describe('stage-prebuild darwin floor gate', () => {
    let dir;
    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'darwin-stage-'));
        writeFileSync(join(dir, 'libok.dylib'), dylib('libok.dylib', buildVersion(DARWIN_DEPLOYMENT_TARGET)));
        writeFileSync(join(dir, 'libnew.dylib'), dylib('libnew.dylib', buildVersion('26.0')));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    it('fails an image above the floor in CI, naming the action', () => {
        const { errors, warnings } = checkDarwinFloor(dir, { ci: true });
        assert.deepEqual(warnings, []);
        assert.equal(errors.length, 1, errors.join('\n'));
        assert.match(errors[0], /libnew\.dylib needs macOS 26\.0.*darwin-deployment-target/);
    });

    it('only warns about it on a local build', () => {
        const { errors, warnings } = checkDarwinFloor(dir, { ci: false });
        assert.deepEqual(errors, []);
        assert.equal(warnings.length, 1);
    });

    it('fails an unmeasured image even locally', () => {
        const bare = mkdtempSync(join(tmpdir(), 'darwin-stage-bare-'));
        try {
            writeFileSync(join(bare, 'libbare.dylib'), dylib('libbare.dylib', null));
            assert.equal(checkDarwinFloor(bare, { ci: false }).errors.length, 1);
        } finally {
            rmSync(bare, { recursive: true, force: true });
        }
    });
});
