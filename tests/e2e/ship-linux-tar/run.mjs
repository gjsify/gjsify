// E2E test for the `linux-tar` / `linux-tar-flatpak` ship targets (ADR 0142).
//
// The artifacts are read back with GNU `tar`, which shares no code with the writer, and the
// packing phase runs `--from-stage` with the project DELETED, so a reach-back into the project
// fails here (same discriminator as tests/e2e/ship-from-stage).
//
// Asserted: the file list equals the staged payload (nothing else — no sidecar), the single top
// directory, the launcher's mode, and `gschemas.compiled` only in the Flatpak variant.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCliSync } from '../mock-registry.mjs';
import { CLI_ENTRY, listPayload, probe, scaffold } from '../ship/fixture.mjs';

const STAMP = '1700000000';
const TOP = 'ship-demo-1.2.3-linux-x86_64';

describe('gjsify ship --target linux-tar,linux-tar-flatpak', { skip: process.platform !== 'linux' }, () => {
    let tmpDir;
    let outDir;
    let payload;

    before(() => {
        probe('tar');
        probe('glib-compile-schemas');
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-ship-linux-tar-'));
        const projectDir = scaffold(join(tmpDir, 'project'));
        const env = { ...process.env, SOURCE_DATE_EPOCH: STAMP };
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--target', 'linux-tar,linux-tar-flatpak'], {
            cwd: projectDir,
            env,
        });

        const stage = join(tmpDir, 'detached', 'stage');
        mkdirSync(dirname(stage), { recursive: true });
        renameSync(join(projectDir, 'ship', 'stage'), stage);
        payload = listPayload(stage);
        rmSync(projectDir, { recursive: true, force: true });

        const nowhere = join(tmpDir, 'nowhere');
        mkdirSync(nowhere, { recursive: true });
        outDir = join(tmpDir, 'out', 'out');
        runCliSync(
            CLI_ENTRY,
            ['ship', '--from-stage', stage, '--target', 'linux-tar,linux-tar-flatpak', '--out', join(tmpDir, 'out')],
            { cwd: nowhere, env },
        );
    });

    after(() => {
        if (!process.env.GJSIFY_KEEP_E2E_TMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    const tarFiles = (name) =>
        execFileSync('tar', ['-tzf', join(outDir, name)], { encoding: 'utf8' })
            .split('\n')
            .filter((line) => line && !line.endsWith('/'))
            .sort();

    it('packs the payload and nothing else under one top directory', () => {
        const files = tarFiles(`${TOP}.tar.gz`);
        // The stage plus the licence overlay the packer renders (`licenseDest`), as for .rpm.
        const expected = [...payload, 'share/licenses/ship-demo/LICENSE'].map((rel) => `${TOP}/${rel}`).sort();
        assert.deepEqual(files, expected);
        assert.ok(!files.some((f) => f.includes('.gjsify-ship-stage')), 'the stage sidecar is not payload');
    });

    it('keeps the launcher executable', () => {
        const listing = execFileSync('tar', ['-tvzf', join(outDir, `${TOP}.tar.gz`)], { encoding: 'utf8' });
        const line = listing.split('\n').find((l) => l.endsWith(`${TOP}/bin/ship-demo`));
        assert.ok(line, 'launcher entry present');
        assert.match(line, /^-rwxr-xr-x/);
    });

    it('adds gschemas.compiled only in the Flatpak variant', () => {
        const cache = `${TOP}/share/glib-2.0/schemas/gschemas.compiled`;
        const plain = tarFiles(`${TOP}.tar.gz`);
        const flatpak = tarFiles(`${TOP}-flatpak.tar.gz`);
        assert.ok(!plain.includes(cache), 'plain variant has no compiled schemas');
        assert.ok(flatpak.includes(cache), 'flatpak variant carries compiled schemas');
        assert.deepEqual(
            flatpak.filter((f) => f !== cache),
            plain,
        );
        assert.ok(readFileSync(join(outDir, `${TOP}-flatpak.tar.gz`)).length > 0);
    });
});
