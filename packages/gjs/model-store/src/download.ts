// Standalone verified download: stream to a temp file, count bytes, hash,
// check size and digest, then rename into place. Used by ModelStore and
// exported for downloads that do not fit a manifest.

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

import { CreateMonitorCallback, ProgressFanout } from './progress.js';

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

/** @internal Variant that lets ModelStore keep its existing error wording. */
export async function downloadVerifiedInternal(
    options: DownloadVerifiedInternalOptions,
): Promise<{ bytes: number; sha256: string }> {
    const { url, dest, bytes, sha256, headers, signal, fetch: fetch_ } = options;
    const doFetch: FetchLike = fetch_ ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    const response = await doFetch(url, { signal, redirect: 'follow', headers });
    if (!response.ok) {
        throw new Error(`${prefix(options.id)} from ${url} failed: HTTP ${response.status}`);
    }
    // Refused before a byte is read. A server that sends no length is not
    // refused here: the running size check and the digest still cover it.
    const declared = response.headers.get('content-length');
    if (declared !== null && bytes !== undefined && Number(declared) !== bytes) {
        const label = options.id === undefined ? 'expected' : 'the manifest says';
        throw new Error(`${prefix(options.id)} refused: ${url} declares ${declared} bytes, ${label} ${bytes}`);
    }

    mkdirSync(dirname(dest), { recursive: true });
    // Written under a unique name and RENAMED into place, in the same
    // directory: a reader sees no file or the whole verified one, never a part.
    const partial = `${dest}.part-${randomUUID()}`;
    const fd = openSync(partial, 'w');
    let closed = false;
    const fanout = new ProgressFanout(options.id ?? url);
    const progress = options.progress ?? fanout;
    if (options.progress === undefined && options.monitor !== undefined) fanout.add(options.monitor);
    try {
        const hash = createHash('sha256');
        let received = 0;
        const totalBytes = bytes;
        const write = (chunk: Uint8Array) => {
            received += chunk.length;
            // Checked per chunk, so a server streaming past the size cannot fill the disk.
            if (bytes !== undefined && received > bytes) {
                const label = options.id === undefined ? 'the expected' : `the manifest's`;
                throw new Error(`${prefix(options.id)} failed: more than ${label} ${bytes} bytes`);
            }
            hash.update(chunk);
            writeSync(fd, chunk);
            progress.report(received, totalBytes ?? received);
        };
        progress.report(0, totalBytes ?? 0);

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

        if (bytes !== undefined && received !== bytes) {
            throw new Error(`${prefix(options.id)} failed: got ${received} bytes, expected ${bytes}`);
        }
        const digest = hash.digest('hex');
        if (sha256 !== undefined && digest !== sha256) {
            throw new Error(`${prefix(options.id)} failed: sha256 ${digest}, expected ${sha256}`);
        }
        closeSync(fd);
        closed = true;
        renameSync(partial, dest);
        progress.report(received, totalBytes ?? received);
        return { bytes: received, sha256: digest };
    } catch (error) {
        if (!closed) closeSync(fd);
        removeQuietly(partial);
        throw error;
    }
}

/**
 * Stream `url` to `dest`, verifying size and/or SHA-256 while downloading.
 * The file is written under a temporary name and renamed into place only after
 * verification. Returns the measured size and digest. Removes the partial file
 * on any failure or abort.
 */
export async function downloadVerified(options: DownloadVerifiedOptions): Promise<{ bytes: number; sha256: string }> {
    return downloadVerifiedInternal(options);
}
