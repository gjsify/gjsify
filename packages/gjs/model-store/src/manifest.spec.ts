import { describe, expect, it } from '@gjsify/unit';

import { validateManifest, type ModelEntry } from './manifest.js';

const good: ModelEntry = {
    id: 'tiny',
    files: [
        {
            file: 'tiny.bin',
            url: 'https://example.org/tiny.bin',
            bytes: 4,
            sha256: 'a'.repeat(64),
        },
    ],
    license: 'MIT',
    redistributable: true,
};

export default async () => {
    await describe('validateManifest', async () => {
        await it('accepts a well-formed manifest', async () => {
            validateManifest([good, { ...good, id: 'other' }]);
        });

        await it('accepts several files in one entry', async () => {
            validateManifest([
                {
                    ...good,
                    files: [
                        {
                            file: 'encoder.onnx',
                            url: 'https://example.org/encoder.onnx',
                            bytes: 4,
                            sha256: 'a'.repeat(64),
                        },
                        {
                            file: 'decoder.onnx',
                            url: 'https://example.org/decoder.onnx',
                            bytes: 5,
                            sha256: 'b'.repeat(64),
                        },
                    ],
                },
            ]);
        });

        await it('refuses duplicate ids and duplicate files within an entry', async () => {
            expect(() => validateManifest([good, { ...good }])).toThrow(/twice/);
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [
                            { file: 'same.bin', url: 'https://example.org/a', bytes: 4, sha256: 'a'.repeat(64) },
                            { file: 'same.bin', url: 'https://example.org/b', bytes: 5, sha256: 'b'.repeat(64) },
                        ],
                    },
                ]),
            ).toThrow(/twice/);
        });

        await it('refuses an empty files array', async () => {
            expect(() => validateManifest([{ ...good, files: [] }])).toThrow(/no files/);
        });

        await it('refuses a file name that would leave the entry directory', async () => {
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [{ file: '../evil', url: 'https://example.org/x', bytes: 4, sha256: 'a'.repeat(64) }],
                    },
                ]),
            ).toThrow(/plain file name/);
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [{ file: '..', url: 'https://example.org/x', bytes: 4, sha256: 'a'.repeat(64) }],
                    },
                ]),
            ).toThrow(/plain file name/);
        });

        await it('refuses a bad digest, size, URL or licence', async () => {
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [{ file: 'tiny.bin', url: 'https://example.org/x', bytes: 4, sha256: 'A'.repeat(64) }],
                    },
                ]),
            ).toThrow(/sha256/);
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [{ file: 'tiny.bin', url: 'https://example.org/x', bytes: 0, sha256: 'a'.repeat(64) }],
                    },
                ]),
            ).toThrow(/size 0/);
            expect(() =>
                validateManifest([
                    {
                        ...good,
                        files: [{ file: 'tiny.bin', url: 'http://example.org/x', bytes: 4, sha256: 'a'.repeat(64) }],
                    },
                ]),
            ).toThrow(/https/);
            expect(() => validateManifest([{ ...good, license: '' }])).toThrow(/licence/);
        });
    });
};
