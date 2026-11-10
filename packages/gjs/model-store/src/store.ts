// One model store per capability (ADR 0132 § 5): where a model is, whether it
// is there, and how it gets there.
//
// THREE SOURCES, IN ORDER: a path the app configures (a model the person
// already has), a directory the app ships read-only, then the cache —
// downloading into it only on `install()`. Plus, once, the directory an older
// release used: a file found there is moved into the cache and never read
// from there again.
//
// Every entry lives in its own directory: `<root>/<capability>/<id>/<file>`.
// That lets several models each carry a `tokens.txt` without collision.
//
// DIGESTS COVER EVERY SOURCE, but not on every call. A cache file was hashed
// on the way in and only renamed into place afterwards, so its size is enough
// to tell it from an interrupted copy. A configured or app-shipped file was
// never hashed by us, so `resolve()` hashes it once per process and remembers
// the answer for that size and mtime. `locate()` is the cheap, synchronous
// half: it checks sizes only and never reads a byte of a model.

import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { modelsRoot } from './cache-dir.js';
import { downloadVerifiedInternal, type FetchLike, type ProgressReporter } from './download.js';
import { validateManifest, type ModelEntry } from './manifest.js';
import { ProgressFanout, type CreateMonitorCallback } from './progress.js';

export { type FetchLike };

/**
 * The WebML CG availability states. The store itself never answers
 * `unavailable` — that is the capability's verdict (no engine, or `checkFit`
 * says `none`) — but the type is shared so the capability can return either.
 */
export type ModelAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

/** Where {@link ModelStore.locate} found a model. */
export type ModelSource = 'configured' | 'app-data' | 'cache';

export interface LocatedModel {
    /** Directory containing every file of the entry. */
    readonly dir: string;
    /** Absolute path for each file name in the entry. */
    readonly files: Record<string, string>;
    readonly source: ModelSource;
}

export interface ResolvedModel {
    /** Directory containing every file of the entry. */
    readonly dir: string;
    /** Absolute path for each file name in the entry. */
    readonly files: Record<string, string>;
}

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
    /** A directory the app was told to use for this id. Must contain all files with the manifest's sizes. */
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

/** Throws when `resolved` escapes `parent` (symlinks, '..' or absolute paths). */
function assertInside(parent: string, resolved: string): void {
    const rel = relative(resolve(parent), resolve(resolved));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`ModelStore: resolved path ${resolved} is outside ${parent}`);
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

/** Sums the bytes of every file in an entry. */
function totalBytes(entry: ModelEntry): number {
    return entry.files.reduce((sum, file) => sum + file.bytes, 0);
}

interface Download {
    promise: Promise<ResolvedModel>;
    readonly progress: MultiFileProgress;
    readonly path: string | undefined;
    readonly fetch: FetchLike | undefined;
}

/** Re-broadcasts the SUM of several file downloads through one WebML-shaped monitor. */
class MultiFileProgress implements ProgressReporter {
    readonly #fanout: ProgressFanout;
    readonly #received = new Map<string, number>();
    readonly #total: number;

    constructor(
        readonly modelId: string,
        entry: ModelEntry,
    ) {
        this.#fanout = new ProgressFanout(modelId);
        this.#total = totalBytes(entry);
        for (const { file } of entry.files) this.#received.set(file, 0);
    }

    add(monitor: CreateMonitorCallback | undefined): void {
        this.#fanout.add(monitor);
    }

    report(receivedBytes: number, _totalBytes: number): void {
        // Called once per entry when the model is already present: report 100 %.
        this.#fanout.report(receivedBytes, this.#total);
    }

    fileReporter(file: string): ProgressReporter {
        return new FileProgress(this, file);
    }

    update(file: string, receivedBytes: number): void {
        this.#received.set(file, receivedBytes);
        const sum = [...this.#received.values()].reduce((a, b) => a + b, 0);
        this.#fanout.report(sum, this.#total);
    }
}

class FileProgress implements ProgressReporter {
    constructor(
        private readonly aggregate: MultiFileProgress,
        private readonly file: string,
    ) {}

