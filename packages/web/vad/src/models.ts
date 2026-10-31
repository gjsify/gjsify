// The model cache: where a Silero model lives, whether it is there, and how it
// gets there (ADR 0127 decision 8 — models are NEVER bundled).
//
// `available()` / `install()` are named after the Web Speech on-device
// additions so an app that already branches on `SpeechRecognition.available()`
// reads the same here. `available()` deliberately answers `unavailable` when
// the native engine is missing: fetching a model for an engine that is not
// installed is the one outcome a download prompt must never produce.
//
// THE DOWNLOAD IS BUFFERED WHOLE. `install()` calls `response.arrayBuffer()`,
// so the model is in memory once before it reaches disk. That is a deliberate
// limit, not an oversight: the largest entry in the manifest is 2.2 MiB, the
// digest has to cover the whole file anyway, and `Content-Length` is refused
// up front when it disagrees with the manifest, so a hostile or broken server
// cannot grow the buffer. A streaming-to-disk install belongs in whichever
// package first ships a model where that matters (the 548 MB recognition
// weights of ADR 0127, not these).

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import fetch from '@gjsify/fetch';

import { DEFAULT_VAD_MODEL, requireVadModel, VAD_MODELS, type VadModelEntry } from './model-manifest.js';
import { hasVadBackend } from './backend.js';

/**
 * What `available()` answers, as the Web Speech on-device additions spell it:
 *
 *   • `available`    — the file is cached and verified-by-size; use it now.
 *   • `downloading`  — an `install()` for this id is in flight in this process.
 *   • `downloadable` — the engine is here, the file is not; `install()` fetches it.
 *   • `unavailable`  — no native engine on this host, so no model helps.
 */
export type VadModelAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

export interface InstallProgress {
    readonly modelId: string;
    /** Bytes written so far. Jumps straight to `total` — see the header on buffering. */
    readonly received: number;
    /** The manifest's size for this model. */
    readonly total: number;
}

export interface InstallOptions {
    /** Called at least once, with `received === total` on success. */
    onProgress?: (progress: InstallProgress) => void;
    /** Abort the fetch. */
    signal?: AbortSignal;
    /** Override `fetch` from `@gjsify/fetch`. Tests only. */
    fetchImpl?: typeof fetch;
    /** Re-fetch and overwrite a cached file instead of returning it. */
    force?: boolean;
}

/** `GLib.get_user_cache_dir()/gjsify/speech-models` — shared with the other ADR 0127 packages. */
export function modelCacheDir(): string {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'gjsify', 'speech-models']);
}

/** Where `id` is cached, whether or not it exists yet. */
export function modelPath(id: string = DEFAULT_VAD_MODEL): string {
    return GLib.build_filenamev([modelCacheDir(), requireVadModel(id).file]);
}

/** In-flight installs, keyed by model id — two callers racing get one download. */
const inFlight = new Map<string, Promise<string>>();

function sizeOf(path: string): number | null {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        return info.get_size();
    } catch {
        return null;
    }
}

/**
 * Whether `path` is the file `entry` describes, by SIZE only.
 *
 * The cheap half of the verification, and the one that runs on every
 * `available()`: a wrong size is the failure that actually happens to a cache
 * (an interrupted copy, a half-written file from an older version of this
 * code). The digest is the expensive half and runs once, in `install()`, on
 * the bytes before they are named — re-hashing 2.2 MiB on every query would
 * buy nothing, because a file that passed the digest on the way in cannot
 * change size without changing content.
 */
function isCached(entry: VadModelEntry): boolean {
    return sizeOf(GLib.build_filenamev([modelCacheDir(), entry.file])) === entry.bytes;
}

/** Hex SHA-256 of `bytes`, lowercase — the form the manifest records. */
function sha256(bytes: Uint8Array): string {
    const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
    checksum.update(bytes);
    const hex = checksum.get_string();
    if (hex === null) throw new Error('GLib.Checksum returned no digest');
    return hex.toLowerCase();
}

/**
 * Whether this host can run a VAD with `id`, and what it would take.
 *
 * QUIET and synchronous. Never downloads, never loads a model, and never
 * throws for a host without an engine — only for an id the manifest does not
 * have, which is a programming error rather than a host condition.
 */
export function available(id: string = DEFAULT_VAD_MODEL): VadModelAvailability {
    const entry = requireVadModel(id);
    if (!hasVadBackend()) return 'unavailable';
    if (isCached(entry)) return 'available';
    if (inFlight.has(entry.id)) return 'downloading';
    return 'downloadable';
}

