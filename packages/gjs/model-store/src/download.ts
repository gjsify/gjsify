// Standalone verified download: stream to a temp file, count bytes, hash,
// check size and digest, then rename into place. Used by ModelStore and
// exported for downloads that do not fit a manifest.
//
// Resume: the partial file `<dest>.part` is kept across calls. The next call
// sends `Range: bytes=<partial>-`; a `206` appends, a `200` restarts, and a
// `416` either verifies the complete partial or discards it and restarts once.
// If a resumed download fails verification, the partial is discarded and the
// download is retried once from scratch before failing.
// Concurrent calls for the same destination are serialized so two writers cannot
// corrupt the partial file.

import { createHash, type Hash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type CreateMonitorCallback, ProgressFanout } from './progress.js';

/** Per-destination serialization queue so concurrent downloads do not corrupt the partial file. */
const queues = new Map<string, Promise<unknown>>();

/** The subset of `fetch` the downloader uses, so a test can inject one. */
export type FetchLike = (
    url: string,
    init: { signal?: AbortSignal; redirect?: 'follow'; headers?: Record<string, string> },
) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface DownloadVerifiedOptions {
    /** URL to fetch. */
    url: string;
    /** Final path; parent directories are created. */
    dest: string;
    /** Expected size in bytes. Checked while streaming and after. */
    bytes?: number;
    /** Expected SHA-256, lowercase hex. Checked after the stream finishes. */
    sha256?: string;
    /** Extra request headers. */
    headers?: Record<string, string>;
    /** Receives an EventTarget firing `downloadprogress`, at least at 0 and 1. */
    monitor?: CreateMonitorCallback;
    /** Abort the request and close the partial file. */
    signal?: AbortSignal;
    /** Override the global `fetch`. */
    fetch?: FetchLike;
}

function removeQuietly(path: string): void {
    try {
        unlinkSync(path);
    } catch {
        // Already gone, or never created. The failure that led here is what matters.
    }
}

function prefix(id: string | undefined): string {
    return id === undefined ? 'Downloading' : `Downloading ${id}`;
}

/** Anything that can receive byte progress for one download. */
export interface ProgressReporter {
    readonly modelId: string;
    report(receivedBytes: number, totalBytes: number): void;
}

interface DownloadVerifiedInternalOptions extends DownloadVerifiedOptions {
    /** Identifier used in error messages. Omit for the standalone public function. */
    id?: string;
    /** Existing progress reporter (e.g. ModelStore's aggregate one). */
    progress?: ProgressReporter;
}

/** Read an existing partial file into `hash` in 1 MiB slices. */
async function hashExistingPartial(path: string, hash: Hash, signal?: AbortSignal): Promise<void> {
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
}

/**
 * Parse the start byte of a `Content-Range: bytes <start>-<end>/<total>`
 * (or `/<*>`) header. Returns `null` when the header is missing or malformed.
 */
function parseContentRangeStart(value: string | null): number | null {
    if (value === null) return null;
    const match = /^bytes\s+(\d+)-\d+\/(\d+|\*)$/i.exec(value.trim());
    return match === null ? null : Number(match[1]);
}

async function fetchOnce(
    doFetch: FetchLike,
    url: string,
    headers: Record<string, string> | undefined,
    signal: AbortSignal | undefined,
    rangeStart: number,
): Promise<ReturnType<FetchLike> extends Promise<infer T> ? T : never> {
    const requestHeaders: Record<string, string> = { ...headers };
    if (rangeStart > 0) requestHeaders.Range = `bytes=${rangeStart}-`;
    return doFetch(url, { signal, redirect: 'follow', headers: requestHeaders });
}

