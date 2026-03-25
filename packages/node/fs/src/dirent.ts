// Reference: Node.js lib/internal/fs/utils.js (Dirent class)
// Reimplemented for GJS using Gio.FileInfo

import Gio from '@girs/gio-2.0';
import { basename, dirname } from 'node:path';

import type { Dirent as OriginalDirent } from 'node:fs'; // Types from @types/node

// POSIX file type constants from stat mode bits (S_IFMT mask = 0o170000)
const S_IFMT   = 0o170000;
const S_IFSOCK = 0o140000;
const S_IFLNK  = 0o120000;
const S_IFREG  = 0o100000;
const S_IFBLK  = 0o060000;
const S_IFDIR  = 0o040000;
const S_IFCHR  = 0o020000;
const S_IFIFO  = 0o010000;

/**
 * A representation of a directory entry, which can be a file or a subdirectory
 * within the directory, as returned by reading from an `fs.Dir`. The
 * directory entry is a combination of the file name and file type pairs.
 *
 * Additionally, when {@link readdir} or {@link readdirSync} is called with
 * the `withFileTypes` option set to `true`, the resulting array is filled with `fs.Dirent` objects, rather than strings or `Buffer` s.
 * @since v10.10.0
 */
export class Dirent implements OriginalDirent {

    /**
     * The file name that this `fs.Dirent` object refers to. The type of this
     * value is determined by the `options.encoding` passed to {@link readdir} or {@link readdirSync}.
     * @since v10.10.0
     */
    name: string;

    /**
     * The path to the parent directory of the file this `fs.Dirent` object refers to.
     * @since v20.12.0, v18.20.0
     */
    parentPath: string;

    private _isFile = false;
    private _isDirectory = false;
    private _isBlockDevice = false;
    private _isCharacterDevice = false;
    private _isSymbolicLink = false;
    private _isFIFO = false;
    private _isSocket = false;

    /** This is not part of node.fs and is used internal by gjsify */
    protected _file: Gio.File;

    /** This is not part of node.fs and is used internal by gjsify */
    constructor(path: string, filename?: string, fileType?: Gio.FileType) {
        if (!filename) filename = basename(path);
        this.name = filename;
        this.parentPath = dirname(path);
        this._file = Gio.File.new_for_path(path);
        const type = fileType ?? this._file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);

        switch (type) {
            case Gio.FileType.DIRECTORY:
                this._isDirectory = true;
                break;
            case Gio.FileType.MOUNTABLE:
                break;
            case Gio.FileType.REGULAR:
                this._isFile = true;
                break;
            case Gio.FileType.SYMBOLIC_LINK:
            case Gio.FileType.SHORTCUT:
                this._isSymbolicLink = true; // ?
                break;
            case Gio.FileType.SPECIAL:
                // File is a "special" file, such as a socket, fifo, block device, or character device.
                // Use unix::mode from Gio.FileInfo to distinguish the exact type via POSIX S_IFMT bits.
                this._classifySpecialFile(path);
                break;
        }

    }

    /**
     * Classify a SPECIAL file type using the unix::mode attribute from Gio.FileInfo.
     * Falls back to marking nothing if the mode attribute is unavailable.
     */
    private _classifySpecialFile(path: string): void {
        try {
            const file = Gio.File.new_for_path(path);
            const info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            const mode = info.get_attribute_uint32('unix::mode');
            if (mode === 0) return;
            const fmt = mode & S_IFMT;
            switch (fmt) {
                case S_IFBLK:
                    this._isBlockDevice = true;
                    break;
                case S_IFCHR:
                    this._isCharacterDevice = true;
                    break;
                case S_IFSOCK:
                    this._isSocket = true;
                    break;
                case S_IFIFO:
                    this._isFIFO = true;
                    break;
            }
        } catch {
            // If we can't query the mode (e.g. permission denied), leave all flags as false
        }
    }

    /**
     * Returns `true` if the `fs.Dirent` object describes a regular file.
     * @since v10.10.0
     */
    isFile(): boolean {
        return this._isFile;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a file system
     * directory.
     * @since v10.10.0
     */
    isDirectory(): boolean {
        return this._isDirectory;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a block device.
     * @since v10.10.0
     */
    isBlockDevice(): boolean {
        return this._isBlockDevice;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a character device.
     * @since v10.10.0
     */
    isCharacterDevice(): boolean {
        return this._isCharacterDevice;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a symbolic link.
     * @since v10.10.0
     */
    isSymbolicLink(): boolean {
        return this._isSymbolicLink;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a first-in-first-out
     * (FIFO) pipe.
     * @since v10.10.0
     */
    isFIFO(): boolean {
        return this._isFIFO;
    }
    /**
     * Returns `true` if the `fs.Dirent` object describes a socket.
     * @since v10.10.0
     */
    isSocket(): boolean {
        return this._isSocket;
    }
}