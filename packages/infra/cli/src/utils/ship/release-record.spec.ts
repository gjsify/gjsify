// The release record — ADR 0124. What the site reads to decide whether a
// download needs the "open an unsigned app" hint, so a wrong field here is a
// page that tells a visitor the wrong thing.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import {
    buildReleaseRecord,
    RELEASE_RECORD_SUFFIX,
    recordedSignature,
    releaseRecordPath,
    writeReleaseRecord,
} from './release-record.js';

function withArtifact(bytes: string, run: (file: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-release-record-spec-'));
    try {
        const file = join(dir, 'app-1.0.0-1.arm64.dmg');
        writeFileSync(file, bytes);
        run(file);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const base = {
    format: 'macos-app-dmg' as const,
    os: 'darwin' as const,
    arch: 'arm64',
    generator: '@gjsify/cli 0.0.0-test',
};

export default async () => {
    await describe('the release record', async () => {
        await it('names the record after its artifact', async () => {
            expect(releaseRecordPath('/o/a.dmg')).toBe('/o/a.dmg.gjsify-release.json');
            expect(RELEASE_RECORD_SUFFIX).toBe('.gjsify-release.json');
        });

        await it('maps no identity, the ad-hoc dash and a named identity to three kinds', async () => {
            expect(recordedSignature(undefined, '-')).toStrictEqual({ kind: 'none' });
            expect(recordedSignature('-', '-')).toStrictEqual({ kind: 'adhoc' });
            expect(recordedSignature('Developer ID Application: X (T)', '-')).toStrictEqual({
                kind: 'identity',
                identity: 'Developer ID Application: X (T)',
            });
        });

        await it('hashes the bytes on disk when it is built, not earlier', async () => {
            withArtifact('before', (file) => {
                // What a staple does: the file changes after it was first written.
                writeFileSync(file, 'after staple');
                const record = buildReleaseRecord({
                    ...base,
                    file,
                    signature: { kind: 'identity', identity: 'I' },
                    notarized: true,
                    stapled: true,
                });
                expect(record.sha256).toBe(createHash('sha256').update('after staple').digest('hex'));
                expect(record.size).toBe('after staple'.length);
                expect(record.artifact).toBe('app-1.0.0-1.arm64.dmg');
                expect(record.schema).toBe(1);
            });
        });

        await it('records a notarised zip that could not be stapled as exactly that', async () => {
            withArtifact('zip', (file) => {
                const record = buildReleaseRecord({
                    ...base,
                    format: 'macos-app-zip',
                    file,
                    signature: { kind: 'identity', identity: 'I' },
                    notarized: true,
                    stapled: false,
                });
                expect(record.notarized).toBe(true);
                expect(record.stapled).toBe(false);
            });
        });

        await it('writes JSON beside the artifact that reads back as the record', async () => {
            withArtifact('x', (file) => {
                const path = writeReleaseRecord({
                    ...base,
                    file,
                    signature: { kind: 'none' },
                    notarized: false,
                    stapled: false,
                });
                expect(path).toBe(`${file}${RELEASE_RECORD_SUFFIX}`);
                const read = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
                expect(read.signature).toStrictEqual({ kind: 'none' });
                expect(read.format).toBe('macos-app-dmg');
                expect(read.generator).toBe('@gjsify/cli 0.0.0-test');
            });
        });
    });
};