async function downloadWithRestart(
    options: DownloadVerifiedInternalOptions,
): Promise<{ bytes: number; sha256: string }> {
    const { url, dest, bytes, sha256, headers, signal, fetch: fetch_ } = options;
    const doFetch: FetchLike = fetch_ ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    const fanout = new ProgressFanout(options.id ?? url);
    const progress = options.progress ?? fanout;
    if (options.progress === undefined && options.monitor !== undefined) fanout.add(options.monitor);

    mkdirSync(dirname(dest), { recursive: true });
    const partial = `${dest}.part`;

    // Two attempts cover: 416 discard-and-restart, or one verification-failure retry.
    for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();

        let partialSize = 0;
        try {
            const stats = statSync(partial);
            if (stats.isFile()) partialSize = stats.size;
        } catch {
            // No partial yet, or a dangling symlink: start from zero.
        }

        if (bytes !== undefined && partialSize > bytes) {
            // Stale partial is larger than the expected file; start over.
            removeQuietly(partial);
            partialSize = 0;
        }

        const didResume = partialSize > 0;
        const response = await fetchOnce(doFetch, url, headers, signal, partialSize);

        if (response.status === 416) {
            if (bytes !== undefined && partialSize === bytes) {
                // Server says the range is past the end: the partial is the whole file.
                progress.report(partialSize, bytes);
                const hash = createHash('sha256');
                await hashExistingPartial(partial, hash, signal);
                const digest = hash.digest('hex');
                if (sha256 !== undefined && digest !== sha256) {
                    removeQuietly(partial);
                    if (didResume) continue;
                    throw new Error(`${prefix(options.id)} failed: sha256 ${digest}, expected ${sha256}`);
                }
                renameSync(partial, dest);
                return { bytes: partialSize, sha256: digest };
            }
            // Partial is stale or the server does not support ranges: discard and try once more.
            removeQuietly(partial);
            continue;
        }

        if (!response.ok) {
            throw new Error(`${prefix(options.id)} from ${url} failed: HTTP ${response.status}`);
        }

        let fd: number;
        let received = partialSize;
        const hash = createHash('sha256');

        if (response.status === 206) {
            const rangeStart = parseContentRangeStart(response.headers.get('content-range'));
            if (rangeStart !== partialSize) {
                // The server is giving us a different range than we asked for;
                // do not append and risk a corrupt file. Start over.
                removeQuietly(partial);
                continue;
            }
            await hashExistingPartial(partial, hash, signal);
            fd = openSync(partial, 'a');
        } else {
            // 200 (or anything else that is not a 206): restart from the beginning.
            fd = openSync(partial, 'w');
            received = 0;
            partialSize = 0;
        }

        // Refused before a byte is read. A server that sends no length is not
        // refused here: the running size check and the digest still cover it.
        const declared = response.headers.get('content-length');
        if (declared !== null && response.status === 200 && bytes !== undefined && Number(declared) !== bytes) {
            closeSync(fd);
            const label = options.id === undefined ? 'expected' : 'the manifest says';
            throw new Error(`${prefix(options.id)} refused: ${url} declares ${declared} bytes, ${label} ${bytes}`);
        }

        let closed = false;
        let sizeExceeded = false;
        const totalBytes = bytes;
        progress.report(received, totalBytes ?? received);

        const write = (chunk: Uint8Array) => {
            if (sizeExceeded) return;
            received += chunk.length;
            // Checked per chunk, so a server streaming past the size cannot fill the disk.
            if (bytes !== undefined && received > bytes) {
                sizeExceeded = true;
                return;
            }
            hash.update(chunk);
            writeSync(fd, chunk);
            progress.report(received, totalBytes ?? received);
        };

        try {
            const reader = response.body?.getReader();
            if (reader !== undefined) {
                try {
                    for (;;) {
                        signal?.throwIfAborted();
                        if (sizeExceeded) {
                            await reader.cancel().catch(() => undefined);
                            break;
                        }
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
        } catch (error) {
            if (!closed) closeSync(fd);
            // Abort and network errors keep the partial so the next call can resume.
            throw error;
        }

        closeSync(fd);
        closed = true;

        if (sizeExceeded || (bytes !== undefined && received !== bytes)) {
            removeQuietly(partial);
            if (didResume) continue;
            throw new Error(
                sizeExceeded
                    ? `${prefix(options.id)} failed: more than ${options.id === undefined ? 'the expected' : `the manifest's`} ${bytes} bytes`
                    : `${prefix(options.id)} failed: got ${received} bytes, expected ${bytes}`,
            );
        }

        const digest = hash.digest('hex');
        if (sha256 !== undefined && digest !== sha256) {
            removeQuietly(partial);
            if (didResume) continue;
            throw new Error(`${prefix(options.id)} failed: sha256 ${digest}, expected ${sha256}`);
        }

        renameSync(partial, dest);
        progress.report(received, totalBytes ?? received);
        return { bytes: received, sha256: digest };
    }

    throw new Error(`${prefix(options.id)} from ${url} failed: could not complete download`);
}

/** @internal Variant that lets ModelStore keep its existing error wording. */
export async function downloadVerifiedInternal(
    options: DownloadVerifiedInternalOptions,
): Promise<{ bytes: number; sha256: string }> {
    // Concurrent calls for the same destination are serialized so two writers
    // cannot corrupt the partial file. Each call still performs its own fetch.
    const previous = queues.get(options.dest) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => downloadWithRestart(options));
    queues.set(options.dest, current);
    try {
        return await current;
    } finally {
        if (queues.get(options.dest) === current) queues.delete(options.dest);
    }
}

/**
 * Stream `url` to `dest`, verifying size and/or SHA-256 while downloading.
 * The file is written under a temporary name and renamed into place only after
 * verification. Returns the measured size and digest. Removes the partial file
 * on verification failure; keeps it on abort or network errors so the next call
 * can resume with `Range: bytes=<partial>-`.
 */
export async function downloadVerified(options: DownloadVerifiedOptions): Promise<{ bytes: number; sha256: string }> {
    return downloadVerifiedInternal(options);
}
