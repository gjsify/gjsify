// NativeScript native bridge for node:fs/promises
// Reimplemented for NativeScript using java.io.File (Android) + NSFileManager (iOS)
// Reference: Node.js lib/fs/promises.js

// ===== Platform detection =====

// NativeScript exposes Java classes as global identifiers on Android
// and Objective-C classes as global identifiers on iOS.
// Neither is available on GJS, Node.js, or browser runtimes.
declare const java:
    | {
          io: {
              File: { new (path: string): JavaFile };
              FileInputStream: { new (file: JavaFile): JavaFileInputStream };
              FileOutputStream: { new (file: JavaFile, append: boolean): JavaFileOutputStream };
          };
      }
    | undefined;
declare const NSFileManager: unknown | undefined;

// Narrower typed Java/iOS interfaces for internal use
interface JavaFile {
    exists(): boolean;
    isFile(): boolean;
    isDirectory(): boolean;
    length(): number;
    lastModified(): number;
    list(): string[] | null;
    mkdirs(): boolean;
    delete(): boolean;
    getParentFile(): JavaFile | null;
}

interface JavaFileInputStream {
    read(buffer: number[]): number;
    close(): void;
}

interface JavaFileOutputStream {
    write(bytes: number[]): void;
    close(): void;
}

interface NSFileManagerType {
    defaultManager: NSFileManagerType;
    contentsOfDirectoryAtPathError_(path: string, error: unknown): string[] | null;
    attributesOfItemAtPathError_(path: string, error: unknown): Record<string, unknown> | null;
    createDirectoryAtPathWithIntermediateDirectoriesAttributesError_(
        path: string,
        createIntermediates: boolean,
        attributes: unknown,
        error: unknown,
    ): boolean;
    removeItemAtPathError_(path: string, error: unknown): boolean;
    fileExistsAtPath_(path: string): boolean;
    contentsAtPath_(path: string): NSDataType | null;
}

interface NSDataType {
    bytes: ArrayBuffer;
    length: number;
    writeToFileAtomically_(path: string, atomically: boolean): boolean;
}

interface NSDataClass {
    dataWithBytesLength_(ptr: ArrayBufferLike, length: number): NSDataType;
}

const isAndroid = typeof java !== 'undefined';
const isIOS = typeof NSFileManager !== 'undefined';
const isNativeScript = isAndroid || isIOS;

function assertNativeScript(): void {
    if (!isNativeScript) {
        throw new Error('Platform not supported');
    }
}

// Typed accessors for the NativeScript platform globals. Each is only ever
// called after the relevant isAndroid / isIOS guard, so the non-null assertion
// is safe — this keeps the `declare const` typings in force instead of casting
// to `any` at every call site.
function androidIO(): NonNullable<typeof java>['io'] {
    return (java as NonNullable<typeof java>).io;
}

function iosFileManager(): NSFileManagerType {
    return (NSFileManager as { defaultManager: NSFileManagerType }).defaultManager;
}

// Node-shaped errno error. The default messages mirror libuv's wording so
// consumers that match on `err.code` or the message string behave like Node.
const ERRNO_MESSAGES: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    EACCES: 'permission denied',
};

function fsError(code: string, syscall: string, path: string): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error(`${code}: ${ERRNO_MESSAGES[code] ?? code}, ${syscall} '${path}'`);
    err.code = code;
    err.path = path;
    err.syscall = syscall;
    return err;
}

// ===== Read options type =====

export interface ReadFileOptions {
    encoding?: BufferEncoding | null;
    flag?: string;
}

export interface WriteFileOptions {
    encoding?: BufferEncoding | null;
    flag?: string;
    mode?: number;
}

export interface MkdirOptions {
    recursive?: boolean;
    mode?: number;
}

export interface ReaddirOptions {
    encoding?: BufferEncoding | null;
    withFileTypes?: false;
}

export interface StatResult {
    size: number;
    mtime: Date;
    isFile(): boolean;
    isDirectory(): boolean;
}

// ===== Internal helpers =====

