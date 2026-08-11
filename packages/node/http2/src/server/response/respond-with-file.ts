// File-descriptor / file-path response methods for Http2ServerResponse.
// Same `install*Methods(proto)` shape as the sibling `headers.ts` split —
// typed `*Methods` interface declaration-merged into
// `Http2ServerResponse` via `declare module '../response.js'` plus an
// `installRespondWithFileMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Houses `respondWithFD()` / `respondWithFile()` plus the file-streaming
// helper `_respondFromFD()`. Exported helpers
// stay module-local (no public surface change).
// Reference: refs/node/lib/internal/http2/core.js
// (Http2Stream.respondWithFD / respondWithFile).
// Original: see server/response.ts pre-split.

import { read as fsRead, fstatSync, openSync, closeSync, type Stats } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { OutgoingHttpHeaders } from 'node:http';
import type { Http2ServerResponse } from '../response.js';

/**
 * StatCheck callback signature — matches Node's
 * `http2.ServerStreamFileResponseOptions.statCheck`:
 * `(stats: fs.Stats, headers: OutgoingHttpHeaders, statOptions: { offset, length }) => void`.
 * The user mutates headers based on stat results; returning `false` cancels
 * the send (Node behaviour — wired through `_respondFromFD`).
 */
export type StatCheckOptions = { offset?: number; length?: number };
export type StatCheck = (stats: Stats, headers: OutgoingHttpHeaders, statOptions: StatCheckOptions) => void | boolean;

export interface RespondWithFileMethods {
    respondWithFD(
        fd: number | { fd: number },
        headers?: Record<string, string | string[] | number>,
        options?: { offset?: number; length?: number; statCheck?: StatCheck },
    ): void;
    respondWithFile(
        path: string,
        headers?: Record<string, string | string[] | number>,
        options?: {
            offset?: number;
            length?: number;
            statCheck?: StatCheck;
            onError?: (err: Error) => void;
        },
    ): void;
}

declare module '../response.js' {
    interface Http2ServerResponse extends RespondWithFileMethods {}
}

const respondWithFileMethods: RespondWithFileMethods & ThisType<Http2ServerResponse> = {
    /**
     * respondWithFD — stream the contents of an open file descriptor as the
     * response body. Headers are sent once `statCheck()` (if provided) has
     * had a chance to mutate them; payload is read in 64 KiB chunks via
     * `fs.read()` and dispatched through the existing Soup chunked-write path.
     *
     * Reference: Node.js doc/api/http2.md § respondWithFD()
     */
    respondWithFD(
        this: Http2ServerResponse,
        fd: number | { fd: number },
        headers?: Record<string, string | string[] | number>,
        options?: { offset?: number; length?: number; statCheck?: StatCheck },
    ): void {
        _respondFromFD(this, fd, headers, options ?? {}, /* closeFd */ false);
    },

    /**
     * respondWithFile — stream a regular file by path. Opens the file with
     * fs.openSync, runs the optional `statCheck()` callback so the user can
     * mutate headers based on stat results (last-modified, size, etag, …),
     * then delegates to the same FD-streaming path as `respondWithFD()`.
     *
     * Reference: Node.js doc/api/http2.md § respondWithFile()
     */
    respondWithFile(
        this: Http2ServerResponse,
        path: string,
        headers?: Record<string, string | string[] | number>,
        options?: {
            offset?: number;
            length?: number;
            statCheck?: StatCheck;
            onError?: (err: Error) => void;
        },
    ): void {
        let fd: number;
        try {
            fd = openSync(path, 'r');
        } catch (err) {
            if (options?.onError) {
                options.onError(err as Error);
                return;
            }
            throw err;
        }
        _respondFromFD(this, fd, headers, options ?? {}, /* closeFd */ true);
    },
};

// Internal-only — only called from the methods above.

/**
 * _respondFromFD — common implementation behind respondWithFD / respondWithFile.
 *
 * Flow:
 *  1) fstatSync on the FD so the user-supplied `statCheck()` callback can
 *     mutate headers based on size / mtime / ino (Node parity).
 *  2) flushHeaders via writeHead — kicks the Soup chunked-write path.
 *  3) Read the FD in 64 KiB chunks via fs.read; pipe each chunk through
 *     `res.write()` so existing Soup pause/unpause back-pressure applies.
 *  4) On EOF, call `res.end()` and close the FD if we opened it.
 *
 * This deliberately uses `node:fs` (the gjsify polyfill) instead of
 * `Gio.UnixInputStream` so the same code path works on Node test runs.
 */
