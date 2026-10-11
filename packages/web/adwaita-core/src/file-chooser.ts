// `Gtk.FileDialog`, `Gtk.FileFilter`, `Gio.File`, `Gio.FileOutputStream`, a minimal `Gio.ListStore`
// and `Gio._promisify`, renderer-free — ADR 0100. A TRUE SUBSET: GTK's and GIO's names with GJS's
// semantics; what the subset does not hold throws by name.
//
// WHAT THE DRIVER DOES. The dialog and the bytes behind a `File` are the platform's: File System
// Access or OPFS on the browser, the Storage Access Framework on Android. A port registers a
// {@link FileChooserDriver} (`registerFileChooserDriver`), which is also the seam ADR 0101 lets an
// app replace and a real-Gio driver plug into (ADR 0105). Everything above it — argument checks,
// the async/finish pairs, cancellation, the stream state, the error shapes — is here, once.
//
// Reference: gtk gtk/gtkfiledialog.c, gtk/gtkfilefilter.c; gio gio/gfile.c, gio/goutputstream.c,
// gio/gliststore.c; gjs modules/core/overrides/Gio.js (`_promisify`)
// Copyright (c) GNOME contributors (GTK, GLib, GJS). LGPLv2.1+, MIT OR LGPLv2+.

import { Bytes } from './glib-bytes.js';
import { asGLibError, DialogError, GLibError, IOErrorEnum } from './glib-error.js';
import { registerBaseClass, UnsupportedGObjectError, type GType } from './gobject.js';

function refuse(feature: string, detail = 'is outside the file-chooser subset'): UnsupportedGObjectError {
    return new UnsupportedGObjectError(feature, `${feature} ${detail} (ADR 0100).`);
}

