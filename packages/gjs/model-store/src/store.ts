// One model store per capability (ADR 0132 § 5): where a model is, whether it
// is there, and how it gets there.
//
// FOUR SOURCES, IN ORDER: a path the app configures (a model the person
// already has), a directory the app ships read-only, our cache, then the
// Hugging Face hub cache. The cache downloads into it only on `install()`.
// Plus, once, the directory an older release used: a file found there is moved
// into the cache and never read from there again.
//
// Every entry lives in its own directory: `<root>/<capability>/<id>/<file>`.
// That lets several models each carry a `tokens.txt` without collision.
//
// CONTENT-ADDRESSED DEDUPLICATION: files with the same SHA-256 are stored once
// under `<root>/blobs/<sha256>` and hard-linked from each entry directory. If
// hard-linking is not supported (cross-device, FAT, EPERM) the store falls back
// to a plain file and keeps no blob for it. `dedupe()` migrates legacy plain
// files and removes orphan blobs.
//
// DIGESTS COVER EVERY SOURCE, but not on every call. A cache file was hashed
// on the way in and only renamed into place afterwards, so its size is enough
// to tell it from an interrupted copy. A configured, app-shipped or HF-cache
// file was never hashed by us, so `resolve()` hashes it once per process and
// remembers the answer for that size and mtime. `locate()` is the cheap,
// synchronous half: it checks sizes only and never reads a byte of a model.