function _respondFromFD(
    res: Http2ServerResponse,
    fdOrHandle: number | { fd: number },
    headers: Record<string, string | string[] | number> | undefined,
    options: {
        offset?: number;
        length?: number;
        statCheck?: StatCheck;
        onError?: (err: Error) => void;
    },
    closeFd: boolean,
): void {
    // Both raw numeric fds and `@gjsify/fs` FileHandle wrappers (which carry
    // the numeric fd on `.fd`) are accepted — `fs.openSync()` returns the
    // wrapper on GJS, a raw integer on Node.
    const fd: number = typeof fdOrHandle === 'number' ? fdOrHandle : (fdOrHandle as { fd: number }).fd;
    // Always hand `fs.read` / `fs.close` the numeric fd. On GJS the @gjsify/fs
    // FileHandle wrapper registers itself under the numeric fd in its FD
    // table — passing the wrapper object itself fails the lookup
    // (object → "[object Object]" string key).
    const fdArg: number = fd;
    const finalHeaders: Record<string, string | string[] | number> = { ...headers };

    // statCheck — mirrors Node's contract: lets the app mutate headers based
    // on stat results without hand-writing fstat boilerplate.
    if (options.statCheck) {
        try {
            // `fstatSync(fd)`, not a stat of `/proc/self/fd/<fd>`. procfs is a
            // LINUX filesystem, so the path form resolved nothing on macOS,
            // `statSync` threw, and the catch below swallowed it — `statCheck`
            // silently never ran and the response went out without the headers
            // the application meant to set. Measured on darwin-x64 / gjs
            // 1.88.1: `statSeen` stayed null. `fstat(2)` is what Node itself
            // uses here and needs no path at all.
            const stat = fstatSync(fd);
            // `finalHeaders` is the http2-style outgoing-headers shape
            // (`Record<string, string | string[] | number>`) which is the same
            // record-shape as `OutgoingHttpHeaders`; the explicit cast bridges
            // the nominal mismatch without weakening either declaration.
            const cont = options.statCheck(stat, finalHeaders as OutgoingHttpHeaders, options);
            if (cont === false) {
                if (closeFd) closeSync(fd);
                res.end();
                return;
            }
        } catch (err) {
            if (options.onError) {
                options.onError(err as Error);
                if (closeFd) closeSync(fd);
                return;
            }
            // Continue without statCheck — Node skips silently when fstat
            // fails, and the FD will fail again in the read loop below, so the
            // error is not lost. Kept narrow ON PURPOSE: this catch used to
            // absorb a platform defect (a Linux-only path that could not
            // resolve on macOS) and report it as "the file had no stat".
        }
    }

    // Headers go out first.
    const status = Number(finalHeaders[':status'] ?? 200);
    delete finalHeaders[':status'];
    const sanitised: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(finalHeaders)) {
        sanitised[k] = typeof v === 'number' ? String(v) : v;
    }
    res.writeHead(status, sanitised);
    res.flushHeaders();

    const startOffset = Math.max(0, options.offset ?? 0);
    const totalLength = options.length;
    const CHUNK = 64 * 1024;
    const buffer = Buffer.alloc(CHUNK);
    let position = startOffset;
    let remaining = typeof totalLength === 'number' ? totalLength : Infinity;
    let bytesSent = 0;

    const readNext = (): void => {
        if (remaining <= 0) {
            finish();
            return;
        }
        const want = Math.min(CHUNK, remaining);
        fsRead(fdArg, buffer, 0, want, position, (err, bytesRead) => {
            if (err) {
                cleanup(err);
                return;
            }
            if (bytesRead === 0) {
                finish();
                return;
            }
            position += bytesRead;
            bytesSent += bytesRead;
            remaining -= bytesRead;
            // Copy the chunk so the same backing buffer can be reused on the
            // next read iteration without overwriting in-flight Soup data.
            const slice = Buffer.allocUnsafe(bytesRead);
            buffer.copy(slice, 0, 0, bytesRead);
            const ok = res.write(slice);
            if (ok) {
                readNext();
            } else {
                res.once('drain', readNext);
            }
        });
    };

    const finish = (): void => {
        res.end();
        if (closeFd) {
            try {
                closeSync(fdArg);
            } catch {
                /* ignore */
            }
        }
    };

    const cleanup = (err: Error): void => {
        if (options.onError) options.onError(err);
        else res.destroy(err);
        if (closeFd) {
            try {
                closeSync(fdArg);
            } catch {
                /* ignore */
            }
        }
    };

    // Suppress empty-body fstat path: if length===0 we just close out.
    if (remaining === 0) {
        finish();
        return;
    }

    readNext();
    // Mark that we used the fd-streaming path so listeners know the body
    // is being delivered out-of-band of the regular write() machinery.
    void bytesSent;
}

/** Install respondWithFD + respondWithFile on Http2ServerResponse.prototype. */
export function installRespondWithFileMethods(proto: object): void {
    Object.assign(proto, respondWithFileMethods);
}
