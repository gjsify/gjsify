// How the web door answers `Gtk.FileDialog` (ADR 0100 § 4, § 4a, § 5). The subset itself — argument
// checks, the async/finish pairs, `Gio.File`, the stream — is `@gjsify/adwaita-core`'s; this file is
// the driver below it.
//
// THE DOOR CHOOSES BY FEATURE, NEVER BY BROWSER. No line here reads the user agent:
//   - `'showSaveFilePicker' in window`: the system pickers of File System Access, over the user's
//     real files. The filters become `types[].accept`.
//   - otherwise: the Origin Private File System, in a dialog drawn from Adwaita elements
//     ({@link presentOpfsDialog}). A file picked through `<input type=file>` from that dialog is
//     COPIED into OPFS, so the next save writes the copy and not a download.
//   - `createWritable` on the handle: the write streams on the main thread; where it is missing
//     (Safari before 26), a dedicated worker writes with `createSyncAccessHandle`.
//
// A download is never a stand-in for save; nothing here creates one.
//
// THE DRAWN DIALOG is a clean-room re-implementation: its STRUCTURE follows the current GNOME file
// chooser (Nautilus' file-chooser mode — an OverlaySplitView with a places sidebar, the file list,
// and a bottom bar with the filter drop-down, the name entry and the accept button), and no code,
// template or string is taken from Nautilus (GPL-3.0-or-later). It shows only what OPFS has.

import {
    dialogFailedError,
    dismissedError,
    fileFilterAccepts,
    registerFileChooserDriver,
    type FileChooserDriver,
    type FileChooserHandle,
    type FileChooserRequest,
    type FileChooserWriter,
    type FileFilterSpec,
} from '@gjsify/adwaita-core';

import './elements/adw-dialog.js';
import './elements/adw-overlay-split-view.js';
import './elements/adw-toolbar-view.js';
import './elements/gtk-button.js';
import './elements/gtk-drop-down.js';
import './elements/gtk-entry.js';
import './elements/gtk-list-box.js';
import './elements/gtk-list-box-row.js';
import type { AdwDialog } from './elements/adw-dialog.js';
import type { GtkDropDown } from './elements/gtk-drop-down.js';
import type { GtkEntry } from './elements/gtk-entry.js';
import type { GtkListBoxRow } from './elements/gtk-list-box-row.js';

/** What the drawn dialog hands back: an OPFS entry by name, or a file the `<input>` picked. */
export type OpfsChoice = { readonly name: string } | { readonly upload: File };