    get modelId(): string {
        return this.aggregate.modelId;
    }

    report(receivedBytes: number, _totalBytes: number): void {
        this.aggregate.update(this.file, receivedBytes);
    }
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
    /** path → `size:mtime:digest` of the file whose digest matched. */
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

    /** Where `id` is cached: `<cacheDir>/<id>`. */
    cachePath(id: string = this.defaultModel): string {
        const dir = resolve(join(this.cacheDir, this.require(id).id));
        assertInside(this.cacheDir, dir);
        return dir;
    }

    /** Where one file of `id` is cached. */
    cacheFilePath(id: string, file: string): string {
        return join(this.cachePath(id), file);
    }

    /**
     * Where `id` is, by size only. Synchronous, reads no model bytes, never
     * downloads. Moves files from a legacy directory into the cache on the
     * way. Throws for a configured path that is missing a file or has the wrong
     * size: the app said the person has this model, so falling through to a
     * download would be the surprise.
     */
    locate(id: string = this.defaultModel, options: LocateOptions = {}): LocatedModel | undefined {
        const entry = this.require(id);
        if (options.path !== undefined) {
            const files = this.#locateFiles(entry, options.path);
            if (files === undefined) {
                throw new Error(
                    `${this.capability} model '${entry.id}': ${options.path} does not contain all files with the expected sizes`,
                );
            }
            return { dir: options.path, files, source: 'configured' };
        }
        for (const dir of this.#appDataDirs) {
            const appDir = join(dir, entry.id);
            const files = this.#locateFiles(entry, appDir);
            if (files !== undefined) return { dir: appDir, files, source: 'app-data' };
        }
        const cached = this.cachePath(entry.id);
        const files = this.#locateFiles(entry, cached);
        if (files !== undefined) return { dir: cached, files, source: 'cache' };
        if (this.#migrate(entry, cached)) {
            const files = this.#locateFiles(entry, cached);
            if (files !== undefined) return { dir: cached, files, source: 'cache' };
        }
        return undefined;
    }

    /** Returns a path map when every file exists with the right size, else `undefined`. */
    #locateFiles(entry: ModelEntry, dir: string): Record<string, string> | undefined {
        const files: Record<string, string> = {};
        for (const { file, bytes } of entry.files) {
            const path = join(dir, file);
            if (sizeOf(path) !== bytes) return undefined;
            files[file] = path;
        }
        return files;
    }

    /** `available` when a source has all files, `downloading` while `install()` runs, else `downloadable`. */
    availability(id: string = this.defaultModel, options: LocateOptions = {}): ModelAvailability {
        const entry = this.require(id);
        if (this.locate(entry.id, options) !== undefined) return 'available';
        return this.#inFlight.has(entry.id) ? 'downloading' : 'downloadable';
    }

    /** Ids some source has all files for, in manifest order. */
    installed(): string[] {
        return this.models.filter((entry) => this.locate(entry.id) !== undefined).map((entry) => entry.id);
    }

    /**
     * The verified paths of `id`. Never downloads: rejects when no source has
     * all files, and when a configured or app-shipped file fails its digest.
     */
    async resolve(id: string = this.defaultModel, options: ResolveOptions = {}): Promise<ResolvedModel> {
        const entry = this.require(id);
        const located = this.locate(entry.id, options);
        if (located === undefined) {
            throw new Error(
                `${this.capability} model '${entry.id}' is not installed — await install('${entry.id}') first. ` +
                    `Total ${totalBytes(entry)} bytes across ${entry.files.length} file(s).`,
            );
        }
        if (located.source !== 'cache') await this.#verifyAll(entry, located.files, options.signal);
        return { dir: located.dir, files: located.files };
    }

