// The platform halves of `FdBackend`: Android over `java.io.RandomAccessFile`, iOS over
// `NSFileHandle`. Only the Java/ObjC calls live here; the descriptor contract is in `fd-table.ts`
// and is measured off-device. These two are measured on a device by `tests/integration/nativescript`.

import { isAndroid, assertNativeScript } from '@gjsify/native-platform';

import type { FdBackend, FdHandle } from './fd-table.js';

interface JavaRandomAccessFile {
    seek(position: number): void;
    length(): number;
    read(buffer: unknown, offset: number, length: number): number;
    close(): void;
}

interface JavaGlobal {
    io: {
        File: { new (path: string): { exists(): boolean; isFile(): boolean; lastModified(): number } };
        RandomAccessFile: { new (path: string, mode: string): JavaRandomAccessFile };
    };
    lang: {
        Byte: { TYPE: unknown };
        reflect: { Array: { newInstance(type: unknown, length: number): ArrayLike<number> } };
    };
}

interface NSFileHandleInstance {
    seekToFileOffset(offset: number): void;
    readDataOfLength(length: number): { bytes: ArrayBuffer; length: number };
    closeFile(): void;
}

declare const java: JavaGlobal | undefined;
declare const NSFileManager:
    | {
          defaultManager: {
              fileExistsAtPath_(path: string): boolean;
              attributesOfItemAtPathError_(path: string, error: unknown): Record<string, unknown> | null;
          };
      }
    | undefined;
declare const NSFileHandle: { fileHandleForReadingAtPath(path: string): NSFileHandleInstance | null } | undefined;

const androidBackend: FdBackend = {
    openRead(path) {
        const j = java as JavaGlobal;
        const file = new j.io.File(path);
        if (!file.exists() || !file.isFile()) return null;
        const raf = new j.io.RandomAccessFile(path, 'r');
        const handle: FdHandle = {
            readAt(position, length) {
                raf.seek(position);
                const native = j.lang.reflect.Array.newInstance(j.lang.Byte.TYPE, length);
                const n = raf.read(native, 0, length);
                if (n <= 0) return new Uint8Array(0);
                const out = new Uint8Array(n);
                // Java bytes are signed.
                for (let i = 0; i < n; i++) out[i] = native[i] & 0xff;
                return out;
            },
            stat: () => ({ size: raf.length(), mtimeMs: file.lastModified() }),
            close: () => raf.close(),
        };
        return handle;
    },
};

const iosBackend: FdBackend = {
    openRead(path) {
        const fm = (NSFileManager as NonNullable<typeof NSFileManager>).defaultManager;
        if (!fm.fileExistsAtPath_(path)) return null;
        const fh = (NSFileHandle as NonNullable<typeof NSFileHandle>).fileHandleForReadingAtPath(path);
        if (fh === null) return null;
        return {
            readAt(position, length) {
                fh.seekToFileOffset(position);
                const data = fh.readDataOfLength(length);
                return new Uint8Array(data.bytes, 0, data.length).slice();
            },
            stat() {
                const attrs = fm.attributesOfItemAtPathError_(path, null);
                return {
                    size: (attrs?.['NSFileSize'] as number | undefined) ?? 0,
                    mtimeMs: (attrs?.['NSFileModificationDate'] as number | undefined) ?? 0,
                };
            },
            close: () => fh.closeFile(),
        };
    },
};

/** The backend for the running platform; throws `Platform not supported` off NativeScript. */
export function platformFdBackend(): FdBackend {
    assertNativeScript();
    return isAndroid ? androidBackend : iosBackend;
}