/** Every manifest entry with what it would take, for a settings panel. */
export function listModels(): { entry: VadModelEntry; availability: VadModelAvailability }[] {
    return VAD_MODELS.map((entry) => ({ entry, availability: available(entry.id) }));
}

/** Cached model ids, in manifest order. */
export function installedModels(): string[] {
    return VAD_MODELS.filter(isCached).map((entry) => entry.id);
}

async function download(entry: VadModelEntry, options: InstallOptions): Promise<string> {
    const dir = modelCacheDir();
    const target = GLib.build_filenamev([dir, entry.file]);

    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(entry.url, { signal: options.signal, redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`Downloading ${entry.id} from ${entry.url} failed: HTTP ${response.status}`);
    }

    // Refused BEFORE the body is read, so a wrong Content-Length costs no memory.
    // A server that sends none is not refused here — the digest still covers it.
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== entry.bytes) {
        throw new Error(
            `Downloading ${entry.id} refused: ${entry.url} declares ${declared} bytes, the manifest says ${entry.bytes}`,
        );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== entry.bytes) {
        throw new Error(`Downloading ${entry.id} failed: got ${bytes.length} bytes, expected ${entry.bytes}`);
    }
    const digest = sha256(bytes);
    if (digest !== entry.sha256) {
        throw new Error(`Downloading ${entry.id} failed: sha256 ${digest}, expected ${entry.sha256}`);
    }

    // The directory is created only once there are verified bytes for it, so a
    // refused download leaves no trace in the cache at all.
    GLib.mkdir_with_parents(dir, 0o755);

    // Written under a unique name and RENAMED into place: a reader (this
    // process or another) sees either no file or the whole verified one, never
    // the half this call has written so far. Same directory, so the rename is
    // atomic; `OVERWRITE` covers `force` and a concurrent winner alike.
    const partial = `${target}.part-${GLib.uuid_string_random()}`;
    const partialFile = Gio.File.new_for_path(partial);
    try {
        partialFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        partialFile.move(Gio.File.new_for_path(target), Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (error) {
        try {
            partialFile.delete(null);
        } catch {
            // The temporary file is already gone, or the directory is not writable
            // and never got one. Either way the original failure is what matters.
        }
        throw error;
    }

    options.onProgress?.({ modelId: entry.id, received: entry.bytes, total: entry.bytes });
    return target;
}

/**
 * Make `id` usable, fetching it if it is not cached. Resolves to its path.
 *
 * Idempotent and safe to call concurrently: a cached file returns immediately
 * and two overlapping calls share one download. Rejects when the host has no
 * native engine — `install()` is a commitment to a 2.2 MiB fetch, so it does
 * not quietly succeed into a state where `createVad()` still cannot run.
 *
 * EVERY failure is a rejection, including an unknown id: a function that
 * returns a promise and sometimes throws before it has to be awaited needs two
 * error paths at every call site.
 */
export function install(id: string = DEFAULT_VAD_MODEL, options: InstallOptions = {}): Promise<string> {
    let entry: VadModelEntry;
    try {
        entry = requireVadModel(id);
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

    const target = GLib.build_filenamev([modelCacheDir(), entry.file]);
    if (!options.force && isCached(entry)) {
        options.onProgress?.({ modelId: entry.id, received: entry.bytes, total: entry.bytes });
        return Promise.resolve(target);
    }

    const running = inFlight.get(entry.id);
    if (running !== undefined) return running;

    const started = download(entry, options).finally(() => inFlight.delete(entry.id));
    inFlight.set(entry.id, started);
    return started;
}

/** Delete the cached file for `id`. `false` when there was nothing to delete. */
export function uninstall(id: string = DEFAULT_VAD_MODEL): boolean {
    const entry = requireVadModel(id);
    try {
        return Gio.File.new_for_path(GLib.build_filenamev([modelCacheDir(), entry.file])).delete(null);
    } catch {
        return false;
    }
}

/**
 * Resolve `VadOptions.model` to a path on disk.
 *
 * A value containing a path separator is taken as a path and used as given —
 * that is how a caller points at a model this manifest does not know. Anything
 * else is a manifest id, and it must already be cached: resolving must not
 * start a download behind a synchronous constructor.
 */
export function resolveModel(model: string = DEFAULT_VAD_MODEL): string {
    if (model.includes('/') || model.includes('\\')) return model;
    const entry = requireVadModel(model);
    const path = GLib.build_filenamev([modelCacheDir(), entry.file]);
    if (!isCached(entry)) {
        throw new Error(
            `VAD model '${entry.id}' is not cached (${path}) — await install('${entry.id}') first, ` +
                `or pass a path to a model file. ${entry.bytes} bytes from ${entry.url}.`,
        );
    }
    return path;
}