import { createHash, randomUUID } from 'node:crypto';
import {
    copyFileSync,
    linkSync,
    mkdirSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    type Stats,
    unlinkSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { modelsRoot } from './cache-dir.js';
import { downloadVerifiedInternal, type FetchLike, type ProgressReporter } from './download.js';
import { validateManifest, type ModelEntry, type ModelFile } from './manifest.js';
import { ProgressFanout, type CreateMonitorCallback } from './progress.js';

export { type FetchLike };

/**
 * The WebML CG availability states. The store itself never answers
 * `unavailable` — that is the capability's verdict (no engine, or `checkFit`
 * says `none`) — but the type is shared so the capability can return either.
 */
export type ModelAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

/** Where {@link ModelStore.locate} found a model. */
export type ModelSource = 'configured' | 'app-data' | 'cache' | 'huggingface';

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

export interface DedupeResult {
    /** Files newly hard-linked into a blob or replaced by a link to one. */
    readonly linked: number;
    /** Bytes reclaimed by replacing duplicate plain files with hard links. */
    readonly reclaimedBytes: number;
    /** Blob files removed because no entry referenced them. */
    readonly removedOrphans: number;
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
    /**
     * Use the Hugging Face hub cache as a read-only source. `true` (default)
     * enables it at `$HF_HUB_CACHE`, `$HF_HOME/hub` or `~/.cache/huggingface/hub`.
     * `false` disables it; a string is the hub directory to use.
     */
    readonly huggingFaceCache?: boolean | string;
    /** Override the global `fetch`. */
    readonly fetch?: FetchLike;
    /** Override `linkSync` for testing cross-device / no-hard-link fallbacks. */
    readonly link?: (existingPath: string, newPath: string) => void;
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
const HF_URL = /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\/resolve\/([^/]+)\/(.+)$/;

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

/** Default Hugging Face hub cache directory, honouring the two env vars HF uses. */
function defaultHfHubDir(): string {
    const hub = process.env.HF_HUB_CACHE;
    if (hub !== undefined && hub !== '') return hub;
    const hfHome = process.env.HF_HOME;
    if (hfHome !== undefined && hfHome !== '') return join(hfHome, 'hub');
    return join(homedir(), '.cache', 'huggingface', 'hub');
}

interface ParsedHfUrl {
    readonly org: string;
    readonly repo: string;
    readonly rev: string;
    readonly path: string;
}

function parseHfUrl(url: string): ParsedHfUrl | undefined {
    const match = HF_URL.exec(url);
    if (match === null) return undefined;
    const [, org, repo, rev, path] = match;
    return { org, repo, rev, path };
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

/** Serialises operations that touch the shared blob directory. */
class BlobLock {
    #tail: Promise<void> = Promise.resolve();

    async run<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.#tail;
        let release: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.#tail = previous.then(
            () => gate,
            () => gate,
        );
        await previous.catch(() => undefined);
        try {
            return await fn();
        } finally {
            release!();
        }
    }
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
    readonly #hfHubDir: string | undefined;
    readonly #fetch: FetchLike | undefined;
    readonly #linkSync: (existingPath: string, newPath: string) => void;
    readonly #inFlight = new Map<string, Download>();
    readonly #blobLock = new BlobLock();
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
        if (options.huggingFaceCache === false) {
            this.#hfHubDir = undefined;
        } else if (typeof options.huggingFaceCache === 'string') {
            this.#hfHubDir = options.huggingFaceCache;
        } else {
            this.#hfHubDir = defaultHfHubDir();
        }
        this.#fetch = options.fetch;
        this.#linkSync = options.link ?? linkSync;
        this.require(this.defaultModel);
    }

    /** `<root>/<capability>`. Resolved per call, so a changed `XDG_CACHE_HOME` is honoured. */
    get cacheDir(): string {
        return join(this.#root ?? modelsRoot(), this.capability);
    }

    /** `<root>/blobs` — shared across capabilities. */
    #blobsDir(): string {
        return join(this.#root ?? modelsRoot(), 'blobs');
    }

    /** Path for one SHA-256 blob. */
    #blobPath(sha256: string): string {
        return join(this.#blobsDir(), sha256);
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
            const migrated = this.#locateFiles(entry, cached);
            if (migrated !== undefined) return { dir: cached, files: migrated, source: 'cache' };
        }
        const hf = this.#locateHf(entry);
        if (hf !== undefined) return hf;
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
     * all files, and when a configured, app-shipped or HF-cache file fails its
     * digest.
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

    /**
     * Delete the CACHED directory of `id` — never a configured, app-shipped or
     * HF-cache one — and remove orphan blobs it was the last reference to.
     * `false` when none was there.
     */
    uninstall(id: string = this.defaultModel): boolean {
        const path = this.cachePath(id);
        assertInside(this.cacheDir, path);
        let entries: string[];
        try {
            entries = readdirSync(path);
            if (entries.length === 0) return false;
        } catch {
            return false;
        }
        const entry = this.require(id);
        const sha256s = entry.files.map((file) => file.sha256);
        rmSync(path, { recursive: true, force: true });
        // Synchronous on purpose (the vad package re-exports this signature). The
        // nlink check makes it safe against a concurrent link: a blob is only
        // unlinked when no entry file shares it, and a lost race at worst makes
        // `dedupe()` recreate it.
        for (const sha256 of sha256s) this.#removeOrphanBlob(sha256);
        return true;
    }

    /**
     * Hash every installed cache file, hard-link unique files into the blob
     * directory, replace duplicate plain files with links to the shared blob,
     * and remove blobs no entry references. Safe to run while the store is in
     * use: it serialises against `install()` / `uninstall()`.
     */
    async dedupe(): Promise<DedupeResult> {
        return this.#blobLock.run(async () => {
            let linked = 0;
            let reclaimedBytes = 0;
            let removedOrphans = 0;

            mkdirSync(this.#blobsDir(), { recursive: true });

            for (const entry of this.models) {
                const entryDir = join(this.cacheDir, entry.id);
                const located = this.#locateFiles(entry, entryDir);
                if (located === undefined) continue;

                for (const file of entry.files) {
                    const entryPath = located[file.file];
                    const digest = await sha256File(entryPath);
                    if (digest !== file.sha256) continue; // Legacy or corrupted: leave untouched.

                    const blobPath = this.#blobPath(file.sha256);
                    const blobStats = statOrNull(blobPath);
                    if (blobStats === null) {
                        try {
                            this.#link(entryPath, blobPath);
                            linked++;
                        } catch {
                            // Hard links unsupported here: leave the plain file.
                        }
                    } else {
                        const entryStats = statSync(entryPath);
                        if (entryStats.ino !== blobStats.ino || entryStats.dev !== blobStats.dev) {
                            const temp = `${entryPath}.dedupe-${randomUUID()}`;
                            try {
                                this.#link(blobPath, temp);
                                renameSync(temp, entryPath);
                                reclaimedBytes += file.bytes;
                                linked++;
                            } catch {
                                removeQuietly(temp);
                            }
                        }
                    }
                }
            }

            for (const name of readdirSync(this.#blobsDir())) {
                if (this.#removeOrphanBlob(name)) removedOrphans++;
            }

            return { linked, reclaimedBytes, removedOrphans };
        });
    }

    #link(existingPath: string, newPath: string): void {
        mkdirSync(dirname(newPath), { recursive: true });
        this.#linkSync(existingPath, newPath);
    }

    #removeOrphanBlob(sha256OrPath: string): boolean {
        const blobPath = sha256OrPath.includes('/') ? sha256OrPath : this.#blobPath(sha256OrPath);
        try {
            const stats = statSync(blobPath);
            if (stats.isFile() && stats.nlink === 1) {
                unlinkSync(blobPath);
                return true;
            }
        } catch {
            // Already gone or not a file.
        }
        return false;
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
            const linkedFromBlob = await this.#linkFromBlob(file, target);
            if (linkedFromBlob) {
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
            await this.#blobLock.run(async () => {
                try {
                    this.#link(target, this.#blobPath(file.sha256));
                } catch {
                    // Plain-file fallback: keep the verified download, drop no blob.
                }
            });
        }
        progress.report(total, total);
        return { dir, files };
    }

    async #linkFromBlob(file: ModelFile, target: string): Promise<boolean> {
        return this.#blobLock.run(async () => {
            const blobPath = this.#blobPath(file.sha256);
            if (sizeOf(blobPath) !== file.bytes) return false;
            try {
                this.#link(blobPath, target);
                return true;
            } catch {
                return false;
            }
        });
    }

    #locateHf(entry: ModelEntry): LocatedModel | undefined {
        if (this.#hfHubDir === undefined) return undefined;
        const files: Record<string, string> = {};
        let commonDir: string | undefined;
        for (const file of entry.files) {
            const path = this.#findHfFile(file);
            if (path === undefined || sizeOf(path) !== file.bytes) return undefined;
            files[file.file] = path;
            const dir = dirname(path);
            if (commonDir === undefined) commonDir = dir;
            else if (commonDir !== dir) commonDir = this.#hfHubDir;
        }
        return { dir: commonDir ?? this.#hfHubDir, files, source: 'huggingface' };
    }

    #findHfFile(file: ModelFile): string | undefined {
        if (this.#hfHubDir === undefined) return undefined;

        // (a) URL maps directly to a snapshot path.
        const parsed = parseHfUrl(file.url);
        if (parsed !== undefined) {
            const snapshotPath = join(
                this.#hfHubDir,
                `models--${parsed.org}--${parsed.repo}`,
                'snapshots',
                parsed.rev,
                ...parsed.path.split('/'),
            );
            assertInside(this.#hfHubDir, snapshotPath);
            if (sizeOf(snapshotPath) === file.bytes) return snapshotPath;
        }

        // (b) Any models--*/blobs/<sha256> matches; prefer a snapshot link that
        // keeps the original file name.
        let foundBlob: string | undefined;
        try {
            for (const modelDir of readdirSync(this.#hfHubDir)) {
                if (!modelDir.startsWith('models--')) continue;
                const blobPath = join(this.#hfHubDir, modelDir, 'blobs', file.sha256);
                if (sizeOf(blobPath) === file.bytes) {
                    foundBlob = blobPath;
                    break;
                }
            }
        } catch {
            return undefined;
        }
        if (foundBlob === undefined) return undefined;
        const snapshotPath = this.#hfSnapshotLinkForBlob(foundBlob, file.file);
        return snapshotPath ?? foundBlob;
    }

    #hfSnapshotLinkForBlob(blobPath: string, fileName: string): string | undefined {
        if (this.#hfHubDir === undefined) return undefined;
        try {
            for (const modelDir of readdirSync(this.#hfHubDir)) {
                if (!modelDir.startsWith('models--')) continue;
                const snapshotsDir = join(this.#hfHubDir, modelDir, 'snapshots');
                for (const rev of readdirSync(snapshotsDir)) {
                    const candidate = join(snapshotsDir, rev, fileName);
                    try {
                        if (realpathSync(candidate) === blobPath && sizeOf(candidate) === sizeOf(blobPath)) {
                            return candidate;
                        }
                    } catch {
                        // Not this link.
                    }
                }
            }
        } catch {
            // Hub dir not fully populated.
        }
        return undefined;
    }
}

function statOrNull(path: string): Stats | null {
    try {
        return statSync(path);
    } catch {
        return null;
    }
}
