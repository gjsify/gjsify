// E2E test for `gjsify ship --from-stage` — ADR 0024 § A2, the two-phase split.
//
// The property under test is not "packing a stage works". It is that the packing phase reaches
// NOTHING outside the stage: no project directory, no `package.json`, no built bundle, no
// `gjsify.ship` config. Every one of those is present on the machine that ran `--stage`, and on a
// darwin or Windows finish runner none of them will be.
//
// So the discriminator is destructive, and it is not optional: the project tree is MOVED OUT and
// DELETED between the two phases. Without the deletion, every accidental reach-back — a
// `readFileSync(settings.bundlePath)`, a `resolve(projectDir, …)`, a config load — silently
// succeeds, the artifact is correct, and this file proves nothing. It is the same reason
// `tests/e2e/ship` reads its artifacts with `rpm` and GNU `ar` instead of with its own writer.
//
// The reference the split is compared against is a SINGLE-PROCESS run of the same project, byte
// for byte. Anything the stage failed to carry — the mode plan, the licence overlay, the GI
// namespaces, the build stamp — changes those bytes, and each of those omissions otherwise exits 0
// with a package that installs.
//
// Both runs are pinned with SOURCE_DATE_EPOCH, exactly as `tests/e2e/ship` does for its
// two-checkout test; the FINISH run deliberately does not get it, so the comparison also proves
// the stamp was carried rather than re-measured on this host.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    truncateSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runCliSync } from '../mock-registry.mjs';
import {
    CLI_ENTRY,
    listFiles,
    listPayload,
    probe,
    scaffold,
    STAGE_MANIFEST_FILE,
    STAGE_SCHEMA_VERSION,
} from '../ship/fixture.mjs';

/** One pinned stamp for both phases — see the header. */
const STAMP = '1700000000';

/** The seven `ShipSettings` fields that name a path on the assembling host. */
const BUILD_HOST_FIELDS = [
    'projectDir',
    'bundlePath',
    'bundleDir',
    'iconFiles',
    'schemaFiles',
    'extraFiles',
    'licenseFile',
];