/** File System Access `showOpenFilePicker`/`showSaveFilePicker` options, as far as the door fills them. */
export interface FilePickerOptions {
    types?: { description: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption?: boolean;
    suggestedName?: string;
}

/** The platform the driver reads. {@link browserFileChooserEnv} is the real one; a spec passes fakes. */
export interface WebFileChooserEnv {
    showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle>;
    /** Transient user activation; an environment that cannot say answers `true`. */
    isActive(): boolean;
    opfsRoot(): Promise<FileSystemDirectoryHandle>;
    /** The drawn dialog over `root`; `null` when the user closed it. */
    choose(
        kind: 'open' | 'save',
        request: FileChooserRequest,
        root: FileSystemDirectoryHandle,
    ): Promise<OpfsChoice | null>;
    /** Whether `handle` writes through `createWritable`; the worker writes otherwise. */
    canStreamWrite(handle: FileSystemFileHandle): boolean;
}

// --- Filters ------------------------------------------------------------------------------------

/** The extensions a filter names, with the dot, as `accept` and `types[].accept` take them. */
function extensionsOf(spec: FileFilterSpec): string[] {
    return [...spec.patterns, ...spec.suffixes].map((ext) => `.${ext}`);
}

/**
 * The File System Access options for `request`. An extension-only filter needs a MIME key, and
 * `application/octet-stream` is the one that claims nothing about the content. A filter that
 * accepts everything is the picker's own accept-all option, so it is not a type.
 */
export function filePickerOptions(request: FileChooserRequest, kind: 'open' | 'save'): FilePickerOptions {
    const types: NonNullable<FilePickerOptions['types']> = [];
    for (const spec of request.filters) {
        if (spec.acceptAll) continue;
        const accept: Record<string, string[]> = {};
        for (const mime of spec.mimeTypes) accept[mime] = [];
        const extensions = extensionsOf(spec);
        if (extensions.length > 0) accept[spec.mimeTypes[0] ?? 'application/octet-stream'] = extensions;
        types.push({ description: spec.name ?? '', accept });
    }
    const options: FilePickerOptions = {};
    if (types.length > 0) {
        options.types = types;
        options.excludeAcceptAllOption = !request.filters.some((spec) => spec.acceptAll);
    }
    if (kind === 'save' && request.initialName !== null) options.suggestedName = request.initialName;
    return options;
}

/** `<input type=file accept>` for one filter: extensions and MIME types; `null` accepts every file. */
export function inputAccept(spec: FileFilterSpec | null): string | null {
    if (!spec || spec.acceptAll) return null;
    const accept = [...extensionsOf(spec), ...spec.mimeTypes];
    return accept.length > 0 ? accept.join(',') : null;
}

// --- Handles and writers ------------------------------------------------------------------------

// Opens, truncates, writes and flushes in one message: `createSyncAccessHandle` exists in a
// dedicated worker only, and only on OPFS files, which is exactly the handle this path gets.
const WORKER_SOURCE = `onmessage = async (event) => {
    const { handle, data } = event.data;
    let access = null;
    try {
        access = await handle.createSyncAccessHandle();
        access.truncate(0);
        access.write(data, { at: 0 });
        access.flush();
        postMessage({ ok: true });
    } catch (error) {
        postMessage({ ok: false, message: String((error && error.name) || 'Error') + ': ' + String(error && error.message) });
    } finally {
        if (access) access.close();
    }
};`;

function writeInWorker(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    return new Promise<void>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<{ ok: boolean; message?: string }>) => {
            if (event.data.ok) resolve();
            else reject(new Error(event.data.message));
        };
        worker.onerror = (event) => reject(new Error(event.message || 'the write worker failed'));
        worker.postMessage({ handle, data });
    }).finally(() => {
        worker.terminate();
        URL.revokeObjectURL(url);
    });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}

async function openWriter(handle: FileSystemFileHandle, env: WebFileChooserEnv): Promise<FileChooserWriter> {
    if (env.canStreamWrite(handle)) {
        // `keepExistingData` defaults to false: the stream starts empty, and `close()` commits.
        const stream = await handle.createWritable();
        return { write: (chunk) => stream.write(chunk as Uint8Array<ArrayBuffer>), close: () => stream.close() };
    }
    const chunks: Uint8Array[] = [];
    return {
        write: async (chunk) => void chunks.push(chunk.slice()),
        close: () => writeInWorker(handle, concat(chunks)),
    };
}

function handleFor(handle: FileSystemFileHandle, env: WebFileChooserEnv): FileChooserHandle {
    return {
        basename: handle.name,
        read: async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()),
        openWriter: () => openWriter(handle, env),
    };
}

/** `name`, or `stem (2).ext`, `stem (3).ext` … — whichever `root` does not hold yet. */
async function freeName(root: FileSystemDirectoryHandle, name: string): Promise<string> {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
        try {
            await root.getFileHandle(candidate);
        } catch {
            return candidate;
        }
    }
}

/** Copies a picked `File` into OPFS: the copy is what a later save writes, never an existing file. */
async function copyIntoOpfs(root: FileSystemDirectoryHandle, file: File, env: WebFileChooserEnv) {
    const target = await root.getFileHandle(await freeName(root, file.name), { create: true });
    const writer = await openWriter(target, env);
    await writer.write(new Uint8Array(await file.arrayBuffer()));
    await writer.close();
    return target;
}

// --- The driver ---------------------------------------------------------------------------------