    /**
     * Make `id` usable, fetching missing files into the cache when no source has
     * it all. Resolves to the verified directory and file paths. Two overlapping
     * calls share one download and both get progress; aborting either caller's
     * signal aborts it for both. Every failure is a rejection, an unknown id
     * included.
     */
    install(id: string = this.defaultModel, options: InstallOptions = {}): Promise<ResolvedModel> {
        let entry: E;
        try {
            entry = this.require(id);
            if (!options.force && this.locate(entry.id, options) !== undefined) {
                const progress = new MultiFileProgress(entry.id, entry);
                progress.add(options.monitor);
                const total = totalBytes(entry);
                progress.report(0, total);
                return this.resolve(entry.id, options).then((resolved) => {
                    progress.report(total, total);
                    return resolved;
                });
            }
        } catch (error) {
            return Promise.reject(error);
        }

        const fetchKey = options.fetch ?? this.#fetch;
        const running = this.#inFlight.get(entry.id);
        if (running !== undefined && !options.force && running.path === options.path && running.fetch === fetchKey) {
            running.progress.add(options.monitor);
            return running.promise;
        }
        const progress = new MultiFileProgress(entry.id, entry);
        progress.add(options.monitor);
        const flight: Download = {
            promise: this.#download(entry, progress, options),
            progress,
            path: options.path,
            fetch: fetchKey,
        };
        flight.promise = flight.promise.finally(() => {
            if (this.#inFlight.get(entry.id) === flight) this.#inFlight.delete(entry.id);
        });
        this.#inFlight.set(entry.id, flight);
        return flight.promise;
    }

    /** Delete the CACHED directory of `id` — never a configured or app-shipped one. `false` when none was there. */
    uninstall(id: string = this.defaultModel): boolean {
        const path = this.cachePath(id);
        assertInside(this.cacheDir, path);
        try {
            const entries = readdirSync(path);
            if (entries.length === 0) return false;
        } catch {
            return false;
        }
        rmSync(path, { recursive: true, force: true });
        return true;
    }

    #migrate(entry: E, targetDir: string): boolean {
        for (const dir of this.#legacyDirs()) {
            const oldFiles: Record<string, string> = {};
            for (const { file, bytes } of entry.files) {
                const old = join(dir, file);
                if (sizeOf(old) !== bytes) break;
                oldFiles[file] = old;
            }
            if (Object.keys(oldFiles).length !== entry.files.length) continue;
            try {
                mkdirSync(targetDir, { recursive: true });
                for (const [file, old] of Object.entries(oldFiles)) {
                    const target = join(targetDir, file);
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

    async #verifyAll(entry: E, files: Record<string, string>, signal?: AbortSignal): Promise<void> {
        for (const { file, sha256 } of entry.files) {
            const path = files[file];
            const digest = await this.#verifiedDigest(path, signal);
            if (digest !== sha256) {
                throw new Error(
                    `${this.capability} model '${entry.id}': ${path} has sha256 ${digest}, expected ${sha256}`,
                );
            }
        }
    }

    async #verifiedDigest(path: string, signal?: AbortSignal): Promise<string> {
        const stats = statSync(path);
        const stamp = `${stats.size}:${stats.mtimeMs}`;
        const cached = this.#verified.get(path);
        if (cached !== undefined) {
            const [cachedStamp, digest] = cached.split(':', 2) as [string, string];
            if (cachedStamp === stamp) return digest;
        }
        const digest = await sha256File(path, signal);
        this.#verified.set(path, `${stamp}:${digest}`);
        return digest;
    }

    async #download(entry: E, progress: MultiFileProgress, options: InstallOptions): Promise<ResolvedModel> {
        const dir = this.cachePath(entry.id);
        mkdirSync(dir, { recursive: true });
        const files: Record<string, string> = {};
        const total = totalBytes(entry);
        progress.report(0, total);
        for (const file of entry.files) {
            const target = join(dir, file.file);
            files[file.file] = target;
            if (!options.force && sizeOf(target) === file.bytes) {
                progress.update(file.file, file.bytes);
                continue;
            }
            await downloadVerifiedInternal({
                url: file.url,
                dest: target,
                bytes: file.bytes,
                sha256: file.sha256,
                signal: options.signal,
                fetch: options.fetch ?? this.#fetch,
                progress: progress.fileReporter(file.file),
                id: entry.id,
            });
        }
        progress.report(total, total);
        return { dir, files };
    }
}
