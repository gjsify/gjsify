// The file-chooser door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `file-chooser.gjs.spec.ts`) through both of its paths — the File System Access
// pickers and the Origin Private File System — plus what only a browser shows: the filter mapping,
// a missing user activation, the drawn dialog, the `<input>` copy and the worker write.
//
// The pickers are scripted fakes; the handles behind them are REAL OPFS handles in a directory of
// their own, so every read and write below goes through the browser's storage.

import {
    driveFileChooserVectors,
    FILE_CHOOSER_VECTORS,
    type FileChooserNamespaces,
    type FileChooserSubject,
    type ScriptedPick,
} from '@gjsify/adwaita-core/conformance';
import { registerFileChooserDriver, type FileChooserRequest, type FileFilterSpec } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwDialog } from './elements/adw-dialog.js';
import type { GtkEntry } from './elements/gtk-entry.js';
import type { GtkListBox } from './elements/gtk-list-box.js';
import {
    createWebFileChooserDriver,
    filePickerOptions,
    inputAccept,
    presentOpfsDialog,
    type FilePickerOptions,
    type OpfsChoice,
    type WebFileChooserEnv,
} from './file-chooser-host.js';
import * as Gio from './namespace/gio.js';
import * as GLib from './namespace/glib.js';
import * as Gtk from './namespace/gtk.js';

let scratchCount = 0;

/** A fresh OPFS directory; the caller removes it with {@link dropScratch}. */
async function scratch(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(`file-chooser-spec-${Date.now()}-${scratchCount++}`, { create: true });
}

async function dropScratch(dir: FileSystemDirectoryHandle): Promise<void> {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(dir.name, { recursive: true });
}

async function put(dir: FileSystemDirectoryHandle, name: string, contents: Uint8Array | string) {
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(contents as FileSystemWriteChunkType);
    await stream.close();
    return handle;
}

async function text(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
    return (await (await dir.getFileHandle(name)).getFile()).text();
}

const abort = () => new DOMException('The user aborted a request.', 'AbortError');

/** The filters a File System Access options object carries, written the way the vectors write them. */
function optionGlobs(options: FilePickerOptions): string[][] {
    const out = (options.types ?? []).map((type) =>
        Object.entries(type.accept).flatMap(([mime, exts]) =>
            exts.length > 0 ? exts.map((ext) => `*${ext}`) : [mime],
        ),
    );
    if (options.types && !options.excludeAcceptAllOption) out.push(['*']);
    return out;
}

function requestGlobs(request: FileChooserRequest | null): string[][] {
    return (request?.filters ?? []).map((spec) => [
        ...(spec.acceptAll ? ['*'] : []),
        ...[...spec.patterns, ...spec.suffixes].map((ext) => `*.${ext}`),
        ...spec.mimeTypes,
    ]);
}

const namespaces = { GLib, Gio, Gtk } as unknown as FileChooserNamespaces;

/** A subject whose env opens the File System Access pickers, scripted. */
function pickerSubject(dir: FileSystemDirectoryHandle) {
    let next: ScriptedPick = null;
    let lastOptions: FilePickerOptions = {};
    const env: WebFileChooserEnv = {
        showOpenFilePicker: async (options) => {
            lastOptions = options;
            if (next === null) throw abort();
            return [await put(dir, next.basename, next.contents ?? '')];
        },
        showSaveFilePicker: async (options) => {
            lastOptions = options;
            if (next === null) throw abort();
            return dir.getFileHandle(next.basename, { create: true });
        },
        isActive: () => true,
        opfsRoot: async () => dir,
        choose: async () => null,
        canStreamWrite: () => true,
    };
    const subject: FileChooserSubject = {
        ...namespaces,
        name: 'adwaita-web (File System Access)',
        isOracle: false,
        script: (pick) => void (next = pick),
        pickerFilters: () => optionGlobs(lastOptions),
        cancelled: () => ({ is_cancelled: () => true }),
    };
    return { env, subject };
}

/** A subject whose env has no pickers: OPFS, with the drawn dialog replaced by the script. */
function opfsSubject(dir: FileSystemDirectoryHandle) {
    let next: ScriptedPick = null;
    let lastRequest: FileChooserRequest | null = null;
    const env: WebFileChooserEnv = {
        isActive: () => true,
        opfsRoot: async () => dir,
        choose: async (kind, request) => {
            lastRequest = request;
            if (next === null) return null;
            if (kind === 'open') await put(dir, next.basename, next.contents ?? '');
            return { name: next.basename };
        },
        canStreamWrite: () => true,
    };
    const subject: FileChooserSubject = {
        ...namespaces,
        name: 'adwaita-web (OPFS)',
        isOracle: false,
        script: (pick) => void (next = pick),
        pickerFilters: () => requestGlobs(lastRequest),
        cancelled: () => ({ is_cancelled: () => true }),
    };
    return { env, subject };
}

