// The Android backend: androidx.sqlite's BundledSQLiteDriver through the NativeScript Java
// bridge — ADR 0146. Everything that is a JS-vs-Java conversion lives here; everything
// that is SQLite semantics lives in driver.ts.
//
// The conversions are the Spike's findings, not guesses:
//   - a 64-bit integer goes in as `java.lang.Long.parseLong(String(v))` (a BigInt argument
//     fails method resolution, a Number rounds, `new java.lang.Long(str)` stores garbage);
//   - a blob goes in as `Array.create('byte', n)` and comes out as a signed `byte[]`,
//     copied into a Uint8Array with `& 0xff`.

import { Utils } from '@nativescript/core';

import type { RawBackend, RawConnection, RawStatement } from './driver.js';

// NativeScript's ambient host globals.
declare const java: any;
declare const androidx: any;
declare const Array: ArrayConstructor & { create(type: string, length: number): any };

const DEFAULT_FLAGS = 6; // READWRITE | CREATE

function toJavaBytes(data: Uint8Array): any {
    const bytes = Array.create('byte', data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = (data[i] << 24) >> 24;
    return bytes;
}

function fromJavaBytes(bytes: any): Uint8Array {
    if (bytes == null) return new Uint8Array(0);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < out.length; i++) out[i] = bytes[i] & 0xff;
    return out;
}

class AndroidStatement implements RawStatement {
    constructor(private readonly s: any) {}
    bindNull(index: number) {
        this.s.bindNull(index);
    }
    bindLong(index: number, value: bigint | number) {
        this.s.bindLong(index, typeof value === 'bigint' ? java.lang.Long.parseLong(String(value)) : value);
    }
    bindDouble(index: number, value: number) {
        this.s.bindDouble(index, value);
    }
    bindText(index: number, value: string) {
        this.s.bindText(index, value);
    }
    bindBlob(index: number, value: Uint8Array) {
        this.s.bindBlob(index, toJavaBytes(value));
    }
    step(): boolean {
        return !!this.s.step();
    }
    reset() {
        this.s.reset();
    }
    clearBindings() {
        this.s.clearBindings();
    }
    close() {
        this.s.close();
    }
    getColumnCount(): number {
        return this.s.getColumnCount();
    }
    getColumnName(index: number): string {
        return String(this.s.getColumnName(index));
    }
    getColumnType(index: number): number {
        return this.s.getColumnType(index);
    }
    getDouble(index: number): number {
        return this.s.getDouble(index);
    }
    getText(index: number): string {
        return String(this.s.getText(index));
    }
    getBlob(index: number): Uint8Array {
        return fromJavaBytes(this.s.getBlob(index));
    }
}

class AndroidConnection implements RawConnection {
    constructor(private readonly c: any) {}
    prepare(sql: string): RawStatement {
        return new AndroidStatement(this.c.prepare(sql));
    }
    close() {
        this.c.close();
    }
}

/** `:memory:` and absolute paths as given; a bare name lives in the app's database directory. */
function resolvePath(path: string, create: boolean): string {
    if (path === '' || path === ':memory:' || path.startsWith('/')) return path;
    const context = Utils.android.getApplicationContext();
    if (!context) return path;
    const file = context.getDatabasePath(path);
    if (create) file.getParentFile()?.mkdirs();
    return String(file.getAbsolutePath());
}

export function createAndroidBackend(): RawBackend {
    return {
        open(path: string, mode: number, uri: boolean): RawConnection {
            if (uri) throw new Error('file: URIs are not supported by the Android node:sqlite driver');
            if (typeof androidx === 'undefined' || !androidx?.sqlite?.driver?.bundled) {
                throw new Error(
                    'androidx.sqlite is not available: add `androidx.sqlite:sqlite-bundled` to the app and list the ' +
                        'androidx.sqlite classes in App_Resources/Android/native-api-usage.json (ADR 0146)',
                );
            }
            const driver = new androidx.sqlite.driver.bundled.BundledSQLiteDriver();
            const target = resolvePath(path, (mode & 4) !== 0);
            const connection = mode === DEFAULT_FLAGS ? driver.open(target) : driver.open(target, mode);
            return new AndroidConnection(connection);
        },
    };
}