function isAbort(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/** The `Gtk.DialogError` a platform rejection becomes: `AbortError` is the user closing the picker. */
function dialogRejection(error: unknown) {
    if (isAbort(error)) return dismissedError();
    const e = error as { name?: string; message?: string } | null;
    if (e && typeof e.message === 'string') return dialogFailedError(`${e.name ?? 'Error'}: ${e.message}`);
    return dialogFailedError(String(error));
}

export function createWebFileChooserDriver(env: WebFileChooserEnv): FileChooserDriver {
    const run = async (kind: 'open' | 'save', request: FileChooserRequest): Promise<FileChooserHandle> => {
        if (!env.isActive()) {
            throw dialogFailedError(`Gtk.FileDialog.${kind}() needs a user activation (a click or a key press)`);
        }
        try {
            if (env.showSaveFilePicker && env.showOpenFilePicker) {
                const options = filePickerOptions(request, kind);
                const handle =
                    kind === 'open'
                        ? (await env.showOpenFilePicker(options))[0]
                        : await env.showSaveFilePicker(options);
                if (!handle) throw dismissedError();
                return handleFor(handle, env);
            }
            const root = await env.opfsRoot();
            const choice = await env.choose(kind, request, root);
            if (choice === null) throw dismissedError();
            if ('upload' in choice) return handleFor(await copyIntoOpfs(root, choice.upload, env), env);
            return handleFor(await root.getFileHandle(choice.name, { create: kind === 'save' }), env);
        } catch (error) {
            throw dialogRejection(error);
        }
    };
    return { open: (request) => run('open', request), save: (request) => run('save', request) };
}

// --- The drawn dialog ---------------------------------------------------------------------------

function el<K extends string>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
}

function sameFilter(a: FileFilterSpec, b: FileFilterSpec): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Lets the user pick an OPFS file (`open`) or name one (`save`). Resolves the choice, or `null`
 * when the dialog closes without one. On `open`, "Upload…" picks a file through `<input type=file>`;
 * its `cancel` event dismisses the whole open, as ADR 0100 § 5 maps it.
 *
 * The dialog sets `data-ready` once the list is filled, which is what a spec waits for.
 */