async function withEnv<T>(env: WebFileChooserEnv, body: () => Promise<T>): Promise<T> {
    const previous = registerFileChooserDriver(createWebFileChooserDriver(env));
    try {
        return await body();
    } finally {
        registerFileChooserDriver(previous);
    }
}

const spec = (over: Partial<FileFilterSpec>): FileFilterSpec => ({
    name: null,
    patterns: [],
    suffixes: [],
    mimeTypes: [],
    acceptAll: false,
    ...over,
});

const asm = spec({ name: 'Assembly Files', patterns: ['asm', 's'] });
const all = spec({ name: 'All Files', acceptAll: true });

const request = (over: Partial<FileChooserRequest> = {}): FileChooserRequest => ({
    title: null,
    filters: [],
    defaultFilter: null,
    initialName: null,
    parent: null,
    ...over,
});

type Opened = { get_basename(): string; load_contents_async(c: unknown): Promise<[Uint8Array, unknown]> };
const openDialog = (filters?: unknown): Promise<Opened> =>
    (new Gtk.FileDialog(filters ? { filters } : {}).open as unknown as (p: unknown, c: unknown) => Promise<Opened>)(
        null,
        null,
    );

async function rejectionOf(pending: Promise<unknown>): Promise<{ dismissed: boolean; failed: boolean } | 'resolved'> {
    try {
        await pending;
        return 'resolved';
    } catch (error) {
        const e = error as { matches(domain: unknown, code: number): boolean };
        return {
            dismissed: e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED),
            failed: e.matches(Gtk.DialogError, Gtk.DialogError.FAILED),
        };
    }
}

