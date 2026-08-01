// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Node-shaped `Stats` / `Dirent` / `BigIntStats` containers. The volume
// supplies plain field values; these classes carry the Node prototype API
// (`isFile()`, `isDirectory()`, ...) over them.

import { S_IFDIR, S_IFLNK, S_IFREG } from './constants.js';

export type NodeKind = 'file' | 'dir' | 'symlink';

export interface StatFields {
    kind: NodeKind;
    size: number;
    mode: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    uid: number;
    gid: number;
    ino: number;
    nlink: number;
}

/** Shared `is*` mixin used by `Stats`, `BigIntStats`, and `Dirent`. */
abstract class KindTests {
    protected abstract _kind(): NodeKind;
    isFile(): boolean {
        return this._kind() === 'file';
    }
    isDirectory(): boolean {
        return this._kind() === 'dir';
    }
    isSymbolicLink(): boolean {
        return this._kind() === 'symlink';
    }
    isBlockDevice(): boolean {
        return false;
    }
    isCharacterDevice(): boolean {
        return false;
    }
    isFIFO(): boolean {
        return false;
    }
    isSocket(): boolean {
        return false;
    }
}

export class Stats extends KindTests {
    kind: NodeKind;
    dev = 0;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev = 0;
    size: number;
    blksize = 4096;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;

    constructor(f: StatFields) {
        super();
        this.kind = f.kind;
        this.size = f.size;
        this.mode = f.mode;
        this.uid = f.uid;
        this.gid = f.gid;
        this.ino = f.ino;
        this.nlink = f.nlink;
        this.atimeMs = f.atimeMs;
        this.mtimeMs = f.mtimeMs;
        this.ctimeMs = f.ctimeMs;
        this.birthtimeMs = f.birthtimeMs;
        this.blocks = Math.ceil(f.size / 512);
        this.atime = new Date(f.atimeMs);
        this.mtime = new Date(f.mtimeMs);
        this.ctime = new Date(f.ctimeMs);
        this.birthtime = new Date(f.birthtimeMs);
    }
    protected _kind(): NodeKind {
        return this.kind;
    }
}

export class BigIntStats extends KindTests {
    kind: NodeKind;
    dev = 0n;
    ino: bigint;
    mode: bigint;
    nlink: bigint;
    uid: bigint;
    gid: bigint;
    rdev = 0n;
    size: bigint;
    blksize = 4096n;
    blocks: bigint;
    atimeMs: bigint;
    mtimeMs: bigint;
    ctimeMs: bigint;
    birthtimeMs: bigint;
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;

    constructor(f: StatFields) {
        super();
        this.kind = f.kind;
        this.size = BigInt(f.size);
        this.mode = BigInt(f.mode);
        this.uid = BigInt(f.uid);
        this.gid = BigInt(f.gid);
        this.ino = BigInt(f.ino);
        this.nlink = BigInt(f.nlink);
        this.atimeMs = BigInt(Math.floor(f.atimeMs));
        this.mtimeMs = BigInt(Math.floor(f.mtimeMs));
        this.ctimeMs = BigInt(Math.floor(f.ctimeMs));
        this.birthtimeMs = BigInt(Math.floor(f.birthtimeMs));
        this.atimeNs = this.atimeMs * 1_000_000n;
        this.mtimeNs = this.mtimeMs * 1_000_000n;
        this.ctimeNs = this.ctimeMs * 1_000_000n;
        this.birthtimeNs = this.birthtimeMs * 1_000_000n;
        this.blocks = BigInt(Math.ceil(f.size / 512));
        this.atime = new Date(f.atimeMs);
        this.mtime = new Date(f.mtimeMs);
        this.ctime = new Date(f.ctimeMs);
        this.birthtime = new Date(f.birthtimeMs);
    }
    protected _kind(): NodeKind {
        return this.kind;
    }
}

export class Dirent extends KindTests {
    name: string;
    parentPath: string;
    /** @deprecated mirrors Node — duplicate of `parentPath`. */
    path: string;
    private kind: NodeKind;
    constructor(name: string, kind: NodeKind, parentPath: string) {
        super();
        this.name = name;
        this.parentPath = parentPath;
        this.path = parentPath;
        this.kind = kind;
    }
    protected _kind(): NodeKind {
        return this.kind;
    }
}

/** mode bits for a `kind`, OR'd with the user-supplied permission bits. */
export function modeFor(kind: NodeKind, perm: number): number {
    const base = kind === 'dir' ? S_IFDIR : kind === 'symlink' ? S_IFLNK : S_IFREG;
    return base | (perm & 0o7777);
}
