// The model cache and the Web Speech on-device additions (`available()`, `install()`),
// pinned against the Web Speech API draft of 27 Oct 2026:
//
//   • `langs` is a list of BCP 47 tags; an invalid tag REJECTS with SyntaxError.
//   • `available()` of an empty list is `unavailable`; the answer for several languages
//     is the WORST one: available < downloading < downloadable < unavailable.
//   • `install()` resolves `false` for an empty list or a language no model serves, and
//     `processLocally` plays no part in it. The spec's transient-activation
//     NotAllowedError has no GJS analogue and is not raised.
//
// Download, verification and placement are `@gjsify/model-store`'s (ADR 0132 § 5).

import { ModelStore, type FetchLike, type ModelAvailability } from '@gjsify/model-store';

import { hasRecognitionBackend } from './backend.js';
import {
    DEFAULT_RECOGNITION_MODEL,
    modelFor,
    RECOGNITION_MODELS,
    type RecognitionModelEntry,
    type RecognitionQuality,
} from './model-manifest.js';
import { syntaxError } from './results.js';

export type SpeechRecognitionAvailability = ModelAvailability;

export interface SpeechRecognitionOptions {
    langs: string[];
    /** Spec default `false`. Plays no part here: every engine in this package is local. */
    processLocally?: boolean;
    /** Spec default `command`. A model that cannot honestly serve it is `unavailable`. */
    quality?: RecognitionQuality;
}

export interface SpeechRecognitionInstallOptions {
    langs: string[];
    quality?: RecognitionQuality;
    /** Called at least once, with `received === total` on success. */
    onProgress?: (progress: { modelId: string; received: number; total: number }) => void;
    signal?: AbortSignal;
    /** Override the global `fetch`. Tests only. */
    fetchImpl?: FetchLike;
}

const store = new ModelStore<RecognitionModelEntry>({
    capability: 'speech',
    models: RECOGNITION_MODELS,
    defaultModel: DEFAULT_RECOGNITION_MODEL,
});

/** `<user cache>/gjsify/models/speech` — shared with `@gjsify/vad`. */
export function modelCacheDir(): string {
    return store.cacheDir;
}

/** Absolute paths of a model's files, for the engine. Throws when it is not cached. */
export function resolveRecognitionModel(entry: RecognitionModelEntry): Record<string, string> {
    const located = store.locate(entry.id);
    if (located === undefined) {
        throw new Error(
            `Recognition model '${entry.id}' is not cached (${store.cachePath(entry.id)}) — await SpeechRecognition.install() first.`,
        );
    }
    return located.files;
}

/** Whether `entry` is fully cached. */
export function isModelCached(entry: RecognitionModelEntry): boolean {
    return store.locate(entry.id) !== undefined;
}

/** Throws SyntaxError unless `tag` is a structurally valid BCP 47 language tag. */
export function validateLanguageTag(tag: string): void {
    try {
        if (typeof tag !== 'string' || tag === '') throw new RangeError('empty');
        new Intl.Locale(tag);
    } catch {
        throw syntaxError(`'${tag}' is not a valid BCP 47 language tag`);
    }
}

const WORSENESS: Record<ModelAvailability, number> = { available: 0, downloading: 1, downloadable: 2, unavailable: 3 };

function statusFor(lang: string, quality: RecognitionQuality): ModelAvailability {
    const entry = modelFor(lang, quality);
    if (entry === undefined || !hasRecognitionBackend()) return 'unavailable';
    return store.availability(entry.id);
}

/** `SpeechRecognition.available()`. QUIET: never downloads, never loads a model. */
export async function available(options: SpeechRecognitionOptions): Promise<SpeechRecognitionAvailability> {
    const langs = options?.langs;
    if (!Array.isArray(langs)) throw new TypeError('available(): options.langs must be an array of BCP 47 tags');
    for (const tag of langs) validateLanguageTag(tag);
    if (langs.length === 0) return 'unavailable';
    const quality = options.quality ?? 'command';
    return langs
        .map((lang) => statusFor(lang, quality))
        .reduce((worst, next) => (WORSENESS[next] > WORSENESS[worst] ? next : worst), 'available' as ModelAvailability);
}

/** `SpeechRecognition.install()`: fetch what `available()` would call `downloadable`. */
export async function install(options: SpeechRecognitionInstallOptions): Promise<boolean> {
    const langs = options?.langs;
    if (!Array.isArray(langs)) throw new TypeError('install(): options.langs must be an array of BCP 47 tags');
    for (const tag of langs) validateLanguageTag(tag);
    if (langs.length === 0) return false;
    const quality = options.quality ?? 'command';
    const entries = langs.map((lang) => modelFor(lang, quality));
    if (entries.some((entry) => entry === undefined) || !hasRecognitionBackend()) return false;

    const { onProgress } = options;
    try {
        for (const entry of new Set(entries as RecognitionModelEntry[])) {
            await store.install(entry.id, {
                signal: options.signal,
                fetch: options.fetchImpl,
                monitor:
                    onProgress === undefined
                        ? undefined
                        : (monitor) =>
                              monitor.addEventListener('downloadprogress', (event) => {
                                  const { receivedBytes, totalBytes } = event as unknown as {
                                      receivedBytes: number;
                                      totalBytes: number;
                                  };
                                  onProgress({ modelId: entry.id, received: receivedBytes, total: totalBytes });
                              }),
            });
        }
        return true;
    } catch {
        return false;
    }
}

/** Delete the cached files for `id`. `false` when there was nothing to delete. */
export function uninstall(id: string = DEFAULT_RECOGNITION_MODEL): boolean {
    store.require(id);
    try {
        return store.uninstall(id);
    } catch {
        return false;
    }
}
