// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// `fs.promises` surface. Identical contract to the sync APIs, just lifted
// into Promises. The default volume is the same single instance shared with
// the sync API, so a `writeFile()` followed by a `readFileSync()` reads the
// same content.

import * as sync from './sync.js';

/** Lift any sync impl to a microtask-deferred promise. */
function async_<F extends (...args: unknown[]) => unknown>(fn: F) {
    return ((...args: Parameters<F>): Promise<ReturnType<F>> =>
        new Promise((res, rej) =>
            queueMicrotask(() => {
                try {
                    res(fn(...args) as ReturnType<F>);
                } catch (e) {
                    rej(e);
                }
            }),
        )) as (...args: Parameters<F>) => Promise<ReturnType<F>>;
}

export const readFile = async_(sync.readFileSync);
export const writeFile = async_(sync.writeFileSync);
export const appendFile = async_(sync.appendFileSync);
export const stat = async_(sync.statSync);
export const lstat = async_(sync.lstatSync);
export const access = async_(sync.accessSync);
export const readdir = async_(sync.readdirSync);
export const mkdir = async_(sync.mkdirSync);
export const rmdir = async_(sync.rmdirSync);
export const rm = async_(sync.rmSync);
export const unlink = async_(sync.unlinkSync);
export const rename = async_(sync.renameSync);
export const copyFile = async_(sync.copyFileSync);
export const link = async_(sync.linkSync);
export const symlink = async_(sync.symlinkSync);
export const readlink = async_(sync.readlinkSync);
export const realpath = async_(sync.realpathSync);
export const chmod = async_(sync.chmodSync);
export const chown = async_(sync.chownSync);
export const truncate = async_(sync.truncateSync);
export const utimes = async_(sync.utimesSync);
export const mkdtemp = async_(sync.mkdtempSync);

// `open()` returns a `FileHandle` in Node; we expose a small wrapper around
// the integer fd that mirrors the most common surface (`read` / `write` /
// `readFile` / `writeFile` / `close`).

export class FileHandle {
    readonly fd: number;
    constructor(fd: number) {
        this.fd = fd;
    }

    read(buf: Uint8Array, offset?: number, length?: number, position?: number | null) {
        return new Promise<{ bytesRead: number; buffer: Uint8Array }>((res, rej) =>
            queueMicrotask(() => {
                try {
                    const n = sync.readSync(this.fd, buf, offset ?? 0, length ?? buf.byteLength, position ?? null);
                    res({ bytesRead: n, buffer: buf });
                } catch (e) {
                    rej(e);
                }
            }),
        );
    }

    write(buf: Uint8Array | string, offset?: number, length?: number, position?: number | null) {
        return new Promise<{ bytesWritten: number; buffer: Uint8Array | string }>((res, rej) =>
            queueMicrotask(() => {
                try {
                    const n = sync.writeSync(this.fd, buf, offset ?? 0, length, position);
                    res({ bytesWritten: n, buffer: buf });
                } catch (e) {
                    rej(e);
                }
            }),
        );
    }

    readFile(): Promise<Uint8Array> {
        return new Promise((res, rej) =>
            queueMicrotask(() => {
                try {
                    const buf = new Uint8Array(64 * 1024);
                    const parts: Uint8Array[] = [];
                    let read = 0;
                    while ((read = sync.readSync(this.fd, buf, 0, buf.byteLength, null)) > 0) {
                        parts.push(buf.slice(0, read));
                    }
                    const total = parts.reduce((s, p) => s + p.byteLength, 0);
                    const merged = new Uint8Array(total);
                    let off = 0;
                    for (const p of parts) {
                        merged.set(p, off);
                        off += p.byteLength;
                    }
                    res(merged);
                } catch (e) {
                    rej(e);
                }
            }),
        );
    }

    close(): Promise<void> {
        return new Promise((res, rej) =>
            queueMicrotask(() => {
                try {
                    sync.closeSync(this.fd);
                    res();
                } catch (e) {
                    rej(e);
                }
            }),
        );
    }
}

export function open(path: Parameters<typeof sync.openSync>[0], flags = 'r', mode = 0o666): Promise<FileHandle> {
    return new Promise((res, rej) =>
        queueMicrotask(() => {
            try {
                res(new FileHandle(sync.openSync(path, flags, mode)));
            } catch (e) {
                rej(e);
            }
        }),
    );
}
