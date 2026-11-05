import { describe, expect, it } from '@gjsify/unit';

import { validateManifest, type ModelEntry } from './manifest.js';

const good: ModelEntry = {
    id: 'tiny',
    file: 'tiny.bin',
    url: 'https://example.org/tiny.bin',
    bytes: 4,
    sha256: 'a'.repeat(64),
    license: 'MIT',
    redistributable: true,
};

export default async () => {
    await describe('validateManifest', async () => {
        await it('accepts a well-formed manifest', async () => {
            validateManifest([good, { ...good, id: 'other', file: 'other.bin' }]);
        });

        await it('refuses duplicate ids and reused files', async () => {
            expect(() => validateManifest([good, { ...good, file: 'x.bin' }])).toThrow(/twice/);
            expect(() => validateManifest([good, { ...good, id: 'x' }])).toThrow(/reuses file/);
        });

        await it('refuses a file name that would leave the cache dir', async () => {
            expect(() => validateManifest([{ ...good, file: '../evil' }])).toThrow(/plain file name/);
            expect(() => validateManifest([{ ...good, file: '..' }])).toThrow(/plain file name/);
        });

        await it('refuses a bad digest, size, URL or licence', async () => {
            expect(() => validateManifest([{ ...good, sha256: 'A'.repeat(64) }])).toThrow(/sha256/);
            expect(() => validateManifest([{ ...good, bytes: 0 }])).toThrow(/size 0/);
            expect(() => validateManifest([{ ...good, url: 'http://example.org/x' }])).toThrow(/https/);
            expect(() => validateManifest([{ ...good, license: '' }])).toThrow(/licence/);
        });
    });
};
