// The file-chooser door of adwaita-nativescript, held to the shared vectors (real GJS is their oracle,
// in adwaita-core's `file-chooser.gjs.spec.ts`) through the namespace barrels, plus what only Android
// shows: the filter → intent mapping. The document picker is replaced by a scripted source; the real
// one needs an Android runtime.

import {
    DialogError,
    FileCreateFlags,
    GioFile,
    GioFileOutputStream,
    GioListStore,
    GioOutputStream,
    GtkFileDialog,
    GtkFileFilter,
    IOErrorEnum,
    promisify,
    type FileChooserHandle,
    type FileChooserRequest,
    type FileFilterSpec,
} from '@gjsify/adwaita-core';
import {
    driveFileChooserVectors,
    type FileChooserNamespaces,
    type ScriptedPick,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { useDocumentSource } from './file-chooser-host.js';
import { SAF_UNTYPED, safIntentSpec } from './file-chooser-intent.js';
import * as GLib from './namespace/glib.js';

// The Gio and Gtk barrels re-export widgets, which need `@nativescript/core`; these are the very
// members `./namespace/gio.ts` and `./namespace/gtk.ts` re-export, and the vocabulary gate holds
// the barrels to them.
const Gio = {
    File: GioFile,
    ListStore: GioListStore,
    OutputStream: GioOutputStream,
    FileOutputStream: GioFileOutputStream,
    FileCreateFlags,
    IOErrorEnum,
    _promisify: promisify,
};
const Gtk = { FileDialog: GtkFileDialog, FileFilter: GtkFileFilter, DialogError };

/** A document held in memory: `openWriter` truncates, `close` commits what was written. */
function memoryHandle(basename: string, initial: Uint8Array = new Uint8Array()): FileChooserHandle {
    let stored = initial.slice();
    return {
        basename,
        uri: `content://test/${basename}`,
        read: async () => stored.slice(),
        openWriter: async () => {
            const chunks: Uint8Array[] = [];
            return {
                write: async (chunk) => void chunks.push(chunk.slice()),
                close: async () => {
                    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
                    let at = 0;
                    for (const c of chunks) {
                        out.set(c, at);
                        at += c.length;
                    }
                    stored = out;
                },
            };
        },
    };
}

function globs(spec: FileFilterSpec): string[] {
    return [
        ...(spec.acceptAll ? ['*'] : []),
        ...spec.patterns.map((ext) => `*.${ext}`),
        ...spec.suffixes.map((ext) => `*.${ext}`),
        ...spec.mimeTypes,
    ];
}

function filter(fields: Partial<FileFilterSpec>): FileFilterSpec {
    return { name: null, patterns: [], suffixes: [], mimeTypes: [], acceptAll: false, ...fields };
}

function request(fields: Partial<FileChooserRequest>): FileChooserRequest {
    return { title: null, filters: [], defaultFilter: null, initialName: null, parent: null, ...fields };
}

export default async () => {
    let next: ScriptedPick = null;
    let last: FileChooserRequest | null = null;
    useDocumentSource(async (_intent, req) => {
        last = req;
        return next === null ? null : memoryHandle(next.basename, next.contents);
    });
    try {
        await driveFileChooserVectors(
            {
                name: 'adwaita-nativescript',
                isOracle: false,
                GLib: GLib as unknown as FileChooserNamespaces['GLib'],
                Gio: Gio as unknown as FileChooserNamespaces['Gio'],
                Gtk: Gtk as unknown as FileChooserNamespaces['Gtk'],
                script: (pick) => void (next = pick),
                pickerFilters: () => (last?.filters ?? []).map(globs),
                cancelled: () => ({ is_cancelled: () => true }),
            },
            { describe, it, expect },
        );
    } finally {
        useDocumentSource(null);
    }

    await describe('adwaita-nativescript: the Storage Access Framework intent', async () => {
        await it('opens */* when a filter names only extensions: on Android the filter is a hint', async () => {
            const spec = safIntentSpec('open', request({ filters: [filter({ patterns: ['asm', 's'] })] }));
            expect(spec.action).toBe('ACTION_OPEN_DOCUMENT');
            expect(spec.type).toBe('*/*');
            expect(spec.extraMimeTypes).toBe(null);
        });

        await it('opens one MIME type as the type, several as EXTRA_MIME_TYPES', async () => {
            const one = safIntentSpec('open', request({ filters: [filter({ mimeTypes: ['text/plain'] })] }));
            expect(one.type).toBe('text/plain');
            expect(one.extraMimeTypes).toBe(null);
            const two = safIntentSpec(
                'open',
                request({ filters: [filter({ mimeTypes: ['text/plain'] }), filter({ mimeTypes: ['image/png'] })] }),
            );
            expect(two.type).toBe('*/*');
            expect(two.extraMimeTypes).toStrictEqual(['text/plain', 'image/png']);
        });

        await it('widens to */* when any filter accepts every file or names no MIME type', async () => {
            const all = safIntentSpec(
                'open',
                request({ filters: [filter({ mimeTypes: ['text/plain'] }), filter({ acceptAll: true })] }),
            );
            expect(all.type).toBe('*/*');
            expect(all.extraMimeTypes).toBe(null);
            const mixed = safIntentSpec(
                'open',
                request({ filters: [filter({ mimeTypes: ['text/plain'] }), filter({ suffixes: ['asm'] })] }),
            );
            expect(mixed.type).toBe('*/*');
        });

        await it('creates a document under the initial name, typed by the default filter', async () => {
            const typed = safIntentSpec(
                'save',
                request({ initialName: 'a.txt', defaultFilter: filter({ mimeTypes: ['text/plain'] }) }),
            );
            expect(typed.action).toBe('ACTION_CREATE_DOCUMENT');
            expect(typed.type).toBe('text/plain');
            expect(typed.title).toBe('a.txt');
            const untyped = safIntentSpec('save', request({ filters: [filter({ suffixes: ['asm'] })] }));
            expect(untyped.type).toBe(SAF_UNTYPED);
            expect(untyped.title).toBe(null);
        });
    });

    await describe('adwaita-nativescript: the platform picker', async () => {
        await it('a host with no picker fails the dialog, not dismisses it', async () => {
            const dialog = new Gtk.FileDialog();
            const open = dialog.open as unknown as (p: unknown, c: unknown) => Promise<unknown>;
            let error: { matches?: (d: unknown, c: number) => boolean } | null = null;
            try {
                await open.call(dialog, null, null);
            } catch (e) {
                error = e as typeof error;
            }
            expect(error?.matches?.(Gtk.DialogError, Gtk.DialogError.FAILED)).toBe(true);
        });
    });
};
