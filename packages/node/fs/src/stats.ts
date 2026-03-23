// Reference: Node.js lib/internal/fs/utils.js (Stats class)
// Reimplemented for GJS using Gio.FileInfo attributes

import Gio from '@girs/gio-2.0';
import { Dirent } from './dirent.js';
import { basename } from 'path';

import type { Stats as NodeStats, BigIntStats as NodeBigIntStats, PathLike } from 'fs';

// Query all attributes needed for a full Node.js Stats object
export const STAT_ATTRIBUTES = 'standard::*,time::*,unix::*';

function populateFromInfo(info: Gio.FileInfo) {
    const atimeSec = info.get_attribute_uint64('time::access');
    const atimeUsec = info.get_attribute_uint32('time::access-usec') || 0;
    const mtimeSec = info.get_attribute_uint64('time::modified');
    const mtimeUsec = info.get_attribute_uint32('time::modified-usec') || 0;
    const ctimeSec = info.get_attribute_uint64('time::changed');
    const ctimeUsec = info.get_attribute_uint32('time::changed-usec') || 0;
    const createdSec = info.get_attribute_uint64('time::created');
    const createdUsec = info.get_attribute_uint32('time::created-usec') || 0;

    const atimeMs = atimeSec * 1000 + atimeUsec / 1000;
    const mtimeMs = mtimeSec * 1000 + mtimeUsec / 1000;
    const ctimeMs = ctimeSec ? ctimeSec * 1000 + ctimeUsec / 1000 : mtimeMs;
    const birthtimeMs = createdSec ? createdSec * 1000 + createdUsec / 1000 : ctimeMs;

    return {
        dev: info.get_attribute_uint32('unix::device') || 0,
        ino: Number(info.get_attribute_uint64('unix::inode') || 0),
        mode: info.get_attribute_uint32('unix::mode') || 0,
        nlink: info.get_attribute_uint32('unix::nlink') || 0,
        uid: info.get_attribute_uint32('unix::uid') || 0,
        gid: info.get_attribute_uint32('unix::gid') || 0,
        rdev: info.get_attribute_uint32('unix::rdev') || 0,
        size: Number(info.get_size() || 0),
        blksize: info.get_attribute_uint32('unix::block-size') || 4096,
        blocks: Number(info.get_attribute_uint64('unix::blocks') || 0),
        atimeMs,
        mtimeMs,
        ctimeMs,
        birthtimeMs,
        atime: new Date(atimeMs),
        mtime: new Date(mtimeMs),
        ctime: new Date(ctimeMs),
        birthtime: new Date(birthtimeMs),
    };
}

/**
 * A `fs.Stats` object provides information about a file.
 * @since v0.1.21
 */
export class Stats extends Dirent implements NodeStats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;

    protected _info: Gio.FileInfo;

    /**
     * Create Stats from a pre-queried FileInfo, or from a path.
     * @param infoOrPath - A Gio.FileInfo or a file path
     * @param pathOrFilename - The file path (when first arg is FileInfo) or filename
     * @param filename - Optional filename (when first arg is FileInfo)
     */
    constructor(info: Gio.FileInfo, path: PathLike, filename?: string);
    constructor(path: PathLike, filename?: string);
    constructor(
        infoOrPath: Gio.FileInfo | PathLike,
        pathOrFilename?: PathLike | string,
        filename?: string
    ) {
        let info: Gio.FileInfo;
        let pathStr: string;

        if (infoOrPath instanceof Gio.FileInfo) {
            info = infoOrPath;
            pathStr = (pathOrFilename as PathLike).toString();
            if (!filename) filename = basename(pathStr);
        } else {
            pathStr = infoOrPath.toString();
            if (typeof pathOrFilename === 'string') filename = pathOrFilename;
            if (!filename) filename = basename(pathStr);
            const file = Gio.File.new_for_path(pathStr);
            info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        }

        super(pathStr, filename);
        this._info = info;

        const data = populateFromInfo(info);
        this.dev = data.dev;
        this.ino = data.ino;
        this.mode = data.mode;
        this.nlink = data.nlink;
        this.uid = data.uid;
        this.gid = data.gid;
        this.rdev = data.rdev;
        this.size = data.size;
        this.blksize = data.blksize;
        this.blocks = data.blocks;
        this.atimeMs = data.atimeMs;
        this.mtimeMs = data.mtimeMs;
        this.ctimeMs = data.ctimeMs;
        this.birthtimeMs = data.birthtimeMs;
        this.atime = data.atime;
        this.mtime = data.mtime;
        this.ctime = data.ctime;
        this.birthtime = data.birthtime;
    }
}

/**
 * BigIntStats — same as Stats but with bigint fields and nanosecond precision.
 */
export class BigIntStats extends Dirent implements NodeBigIntStats {
    dev: bigint;
    ino: bigint;
    mode: bigint;
    nlink: bigint;
    uid: bigint;
    gid: bigint;
    rdev: bigint;
    size: bigint;
    blksize: bigint;
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

    protected _info: Gio.FileInfo;

    constructor(info: Gio.FileInfo, path: PathLike, filename?: string);
    constructor(path: PathLike, filename?: string);
    constructor(
        infoOrPath: Gio.FileInfo | PathLike,
        pathOrFilename?: PathLike | string,
        filename?: string
    ) {
        let info: Gio.FileInfo;
        let pathStr: string;

        if (infoOrPath instanceof Gio.FileInfo) {
            info = infoOrPath;
            pathStr = (pathOrFilename as PathLike).toString();
            if (!filename) filename = basename(pathStr);
        } else {
            pathStr = infoOrPath.toString();
            if (typeof pathOrFilename === 'string') filename = pathOrFilename;
            if (!filename) filename = basename(pathStr);
            const file = Gio.File.new_for_path(pathStr);
            info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        }

        super(pathStr, filename);
        this._info = info;

        const data = populateFromInfo(info);
        this.dev = BigInt(data.dev);
        this.ino = BigInt(data.ino);
        this.mode = BigInt(data.mode);
        this.nlink = BigInt(data.nlink);
        this.uid = BigInt(data.uid);
        this.gid = BigInt(data.gid);
        this.rdev = BigInt(data.rdev);
        this.size = BigInt(data.size);
        this.blksize = BigInt(data.blksize);
        this.blocks = BigInt(data.blocks);
        this.atimeMs = BigInt(Math.trunc(data.atimeMs));
        this.mtimeMs = BigInt(Math.trunc(data.mtimeMs));
        this.ctimeMs = BigInt(Math.trunc(data.ctimeMs));
        this.birthtimeMs = BigInt(Math.trunc(data.birthtimeMs));
        this.atimeNs = this.atimeMs * 1000000n;
        this.mtimeNs = this.mtimeMs * 1000000n;
        this.ctimeNs = this.ctimeMs * 1000000n;
        this.birthtimeNs = this.birthtimeMs * 1000000n;
        this.atime = data.atime;
        this.mtime = data.mtime;
        this.ctime = data.ctime;
        this.birthtime = data.birthtime;
    }
}
