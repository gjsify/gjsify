// The model cache: where a Silero model lives, whether it is there, and how it
// gets there (ADR 0127 decision 8 — models are NEVER bundled). Download,
// verification and placement are `@gjsify/model-store`'s (ADR 0132 § 5); what
// stays here is the manifest and the one rule the store cannot know.
//
// `available()` / `install()` are named after the Web Speech on-device
// additions so an app that already branches on `SpeechRecognition.available()`
// reads the same here. `available()` deliberately answers `unavailable` when
// the native engine is missing: fetching a model for an engine that is not
// installed is the one outcome a download prompt must never produce.

import { join } from 'node:path';

import { ModelStore, userCacheDir, type FetchLike, type ModelAvailability } from '@gjsify/model-store';

import { DEFAULT_VAD_MODEL, VAD_MODELS, type VadModelEntry } from './model-manifest.js';
import { hasVadBackend } from './backend.js';

/**
 * What `available()` answers, as the Web Speech on-device additions spell it:
 *
 *   • `available`    — all files are cached and verified-by-size; use it now.
 *   • `downloading`  — an `install()` for this id is in flight in this process.
 *   • `downloadable` — the engine is here, the files are not; `install()` fetches them.
 *   • `unavailable`  — no native engine on this host, so no model helps.
 */
export type VadModelAvailability = ModelAvailability;

export interface InstallProgress {
    readonly modelId: string;
    /** Bytes written so far. */
    readonly received: number;
    /** The manifest's total size for this model. */
    readonly total: number;
}

export interface InstallOptions {
    /** Called at least once, with `received === total` on success. */
    onProgress?: (progress: InstallProgress) => void;
    /** Abort the fetch. */
    signal?: AbortSignal;
    /** Override the global `fetch`. Tests only. */
    fetchImpl?: FetchLike;
    /** Re-fetch and overwrite cached files instead of returning them. */
    force?: boolean;
}

/**
 * Shared with the other speech packages: `models/speech/`. Releases up to
 * 0.64 cached into `speech-models/`; a file found there is moved over once.
 */
const store = new ModelStore<VadModelEntry>({
    capability: 'speech',
    models: VAD_MODELS,
    defaultModel: DEFAULT_VAD_MODEL,
    legacyDirs: () => [join(userCacheDir(), 'gjsify', 'speech-models')],
    // `resolveModel` is synchronous and so cannot check a digest; a file from the
    // Hugging Face hub would reach the ONNX runtime on its size alone.
    huggingFaceCache: false,
});

/** `<user cache>/gjsify/models/speech` — shared with the other ADR 0127 packages. */
export function modelCacheDir(): string {
    return store.cacheDir;
}

/** Directory where `id` is cached, whether or not it exists yet. */
export function modelDir(id: string = DEFAULT_VAD_MODEL): string {
    return store.cachePath(id);
}

/**
 * Whether this host can run a VAD with `id`, and what it would take.
 *
 * QUIET and synchronous. Never downloads, never loads a model, and never
 * throws for a host without an engine — only for an id the manifest does not
 * have, which is a programming error rather than a host condition.
 */
export function available(id: string = DEFAULT_VAD_MODEL): VadModelAvailability {
    store.require(id);
    if (!hasVadBackend()) return 'unavailable';
    return store.availability(id);
}

/** Every manifest entry with what it would take, for a settings panel. */
export function listModels(): { entry: VadModelEntry; availability: VadModelAvailability }[] {
    return VAD_MODELS.map((entry) => ({ entry, availability: available(entry.id) }));
}

/** Cached model ids, in manifest order. */
export function installedModels(): string[] {
    return store.installed();
}

/**
 * Make `id` usable, fetching it if it is not cached. Resolves to its model file path.
 *
 * Idempotent and safe to call concurrently: a cached model returns immediately
 * and two overlapping calls share one download. Rejects when the host has no
 * native engine — `install()` is a commitment to a fetch, so it does not
 * quietly succeed into a state where `createVad()` still cannot run.
 *
 * EVERY failure is a rejection, including an unknown id: a function that
 * returns a promise and sometimes throws before it has to be awaited needs two
 * error paths at every call site.
 */
export function install(id: string = DEFAULT_VAD_MODEL, options: InstallOptions = {}): Promise<string> {
    let entry: VadModelEntry;
    try {
        entry = store.require(id);
    } catch (error) {
        return Promise.reject(error);
    }
    if (!hasVadBackend()) {
        return Promise.reject(
            new Error(
                `install('${entry.id}'): no native VAD engine on this host, so a model would be unusable — ` +
                    'gate on available() and show describeVadBackend() instead.',
            ),
        );
    }
    const { onProgress } = options;
    return store
        .install(entry.id, {
            signal: options.signal,
            force: options.force,
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
        })
        .then((resolved) => resolved.files[entry.files[0].file]);
}

/** Delete the cached files for `id`. `false` when there was nothing to delete. */
export function uninstall(id: string = DEFAULT_VAD_MODEL): boolean {
    store.require(id);
    try {
        return store.uninstall(id);
    } catch {
        return false;
    }
}

/**
 * Resolve `VadOptions.model` to a path on disk.
 *
 * A value containing a path separator is taken as a directory and used as given —
 * that is how a caller points at a model this manifest does not know. Anything
 * else is a manifest id, and it must already be cached: resolving must not
 * start a download behind a synchronous constructor.
 */
export function resolveModel(model: string = DEFAULT_VAD_MODEL): string {
    if (model.includes('/') || model.includes('\\')) return model;
    const entry = store.require(model);
    const located = store.locate(entry.id);
    if (located === undefined) {
        const totalBytes = entry.files.reduce((sum, file) => sum + file.bytes, 0);
        throw new Error(
            `VAD model '${entry.id}' is not cached (${store.cachePath(entry.id)}) — await install('${entry.id}') first, ` +
                `or pass a directory containing a model file. ${totalBytes} bytes from ${entry.files[0].url}.`,
        );
    }
    return located.files[entry.files[0].file];
}