export function presentOpfsDialog(
    kind: 'open' | 'save',
    request: FileChooserRequest,
    root: FileSystemDirectoryHandle,
): Promise<OpfsChoice | null> {
    const filters = request.filters;
    const initial = request.defaultFilter ? filters.findIndex((f) => sameFilter(f, request.defaultFilter!)) : 0;
    let current: FileFilterSpec | null = filters[Math.max(initial, 0)] ?? request.defaultFilter;

    const dialog = el('adw-dialog', {
        title: request.title ?? (kind === 'open' ? 'Open File' : 'Save File'),
        'content-width': '720',
        'content-height': '480',
    }) as AdwDialog;

    const split = el('adw-overlay-split-view', { breakpoint: 'max-width: 560px' });
    const sidebar = el('div', { slot: 'sidebar' });
    const places = el('gtk-list-box', { class: 'navigation-sidebar', 'selection-mode': 'browse' });
    places.append(el('gtk-list-box-row', {}, 'Origin Storage'));
    sidebar.append(places);

    const view = el('adw-toolbar-view');
    const list = el('gtk-list-box', { 'selection-mode': 'single', 'activate-on-single-click': 'false' });
    const empty = el('p', { class: 'dimmed', hidden: '' }, 'No files');
    const bottom = el('div', { slot: 'bottom', class: 'toolbar' });

    let dropDown: GtkDropDown | null = null;
    if (filters.length > 0) {
        dropDown = el('gtk-drop-down') as GtkDropDown;
        dropDown.model = filters.map((f, i) => f.name ?? `Filter ${i + 1}`);
        dropDown.selected = Math.max(initial, 0);
        bottom.append(dropDown);
    }
    let entry: GtkEntry | null = null;
    if (kind === 'save') {
        entry = el('gtk-entry', { 'placeholder-text': 'Name' }) as GtkEntry;
        entry.style.flex = '1';
        entry.value = request.initialName ?? '';
        bottom.append(entry);
    }
    let upload: HTMLElement | null = null;
    if (kind === 'open') {
        upload = el('gtk-button', { label: 'Upload…' });
        bottom.append(upload);
    }
    const spacer = el('div');
    spacer.style.flex = '1';
    const accept = el('gtk-button', { label: kind === 'open' ? 'Open' : 'Save', suggested: '' });
    bottom.append(spacer, accept);

    view.append(list, empty, bottom);
    split.append(sidebar, view);
    dialog.append(split);

    let selected: string | null = null;

    const refill = async () => {
        dialog.removeAttribute('data-ready');
        const names: string[] = [];
        for await (const [name, entryHandle] of root.entries()) {
            if (entryHandle.kind === 'file' && (!current || fileFilterAccepts(current, name))) names.push(name);
        }
        names.sort((a, b) => a.localeCompare(b));
        list.replaceChildren(
            ...names.map((name) => {
                const row = el('gtk-list-box-row', { 'data-name': name }, name);
                return row;
            }),
        );
        selected = null;
        empty.hidden = names.length > 0;
        dialog.setAttribute('data-ready', '');
    };

    return new Promise<OpfsChoice | null>((resolve) => {
        let settled = false;
        const finish = (choice: OpfsChoice | null) => {
            if (settled) return;
            settled = true;
            resolve(choice);
            dialog.forceClose();
            dialog.remove();
        };
        const acceptCurrent = () => {
            if (kind === 'open') {
                if (selected !== null) finish({ name: selected });
                return;
            }
            const name = entry!.value.trim();
            if (name !== '' && !name.includes('/') && name !== '.' && name !== '..') finish({ name });
        };

        list.addEventListener('row-selected', (event) => {
            const row = (event as CustomEvent<{ row: GtkListBoxRow | null }>).detail.row;
            selected = row?.dataset.name ?? null;
            if (entry && selected !== null) entry.value = selected;
        });
        list.addEventListener('row-activated', (event) => {
            const row = (event as CustomEvent<{ row: GtkListBoxRow }>).detail.row;
            selected = row.dataset.name ?? null;
            if (entry && selected !== null) entry.value = selected;
            acceptCurrent();
        });
        entry?.addEventListener('activate', acceptCurrent);
        accept.addEventListener('click', acceptCurrent);
        dropDown?.addEventListener('notify::selected', (event) => {
            current = filters[(event as CustomEvent<{ selected: number }>).detail.selected] ?? null;
            void refill();
        });
        upload?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            const acceptAttr = inputAccept(current);
            if (acceptAttr !== null) input.accept = acceptAttr;
            input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) finish({ upload: file });
            });
            input.addEventListener('cancel', () => finish(null));
            input.click();
        });
        dialog.addEventListener('closed', () => finish(null));

        dialog.present();
        void refill();
    });
}

// --- The real environment -----------------------------------------------------------------------

type PickerWindow = {
    showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle>;
};

export function browserFileChooserEnv(): WebFileChooserEnv {
    const win = (typeof window === 'undefined' ? {} : window) as PickerWindow;
    const pickers = 'showSaveFilePicker' in win && 'showOpenFilePicker' in win;
    return {
        showOpenFilePicker: pickers ? (options) => win.showOpenFilePicker!(options) : undefined,
        showSaveFilePicker: pickers ? (options) => win.showSaveFilePicker!(options) : undefined,
        isActive: () =>
            typeof navigator !== 'undefined' && navigator.userActivation ? navigator.userActivation.isActive : true,
        opfsRoot: async () => {
            if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
                throw new Error(
                    'this browser has neither the File System Access pickers nor an Origin Private File System',
                );
            }
            return navigator.storage.getDirectory();
        },
        choose: presentOpfsDialog,
        canStreamWrite: (handle) => typeof (handle as { createWritable?: unknown }).createWritable === 'function',
    };
}

export const webFileChooserDriver = createWebFileChooserDriver(browserFileChooserEnv());

registerFileChooserDriver(webFileChooserDriver);
