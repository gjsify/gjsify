// E2E test for `gjsify ship --target snap` — ADR 0149.
//
// TIERED like `ship-appimage`, because `snapcraft` is on no CI image here and a `.snap` build
// needs LXD or an Ubuntu host:
//
//   1. STRUCTURAL (always). The format is out of the default target set, the host gate fires
//      with the tool hidden and names it, and a `--stage` run that names `snap` stages the
//      SAME payload the `.deb` is built from — "a row plus a packer, no new staging".
//   2. REAL (only where `snapcraft` is installed, and the skip is PRINTED). Build the snap and
//      read its `meta/snap.yaml` back with `unsquashfs`, a program this tree did not write.
//
// What only tier 2 can answer — does the `gnome` extension's launcher find `gjs` through the
// platform snap, which plugs an app needs — is recorded in ADR 0149 as not yet measured.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasCommand } from '../helpers.mjs';
import { runCliSync } from '../mock-registry.mjs';
import { APP_ID, CLI_ENTRY, listPayload, scaffold, STAGE_MANIFEST_FILE } from '../ship/fixture.mjs';

const BINARY = 'ship-demo';
const ARCH_LABEL = process.arch === 'arm64' ? 'arm64' : 'amd64';
const ARTIFACT = `${BINARY}_1.2.3_${ARCH_LABEL}.snap`;

describe('CLI ship Snap E2E', { timeout: 20 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let stageDir;
    let staged;
    let defaultStage;
    let defaultPayload;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-snap-'));
        projectDir = scaffold(join(tmpDir, 'app'));
        mkdirSync(projectDir, { recursive: true });
        stageDir = join(projectDir, 'ship', 'stage');
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--stage'], { cwd: projectDir });
        defaultStage = JSON.parse(readFileSync(join(stageDir, STAGE_MANIFEST_FILE), 'utf-8'));
        defaultPayload = listPayload(stageDir);
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--stage', '--target', 'deb,rpm,snap'], {
            cwd: projectDir,
        });
        staged = listPayload(stageDir);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('stays out of a bare `gjsify ship linux`, so no project grows a new tool requirement', () => {
        assert.deepEqual([...defaultStage.formats].sort(), ['deb', 'rpm']);
    });

    it('needs NOTHING staged of its own — the snap wraps the payload the .deb wraps', () => {
        assert.deepEqual(staged, defaultPayload);
        assert.ok(staged.includes(`bin/${BINARY}`));
        assert.ok(staged.includes(`share/applications/${APP_ID}.desktop`));
    });

    it('refuses to pack when snapcraft is absent, and names the tool and the way across', () => {
        const emptyPath = join(tmpDir, 'no-tools');
        mkdirSync(emptyPath, { recursive: true });
        let stderr = '';
        let status = 0;
        try {
            runCliSync(CLI_ENTRY, ['ship', '--from-stage', 'ship/stage', '--target', 'snap'], {
                cwd: projectDir,
                env: { ...process.env, PATH: emptyPath },
            });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        }
        assert.notEqual(status, 0, 'packing a snap with no snapcraft must fail');
        assert.match(stderr, /snapcraft/);
        assert.match(stderr, /--stage/);
        assert.equal(existsSync(join(projectDir, 'ship', 'out')), false, 'a refused pack writes no artifact');
    });

    it('builds a real snap and reads its metadata back', () => {
        if (!hasCommand('snapcraft') || !hasCommand('unsquashfs')) {
            console.log('  ↳ SKIPPED: snapcraft and unsquashfs are not both on PATH.');
            return;
        }
        runCliSync(CLI_ENTRY, ['ship', 'linux', '--skip-build', '--target', 'snap'], { cwd: projectDir });
        const artifact = join(projectDir, 'ship', 'out', ARTIFACT);
        assert.ok(existsSync(artifact), `${ARTIFACT} was not produced`);
        const read = spawnSync('unsquashfs', ['-cat', artifact, 'meta/snap.yaml'], { encoding: 'utf-8' });
        assert.equal(read.status, 0, read.stderr);
        assert.match(read.stdout, new RegExp(`^name: ${BINARY}$`, 'm'));
        assert.match(read.stdout, /^base: core26$/m);
        assert.match(read.stdout, /^confinement: strict$/m);
    });
});