async function readyDialog(): Promise<AdwDialog> {
    for (let i = 0; i < 200; i++) {
        const dialog = document.querySelector('adw-dialog[data-ready]') as AdwDialog | null;
        if (dialog) return dialog;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the OPFS dialog never set data-ready');
}

const rowNames = (dialog: AdwDialog) =>
    [...dialog.querySelectorAll('gtk-list-box-row[data-name]')].map((row) => (row as HTMLElement).dataset.name);

export const FileChooserTest = async () => {
    for (const make of [pickerSubject, opfsSubject]) {
        const dir = await scratch();
        const { env, subject } = make(dir);
        try {
            await withEnv(env, () => driveFileChooserVectors(subject, { describe, it, expect }, FILE_CHOOSER_VECTORS));
        } finally {
            await dropScratch(dir);
        }
    }

    await describe('adwaita-web: the File System Access mapping', async () => {
        await it('maps an extension filter to the octet-stream key and keeps the accept-all option', () => {
            const options = filePickerOptions(request({ filters: [asm, all], initialName: 'a.asm' }), 'save');
            expect(JSON.stringify(options)).toBe(
                JSON.stringify({
                    types: [{ description: 'Assembly Files', accept: { 'application/octet-stream': ['.asm', '.s'] } }],
                    excludeAcceptAllOption: false,
                    suggestedName: 'a.asm',
                }),
            );
        });

        await it('excludes the accept-all option when no filter accepts everything, and keys MIME types', () => {
            const text = spec({ name: 'Text', suffixes: ['txt'], mimeTypes: ['text/plain'] });
            const options = filePickerOptions(request({ filters: [text], initialName: 'x.txt' }), 'open');
            expect(JSON.stringify(options)).toBe(
                JSON.stringify({
                    types: [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }],
                    excludeAcceptAllOption: true,
                }),
            );
        });

        await it('gives <input accept> the extensions and MIME types, and nothing for accept-all', () => {
            expect(JSON.stringify([inputAccept(asm), inputAccept(all), inputAccept(null)])).toBe(
                JSON.stringify(['.asm,.s', null, null]),
            );
        });
    });

    await describe('adwaita-web: the driver', async () => {
        await it('rejects with DialogError.FAILED without a user activation, before any picker opens', async () => {
            const dir = await scratch();
            let opened = false;
            const { env } = pickerSubject(dir);
            env.isActive = () => false;
            const picker = env.showOpenFilePicker!;
            env.showOpenFilePicker = (options) => ((opened = true), picker(options));
            const result = await withEnv(env, () => rejectionOf(openDialog()));
            await dropScratch(dir);
            expect(JSON.stringify([result, opened])).toBe(JSON.stringify([{ dismissed: false, failed: true }, false]));
        });

        await it('maps AbortError to DISMISSED and any other picker error to FAILED', async () => {
            const dir = await scratch();
            const { env } = pickerSubject(dir);
            const aborted = await withEnv(env, () => rejectionOf(openDialog()));
            env.showOpenFilePicker = async () => {
                throw new DOMException('blocked', 'SecurityError');
            };
            const blocked = await withEnv(env, () => rejectionOf(openDialog()));
            await dropScratch(dir);
            expect(JSON.stringify([aborted, blocked])).toBe(
                JSON.stringify([
                    { dismissed: true, failed: false },
                    { dismissed: false, failed: true },
                ]),
            );
        });

        await it('copies an <input> pick into OPFS under a free name', async () => {
            const dir = await scratch();
            await put(dir, 'a.asm', 'old');
            const env: WebFileChooserEnv = {
                isActive: () => true,
                opfsRoot: async () => dir,
                choose: async () => ({ upload: new File(['new'], 'a.asm') }) as OpfsChoice,
                canStreamWrite: () => true,
            };
            const file = await withEnv(env, () => openDialog());
            const result = [file.get_basename(), await text(dir, 'a.asm'), await text(dir, 'a (2).asm')];
            await dropScratch(dir);
            expect(JSON.stringify(result)).toBe(JSON.stringify(['a (2).asm', 'old', 'new']));
        });

        await it('writes through a createSyncAccessHandle worker where createWritable is missing', async () => {
            const dir = await scratch();
            await put(dir, 'w.txt', 'a longer old content');
            const driver = createWebFileChooserDriver({
                isActive: () => true,
                opfsRoot: async () => dir,
                choose: async () => ({ name: 'w.txt' }),
                canStreamWrite: () => false,
            });
            const handle = await driver.save(request({ initialName: 'w.txt' }));
            const writer = await handle.openWriter();
            await writer.write(new TextEncoder().encode('he'));
            await writer.write(new TextEncoder().encode('llo'));
            await writer.close();
            const result = new TextDecoder().decode(await handle.read());
            await dropScratch(dir);
            expect(result).toBe('hello');
        });

        await it('never creates a download link to save', async () => {
            const dir = await scratch();
            const created: string[] = [];
            const original = document.createElement;
            document.createElement = function (this: Document, tag: string, options?: ElementCreationOptions) {
                created.push(tag.toLowerCase());
                return original.call(this, tag, options);
            } as typeof document.createElement;
            try {
                const { env, subject } = opfsSubject(dir);
                subject.script({ basename: 'd.txt' });
                await withEnv(env, async () => {
                    const save = new Gtk.FileDialog({ initial_name: 'd.txt' }).save as unknown as (
                        p: unknown,
                        c: unknown,
                    ) => Promise<{ replace_contents_async: unknown }>;
                    await save(null, null);
                });
            } finally {
                document.createElement = original;
                await dropScratch(dir);
            }
            expect(created.includes('a')).toBe(false);
        });
    });

    await describe('adwaita-web: the drawn OPFS dialog', async () => {
        await it('lists what the current filter accepts and opens the selected row', async () => {
            const dir = await scratch();
            await put(dir, 'b.asm', '');
            await put(dir, 'a.asm', '');
            await put(dir, 'notes.txt', '');
            const pending = presentOpfsDialog('open', request({ filters: [asm, all] }), dir);
            const dialog = await readyDialog();
            const names = rowNames(dialog);
            const list = dialog.querySelector('gtk-list-box[selection-mode="single"]') as GtkListBox;
            list.selectRow(list.rows[1]);
            (dialog.querySelector('gtk-button[label="Open"]') as HTMLElement).click();
            const choice = await pending;
            const gone = !dialog.isConnected;
            await dropScratch(dir);
            expect(JSON.stringify([names, choice, gone])).toBe(
                JSON.stringify([['a.asm', 'b.asm'], { name: 'b.asm' }, true]),
            );
        });

        await it('saves under the name in the entry, prefilled with the initial name', async () => {
            const dir = await scratch();
            const pending = presentOpfsDialog('save', request({ initialName: 'p.asm' }), dir);
            const dialog = await readyDialog();
            const entry = dialog.querySelector('gtk-entry') as GtkEntry;
            const prefilled = entry.value;
            entry.value = 'q.asm';
            (dialog.querySelector('gtk-button[label="Save"]') as HTMLElement).click();
            const choice = await pending;
            await dropScratch(dir);
            expect(JSON.stringify([prefilled, choice])).toBe(JSON.stringify(['p.asm', { name: 'q.asm' }]));
        });

        await it('resolves null when the dialog closes without a choice', async () => {
            const dir = await scratch();
            const pending = presentOpfsDialog('open', request(), dir);
            const dialog = await readyDialog();
            dialog.close();
            const choice = await pending;
            await dropScratch(dir);
            expect(choice).toBe(null);
        });
    });
};
