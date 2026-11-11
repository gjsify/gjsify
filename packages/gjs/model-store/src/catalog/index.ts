// Shared model catalog for all gjsify capability packages.
//
// Every entry here is measured from the real upstream file. Capability-specific
// behaviour stays in the package that uses the model and is composed on top.

import type { ModelEntry } from '../manifest.js';
import { EMBEDDING_MODELS } from './embeddings.js';
import { SPEECH_MODELS } from './speech.js';

/** One shared catalog entry: a {@link ModelEntry} plus its capability name. */
export interface CatalogEntry extends ModelEntry {
    /** Capability namespace the entry belongs to (e.g. `'speech'`, `'embeddings'`). */
    readonly capability: string;
    /** One line for a settings panel or a download prompt. */
    readonly description: string;
}

/** The whole shared catalog, in capability order. */
export const CATALOG: readonly CatalogEntry[] = [...SPEECH_MODELS, ...EMBEDDING_MODELS];

/** All catalog entries for `capability`. */
export function catalogFor(capability: string): readonly CatalogEntry[] {
    return CATALOG.filter((entry) => entry.capability === capability);
}

/** The catalog entry for `capability` and `id`, or `undefined`. */
export function findCatalogEntry(capability: string, id: string): CatalogEntry | undefined {
    return CATALOG.find((entry) => entry.capability === capability && entry.id === id);
}

/** The catalog entry for `capability` and `id`, or a `RangeError` naming the known ids. */
export function requireCatalogEntry(capability: string, id: string): CatalogEntry {
    const entry = findCatalogEntry(capability, id);
    if (entry === undefined) {
        const known = catalogFor(capability)
            .map((catalogEntry) => catalogEntry.id)
            .join(', ');
        throw new RangeError(`Unknown catalog entry '${id}' for capability '${capability}' — known ids: ${known}`);
    }
    return entry;
}
