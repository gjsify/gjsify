// The Silero models this package knows how to fetch (ADR 0127 decision 8).
//
// A TS MODULE, not a JSON file: `gjsify build` bundles the library into
// `lib/esm/index.js`, and a JSON import would turn into a path lookup that has
// to resolve relative to the bundle at runtime — on GJS, inside Flatpak, and
// from a consumer's own bundle. The manifest is a handful of constants; making
// them part of the module graph costs nothing and removes the question.
//
// EVERY FIELD IS MEASURED. `bytes` and `sha256` were taken from the files that
// `install()` writes, and they are the whole verification: a truncated download
// and a mirror serving the wrong revision both fail on them. Updating a model
// means re-measuring both, never editing one.

/** One fetchable Silero VAD model. */
export interface VadModelEntry {
    /** Stable id used by `available()`, `install()` and `VadOptions.model`. */
    readonly id: string;
    /** File name inside the cache directory. Upstream's own name, so a hand-placed file matches. */
    readonly file: string;
    /** Where it is fetched from. Upstream only — never a mirror of ours. */
    readonly url: string;
    /** Exact size in bytes. */
    readonly bytes: number;
    /** SHA-256 of the file, lowercase hex. */
    readonly sha256: string;
    /** SPDX id of the MODEL's licence, which is not this package's. */
    readonly license: string;
    /** Sample rate this entry has been measured at. */
    readonly sampleRate: number;
    /** Samples per inference window at {@link sampleRate}. */
    readonly windowSize: number;
    /** One line for a settings panel or a download prompt. */
    readonly description: string;
}

/**
 * The default model. v5 is what ADR 0127 decision 10 names, and it is four
 * times the size of v4 — 2.2 MiB, which is small enough that the choice is
 * about accuracy rather than bandwidth.
 */
export const DEFAULT_VAD_MODEL = 'silero-v5';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

export const VAD_MODELS: readonly VadModelEntry[] = [
    {
        id: 'silero-v5',
        file: 'silero_vad_v5.onnx',
        url: `${RELEASE}/silero_vad_v5.onnx`,
        bytes: 2313101,
        sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
        license: 'MIT',
        sampleRate: 16000,
        windowSize: 512,
        description: 'Silero VAD v5 (2.2 MiB) — the default. Takes input/state/sr; 16 kHz, 512-sample windows.',
    },
    {
        id: 'silero-v4',
        file: 'silero_vad.onnx',
        url: `${RELEASE}/silero_vad.onnx`,
        bytes: 643854,
        sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        license: 'MIT',
        sampleRate: 16000,
        windowSize: 512,
        description: 'Silero VAD v4 (0.6 MiB) — smaller and older. Only its 16 kHz branch is covered here.',
    },
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
