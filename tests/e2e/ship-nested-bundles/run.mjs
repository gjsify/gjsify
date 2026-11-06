// E2E test for `gjsify.ship.nestedBundles` / `gjsify.ship.helperExecutables` —
// ADR 0024 amendment, "nested bundles and helper executables" (the beifahrer
// ADR this answers: 0026 § 6).
//
// WHAT THIS CLOSES. A consumer whose Xcode-built Safari-extension shell was
// discarded in favour of ADR 0026's "one app" decision still has ONE bundle
// `gjsify ship darwin` could not carry on its own: a `.appex`, registered by
// macOS only when it sits under the PARENT app's `Contents/PlugIns/`. This
// suite proves the staging half (the tree lands under `Contents/PlugIns/` /
// `Contents/Helpers/`, unflattened) on every host, and the signing half
// (inside out, own entitlements, outer seal last) wherever `codesign` exists —
// same split as `ship-signing`'s header, for the same reason.
//
// WHAT IS NOT PROVEN HERE: a REAL Safari `.appex` built by
// `xcrun safari-web-extension-packager`, or `pluginkit`/`lsregister` reading the
// registration back. Both need a real extension and a running Safari, which is
// beifahrer's own measurement (its ADR 0026 § 3), not this command's. This
// suite's fixture is a synthetic Mach-O standing in for the `.appex`'s own
// binary — enough to prove gjsify signs and seals it correctly, nothing about
// Safari's own behaviour.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasCommand } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';
import { CLI_ENTRY, NODE_BUNDLE, scaffold } from '../ship/fixture.mjs';
import { signedMachO } from '../macho.mjs';

process.env.GJSIFY_GTK_RUNTIME_FETCH = '0';

const APP_NAME = 'Ship Demo';
const HAS_CODESIGN = hasCommand('codesign');
const HAS_CC = hasCommand('cc');
const REQUIRE_DARWIN = process.env.GJSIFY_SHIP_SIGNING_REQUIRE_DARWIN_TOOLS === '1';

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
 * A throwaway `.appex`-shaped tree for the STAGING assertions, which never run
 * `codesign` and therefore need only bytes a plain file reader can find —
 * `signedMachO()`'s synthetic image is exactly that, and cheap.
 */