describe('CLI ship --from-stage E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    /** A directory with no project in it — the cwd every finish run gets. */
    let nowhere;
    /** The stage, after its project was deleted. Never mutated; variants copy it. */
    let detachedStage;
    let reference;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-from-stage-'));
        nowhere = join(tmpDir, 'nowhere');
        mkdirSync(nowhere, { recursive: true });

        // Phase 0 — the single-process artifact everything is compared against.
        const referenceDir = scaffold(join(tmpDir, 'reference'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: referenceDir, env: stamped() });
        reference = {
            deb: readFileSync(debPath(join(referenceDir, 'ship'))),
            rpm: readFileSync(rpmPath(join(referenceDir, 'ship'))),
        };

        // Phase 1 — assemble, then take the stage away from its project and destroy the project.
        const projectDir = scaffold(join(tmpDir, 'project'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: projectDir, env: stamped() });
        assert.equal(existsSync(join(projectDir, 'ship', 'out')), false, '--stage must pack nothing');

        detachedStage = join(tmpDir, 'detached', 'stage');
        mkdirSync(dirname(detachedStage), { recursive: true });
        renameSync(join(projectDir, 'ship', 'stage'), detachedStage);
        rmSync(projectDir, { recursive: true, force: true });
        assert.equal(existsSync(projectDir), false, 'the project tree must be gone before anything packs');
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── the split itself ──────────────────────────────────────────────────

    it('packs a stage whose project no longer exists', () => {
        runFinish(detachedStage);
        const outRoot = dirname(detachedStage);
        assert.ok(existsSync(debPath(outRoot)), `expected ${debPath(outRoot)}`);
        assert.ok(existsSync(rpmPath(outRoot)));
    });

    it('produces the same bytes as the single-process run', () => {
        // Each thing the stage could have failed to carry lands here as a diff, and lands
        // NOWHERE else: a stage without the mode plan packs the launcher 0644, one without the
        // overlay ships no /usr/share/doc/ship-demo/copyright (Debian Policy § 12.5), one without
        // the namespaces drops gir1.2-gtk-4.0 and gir1.2-adw-1 from Depends, and one that
        // re-measured the build stamp writes a different mtime into every header. All four exit 0.
        const outRoot = dirname(detachedStage);
        assert.deepEqual(readFileSync(debPath(outRoot)), reference.deb);
        assert.deepEqual(readFileSync(rpmPath(outRoot)), reference.rpm);
    });

    it('carries a closure, not a settings dump', () => {
        const manifest = readManifest(detachedStage);
        assert.equal(manifest.schema, STAGE_SCHEMA_VERSION);
        assert.deepEqual(manifest.target, { os: 'linux', arch: process.arch });
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
        assert.equal(manifest.mtime, Number(STAMP));
        assert.deepEqual(manifest.namespaces, ['Adw-1', 'Gtk-4.0']);
        assert.equal(manifest.overlay.deb[0].path, 'share/doc/ship-demo/copyright');
        assert.equal(manifest.overlay.rpm[0].path, 'share/licenses/ship-demo/LICENSE');

        // Not one absolute path from the machine that assembled it — the project directory does
        // not exist any more, so a manifest naming it would name nothing.
        for (const field of BUILD_HOST_FIELDS) {
            assert.equal(field in manifest.settings, false, `settings must not carry ${field}`);
        }
        assert.doesNotMatch(JSON.stringify(manifest), new RegExp(escapeRegExp(join(tmpDir, 'project'))));

        // The mode plan is what survives a transfer that does not carry modes.
        const launcher = manifest.staged.find((file) => file.path === 'bin/ship-demo');
        assert.equal(launcher.mode, 0o755);
        assert.equal(launcher.bytes, statSync(join(detachedStage, 'bin', 'ship-demo')).size);
    });

    it('does not pack its own manifest', () => {
        assert.ok(listFiles(detachedStage).includes(STAGE_MANIFEST_FILE), 'the stage must carry its manifest');
        const outRoot = dirname(detachedStage);
        if (probe('rpm')) {
            const files = execFileSync('rpm', ['-qpl', rpmPath(outRoot)], { encoding: 'utf-8' });
            assert.doesNotMatch(files, /gjsify-ship-stage/);
        }
        if (probe('ar') && probe('tar')) {
            assert.doesNotMatch(
                readDataListing(outRoot)
                    .map((entry) => entry.name)
                    .join('\n'),
                /gjsify-ship-stage/,
            );
        }
    });

    // ── the mode plan ─────────────────────────────────────────────────────

    it('takes modes from the plan, not from the tree it arrived in', () => {
        const stage = freshStage('stripped');
        // Deliberately NOT `chmod -R a-x`: that strips the traversal bit off the directories too,
        // and the run then dies with EACCES before reading a byte — red for the wrong reason.
        // What a CI artifact round-trip actually does is lose the mode of every FILE
        // (`actions/upload-artifact` stores no POSIX mode at all), and that is the case worth
        // pinning.
        for (const rel of listPayload(stage)) chmodSync(join(stage, ...rel.split('/')), 0o644);
        assert.equal(statSync(join(stage, 'bin', 'ship-demo')).mode & 0o777, 0o644);

        runFinish(stage);
        // Byte-equality is the strongest form of the assertion: had the mode come from `stat()`,
        // the tar header and the rpm FILEMODES array would both differ.
        assert.deepEqual(readFileSync(debPath(dirname(stage))), reference.deb);
        assert.deepEqual(readFileSync(rpmPath(dirname(stage))), reference.rpm);

        if (!probe('ar') || !probe('tar')) return;
        const entry = readDataListing(dirname(stage)).find((item) => item.name === './usr/bin/ship-demo');
        assert.ok(entry, 'the launcher is missing from data.tar');
        assert.equal(entry.mode, '-rwxr-xr-x');
    });

    // ── what a stage that is not the planned tree does ────────────────────

    it('refuses a file the manifest does not list, and names it', () => {
        const stage = freshStage('stowaway');
        writeFileSync(join(stage, 'share', 'stowaway.txt'), 'nobody planned this\n');
        const output = expectFailure(stage);
        assert.match(output, /stowaway\.txt/);
        // The message has to say WHY a default is not an option: an unplanned mode is a guess.
        assert.match(output, /mode from the plan/);
    });

    it('refuses a stage that lost a file', () => {
        const stage = freshStage('incomplete');
        rmSync(join(stage, 'lib', 'ship-demo', 'gjs.js'));
        const output = expectFailure(stage);
        assert.match(output, /lib\/ship-demo\/gjs\.js/);
        assert.match(output, /does not contain/);
    });

    it('refuses a stage that arrived truncated', () => {
        const stage = freshStage('truncated');
        // The failure the file-set check structurally cannot see: every path is still there.
        truncateSync(join(stage, 'lib', 'ship-demo', 'gjs.js'), 0);
        const output = expectFailure(stage);
        assert.match(output, /lib\/ship-demo\/gjs\.js is 0 bytes/);
    });

    // ── refusing the wrong stage ──────────────────────────────────────────

    it('refuses a directory that is not a stage', () => {
        const output = expectFailure(nowhere);
        assert.match(output, new RegExp(escapeRegExp(STAGE_MANIFEST_FILE)));
        assert.match(output, /gjsify ship --stage/);
    });

    it('refuses a manifest written by a newer gjsify', () => {
        const stage = freshStage('from-the-future');
        const manifest = readManifest(stage);
        manifest.schema = STAGE_SCHEMA_VERSION + 1;
        writeManifest(stage, manifest);
        const output = expectFailure(stage);
        assert.match(output, new RegExp(`schema ${STAGE_SCHEMA_VERSION + 1}`));
        assert.match(output, /self-update/);
    });

    it('refuses a stage from another matrix leg', () => {
        // Scope, stated because the sibling check next door is the one that guards bytes:
        // `--expect-target` compares the FLAG to what the sidecar RECORDED. Both strings are
        // written by the same pipeline one job apart, so this catches a finish job that
        // downloaded the wrong artifact and nothing else. It is NOT the guard
        // `verify-bundle-manifest.mjs --expect-host-target` provides — that one compares a
        // bundle to the machine, which is exactly what a two-host split cannot do. The
        // label-versus-bytes class is covered by 'refuses a payload the label contradicts'.
        const other = process.arch === 'arm64' ? 'x64' : 'arm64';
        const output = expectFailure(detachedStage, ['--expect-target', `linux-${other}`]);
        assert.match(output, new RegExp(`--expect-target linux-${other}`));
        assert.match(output, new RegExp(`assembled for linux-${process.arch}`));
    });

    it('accepts the stage its own target names', () => {
        runFinish(detachedStage, ['--expect-target', `linux-${process.arch}`]);
    });

    // ── the label and the bytes ───────────────────────────────────────────
    //
    // Everything above this line packs a PURE-JS payload, which is `Architecture: all` /
    // `BuildArch: noarch` whatever `--arch` says — so before these two cases, `target.arch`
    // reached no byte of any artifact in either ship suite and `--arch` was covered only by a
    // refusal test. These two are the first artifacts here with a real architecture on them.

    it('refuses a payload the label contradicts', () => {
        // THE DISCRIMINATOR for `assertPayloadMatchesArch`: before it existed this exact
        // command exited 0 and produced `…aarch64.rpm` whose only `.so` was `e_machine=0x3e`,
        // and `rpm -qp --qf %{ARCH}` confirmed `aarch64` — because rpm reads the header and the
        // header was written from the claim. That is the class
        // `packages/node-gi/scripts/verify-bundle-manifest.mjs` names in its own comment.
        const dir = nativeProject('mislabelled', 'x64');
        const result = spawnSync(process.execPath, [CLI_ENTRY, 'ship', '--skip-build', '--stage', '--arch', 'arm64'], {
            cwd: dir,
            env: stamped(),
            encoding: 'utf-8',
        });
        // The stage phase packs nothing, so it may legitimately succeed; the refusal is the
        // pack phase's. Assert on whichever one spoke, and require that one of them did.
        const staged = join(dir, 'ship', 'stage');
        const output = result.status === 0 ? expectFailure(staged, []) : `${result.stdout}${result.stderr}`;
        assert.match(output, /libdemo\.so/);
        assert.match(output, /is built for x64/);
        assert.match(output, /labelled arm64/);
    });

    it('packs a native payload with the architecture it really has', () => {
        // The positive control for the case above: without it, a gate that refused EVERY native
        // payload would look identical here. Also the only non-`all`/`noarch` artifact either
        // ship suite produces, which is what makes `archName` and `--arch` covered at all.
        const dir = nativeProject('native-ok', process.arch);
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: dir, env: stamped() });
        const staged = join(dir, 'ship', 'stage');
        runFinish(staged);
        const outDir = join(dir, 'ship', 'out');
        const produced = listFiles(outDir);
        assert.ok(
            produced.some((name) => name.endsWith('.deb') && !name.includes('_all.')),
            `expected an architecture-labelled .deb, got ${produced.join(', ')}`,
        );
        assert.ok(
            produced.some((name) => name.endsWith('.rpm') && !name.includes('.noarch.')),
            `expected an architecture-labelled .rpm, got ${produced.join(', ')}`,
        );
    });

    it('refuses a format the stage was never assembled for', () => {
        const debOnly = scaffold(join(tmpDir, 'deb-only'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--target', 'deb'], {
            cwd: debOnly,
            env: stamped(),
        });
        const output = expectFailure(join(debOnly, 'ship', 'stage'), ['--target', 'rpm']);
        assert.match(output, /assembled for deb/);
        assert.match(output, /share\/licenses/);
        assert.match(output, /--stage --target deb,rpm/);
    });

    // ── flag combinations ─────────────────────────────────────────────────

    it('refuses --stage and --from-stage together', () => {
        const output = expectFailure(detachedStage, ['--stage']);
        assert.match(output, /two halves of one split/);
        assert.match(output, /ADR 0024/);
    });

    it('refuses --arch at pack time and names where it belongs', () => {
        const output = expectFailure(detachedStage, ['--arch', 'arm64']);
        assert.match(output, /--arch is decided when the stage is assembled/);
        assert.match(output, /--expect-target/);
    });

    it('refuses --skip-build at pack time', () => {
        const output = expectFailure(detachedStage, ['--skip-build']);
        assert.match(output, /nothing to skip/);
    });

    // ── the build stamp ───────────────────────────────────────────────────

    it("keeps the stage's stamp when the finish job disagrees, and says so", () => {
        const stage = freshStage('other-stamp');
        // `spawnSync`, not `runCliSync`: warnings go to stderr and `execFileSync` returns stdout
        // only, so the convention helper cannot see the line this test is about.
        const result = spawnSync(process.execPath, [CLI_ENTRY, 'ship', '--from-stage', stage], {
            cwd: nowhere,
            env: { ...process.env, SOURCE_DATE_EPOCH: '1600000000' },
            encoding: 'utf-8',
        });
        assert.equal(result.status, 0, result.stderr);
        const output = result.stderr;
        // A finish job that honoured its own SOURCE_DATE_EPOCH would produce a different artifact
        // from the same stage packed anywhere else — the one property the split has to keep.
        assert.deepEqual(readFileSync(debPath(dirname(stage))), reference.deb);
        assert.match(output, /SOURCE_DATE_EPOCH is 1600000000 here/);
        assert.match(output, new RegExp(`stamped ${STAMP}`));
    });

    // ── helpers ───────────────────────────────────────────────────────────

    /** `process.env` plus the pinned stamp — phase 0 and phase 1 only. */
    function stamped() {
        return { ...process.env, SOURCE_DATE_EPOCH: STAMP };
    }

    /**
     * `process.env` WITHOUT the stamp — every finish run.
     *
     * Deleted rather than left alone: a runner that exports SOURCE_DATE_EPOCH globally would
     * otherwise hand the finish phase the same value by accident, and the comparison would stop
     * proving that the stamp travelled in the manifest.
     */
    function unstamped() {
        const env = { ...process.env };
        delete env.SOURCE_DATE_EPOCH;
        return env;
    }

    function runFinish(stageDir, extra = []) {
        return runCliSync(CLI_ENTRY, ['ship', '--from-stage', stageDir, ...extra], {
            cwd: nowhere,
            env: unstamped(),
        });
    }

    function expectFailure(stageDir, extra = []) {
        try {
            runFinish(stageDir, extra);
        } catch (error) {
            assert.notEqual(error.status, 0, 'expected a non-zero exit');
            return `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        assert.fail('expected `gjsify ship --from-stage` to fail');
    }

    /**
     * A demo project carrying one synthetic native image of the given architecture.
     *
     * Synthetic rather than a real `.so` copied off this host: the point is to produce a payload
     * whose architecture is NOT the runner's, which no file on the runner can be. Only the ELF
     * header is real — `isNativeBinary` reads the 4-byte magic and `readBinaryArch` reads
     * `EI_DATA` and `e_machine`, and nothing in the ship path ever executes or links it.
     */
    function nativeProject(name, arch) {
        const machine = { x64: 0x3e, arm64: 0xb7, ppc64: 0x15, riscv64: 0xf3 }[arch];
        assert.ok(machine !== undefined, `no synthetic ELF header for ${arch}`);
        const dir = scaffold(join(tmpDir, name), (pkg) => {
            pkg.gjsify.ship.extraFiles = { 'lib/ship-demo/gi/libdemo.so': 'native/libdemo.so' };
        });
        const header = new Uint8Array(64);
        header.set([0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
        header[4] = 2; // ELFCLASS64
        header[5] = 1; // ELFDATA2LSB — little-endian, so e_machine is little-endian too
        header[16] = 3; // ET_DYN
        header[18] = machine & 0xff;
        header[19] = machine >> 8;
        mkdirSync(join(dir, 'native'), { recursive: true });
        writeFileSync(join(dir, 'native', 'libdemo.so'), header);
        return dir;
    }

    /** A private copy of the detached stage, under its own output root. */
    function freshStage(name) {
        const target = join(tmpDir, name, 'stage');
        mkdirSync(dirname(target), { recursive: true });
        cpSync(detachedStage, target, { recursive: true });
        return target;
    }

    function readManifest(stageDir) {
        return JSON.parse(readFileSync(join(stageDir, STAGE_MANIFEST_FILE), 'utf-8'));
    }

    function writeManifest(stageDir, manifest) {
        writeFileSync(join(stageDir, STAGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    }

    function debPath(outRoot) {
        return join(outRoot, 'out', 'ship-demo_1.2.3-1_all.deb');
    }

    function rpmPath(outRoot) {
        return join(outRoot, 'out', 'ship-demo-1.2.3-1.noarch.rpm');
    }

    function readDataListing(outRoot) {
        const work = join(outRoot, 'deb-extract');
        rmSync(work, { recursive: true, force: true });
        mkdirSync(work, { recursive: true });
        execFileSync('ar', ['x', debPath(outRoot)], { cwd: work });
        const output = execFileSync('tar', ['tvzf', join(work, 'data.tar.gz')], { encoding: 'utf-8' });
        return output
            .trim()
            .split('\n')
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                return { mode: parts[0], owner: parts[1], name: parts[parts.length - 1] };
            });
    }
});

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
