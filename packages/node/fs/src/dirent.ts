import Gio from '@gjsify/types/Gio-2.0';

/**
 * A representation of a directory entry, which can be a file or a subdirectory
 * within the directory, as returned by reading from an `fs.Dir`. The
 * directory entry is a combination of the file name and file type pairs.
 *
 * Additionally, when {@link readdir} or {@link readdirSync} is called with
 * the `withFileTypes` option set to `true`, the resulting array is filled with `fs.Dirent` objects, rather than strings or `Buffer` s.
 * @since v10.10.0
 */
export class Dirent {

    /**
     * The file name that this `fs.Dirent` object refers to. The type of this
     * value is determined by the `options.encoding` passed to {@link readdir} or {@link readdirSync}.
     * @since v10.10.0
     */
    name: string;

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
    constructor(path: string) {
        this._file = Gio.File.new_for_path(path);
        const type = this._file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);

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
                this._isBlockDevice = Gio.unix_is_system_device_path(path);
                // TODO: this._isCharacterDevice = 
                // TODO: this._isSocket = 
                // TODO: this._isFifo = 
                break;
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