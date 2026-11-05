// One model store per capability (ADR 0132 § 5): where a model is, whether it
// is there, and how it gets there.
//
// THREE SOURCES, IN ORDER: a path the app configures (a model the person
// already has), a directory the app ships read-only, then the cache —
// downloading into it only on `install()`. Plus, once, the directory an older
// release used: a file found there is moved into the cache and never read
// from there again.
//
// DIGESTS COVER EVERY SOURCE, but not on every call. A cache file was hashed
// on the way in and only renamed into place afterwards, so its size is enough
// to tell it from an interrupted copy. A configured or app-shipped file was
// never hashed by us, so `resolve()` hashes it once per process and remembers
// the answer for that size and mtime. `locate()` is the cheap, synchronous
// half: it checks sizes only and never reads a byte of a model.

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { modelsRoot } from './cache-dir.js';
import { validateManifest, type ModelEntry } from './manifest.js';
import { ProgressFanout, type CreateMonitorCallback } from './progress.js';

/**
 * The WebML CG availability states. The store itself never answers
 * `unavailable` — that is the capability's verdict (no engine, or `checkFit`
 * says `none`) — but the type is shared so the capability can return either.
 */
export type ModelAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

/** Where {@link ModelStore.locate} found a model. */
export type ModelSource = 'configured' | 'app-data' | 'cache';

export interface LocatedModel {
    readonly path: string;
    readonly source: ModelSource;
}

/** The subset of `fetch` the store uses, so a test can inject one. */
export type FetchLike = (
    url: string,
    init: { signal?: AbortSignal; redirect?: 'follow' },
) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface ModelStoreOptions<E extends ModelEntry> {
    /** Directory name under the models root: `speech`, `embeddings`, `image`. Lowercase, digits, dashes. */
    readonly capability: string;
    readonly models: readonly E[];
    /** The id `undefined` means. Default: the first entry. */
    readonly defaultModel?: string;
    /** Override `<user cache>/gjsify/models`. Tests, or an app that keeps models elsewhere. */
    readonly root?: string;
    /** Directories an app ships models in, read-only. Searched before the cache. */
    readonly appDataDirs?: readonly string[];
    /**
     * Directories an older release cached into. A match is moved into the
     * cache once. A function is called per lookup, so a directory derived from
     * the user cache follows a changed `XDG_CACHE_HOME` the way `cacheDir` does.
     */
    readonly legacyDirs?: readonly string[] | (() => readonly string[]);
    /** Override the global `fetch`. */
    readonly fetch?: FetchLike;
}

export interface LocateOptions {
    /** A file the app was told to use for this id. Must exist and have the manifest's size. */
    readonly path?: string;
}

export interface ResolveOptions extends LocateOptions {
    readonly signal?: AbortSignal;
}

export interface InstallOptions extends ResolveOptions {
    /** Receives an EventTarget firing `downloadprogress`, at least at 0 and 1. */
    readonly monitor?: CreateMonitorCallback;
    /** Re-fetch into the cache even when a source already has the model. */
    readonly force?: boolean;
    /** Override the store's `fetch` for this call. */
    readonly fetch?: FetchLike;
}

const CAPABILITY = /^[a-z0-9][a-z0-9-]*$/;

function sizeOf(path: string): number | null {
    try {
        const stats = statSync(path);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
}

function removeQuietly(path: string): void {
    try {
        unlinkSync(path);
    } catch {
        // Already gone, or never created. The failure that led here is what matters.
    }
}

/** Hex SHA-256 of a file, read in 1 MiB slices so a 548 MB model never sits in memory. */
export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
    const hash = createHash('sha256');
    const handle = await open(path, 'r');
    try {
        const buffer = new Uint8Array(1024 * 1024);
        for (;;) {
            signal?.throwIfAborted();
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
        }
    } finally {
        await handle.close();
    }
    return hash.digest('hex');
}

interface Download {
    readonly promise: Promise<string>;
    readonly progress: ProgressFanout;
}

export class ModelStore<E extends ModelEntry = ModelEntry> {
    readonly capability: string;
    readonly models: readonly E[];
    readonly defaultModel: string;
    readonly #root: string | undefined;
    readonly #appDataDirs: readonly string[];
    readonly #legacyDirs: () => readonly string[];
    readonly #fetch: FetchLike | undefined;
    readonly #inFlight = new Map<string, Download>();
    /** path → `size:mtime` of the file whose digest matched. */
    readonly #verified = new Map<string, string>();