function plantFakeAppex(project, { arch = 'x64' } = {}) {
    const root = join(project, 'extension', 'Ext.appex');
    mkdirSync(join(root, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(
        join(root, 'Contents', 'MacOS', 'Ext'),
        signedMachO({ signature: Buffer.alloc(64, 0xaa), uuid: Buffer.alloc(16, 0x44), arch }),
    );
    writeFileSync(
        join(root, 'Contents', 'Info.plist'),
        '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key>' +
            '<string>eu.jumplink.gjsify.probe.Extension</string></dict></plist>\n',
    );
    return root;
}

/** A throwaway helper executable for the STAGING assertions — same reason as {@link plantFakeAppex}. */
function plantFakeHelper(project, { arch = 'x64' } = {}) {
    const path = join(project, 'helper-bin');
    writeFileSync(path, signedMachO({ signature: Buffer.alloc(64, 0xbb), uuid: Buffer.alloc(16, 0x55), arch }));
    return path;
}

/**
 * A REAL `.appex`-shaped tree for the SIGNING assertions. `codesign` refuses a
 * synthetic Mach-O outright ("invalid or unsupported format for signature") —
 * measured on the first run of this suite — because the writer in `macho.mjs`
 * exists for the pure-JS binary readers (`manifest-conformance`'s `readLibrary`)
 * and omits everything `codesign` itself parses (a real `__TEXT` segment,
 * `LC_SEGMENT_64` layout). `ship-signing`'s own ad-hoc case hits the same wall
 * and solves it the same way: a real compiled Mach-O.
 *
 * AN EXECUTABLE, NOT A DYLIB, and `Info.plist` names it with `CFBundleExecutable`.
 * Measured on a first cut that built `-dynamiclib`: `codesign --entitlements`
 * embeds entitlements into a Mach-O's CODE DIRECTORY either way, but reading
 * them back off the BUNDLE (`codesign -d --entitlements - Ext.appex`, the
 * question a real extension point asks) only finds them through
 * `CFBundleExecutable` — a bundle with no main-executable key answers from
 * `Info.plist` itself, which carries no entitlements and reads back empty. A
 * real `.appex`'s `Info.plist` always declares this key (Apple's extension-point
 * template does), so the fixture has to as well.
 */
function compileRealAppex(project, { arch = process.arch } = {}) {
    const root = join(project, 'extension', 'Ext.appex');
    mkdirSync(join(root, 'Contents', 'MacOS'), { recursive: true });
    const source = join(project, 'extension-demo.c');
    writeFileSync(source, 'int main(void) { return 0; }\n');
    execFileSync('cc', ['-arch', arch, '-o', join(root, 'Contents', 'MacOS', 'Ext'), source], { stdio: 'pipe' });
    writeFileSync(
        join(root, 'Contents', 'Info.plist'),
        '<?xml version="1.0"?><plist><dict>' +
            '<key>CFBundleIdentifier</key><string>eu.jumplink.gjsify.probe.Extension</string>' +
            '<key>CFBundleExecutable</key><string>Ext</string>' +
            '</dict></plist>\n',
    );
    return root;
}

/** A REAL helper executable for the SIGNING assertions — same reason as {@link compileRealAppex}. */
function compileRealHelper(project, { arch = process.arch } = {}) {
    const path = join(project, 'helper-bin');
    const source = join(project, 'helper-demo.c');
    writeFileSync(source, 'int main(void) { return 0; }\n');
    execFileSync('cc', ['-arch', arch, '-o', path, source], { stdio: 'pipe' });
    return path;
}

async function shipFailing(args, cwd) {
    const result = await runCli(CLI_ENTRY, args, { cwd, timeoutMs: 300_000 });
    assert.notEqual(result.status, 0, `expected \`gjsify ${args.join(' ')}\` to fail:\n${result.stdout}`);
    return `${result.stdout}${result.stderr}`;
}

async function shipOk(args, cwd) {
    const result = await runCli(CLI_ENTRY, args, { cwd, timeoutMs: 300_000 });
    assert.equal(result.status, 0, `\`gjsify ${args.join(' ')}\` failed:\n${result.stdout}\n${result.stderr}`);
    return result;
}

/** The leaf a linux/windows layout stages for `name`, when it stages ANYTHING extra at all. */
function hasNoPlugins(root) {
    return !existsSync(join(root, 'Contents', 'PlugIns')) && !existsSync(join(root, 'PlugIns'));
}

describe('CLI ship nested bundles / helper executables E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gjsify-ship-nested-'));
    });
    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    });

    // ── outside darwin, which runs on every host ────────────────────────────
    describe('outside the darwin layout', () => {
        it('stages gjsify.ship.nestedBundles without Contents/PlugIns, prints the notice, exit 0', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'linux-nested-')), {
                nestedBundles: [{ source: 'extension/Ext.appex', name: 'Ext.appex' }],
            });
            plantFakeAppex(project);
            const result = await shipOk(['ship', 'linux', '--target', 'deb', '--skip-build'], project);
            assert.match(result.stderr, /nestedBundles\/helperExecutables apply to darwin only — not staged for linux/);
        });

        it('stages gjsify.ship.helperExecutables without Contents/Helpers, prints the notice, exit 0', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'windows-helper-')), {
                helperExecutables: [{ source: 'helper-bin', name: 'helper' }],
            });
            plantFakeHelper(project);
            const result = await shipOk(
                ['ship', 'windows', '--target', 'windows-dir', '--skip-build', '--arch', 'x64'],
                project,
            );
            assert.match(result.stderr, /nestedBundles\/helperExecutables apply to darwin only — not staged for win32/);
            const dir = join(project, 'ship', 'out', APP_NAME);
            assert.ok(hasNoPlugins(dir), 'a windows program directory must carry no Contents/PlugIns at all');
        });

        it('still validates SHAPE outside darwin — a typo is caught on a linux build too', async () => {
            // A path-separator name is a SHAPE defect, independent of the
            // declaration being ignored on this layout.
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'linux-shape-')), {
                nestedBundles: [{ source: 'extension/Ext.appex', name: 'sub/Ext.appex' }],
            });
            plantFakeAppex(project);
            const said = await shipFailing(['ship', 'linux', '--target', 'deb', '--skip-build'], project);
            assert.match(said, /not usable as a leaf/);
        });

        it('does NOT demand the nested bundle source exist outside darwin — never built there', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'linux-no-source-')), {
                nestedBundles: [{ source: 'nowhere.appex', name: 'Nowhere.appex' }],
            });
            await shipOk(['ship', 'linux', '--target', 'deb', '--skip-build'], project);
        });
    });

    // ── refusals, which run on every host ───────────────────────────────────
    describe('declaration refusals', () => {
        it('refuses a nested bundle source that does not exist, on darwin', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'missing-source-')), {
                nestedBundles: [{ source: 'nowhere.appex', name: 'Nowhere.appex' }],
            });
            const said = await shipFailing(['ship', 'darwin', '--stage', '--skip-build', '--arch', 'x64'], project);
            assert.match(said, /nowhere\.appex.*does not exist/s);
        });
    });

    // ── staging — the layout slot, on every host ────────────────────────────
    describe('staging', () => {
        it('stages the nested bundle tree-preserving under Contents/PlugIns, and the helper under Contents/Helpers', async () => {
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'stage-')), {
                nestedBundles: [
                    {
                        source: 'extension/Ext.appex',
                        name: 'Ext.appex',
                        entitlements: ['com.apple.security.app-sandbox'],
                    },
                ],
                helperExecutables: [{ source: 'helper-bin', name: 'safari-ext-helper' }],
            });
            plantFakeAppex(project);
            plantFakeHelper(project);

            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', 'x64'], project);
            const bundle = join(project, 'ship', 'stage', `${APP_NAME}.app`);
            assert.ok(
                existsSync(join(bundle, 'Contents', 'PlugIns', 'Ext.appex', 'Contents', 'MacOS', 'Ext')),
                'the appex binary did not land under Contents/PlugIns, tree-preserving',
            );
            assert.ok(
                existsSync(join(bundle, 'Contents', 'PlugIns', 'Ext.appex', 'Contents', 'Info.plist')),
                'the appex Info.plist did not travel with the bundle',
            );
            assert.ok(
                existsSync(join(bundle, 'Contents', 'Helpers', 'safari-ext-helper')),
                'the helper executable did not land under Contents/Helpers',
            );
            // And NOT flattened into `Contents/Resources/native` — the fate a
            // `gjsify.ship.bundledTypelibs`-style stager would have given it.
            assert.ok(!existsSync(join(bundle, 'Contents', 'Resources', 'native', 'Ext')));
        });
    });

    // ── signing — needs codesign ─────────────────────────────────────────────
    describe('ad-hoc signing, inside out', () => {
        it('has codesign and cc, or says the leg proved nothing', () => {
            if (HAS_CODESIGN && HAS_CC) return;
            assert.equal(
                REQUIRE_DARWIN,
                false,
                'GJSIFY_SHIP_SIGNING_REQUIRE_DARWIN_TOOLS=1 was set and `codesign`/`cc` are not both on PATH.',
            );
            console.log('    (missing codesign or cc on this host: the signing half of this suite did not run)');
        });

        it('signs the nested bundle and the helper with their OWN entitlements, before the outer seal', async () => {
            if (!HAS_CODESIGN || !HAS_CC) return;
            const project = scaffoldNodeApp(mkdtempSync(join(tmpDir, 'sign-')), {
                nestedBundles: [
                    {
                        source: 'extension/Ext.appex',
                        name: 'Ext.appex',
                        entitlements: ['com.apple.security.app-sandbox'],
                    },
                ],
                helperExecutables: [{ source: 'helper-bin', name: 'safari-ext-helper' }],
            });
            compileRealAppex(project);
            compileRealHelper(project);

            await shipOk(['ship', 'darwin', '--stage', '--skip-build', '--arch', process.arch], project);
            const stage = join(project, 'ship', 'stage');
            const packed = await shipOk(
                ['ship', '--from-stage', stage, '--target', 'macos-app', '--sign', '-', '--verbose'],
                project,
            );
            assert.match(packed.stdout, /nested: Ship Demo\.app\/Contents\/PlugIns\/Ext\.appex/);

            const artifact = join(project, 'ship', 'out', `${APP_NAME}.app`);
            // The nested bundle verifies as its OWN signed unit.
            execFileSync('codesign', ['--verify', '--strict', join(artifact, 'Contents', 'PlugIns', 'Ext.appex')], {
                stdio: 'pipe',
            });
            // The helper is signed too.
            execFileSync(
                'codesign',
                ['--verify', '--strict', join(artifact, 'Contents', 'Helpers', 'safari-ext-helper')],
                {
                    stdio: 'pipe',
                },
            );
            // And the WHOLE tree, including the nested bundle, verifies as one
            // sealed unit — `--deep` walks into `Contents/PlugIns/`.
            execFileSync('codesign', ['--verify', '--deep', '--strict', artifact], { stdio: 'pipe' });

            // The nested bundle's entitlements are its OWN declared set, not the
            // outer app's JIT/dyld-environment grants.
            //
            // `--entitlements -` (no colon), not `--entitlements :-`: the colon
            // prefix asks for the DER-encoded blob, not the readable plist —
            // `codesign(1)`: "If the path is preceded by a colon, the
            // entitlement extracted is the DER-encoded representation." Measured
            // on this host: the colon form prints a deprecation warning to
            // stderr and nothing readable to stdout.
            const entitlements = execFileSync(
                'codesign',
                ['-d', '--entitlements', '-', join(artifact, 'Contents', 'PlugIns', 'Ext.appex')],
                { encoding: 'utf-8' },
            );
            assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
            assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.allow-jit/);
        });
    });
});
