import { describe, expect, it } from '@gjsify/unit';

import { validateManifest } from '../manifest.js';
import { CATALOG, catalogFor, findCatalogEntry, requireCatalogEntry, type CatalogEntry } from './index.js';

/** File facts keyed by digest so we can detect accidental drift across entries. */
function digestFacts(entries: readonly CatalogEntry[]): Map<string, { bytes: number; file: string }> {
    const map = new Map<string, { bytes: number; file: string }>();
    for (const entry of entries) {
        for (const file of entry.files) {
            const existing = map.get(file.sha256);
            if (existing === undefined) {
                map.set(file.sha256, { bytes: file.bytes, file: file.file });
            }
        }
    }
    return map;
}

export default async () => {
    await describe('catalog', async () => {
        await it('passes validateManifest for every capability', async () => {
            validateManifest(CATALOG);
            for (const capability of new Set(CATALOG.map((entry) => entry.capability))) {
                validateManifest(catalogFor(capability));
            }
        });

        await it('has unique ids per capability', async () => {
            const byCapability = new Map<string, Set<string>>();
            for (const entry of CATALOG) {
                const ids = byCapability.get(entry.capability) ?? new Set<string>();
                expect(ids.has(entry.id)).toBe(false);
                ids.add(entry.id);
                byCapability.set(entry.capability, ids);
            }
        });

        await it('has the same file name and byte size for every sha256', async () => {
            const facts = digestFacts(CATALOG);
            for (const entry of CATALOG) {
                for (const file of entry.files) {
                    const expected = facts.get(file.sha256);
                    expect(expected).toBeDefined();
                    expect(file.bytes).toBe(expected!.bytes);
                    expect(file.file).toBe(expected!.file);
                }
            }
        });

        await it('fetches every file over https', async () => {
            for (const entry of CATALOG) {
                for (const file of entry.files) {
                    expect(file.url.startsWith('https://')).toBe(true);
                }
            }
        });

        await it('finds and requires entries by capability and id', async () => {
            expect(findCatalogEntry('speech', 'silero-v5')).toBeDefined();
            expect(findCatalogEntry('speech', 'nope')).toBe(undefined);
            expect(() => requireCatalogEntry('speech', 'nope')).toThrow(RangeError);
            expect(() => requireCatalogEntry('speech', 'nope')).toThrow(/silero-v5/);
        });
    });
};
