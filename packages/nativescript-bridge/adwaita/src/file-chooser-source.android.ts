// Picking a document on Android: the Storage Access Framework, the same `ACTION_OPEN_DOCUMENT` /
// `ACTION_CREATE_DOCUMENT` intents an app's own code sends. Unverified on a device (ADR 0100 § Tests);
// the APIs are the documented ones.
//
// The handle is the `content://` URI: `read()` drains `openInputStream`, `openWriter()` opens
// `openOutputStream(uri, "wt")`, which truncates — so a crash mid-write can lose content, as ADR 0100
// § 3 records. Permission is the one the intent grants for this run; nothing is persisted.

import { Application } from '@nativescript/core';
import type { FileChooserHandle, FileChooserWriter } from '@gjsify/adwaita-core';

import type { SafIntentSpec } from './file-chooser-intent.js';

// As much of the Java surface as this file reaches, declared rather than `any`.

/** A Java array NativeScript allocates: indexable, written element by element. */
type JavaArrayLike<T> = { [index: number]: T; readonly length: number };

interface AndroidUri {
    toString(): string;
    getLastPathSegment(): string | null;
}

interface AndroidCursor {
    getColumnIndex(column: string): number;
    moveToFirst(): boolean;
    getString(column: number): string | null;
    close(): void;
}

interface AndroidInputStream {
    read(buffer: JavaArrayLike<number>): number;
    close(): void;
}

interface AndroidOutputStream {
    write(buffer: JavaArrayLike<number>, offset: number, length: number): void;
    flush(): void;
    close(): void;
}

interface AndroidContentResolver {
    query(uri: AndroidUri, ...rest: null[]): AndroidCursor | null;
    openInputStream(uri: AndroidUri): AndroidInputStream | null;
    openOutputStream(uri: AndroidUri, mode: string): AndroidOutputStream | null;
}

interface AndroidPickerActivity {
    getContentResolver(): AndroidContentResolver;
    startActivityForResult(intent: AndroidIntent, requestCode: number): void;
}

interface AndroidIntent {
    addCategory(category: string): void;
    setType(type: string): void;
    putExtra(name: string, value: unknown): void;
    getData?(): AndroidUri | null;
}

interface ActivityResult {
    readonly requestCode: number;
    readonly resultCode: number;
    readonly intent?: AndroidIntent | null;
}

interface AndroidPickerHost {
    readonly foregroundActivity?: AndroidPickerActivity | null;
    readonly startActivity?: AndroidPickerActivity | null;
    on?(event: 'activityResult', callback: (args: ActivityResult) => void): void;
    off?(event: 'activityResult', callback: (args: ActivityResult) => void): void;
}

declare const android: {
    app: { Activity: { RESULT_OK: number } };
    provider: { OpenableColumns: { DISPLAY_NAME: string } };
    content: {
        Intent: (new (action: string) => AndroidIntent) & {
            readonly ACTION_OPEN_DOCUMENT: string;
            readonly ACTION_CREATE_DOCUMENT: string;
            readonly CATEGORY_OPENABLE: string;
            readonly EXTRA_MIME_TYPES: string;
            readonly EXTRA_TITLE: string;
        };
    };
};

// NativeScript puts `create` on the global `Array` to allocate a Java array.
const JavaArray = Array as unknown as { create<T>(type: string, length: number): JavaArrayLike<T> };

const CHUNK = 64 * 1024;
// One request code for the door: a second picker cannot open while the first owns the activity.
const REQUEST_CODE = 0x6a5f;

function displayName(resolver: AndroidContentResolver, uri: AndroidUri): string {
    const cursor = resolver.query(uri, null, null, null, null);
    try {
        const column = cursor?.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME) ?? -1;
        if (cursor && column >= 0 && cursor.moveToFirst()) {
            const name = cursor.getString(column);
            if (name) return String(name);
        }
    } finally {
        cursor?.close();
    }
    const segment = uri.getLastPathSegment();
    return segment ? String(segment) : String(uri.toString());
}

async function readAll(resolver: AndroidContentResolver, uri: AndroidUri): Promise<Uint8Array> {
    const input = resolver.openInputStream(uri);
    if (!input) throw new Error(`Android cannot open ${uri.toString()} for reading`);
    const buffer = JavaArray.create<number>('byte', CHUNK);
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
        for (let n = input.read(buffer); n > 0; n = input.read(buffer)) {
            const part = new Uint8Array(n);
            for (let i = 0; i < n; i++) part[i] = buffer[i] & 0xff;
            parts.push(part);
            total += n;
        }
    } finally {
        input.close();
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

function openWriter(resolver: AndroidContentResolver, uri: AndroidUri): FileChooserWriter {
    const output = resolver.openOutputStream(uri, 'wt');
    if (!output) throw new Error(`Android cannot open ${uri.toString()} for writing`);
    return {
        write: async (chunk) => {
            const bytes = JavaArray.create<number>('byte', chunk.length);
            // A Java byte is signed: 0x80..0xff go in as -128..-1.
            for (let i = 0; i < chunk.length; i++) bytes[i] = (chunk[i] << 24) >> 24;
            output.write(bytes, 0, chunk.length);
        },
        close: async () => {
            output.flush();
            output.close();
        },
    };
}

function handleFor(context: AndroidPickerActivity, uri: AndroidUri): FileChooserHandle {
    const resolver = context.getContentResolver();
    return {
        basename: displayName(resolver, uri),
        uri: String(uri.toString()),
        read: () => readAll(resolver, uri),
        openWriter: async () => openWriter(resolver, uri),
    };
}

function intentFor(spec: SafIntentSpec): AndroidIntent {
    const Intent = android.content.Intent;
    const intent = new Intent(Intent[spec.action]);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(spec.type);
    if (spec.extraMimeTypes !== null) {
        const types = JavaArray.create<string>('java.lang.String', spec.extraMimeTypes.length);
        spec.extraMimeTypes.forEach((type, i) => (types[i] = type));
        intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
    }
    if (spec.title !== null) intent.putExtra(Intent.EXTRA_TITLE, spec.title);
    return intent;
}

export function pickPlatformDocument(spec: SafIntentSpec): Promise<FileChooserHandle | null> {
    const host = Application.android as AndroidPickerHost | undefined;
    const context = host?.foregroundActivity ?? host?.startActivity ?? null;
    if (!host?.on || !host.off || !context?.startActivityForResult) {
        return Promise.reject(new Error('Android has no foreground activity to start the document picker from'));
    }
    const { on, off } = { on: host.on.bind(host), off: host.off.bind(host) };
    return new Promise((resolve, reject) => {
        const onResult = (args: ActivityResult) => {
            if (args.requestCode !== REQUEST_CODE) return;
            off('activityResult', onResult);
            const uri = args.intent?.getData?.();
            // RESULT_CANCELED, or a provider that returned no document: the user backed out.
            if (args.resultCode !== android.app.Activity.RESULT_OK || !uri) return resolve(null);
            try {
                resolve(handleFor(context, uri));
            } catch (error) {
                reject(error);
            }
        };
        on('activityResult', onResult);
        try {
            context.startActivityForResult(intentFor(spec), REQUEST_CODE);
        } catch (error) {
            off('activityResult', onResult);
            reject(error);
        }
    });
}