    constructor(options: ModelStoreOptions<E>) {
        if (!CAPABILITY.test(options.capability)) {
            throw new Error(`ModelStore: capability '${options.capability}' is not a lowercase directory name`);
        }
        if (options.models.length === 0) throw new Error(`ModelStore '${options.capability}': no models`);
        validateManifest(options.models);
        this.capability = options.capability;
        this.models = options.models;
        this.defaultModel = options.defaultModel ?? options.models[0].id;
        this.#root = options.root;
        this.#appDataDirs = options.appDataDirs ?? [];
        const legacy = options.legacyDirs ?? [];
        this.#legacyDirs = typeof legacy === 'function' ? legacy : () => legacy;
        this.#fetch = options.fetch;
        this.require(this.defaultModel);
    }

    /** `<root>/<capability>`. Resolved per call, so a changed `XDG_CACHE_HOME` is honoured. */
    get cacheDir(): string {
        return join(this.#root ?? modelsRoot(), this.capability);
    }

    find(id: string = this.defaultModel): E | undefined {
        return this.models.find((entry) => entry.id === id);
    }

    /** The entry for `id`, or a `RangeError` naming the ids that exist. */
    require(id: string = this.defaultModel): E {
        const entry = this.find(id);
        if (entry === undefined) {
            const known = this.models.map((m) => m.id).join(', ');
            throw new RangeError(`Unknown ${this.capability} model '${id}' — known ids: ${known}`);
        }
        return entry;
    }

    /** Where `id` is cached, whether or not it is there yet. */
    cachePath(id: string = this.defaultModel): string {
        return join(this.cacheDir, this.require(id).file);
    }

    /**
     * Where `id` is, by size only. Synchronous, reads no model bytes, never
     * downloads. Moves a file from a legacy directory into the cache on the
     * way. Throws for a configured path that is missing or has the wrong size:
     * the app said the person has this file, so falling through to a download
     * would be the surprise.
     */
    locate(id: string = this.defaultModel, options: LocateOptions = {}): LocatedModel | undefined {
        const entry = this.require(id);
        if (options.path !== undefined) {
            const size = sizeOf(options.path);
            if (size !== entry.bytes) {
                const found = size === null ? 'no file' : `${size} bytes`;
                throw new Error(
                    `${this.capability} model '${entry.id}': ${options.path} has ${found}, expected ${entry.bytes}`,
                );
            }
            return { path: options.path, source: 'configured' };
        }
        for (const dir of this.#appDataDirs) {
            const path = join(dir, entry.file);
            if (sizeOf(path) === entry.bytes) return { path, source: 'app-data' };
        }
        const cached = join(this.cacheDir, entry.file);
        if (sizeOf(cached) === entry.bytes) return { path: cached, source: 'cache' };
        if (this.#migrate(entry, cached)) return { path: cached, source: 'cache' };
        return undefined;
    }

    /** `available` when a source has it, `downloading` while `install()` runs, else `downloadable`. */
    availability(id: string = this.defaultModel, options: LocateOptions = {}): ModelAvailability {
        const entry = this.require(id);
        if (this.locate(entry.id, options) !== undefined) return 'available';
        return this.#inFlight.has(entry.id) ? 'downloading' : 'downloadable';
    }

    /** Ids some source has, in manifest order. */
    installed(): string[] {
        return this.models.filter((entry) => this.locate(entry.id) !== undefined).map((entry) => entry.id);
    }

    /**
     * The verified path of `id`. Never downloads: rejects when no source has
     * it, and when a configured or app-shipped file fails its digest.
     */
    async resolve(id: string = this.defaultModel, options: ResolveOptions = {}): Promise<string> {
        const entry = this.require(id);
        const located = this.locate(entry.id, options);
        if (located === undefined) {
            throw new Error(
                `${this.capability} model '${entry.id}' is not installed — await install('${entry.id}') first. ` +
                    `${entry.bytes} bytes from ${entry.url}.`,
            );
        }
        if (located.source !== 'cache') await this.#verify(entry, located.path, options.signal);
        return located.path;
    }

    /**
     * Make `id` usable, fetching it into the cache when no source has it.
     * Resolves to its verified path. Two overlapping calls share one download
     * and both get progress; aborting either caller's signal aborts it for both.
     * Every failure is a rejection, an unknown id included.
     */
    install(id: string = this.defaultModel, options: InstallOptions = {}): Promise<string> {
        let entry: E;
        try {
            entry = this.require(id);
            if (!options.force && this.locate(entry.id, options) !== undefined) {
                const progress = new ProgressFanout(entry.id);
                progress.add(options.monitor);
                return this.resolve(entry.id, options).then((path) => {
                    progress.report(entry.bytes, entry.bytes);
                    return path;
                });
            }
        } catch (error) {
            return Promise.reject(error);
        }

        const running = this.#inFlight.get(entry.id);
        if (running !== undefined) {
            running.progress.add(options.monitor);
            return running.promise;
        }
        const progress = new ProgressFanout(entry.id);
        progress.add(options.monitor);
        const promise = this.#download(entry, progress, options).finally(() => this.#inFlight.delete(entry.id));
        this.#inFlight.set(entry.id, { promise, progress });
        return promise;
    }

    /** Delete the CACHED file of `id` — never a configured or app-shipped one. `false` when none was there. */
    uninstall(id: string = this.defaultModel): boolean {
        const path = this.cachePath(id);
        if (sizeOf(path) === null) return false;
        unlinkSync(path);
        return true;
    }

    #migrate(entry: E, target: string): boolean {
        for (const dir of this.#legacyDirs()) {
            const old = join(dir, entry.file);
            if (sizeOf(old) !== entry.bytes) continue;
            try {
                mkdirSync(this.cacheDir, { recursive: true });
                try {
                    renameSync(old, target);
                } catch {
                    // Another filesystem (EXDEV) or a read-only old dir: copy under a
                    // temporary name so a reader never sees half a file, then drop the old one.
                    const partial = `${target}.part-${randomUUID()}`;
                    try {
                        copyFileSync(old, partial);
                        renameSync(partial, target);
                    } catch (error) {
                        removeQuietly(partial);
                        throw error;
                    }
                    removeQuietly(old);
                }
                return true;
            } catch {
                // A cache we cannot write is not a reason to fail a lookup; the
                // model is simply not in the cache yet.
                return false;
            }
        }
        return false;
    }

    async #verify(entry: E, path: string, signal?: AbortSignal): Promise<void> {
        const stats = statSync(path);
        const stamp = `${stats.size}:${stats.mtimeMs}`;
        if (this.#verified.get(path) === stamp) return;
        const digest = await sha256File(path, signal);
        if (digest !== entry.sha256) {
            throw new Error(
                `${this.capability} model '${entry.id}': ${path} has sha256 ${digest}, expected ${entry.sha256}`,
            );
        }
        this.#verified.set(path, stamp);
    }

    async #download(entry: E, progress: ProgressFanout, options: InstallOptions): Promise<string> {
        const signal = options.signal;
        const doFetch: FetchLike =
            options.fetch ?? this.#fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
        const response = await doFetch(entry.url, { signal, redirect: 'follow' });
        if (!response.ok) {
            throw new Error(`Downloading ${entry.id} from ${entry.url} failed: HTTP ${response.status}`);
        }
        // Refused before a byte is read. A server that sends no length is not
        // refused here: the running size check and the digest still cover it.
        const declared = response.headers.get('content-length');
        if (declared !== null && Number(declared) !== entry.bytes) {
            throw new Error(
                `Downloading ${entry.id} refused: ${entry.url} declares ${declared} bytes, the manifest says ${entry.bytes}`,
            );
        }

        const dir = this.cacheDir;
        const target = join(dir, entry.file);
        mkdirSync(dir, { recursive: true });
        // Written under a unique name and RENAMED into place, in the same
        // directory: a reader sees no file or the whole verified one, never a part.
        const partial = `${target}.part-${randomUUID()}`;
        const fd = openSync(partial, 'w');
        let closed = false;
        try {
            const hash = createHash('sha256');
            let received = 0;
            const write = (chunk: Uint8Array) => {
                received += chunk.length;
                // Checked per chunk, so a server streaming past the size cannot fill the disk.
                if (received > entry.bytes) {
                    throw new Error(`Downloading ${entry.id} failed: more than the manifest's ${entry.bytes} bytes`);
                }
                hash.update(chunk);
                writeSync(fd, chunk);
                progress.report(received, entry.bytes);
            };
            progress.report(0, entry.bytes);

            const reader = response.body?.getReader();
            if (reader !== undefined) {
                try {
                    for (;;) {
                        signal?.throwIfAborted();
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value !== undefined && value.length > 0) write(value);
                    }
                } catch (error) {
                    await reader.cancel().catch(() => undefined);
                    throw error;
                }
            } else {
                write(new Uint8Array(await response.arrayBuffer()));
            }

            if (received !== entry.bytes) {
                throw new Error(`Downloading ${entry.id} failed: got ${received} bytes, expected ${entry.bytes}`);
            }
            const digest = hash.digest('hex');
            if (digest !== entry.sha256) {
                throw new Error(`Downloading ${entry.id} failed: sha256 ${digest}, expected ${entry.sha256}`);
            }
            closeSync(fd);
            closed = true;
            renameSync(partial, target);
            progress.report(entry.bytes, entry.bytes);
            return target;
        } catch (error) {
            if (!closed) closeSync(fd);
            removeQuietly(partial);
            throw error;
        }
    }
}