function refuseMembers(target: object, owner: string, names: readonly string[]): void {
    for (const name of names) {
        Object.defineProperty(target, name, {
            value: () => {
                throw refuse(`${owner}.${name}()`);
            },
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
}

// --- The driver seam ------------------------------------------------------------------------

/** What a `Gtk.FileFilter` holds, as a driver reads it. */
export interface FileFilterSpec {
    readonly name: string | null;
    /** `add_pattern("*.ext")`: the extension, without the dot. Case-sensitive, as GTK's. */
    readonly patterns: readonly string[];
    /** `add_suffix("ext")`: case-insensitive, as GTK's. */
    readonly suffixes: readonly string[];
    readonly mimeTypes: readonly string[];
    /** `add_pattern("*")` or `add_mime_type("*\/*")`: the filter accepts every file. */
    readonly acceptAll: boolean;
}

/** One open or save, as the dialog hands it to the driver. */
export interface FileChooserRequest {
    readonly title: string | null;
    readonly filters: readonly FileFilterSpec[];
    readonly defaultFilter: FileFilterSpec | null;
    readonly initialName: string | null;
    /** The `parent` passed to `open`/`save`; the web ignores it, Android may use it as the owner. */
    readonly parent: unknown;
}

/** The platform's handle behind a `Gio.File`: bytes, not a path. */
export interface FileChooserHandle {
    readonly basename: string;
    /** The URI GIO would give (`content://…` on Android); absent where there is none to give. */
    readonly uri?: string;
    read(): Promise<Uint8Array>;
    /** Opens for writing and truncates. `close()` commits. */
    openWriter(): Promise<FileChooserWriter>;
}

export interface FileChooserWriter {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
}

/**
 * Opens the platform's picker. A user who closes it rejects with a `GLib.Error` of
 * `Gtk.DialogError.DISMISSED` ({@link dismissedError}); anything else that rejects becomes
 * `Gtk.DialogError.FAILED` with the cause in the message.
 */
export interface FileChooserDriver {
    open(request: FileChooserRequest): Promise<FileChooserHandle>;
    save(request: FileChooserRequest): Promise<FileChooserHandle>;
}

let driver: FileChooserDriver | null = null;

/** Puts `next` below every `Gtk.FileDialog`; returns the driver it replaced. A gjsify extra, not GTK. */
export function registerFileChooserDriver(next: FileChooserDriver | null): FileChooserDriver | null {
    const previous = driver;
    driver = next;
    return previous;
}

export function dismissedError(message = 'Dismissed by user'): GLibError {
    return new GLibError(DialogError, DialogError.DISMISSED, message);
}

export function dialogFailedError(message: string): GLibError {
    return new GLibError(DialogError, DialogError.FAILED, message);
}

// --- Async results --------------------------------------------------------------------------

type AsyncReadyCallback = ((source: object, result: AsyncResult) => void) | null;

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

/** `Gio.AsyncResult`: opaque to the caller, read once by the matching `_finish`. */
class AsyncResult {
    readonly #source: object;
    readonly #tag: string;
    readonly #outcome: Outcome;

    constructor(source: object, tag: string, outcome: Outcome) {
        this.#source = source;
        this.#tag = tag;
        this.#outcome = outcome;
    }

    get_source_object(): object {
        return this.#source;
    }

    static take(result: unknown, source: object, tag: string): unknown {
        if (!(result instanceof AsyncResult) || result.#source !== source || result.#tag !== tag) {
            throw new TypeError(`${tag}_finish: the result is not one of ${tag}`);
        }
        if (!result.#outcome.ok) throw result.#outcome.error;
        return result.#outcome.value;
    }
}

function requireArgs(method: string, needed: number, passed: number): void {
    if (passed < needed) {
        throw new TypeError(`method ${method}: At least ${needed} arguments required, but only ${passed} passed`);
    }
}

function isCancelled(cancellable: unknown): boolean {
    const probe = cancellable as { is_cancelled?: () => boolean } | null;
    return typeof probe?.is_cancelled === 'function' && probe.is_cancelled() === true;
}

function cancelledError(): GLibError {
    return new GLibError(IOErrorEnum, IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

/** Runs `work` and hands the callback a result once it settled, never synchronously. */
function runAsync(
    source: object,
    tag: string,
    cancellable: unknown,
    callback: AsyncReadyCallback,
    work: () => Promise<unknown>,
    wrap: (error: unknown) => GLibError,
): void {
    const started = isCancelled(cancellable) ? Promise.reject(cancelledError()) : Promise.resolve().then(work);
    started
        .then(
            (value): Outcome => ({ ok: true, value }),
            (error): Outcome => ({ ok: false, error: wrap(error) }),
        )
        .then((outcome) => {
            if (typeof callback === 'function') callback(source, new AsyncResult(source, tag, outcome));
        });
}

const ioError = (error: unknown): GLibError => asGLibError(error, IOErrorEnum, IOErrorEnum.FAILED);
const dialogError = (error: unknown): GLibError => asGLibError(error, DialogError, DialogError.FAILED);

// --- Gio._promisify -------------------------------------------------------------------------

/**
 * `Gio._promisify(proto, asyncName, finishName)`: called without its callback, `asyncName` returns a
 * Promise of what `finishName` returns, a leading `true` dropped. A missing method throws here, as GJS's.
 */
export function promisify(proto: object, asyncName: string, finishName?: string): void {
    const target = proto as Record<string, unknown>;
    if (target[asyncName] === undefined) throw new Error(`${String(proto)} has no method named ${asyncName}`);
    const finish = finishName ?? `${asyncName.replace(/_(begin|async)$/, '')}_finish`;
    if (target[finish] === undefined) throw new Error(`${String(proto)} has no method named ${finish}`);
    const originalName = `_original_${asyncName}`;
    if (target[originalName] !== undefined) return;
    const original = target[asyncName] as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, originalName, { value: original, writable: true, configurable: true });
    Object.defineProperty(proto, asyncName, {
        value: function (this: Record<string, (...args: unknown[]) => unknown>, ...args: unknown[]) {
            if (args.length === original.length) return original.apply(this, args);
            return new Promise((resolve, reject) => {
                original.call(this, ...args, (source: Record<string, (r: unknown) => unknown>, result: unknown) => {
                    try {
                        const value = source[finish](result);
                        if (Array.isArray(value) && value.length > 1 && value[0] === true) value.shift();
                        resolve(value);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        },
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

// --- Gtk.FileFilter -------------------------------------------------------------------------

const GLOB_CHARS = /[*?[\]]/;

interface FilterState {
    name: string | null;
    patterns: string[];
    suffixes: string[];
    mimeTypes: string[];
    acceptAll: boolean;
}

const FILTERS = new WeakMap<object, FilterState>();

function filterState(filter: unknown): FilterState {
    const state = filter !== null && typeof filter === 'object' ? FILTERS.get(filter) : undefined;
    if (!state) throw refuse(`a ${typeof filter} where a Gtk.FileFilter is expected`, 'is not a Gtk.FileFilter');
    return state;
}

export class FileFilter {
    declare static readonly $gtype: GType;

    constructor(params: Record<string, unknown> = {}) {
        FILTERS.set(this, { name: null, patterns: [], suffixes: [], mimeTypes: [], acceptAll: false });
        for (const [key, value] of Object.entries(params)) {
            if (key === 'name') this.set_name(value as string | null);
            else throw refuse(`the Gtk.FileFilter '${key}' property`);
        }
    }

    static new(): FileFilter {
        return new FileFilter();
    }

    get name(): string | null {
        return filterState(this).name;
    }

    set name(value: string | null) {
        this.set_name(value);
    }

    get_name(): string | null {
        return this.name;
    }

    set_name(name: string | null): void {
        filterState(this).name = name === null || name === undefined ? null : String(name);
    }

    /** `*` or `*.ext`; any other glob is refused, since no picker below takes one. */
    add_pattern(pattern: string): void {
        const state = filterState(this);
        if (pattern === '*') {
            state.acceptAll = true;
            return;
        }
        const ext = pattern.startsWith('*.') ? pattern.slice(2) : null;
        if (ext === null || ext === '' || GLOB_CHARS.test(ext)) {
            throw refuse(`Gtk.FileFilter.add_pattern('${pattern}')`, "is a glob other than '*' or '*.ext'");
        }
        state.patterns.push(ext);
    }

    add_suffix(suffix: string): void {
        if (typeof suffix !== 'string' || suffix === '' || GLOB_CHARS.test(suffix)) {
            throw refuse(`Gtk.FileFilter.add_suffix('${String(suffix)}')`, 'is not a plain suffix');
        }
        filterState(this).suffixes.push(suffix);
    }

    /** `type/subtype`, `type/*` or `*\/*`. A driver that cannot honour `type/*` refuses it when it opens. */
    add_mime_type(mimeType: string): void {
        const state = filterState(this);
        if (mimeType === '*/*') {
            state.acceptAll = true;
            return;
        }
        if (typeof mimeType !== 'string' || !/^[\w.+-]+\/(\*|[\w.+-]+)$/.test(mimeType)) {
            throw refuse(`Gtk.FileFilter.add_mime_type('${String(mimeType)}')`, 'is not a MIME type');
        }
        state.mimeTypes.push(mimeType);
    }
}

refuseMembers(FileFilter.prototype, 'Gtk.FileFilter', [
    'add_pixbuf_formats',
    'get_attributes',
    'to_gvariant',
    'match',
    'get_strictness',
    'changed',
]);
registerBaseClass(FileFilter as never, 'GtkFileFilter', {});

export function fileFilterSpec(filter: FileFilter): FileFilterSpec {
    const { name, patterns, suffixes, mimeTypes, acceptAll } = filterState(filter);
    return { name, patterns: [...patterns], suffixes: [...suffixes], mimeTypes: [...mimeTypes], acceptAll };
}

/** Whether `basename` passes `spec` by name. MIME types do not judge a name; a MIME-only filter passes. */
export function fileFilterAccepts(spec: FileFilterSpec, basename: string): boolean {
    if (spec.acceptAll) return true;
    if (spec.patterns.length === 0 && spec.suffixes.length === 0) return true;
    const lower = basename.toLowerCase();
    return (
        spec.patterns.some((ext) => basename.endsWith(`.${ext}`)) ||
        spec.suffixes.some((suffix) => lower.endsWith(`.${suffix.toLowerCase()}`))
    );
}

// --- Gio.ListStore --------------------------------------------------------------------------

/** The store `Gtk.FileDialog.filters` takes: `item_type` `Gtk.FileFilter.$gtype`, `append` to fill it. */
export class GioListStore {
    readonly #items: object[] = [];
    readonly #itemType: GType;

    constructor(params: { item_type?: GType; itemType?: GType } = {}) {
        const itemType = params.item_type ?? params.itemType;
        if (itemType !== FileFilter.$gtype) {
            throw refuse(`Gio.ListStore of ${String(itemType?.name ?? itemType)}`, 'holds no Gtk.FileFilter');
        }
        this.#itemType = itemType;
    }

    get item_type(): GType {
        return this.#itemType;
    }

    get n_items(): number {
        return this.#items.length;
    }

    append(item: object): void {
        filterState(item);
        this.#items.push(item);
    }

    get_n_items(): number {
        return this.#items.length;
    }

    get_item(position: number): object | null {
        return this.#items[position] ?? null;
    }

    get_item_type(): GType {
        return this.#itemType;
    }
}

refuseMembers(GioListStore.prototype, 'Gio.ListStore', [
    'insert',
    'insert_sorted',
    'remove',
    'remove_all',
    'splice',
    'sort',
    'find',
    'find_with_equal_func',
    'items_changed',
]);

// --- Gio.FileCreateFlags, Gio.OutputStream, Gio.FileOutputStream ----------------------------

export const FileCreateFlags = Object.freeze({ NONE: 0, PRIVATE: 1, REPLACE_DESTINATION: 2 });

const STREAMS = new WeakMap<object, { writer: FileChooserWriter; closed: boolean; pending: boolean }>();

function streamState(stream: object) {
    const state = STREAMS.get(stream);
    if (!state) throw refuse('Gio.OutputStream', 'is only made by Gio.File.replace_async');
    return state;
}

/** Runs one stream operation: CLOSED after close, PENDING while another runs, as GIO's. */
function streamOp(stream: object, closing: boolean, work: (writer: FileChooserWriter) => Promise<unknown>) {
    return async (): Promise<unknown> => {
        const state = streamState(stream);
        if (state.closed) throw new GLibError(IOErrorEnum, IOErrorEnum.CLOSED, 'Stream is already closed');
        if (state.pending) throw new GLibError(IOErrorEnum, IOErrorEnum.PENDING, 'Stream has outstanding operation');
        state.pending = true;
        try {
            const value = await work(state.writer);
            if (closing) state.closed = true;
            return value;
        } finally {
            state.pending = false;
        }
    };
}

export class OutputStream {
    /** @internal */
    constructor(writer: FileChooserWriter) {
        STREAMS.set(this, { writer, closed: false, pending: false });
    }

    write_bytes_async(bytes: Bytes, _io_priority: number, cancellable: unknown, callback: AsyncReadyCallback): void {
        requireArgs('Gio.OutputStream.write_bytes_async', 4, arguments.length);
        if (!(bytes instanceof Bytes)) throw refuse('write_bytes_async of a non-GLib.Bytes', 'is not a GLib.Bytes');
        const data = Bytes.view(bytes);
        const work = streamOp(this, false, async (writer) => {
            await writer.write(data);
            return data.length;
        });
        runAsync(this, 'write_bytes', cancellable, callback, work, ioError);
    }

    write_bytes_finish(result: unknown): number {
        return AsyncResult.take(result, this, 'write_bytes') as number;
    }

    close_async(_io_priority: number, cancellable: unknown, callback: AsyncReadyCallback): void {
        requireArgs('Gio.OutputStream.close_async', 3, arguments.length);
        const work = streamOp(this, true, async (writer) => {
            await writer.close();
            return true;
        });
        runAsync(this, 'close', cancellable, callback, work, ioError);
    }

    close_finish(result: unknown): boolean {
        return AsyncResult.take(result, this, 'close') as boolean;
    }

    is_closed(): boolean {
        return streamState(this).closed;
    }
}

export class FileOutputStream extends OutputStream {}

refuseMembers(OutputStream.prototype, 'Gio.OutputStream', [
    'write',
    'write_all',
    'write_bytes',
    'write_async',
    'write_all_async',
    'writev',
    'splice',
    'splice_async',
    'flush',
    'flush_async',
    'close',
    'printf',
]);
refuseMembers(FileOutputStream.prototype, 'Gio.FileOutputStream', ['seek', 'truncate', 'query_info', 'get_etag']);

// --- Gio.File -------------------------------------------------------------------------------

const HANDLES = new WeakMap<object, FileChooserHandle>();

function handleOf(file: object): FileChooserHandle {
    const handle = HANDLES.get(file);
    if (!handle) throw refuse('Gio.File', 'is only made by Gtk.FileDialog');
    return handle;
}

/** The arguments `replace_async` and `replace_contents_async` hold to their GIO defaults. */
function checkReplaceArgs(method: string, etag: unknown, makeBackup: unknown, flags: unknown): void {
    if (etag !== null && etag !== undefined) throw refuse(`${method} with an etag`);
    if (makeBackup !== false) throw refuse(`${method} with make_backup`);
    if (flags !== FileCreateFlags.NONE) throw refuse(`${method} with flags ${String(flags)}`);
}

export class GioFile {
    /** @internal */
    constructor(handle: FileChooserHandle) {
        HANDLES.set(this, handle);
    }

    static new_for_path(): never {
        throw refuse('Gio.File.new_for_path()', 'names a path, and a page or an Android app has none');
    }

    static new_for_uri(): never {
        throw refuse('Gio.File.new_for_uri()', 'names a URI the platform cannot open');
    }

    static new_for_commandline_arg(): never {
        throw refuse('Gio.File.new_for_commandline_arg()');
    }

    get_basename(): string {
        return handleOf(this).basename;
    }

    /** `null`, as GJS gives for a file with no local path (a portal `content://` file). */
    get_path(): string | null {
        handleOf(this);
        return null;
    }

    get_uri(): string {
        const { uri } = handleOf(this);
        if (uri === undefined) throw refuse('Gio.File.get_uri()', 'has no URI to give on this platform');
        return uri;
    }

    load_contents_async(cancellable: unknown, callback: AsyncReadyCallback): void {
        requireArgs('Gio.File.load_contents_async', 2, arguments.length);
        const handle = handleOf(this);
        runAsync(this, 'load_contents', cancellable, callback, () => handle.read(), ioError);
    }

    /** `[true, contents, etag]`; the etag is `null` here (ADR 0100 § 3). */
    load_contents_finish(result: unknown): [boolean, Uint8Array, string | null] {
        return [true, AsyncResult.take(result, this, 'load_contents') as Uint8Array, null];
    }

    replace_contents_async(
        contents: Uint8Array | Bytes,
        etag: string | null,
        make_backup: boolean,
        flags: number,
        cancellable: unknown,
        callback: AsyncReadyCallback,
    ): void {
        requireArgs('Gio.File.replace_contents_async', 6, arguments.length);
        checkReplaceArgs('Gio.File.replace_contents_async', etag, make_backup, flags);
        const data = contents instanceof Bytes ? Bytes.view(contents) : contents;
        if (!(data instanceof Uint8Array)) throw refuse('replace_contents_async of a non-Uint8Array');
        const copy = data.slice();
        const handle = handleOf(this);
        const work = async () => {
            const writer = await handle.openWriter();
            await writer.write(copy);
            await writer.close();
        };
        runAsync(this, 'replace_contents', cancellable, callback, work, ioError);
    }

    /** `[true, new_etag]`; the etag is `null` here. */
    replace_contents_finish(result: unknown): [boolean, string | null] {
        AsyncResult.take(result, this, 'replace_contents');
        return [true, null];
    }

    replace_async(
        etag: string | null,
        make_backup: boolean,
        flags: number,
        _io_priority: number,
        cancellable: unknown,
        callback: AsyncReadyCallback,
    ): void {
        requireArgs('Gio.File.replace_async', 6, arguments.length);
        checkReplaceArgs('Gio.File.replace_async', etag, make_backup, flags);
        const handle = handleOf(this);
        const work = async () => new FileOutputStream(await handle.openWriter());
        runAsync(this, 'replace', cancellable, callback, work, ioError);
    }

    replace_finish(result: unknown): FileOutputStream {
        return AsyncResult.take(result, this, 'replace') as FileOutputStream;
    }
}

refuseMembers(GioFile.prototype, 'Gio.File', [
    'read',
    'read_async',
    'load_contents',
    'load_bytes',
    'load_bytes_async',
    'replace',
    'replace_contents',
    'create',
    'create_async',
    'append_to',
    'append_to_async',
    'query_info',
    'query_info_async',
    'query_exists',
    'query_file_type',
    'delete',
    'delete_async',
    'trash',
    'move',
    'move_async',
    'copy',
    'copy_async',
    'get_parent',
    'get_child',
    'resolve_relative_path',
    'enumerate_children',
    'enumerate_children_async',
    'make_directory',
    'monitor',
    'monitor_file',
    'monitor_directory',
    'equal',
    'hash',
    'dup',
]);

/** A `Gio.File` over `handle`, for a driver to resolve `open`/`save` with. */
export function fileForHandle(handle: FileChooserHandle): GioFile {
    return new GioFile(handle);
}

// --- Gtk.FileDialog -------------------------------------------------------------------------

const DIALOG_PROPERTIES = new Set(['title', 'modal', 'filters', 'initial_name', 'default_filter']);
const DIALOG_REFUSED_PROPERTIES = ['initial_folder', 'initial_file', 'accept_label'];

const snake = (key: string): string => key.replace(/-/g, '_').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export class FileDialog {
    #title: string | null = null;
    #modal = true;
    #filters: GioListStore | null = null;
    #initialName: string | null = null;
    #defaultFilter: FileFilter | null = null;

    constructor(params: Record<string, unknown> = {}) {
        for (const [key, value] of Object.entries(params)) {
            const name = snake(key);
            if (!DIALOG_PROPERTIES.has(name)) throw refuse(`the Gtk.FileDialog '${name}' property`);
            (this as unknown as Record<string, unknown>)[name] = value;
        }
    }

    static new(): FileDialog {
        return new FileDialog();
    }

    get title(): string | null {
        return this.#title;
    }
    set title(value: string | null) {
        this.#title = value === null || value === undefined ? null : String(value);
    }
    get_title(): string | null {
        return this.#title;
    }
    set_title(title: string | null): void {
        this.title = title;
    }

    get modal(): boolean {
        return this.#modal;
    }
    set modal(value: boolean) {
        if (value !== true) throw refuse('Gtk.FileDialog modal: false', 'cannot open non-modally on this platform');
        this.#modal = true;
    }
    get_modal(): boolean {
        return this.#modal;
    }
    set_modal(modal: boolean): void {
        this.modal = modal;
    }

    get filters(): GioListStore | null {
        return this.#filters;
    }
    set filters(value: GioListStore | null) {
        if (value !== null && !(value instanceof GioListStore)) throw refuse('Gtk.FileDialog filters of another type');
        this.#filters = value;
    }
    get_filters(): GioListStore | null {
        return this.#filters;
    }
    set_filters(filters: GioListStore | null): void {
        this.filters = filters;
    }

    get initial_name(): string | null {
        return this.#initialName;
    }
    set initial_name(value: string | null) {
        this.#initialName = value === null || value === undefined ? null : String(value);
    }
    get initialName(): string | null {
        return this.initial_name;
    }
    set initialName(value: string | null) {
        this.initial_name = value;
    }
    get_initial_name(): string | null {
        return this.#initialName;
    }
    set_initial_name(name: string | null): void {
        this.initial_name = name;
    }

    get default_filter(): FileFilter | null {
        return this.#defaultFilter;
    }
    set default_filter(value: FileFilter | null) {
        if (value !== null) filterState(value);
        this.#defaultFilter = value;
    }
    get defaultFilter(): FileFilter | null {
        return this.default_filter;
    }
    set defaultFilter(value: FileFilter | null) {
        this.default_filter = value;
    }
    get_default_filter(): FileFilter | null {
        return this.#defaultFilter;
    }
    set_default_filter(filter: FileFilter | null): void {
        this.default_filter = filter;
    }

    open(parent: unknown, cancellable: unknown, callback: AsyncReadyCallback): void {
        requireArgs('Gtk.FileDialog.open', 3, arguments.length);
        this.#run('open', parent, cancellable, callback);
    }

    open_finish(result: unknown): GioFile {
        return AsyncResult.take(result, this, 'open') as GioFile;
    }

    save(parent: unknown, cancellable: unknown, callback: AsyncReadyCallback): void {
        requireArgs('Gtk.FileDialog.save', 3, arguments.length);
        this.#run('save', parent, cancellable, callback);
    }

    save_finish(result: unknown): GioFile {
        return AsyncResult.take(result, this, 'save') as GioFile;
    }

    #run(kind: 'open' | 'save', parent: unknown, cancellable: unknown, callback: AsyncReadyCallback): void {
        const request = this.#request(parent);
        const work = async () => {
            if (!driver) throw dialogFailedError('No file chooser driver is registered on this platform');
            return new GioFile(await driver[kind](request));
        };
        runAsync(this, kind, cancellable, callback, work, dialogError);
    }

    #request(parent: unknown): FileChooserRequest {
        const filters: FileFilterSpec[] = [];
        const store = this.#filters;
        for (let i = 0; store && i < store.get_n_items(); i++)
            filters.push(fileFilterSpec(store.get_item(i) as FileFilter));
        return {
            title: this.#title,
            filters,
            defaultFilter: this.#defaultFilter ? fileFilterSpec(this.#defaultFilter) : null,
            initialName: this.#initialName,
            parent,
        };
    }
}

refuseMembers(FileDialog.prototype, 'Gtk.FileDialog', [
    'open_multiple',
    'open_multiple_finish',
    'open_multiple_text_files',
    'open_multiple_text_files_finish',
    'open_text_file',
    'open_text_file_finish',
    'save_text_file',
    'save_text_file_finish',
    'select_folder',
    'select_folder_finish',
    'select_multiple_folders',
    'select_multiple_folders_finish',
    'set_initial_folder',
    'get_initial_folder',
    'set_initial_file',
    'get_initial_file',
    'set_accept_label',
    'get_accept_label',
]);
for (const name of DIALOG_REFUSED_PROPERTIES) {
    Object.defineProperty(FileDialog.prototype, name, {
        get() {
            throw refuse(`the Gtk.FileDialog '${name}' property`, 'names a folder or label the platform does not take');
        },
        set() {
            throw refuse(`the Gtk.FileDialog '${name}' property`, 'names a folder or label the platform does not take');
        },
        configurable: true,
        enumerable: false,
    });
}
registerBaseClass(FileDialog as never, 'GtkFileDialog', {});
