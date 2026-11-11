// The Silero models this package knows how to fetch (ADR 0127 decision 8).
//
// The file facts live in `@gjsify/model-store/catalog`; this module composes
// the VAD-specific runtime behaviour (sampleRate, windowSize) on top.
//
// A TS MODULE, not a JSON file: `gjsify build` bundles the library into
// `lib/esm/index.js`, and a JSON import would turn into a path lookup that has
// to resolve relative to the bundle at runtime — on GJS, inside Flatpak, and
// from a consumer's own bundle. The manifest is a handful of constants; making
// them part of the module graph costs nothing and removes the question.

import { requireCatalogEntry } from '@gjsify/model-store/catalog';
import type { ModelEntry } from '@gjsify/model-store';

/** One fetchable Silero VAD model. `id` is what `available()`, `install()` and `VadOptions.model` take. */
export interface VadModelEntry extends ModelEntry {
    /** One line for a settings panel or a download prompt. */
    readonly description: string;
    /** Sample rate this entry has been measured at. */
    readonly sampleRate: number;
    /** Samples per inference window at {@link sampleRate}. */
    readonly windowSize: number;
}

/**
 * The default model. v5 is what ADR 0127 decision 10 names, and it is four
 * times the size of v4 — 2.2 MiB, which is small enough that the choice is
 * about accuracy rather than bandwidth.
 */
export const DEFAULT_VAD_MODEL = 'silero-v5';

function vadEntry(id: string, sampleRate: number, windowSize: number): VadModelEntry {
    const { capability: _capability, ...catalog } = requireCatalogEntry('speech', id);
    return {
        ...catalog,
        sampleRate,
        windowSize,
    };
}

export const VAD_MODELS: readonly VadModelEntry[] = [
    vadEntry('silero-v5', 16000, 512),
    vadEntry('silero-v4', 16000, 512),
];

/** The entry for `id`, or `undefined`. `id` may also be `undefined`, meaning {@link DEFAULT_VAD_MODEL}. */
export function findVadModel(id: string = DEFAULT_VAD_MODEL): VadModelEntry | undefined {
    return VAD_MODELS.find((entry) => entry.id === id);
}

/** The entry for `id`, or a `RangeError` naming the ids that do exist. */
export function requireVadModel(id: string = DEFAULT_VAD_MODEL): VadModelEntry {
    const entry = findVadModel(id);
    if (entry === undefined) {
        throw new RangeError(`Unknown VAD model '${id}' — known ids: ${VAD_MODELS.map((m) => m.id).join(', ')}`);
    }
    return entry;
}