function stringToBytes(data: string, encoding: BufferEncoding = 'utf8'): number[] {
    // For NativeScript, we build a byte array from the string.
    // Only utf8 / latin1 are used in practice for mobile file ops.
    const bytes: number[] = [];
    if (encoding === 'base64') {
        const raw = atob(data);
        for (let i = 0; i < raw.length; i++) {
            bytes.push(raw.charCodeAt(i));
        }
    } else {
        // utf8 encoding via TextEncoder-like logic
        const encoder = new TextEncoder();
        const encoded = encoder.encode(data);
        for (let i = 0; i < encoded.length; i++) {
            bytes.push(encoded[i]);
        }
    }
    return bytes;
}

function bytesToString(bytes: number[], encoding: BufferEncoding = 'utf8'): string {
    const uint8 = new Uint8Array(bytes);
    if (encoding === 'base64') {
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
        }
        return btoa(binary);
    }
    const decoder = new TextDecoder(encoding);
    return decoder.decode(uint8);
}

// ===== Android implementation =====

function androidReadFile(path: string, encoding: BufferEncoding | null): Promise<string | Uint8Array> {
    return new Promise((resolve, reject) => {
        try {
            const io = androidIO();
            const file = new io.File(path);
            if (!file.exists()) {
                return reject(fsError('ENOENT', 'open', path));
            }
            const fis = new io.FileInputStream(file);
            const bytes: number[] = [];
            const buffer = Array.from<number>({ length: 4096 });
            let bytesRead: number;
            while ((bytesRead = fis.read(buffer)) !== -1) {
                for (let i = 0; i < bytesRead; i++) {
                    bytes.push(buffer[i]);
                }
            }
            fis.close();
            if (encoding) {
                resolve(bytesToString(bytes, encoding));
            } else {
                resolve(new Uint8Array(bytes));
            }
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function androidWriteFile(path: string, data: string | Uint8Array, encoding: BufferEncoding = 'utf8'): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const io = androidIO();
            const file = new io.File(path);
            const parent = file.getParentFile();
            if (parent !== null && !parent.exists()) {
                parent.mkdirs();
            }
            const fos = new io.FileOutputStream(file, false);
            const bytes = typeof data === 'string' ? stringToBytes(data, encoding) : Array.from(data);
            fos.write(bytes);
            fos.close();
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function androidReaddir(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        try {
            const file = new (androidIO().File)(path);
            if (!file.exists() || !file.isDirectory()) {
                return reject(fsError('ENOENT', 'scandir', path));
            }
            const entries = file.list();
            resolve(entries !== null ? Array.from(entries) : []);
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function androidStat(path: string): Promise<StatResult> {
    return new Promise((resolve, reject) => {
        try {
            const file = new (androidIO().File)(path);
            if (!file.exists()) {
                return reject(fsError('ENOENT', 'stat', path));
            }
            const size = file.isFile() ? file.length() : 0;
            const mtime = new Date(file.lastModified());
            const _isFile = file.isFile();
            const _isDirectory = file.isDirectory();
            resolve({
                size,
                mtime,
                isFile: () => _isFile,
                isDirectory: () => _isDirectory,
            });
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function androidMkdir(path: string, options?: MkdirOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const file = new (androidIO().File)(path);
            if (file.exists()) {
                if (!options?.recursive) {
                    return reject(fsError('EEXIST', 'mkdir', path));
                }
                return resolve();
            }
            if (!file.mkdirs()) {
                return reject(fsError('EACCES', 'mkdir', path));
            }
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function androidUnlink(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const file = new (androidIO().File)(path);
            if (!file.exists()) {
                return reject(fsError('ENOENT', 'unlink', path));
            }
            if (!file.delete()) {
                return reject(fsError('EACCES', 'unlink', path));
            }
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

// ===== iOS implementation =====

function iosReadFile(path: string, encoding: BufferEncoding | null): Promise<string | Uint8Array> {
    return new Promise((resolve, reject) => {
        try {
            const nsdata = iosFileManager().contentsAtPath_(path);
            if (nsdata === null) {
                return reject(fsError('ENOENT', 'open', path));
            }
            const buffer = nsdata.bytes;
            const uint8 = new Uint8Array(buffer, 0, nsdata.length);
            if (encoding) {
                resolve(bytesToString(Array.from(uint8), encoding));
            } else {
                resolve(new Uint8Array(uint8));
            }
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function iosWriteFile(path: string, data: string | Uint8Array, encoding: BufferEncoding = 'utf8'): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const bytes = typeof data === 'string' ? new Uint8Array(stringToBytes(data, encoding)) : data;
            // Build NSData from the byte buffer via the ObjC class global.
            const NSData = (globalThis as unknown as Record<string, NSDataClass>).NSData;
            const nsdata = NSData.dataWithBytesLength_(bytes.buffer, bytes.byteLength);
            if (!nsdata.writeToFileAtomically_(path, true)) {
                return reject(fsError('EACCES', 'open', path));
            }
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function iosReaddir(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        try {
            const entries = iosFileManager().contentsOfDirectoryAtPathError_(path, null);
            if (entries === null) {
                return reject(fsError('ENOENT', 'scandir', path));
            }
            resolve(Array.from(entries));
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function iosStat(path: string): Promise<StatResult> {
    return new Promise((resolve, reject) => {
        try {
            const attrs = iosFileManager().attributesOfItemAtPathError_(path, null);
            if (attrs === null) {
                return reject(fsError('ENOENT', 'stat', path));
            }
            const fileType = attrs['NSFileType'] as string | undefined;
            const _isFile = fileType === 'NSFileTypeRegular';
            const _isDirectory = fileType === 'NSFileTypeDirectory';
            const size = (attrs['NSFileSize'] as number | undefined) ?? 0;
            const mtime = new Date((attrs['NSFileModificationDate'] as number | undefined) ?? 0);
            resolve({
                size,
                mtime,
                isFile: () => _isFile,
                isDirectory: () => _isDirectory,
            });
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function iosMkdir(path: string, options?: MkdirOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const fm = iosFileManager();
            if (fm.fileExistsAtPath_(path)) {
                if (!options?.recursive) {
                    return reject(fsError('EEXIST', 'mkdir', path));
                }
                return resolve();
            }
            const ok = fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError_(
                path,
                options?.recursive ?? false,
                null,
                null,
            );
            if (!ok) {
                return reject(fsError('EACCES', 'mkdir', path));
            }
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

function iosUnlink(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const fm = iosFileManager();
            if (!fm.fileExistsAtPath_(path)) {
                return reject(fsError('ENOENT', 'unlink', path));
            }
            if (!fm.removeItemAtPathError_(path, null)) {
                return reject(fsError('EACCES', 'unlink', path));
            }
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

// ===== Public API (node:fs/promises-shaped) =====

/**
 * Read the entire contents of a file.
 * Returns a string when an encoding is given, Uint8Array otherwise.
 */
export function readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding | null,
): Promise<string | Uint8Array> {
    assertNativeScript();
    const encoding =
        options === null || options === undefined
            ? null
            : typeof options === 'string'
              ? options
              : (options.encoding ?? null);
    if (isAndroid) {
        return androidReadFile(path, encoding);
    }
    return iosReadFile(path, encoding);
}

/**
 * Write data to a file, replacing the file if it already exists.
 */
export function writeFile(
    path: string,
    data: string | Uint8Array,
    options?: WriteFileOptions | BufferEncoding | null,
): Promise<void> {
    assertNativeScript();
    const encoding =
        options === null || options === undefined
            ? 'utf8'
            : typeof options === 'string'
              ? options
              : ((options.encoding ?? 'utf8') as BufferEncoding);
    if (isAndroid) {
        return androidWriteFile(path, data, encoding);
    }
    return iosWriteFile(path, data, encoding);
}

/**
 * Read the contents of a directory.
 */
export function readdir(path: string, _options?: ReaddirOptions | null): Promise<string[]> {
    assertNativeScript();
    if (isAndroid) {
        return androidReaddir(path);
    }
    return iosReaddir(path);
}

/**
 * Get file or directory statistics.
 */
export function stat(path: string): Promise<StatResult> {
    assertNativeScript();
    if (isAndroid) {
        return androidStat(path);
    }
    return iosStat(path);
}

/**
 * Create a directory.
 */
export function mkdir(path: string, options?: MkdirOptions): Promise<void> {
    assertNativeScript();
    if (isAndroid) {
        return androidMkdir(path, options);
    }
    return iosMkdir(path, options);
}

/**
 * Remove a file.
 */
export function unlink(path: string): Promise<void> {
    assertNativeScript();
    if (isAndroid) {
        return androidUnlink(path);
    }
    return iosUnlink(path);
}

/**
 * Check whether a path exists (resolves true/false, never rejects).
 */
export function exists(path: string): Promise<boolean> {
    assertNativeScript();
    return stat(path).then(
        () => true,
        () => false,
    );
}
