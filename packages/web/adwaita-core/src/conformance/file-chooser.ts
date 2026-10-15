// `Gtk.FileDialog`, `Gtk.FileFilter`, `Gio.File`, `Gio.FileOutputStream`, `GLib.Bytes`, `GLib.Error`
// and `Gio._promisify` as observable behaviour — the calls Learn6502's `file.service.ts` and
// `bootstrap.ts` make (ADR 0100 § 6).
//
// A vector is a program written against the namespaces and the data it must leave behind. The SAME
// vectors run on real GJS (the ORACLE: a vector that fails there is wrong, never a port bug), on the
// core with a scripted driver, and on each port's door. The picker itself is the subject's: the
// oracle answers `open`/`save` with a test `Gio.File` under a temporary directory, a port with a
// scripted double. GJS is the oracle for the SHAPE of results and errors, not for the picker UI.
//
// `holds: 'subset'` marks a vector GJS does not answer the same way on purpose: a refusal, `get_path()`
// of a picked file, a dialog opened with a cancelled cancellable. The driver skips it on the oracle.
// No vector pins an error MESSAGE (GLib localises them) or an etag (GIO's is real, the ports' `null`).

import type { ConstructHarness } from './constructs.js';

type Callback = (source: unknown, result: unknown) => void;

interface GLibErrorLike {
    readonly domain: unknown;
    readonly code: number;
    readonly message: string;
    matches(domain: unknown, code: number): boolean;
    toString(): string;
}

interface BytesLike {
    get_size(): number;
    get_data(): Uint8Array | null;
}

interface FilterLike {
    get_name(): string | null;
    set_name(name: string | null): void;
    add_pattern(pattern: string): void;
    readonly name: string | null;
}

interface ListStoreLike {
    append(item: unknown): void;
    get_n_items(): number;
}

interface StreamLike {
    write_bytes_async(bytes: BytesLike, priority: number, cancellable: unknown): Promise<number>;
    close_async(priority: number, cancellable: unknown): Promise<boolean>;
    write: unknown;
    flush: unknown;
}

interface FileLike {
    get_basename(): string | null;
    get_path(): string | null;
    load_contents_async(cancellable: unknown): Promise<[Uint8Array, unknown]>;
    load_contents_async(cancellable: unknown, callback: Callback): void;
    load_contents_finish(result: unknown): unknown[];
    replace_contents_async(
        contents: Uint8Array,
        etag: string | null,
        makeBackup: boolean,
        flags: number,
        cancellable: unknown,
        callback: Callback,
    ): void;
    replace_contents_finish(result: unknown): unknown[];
    replace_async(
        etag: string | null,
        makeBackup: boolean,
        flags: number,
        priority: number,
        cancellable: unknown,
    ): Promise<StreamLike>;
    get_parent(): unknown;
    query_exists(cancellable: unknown): boolean;
}

interface DialogLike {
    title: string | null;
    modal: boolean;
    initial_name: string | null;
    filters: ListStoreLike | null;
    default_filter: FilterLike | null;
    open(parent: unknown, cancellable: unknown): Promise<FileLike>;
    open(parent: unknown, cancellable: unknown, callback: Callback): void;
    open_finish(result: unknown): FileLike;
    save(parent: unknown, cancellable: unknown): Promise<FileLike>;
    open_multiple: unknown;
    select_folder: unknown;
}

/** The parts of `GLib`, `Gio` and `Gtk` the vectors read. */
export interface FileChooserNamespaces {
    readonly GLib: {
        readonly Error: new (domain: unknown, code: number, message: string) => GLibErrorLike;
        readonly Bytes: new (data: Uint8Array) => BytesLike;
        readonly PRIORITY_DEFAULT: number;
    };
    readonly Gio: {
        readonly File: {
            readonly prototype: object;
            new_for_path(path: string): unknown;
            new_for_uri(uri: string): unknown;
        };
        readonly OutputStream: { readonly prototype: object };
        readonly FileOutputStream: abstract new (...args: never[]) => object;
        readonly ListStore: new (params: { item_type: unknown }) => ListStoreLike;
        readonly FileCreateFlags: { readonly NONE: number };
        readonly IOErrorEnum: { readonly CANCELLED: number; readonly CLOSED: number; readonly PENDING: number };
        _promisify(proto: object, asyncName: string, finishName?: string): void;
    };
    readonly Gtk: {
        readonly FileDialog: { readonly prototype: object } & (new (params?: Record<string, unknown>) => DialogLike);
        readonly FileFilter: { readonly $gtype: unknown; 'new'(): FilterLike };
        readonly DialogError: { readonly FAILED: number; readonly CANCELLED: number; readonly DISMISSED: number };
    };
}

/** What the next `open`/`save` picks: a file named `basename` (holding `contents`, if given), or a dismissal. */
export type ScriptedPick = { readonly basename: string; readonly contents?: Uint8Array } | null;

/** What a driver hands the vectors. */
export interface FileChooserSubject extends FileChooserNamespaces {
    readonly name: string;
    readonly isOracle: boolean;
    script(pick: ScriptedPick): void;
    /** The filters the last picker received, one list per filter, each `*.ext`, `*` or a MIME type. */
    pickerFilters(): string[][];
    /** A cancellable that is already cancelled. */
    cancelled(): unknown;
}

export const FILE_CHOOSER_ROWS = [
    'error',
    'bytes',
    'filter',
    'dialog',
    'open',
    'save',
    'stream',
    'cancel',
    'promisify',
    'refusal',
] as const;

export type FileChooserRow = (typeof FILE_CHOOSER_ROWS)[number];

export interface FileChooserVector {
    readonly row: FileChooserRow;
    readonly rule: string;
    /** `subset`: a refusal or a difference ADR 0100 decides; not run on the oracle. */
    readonly holds?: 'subset';
    readonly observe: (subject: FileChooserSubject) => unknown;
    readonly shows: unknown;
}

const bytesOf = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
const textOf = (bytes: Uint8Array | null): string => String.fromCharCode(...(bytes ?? []));

function throws(fn: () => unknown): boolean {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

/** Whether `fn` throws, or returns a promise that rejects: a `_promisify`d call refuses through its promise. */
async function refused(fn: () => unknown): Promise<boolean> {
    try {
        await fn();
        return false;
    } catch {
        return true;
    }
}

/** How a rejection looks: GLib.Error or not, and which of the subset's codes it matches. */
async function rejection(subject: FileChooserSubject, pending: () => Promise<unknown>): Promise<unknown> {
    try {
        await pending();
        return 'resolved';
    } catch (error) {
        const { GLib, Gio, Gtk } = subject;
        const e = error as GLibErrorLike;
        return {
            glibError: error instanceof GLib.Error,
            dismissed: e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED),
            failed: e.matches?.(Gtk.DialogError, Gtk.DialogError.FAILED),
            cancelled: e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
            closed: e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CLOSED),
            pending: e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING),
        };
    }
}

function filterStore({ Gio, Gtk }: FileChooserNamespaces): ListStoreLike {
    const filters = new Gio.ListStore({ item_type: Gtk.FileFilter.$gtype });
    const asm = Gtk.FileFilter.new();
    asm.set_name('Assembly Files');
    asm.add_pattern('*.asm');
    asm.add_pattern('*.s');
    const all = Gtk.FileFilter.new();
    all.set_name('All Files');
    all.add_pattern('*');
    filters.append(asm);
    filters.append(all);
    return filters;
}

async function pickToOpen(subject: FileChooserSubject, basename: string, contents: string): Promise<FileLike> {
    subject.script({ basename, contents: bytesOf(contents) });
    return new subject.Gtk.FileDialog({ modal: true, filters: filterStore(subject) }).open(null, null);
}

async function pickToSave(subject: FileChooserSubject, basename: string): Promise<FileLike> {
    subject.script({ basename });
    return new subject.Gtk.FileDialog({ initial_name: basename }).save(null, null);
}

function replaceContents(subject: FileChooserSubject, file: FileLike, text: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        file.replace_contents_async(bytesOf(text), null, false, subject.Gio.FileCreateFlags.NONE, null, (_s, r) => {
            try {
                resolve(file.replace_contents_finish(r));
            } catch (error) {
                reject(error);
            }
        });
    });
}

const PRIORITY = 0;

export const FILE_CHOOSER_VECTORS: readonly FileChooserVector[] = [
    {
        row: 'error',
        rule: 'new GLib.Error(domain, code, message) reads back its fields and matches its own domain and code only',
        observe: ({ GLib, Gio, Gtk }) => {
            const e = new GLib.Error(Gtk.DialogError, Gtk.DialogError.DISMISSED, 'gone');
            return [
                e instanceof GLib.Error,
                typeof e.domain,
                e.code,
                e.message,
                e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED),
                e.matches(Gtk.DialogError, Gtk.DialogError.FAILED),
                e.matches(Gio.IOErrorEnum, Gtk.DialogError.DISMISSED),
                new GLib.Error(e.domain, 1, 'y').matches(Gtk.DialogError, 1),
            ];
        },
        shows: [true, 'number', 2, 'gone', true, false, false, true],
    },
    {
        row: 'error',
        rule: 'a GLib.Error names its domain when printed and is not a JS Error',
        observe: ({ GLib, Gtk }) => {
            const e = new GLib.Error(Gtk.DialogError, Gtk.DialogError.FAILED, 'x');
            return [String(e), (e as unknown) instanceof Error];
        },
        shows: ['Gtk.DialogError: x', false],
    },
    {
        row: 'error',
        rule: 'the enum members the subset raises have GIO and GTK values',
        observe: ({ Gio, Gtk }) => [
            Gtk.DialogError.FAILED,
            Gtk.DialogError.CANCELLED,
            Gtk.DialogError.DISMISSED,
            Gio.IOErrorEnum.CLOSED,
            Gio.IOErrorEnum.CANCELLED,
            Gio.IOErrorEnum.PENDING,
            Gio.FileCreateFlags.NONE,
        ],
        shows: [0, 1, 2, 18, 19, 20, 0],
    },
    {
        row: 'bytes',
        rule: 'GLib.Bytes copies its input; get_size and get_data give it back, each read a copy',
        observe: ({ GLib }) => {
            const source = Uint8Array.of(1, 2, 3);
            const bytes = new GLib.Bytes(source);
            source[0] = 9;
            const first = bytes.get_data()!;
            first[1] = 7;
            return [bytes.get_size(), Array.from(bytes.get_data()!), bytes.get_data() instanceof Uint8Array];
        },
        shows: [3, [1, 2, 3], true],
    },
    {
        row: 'filter',
        rule: 'a FileFilter has no name until set, and a ListStore of FileFilter.$gtype holds what is appended',
        observe: (subject) => {
            const filter = subject.Gtk.FileFilter.new();
            const before = filter.get_name();
            filter.set_name('A');
            return [before, filter.get_name(), filter.name, filterStore(subject).get_n_items()];
        },
        shows: [null, 'A', 'A', 2],
    },
    {
        row: 'filter',
        rule: 'the filters of the dialog reach the picker: *.asm and *.s in one, * in the other',
        async observe(subject) {
            await pickToOpen(subject, 'f.asm', '');
            return subject.pickerFilters();
        },
        shows: [['*.asm', '*.s'], ['*']],
    },
    {
        row: 'dialog',
        rule: 'a new FileDialog is modal with no title, initial name or filters',
        observe: ({ Gtk }) => {
            const d = new Gtk.FileDialog();
            return [d.modal, d.title, d.initial_name, d.filters, d.default_filter];
        },
        shows: [true, null, null, null, null],
    },
    {
        row: 'dialog',
        rule: 'the construct properties read back, the filters store by identity',
        observe: (subject) => {
            const filters = filterStore(subject);
            const d = new subject.Gtk.FileDialog({ title: 't', modal: true, filters, initial_name: 'a.asm' });
            return [d.title, d.modal, d.initial_name, d.filters === filters];
        },
        shows: ['t', true, 'a.asm', true],
    },
    {
        row: 'open',
        rule: 'open resolves a File with the picked basename whose load_contents_async gives the bytes',
        async observe(subject) {
            const file = await pickToOpen(subject, 'prog.asm', 'LDA #$01');
            const [contents] = await file.load_contents_async(null);
            return [file.get_basename(), textOf(contents), contents instanceof Uint8Array];
        },
        shows: ['prog.asm', 'LDA #$01', true],
    },
    {
        row: 'open',
        rule: 'the callback forms hand back the source and a leading true; the promise form drops it',
        async observe(subject) {
            const file = await pickToOpen(subject, 'cb.asm', 'x');
            const viaCallback = await new Promise<unknown[]>((resolve) => {
                file.load_contents_async(null, (source, result) => {
                    const out = (source as FileLike).load_contents_finish(result);
                    resolve([source === file, out.length, out[0], textOf(out[1] as Uint8Array)]);
                });
            });
            const viaPromise = await file.load_contents_async(null);
            return [...viaCallback, viaPromise.length, textOf(viaPromise[0])];
        },
        shows: [true, 3, true, 'x', 2, 'x'],
    },
    {
        row: 'open',
        rule: 'open in the callback form resolves through open_finish with the dialog as source',
        async observe(subject) {
            subject.script({ basename: 'c.s', contents: bytesOf('') });
            const dialog = new subject.Gtk.FileDialog();
            return new Promise((resolve) => {
                dialog.open(null, null, (source, result) => {
                    resolve([source === dialog, (source as DialogLike).open_finish(result).get_basename()]);
                });
            });
        },
        shows: [true, 'c.s'],
    },
    {
        row: 'open',
        rule: 'a picked file has no local path',
        holds: 'subset',
        async observe(subject) {
            return (await pickToOpen(subject, 'p.asm', '')).get_path();
        },
        shows: null,
    },
    {
        row: 'save',
        rule: 'save, replace_contents_async, load_contents_async round-trip; a second replace overwrites',
        async observe(subject) {
            const file = await pickToSave(subject, 'out.asm');
            const first = await replaceContents(subject, file, 'first version');
            const [one] = await file.load_contents_async(null);
            await replaceContents(subject, file, 'short');
            const [two] = await file.load_contents_async(null);
            return [file.get_basename(), first.length, first[0], textOf(one), textOf(two)];
        },
        shows: ['out.asm', 2, true, 'first version', 'short'],
    },
    {
        row: 'stream',
        rule: 'replace_async gives a FileOutputStream; write_bytes_async counts, close_async is true, bytes land',
        async observe(subject) {
            const { GLib, Gio } = subject;
            const file = await pickToSave(subject, 'stream.asm');
            await replaceContents(subject, file, 'old content that is longer');
            const stream = await file.replace_async(null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            const one = await stream.write_bytes_async(new GLib.Bytes(bytesOf('AB')), PRIORITY, null);
            const two = await stream.write_bytes_async(new GLib.Bytes(bytesOf('CDE')), PRIORITY, null);
            const closed = await stream.close_async(PRIORITY, null);
            const [contents] = await file.load_contents_async(null);
            return [stream instanceof Gio.FileOutputStream, one, two, closed, textOf(contents)];
        },
        shows: [true, 2, 3, true, 'ABCDE'],
    },
    {
        row: 'stream',
        rule: 'a write after close rejects with a GLib.Error, IOErrorEnum.CLOSED',
        async observe(subject) {
            const { GLib, Gio } = subject;
            const file = await pickToSave(subject, 'closed.asm');
            const stream = await file.replace_async(null, false, Gio.FileCreateFlags.NONE, PRIORITY, null);
            await stream.close_async(PRIORITY, null);
            return rejection(subject, () => stream.write_bytes_async(new GLib.Bytes(bytesOf('x')), PRIORITY, null));
        },
        shows: { glibError: true, dismissed: false, failed: false, cancelled: false, closed: true, pending: false },
    },
    {
        row: 'stream',
        rule: 'a second write while one is pending rejects with IOErrorEnum.PENDING',
        async observe(subject) {
            const { GLib, Gio } = subject;
            const file = await pickToSave(subject, 'pending.asm');
            const stream = await file.replace_async(null, false, Gio.FileCreateFlags.NONE, PRIORITY, null);
            const first = stream.write_bytes_async(new GLib.Bytes(bytesOf('a')), PRIORITY, null);
            const second = await rejection(subject, () =>
                stream.write_bytes_async(new GLib.Bytes(bytesOf('b')), PRIORITY, null),
            );
            await first;
            await stream.close_async(PRIORITY, null);
            return second;
        },
        shows: { glibError: true, dismissed: false, failed: false, cancelled: false, closed: false, pending: true },
    },
    {
        row: 'cancel',
        rule: 'a dismissed dialog rejects with a GLib.Error matching Gtk.DialogError.DISMISSED only',
        async observe(subject) {
            subject.script(null);
            return rejection(subject, () => new subject.Gtk.FileDialog().open(null, null));
        },
        shows: { glibError: true, dismissed: true, failed: false, cancelled: false, closed: false, pending: false },
    },
    {
        row: 'cancel',
        rule: 'load_contents_async with a cancelled cancellable rejects with IOErrorEnum.CANCELLED',
        async observe(subject) {
            const file = await pickToOpen(subject, 'c.asm', 'x');
            return rejection(subject, () => file.load_contents_async(subject.cancelled()));
        },
        shows: { glibError: true, dismissed: false, failed: false, cancelled: true, closed: false, pending: false },
    },
    {
        row: 'cancel',
        rule: 'open with a cancelled cancellable rejects with IOErrorEnum.CANCELLED before the picker opens',
        holds: 'subset',
        async observe(subject) {
            subject.script({ basename: 'never.asm' });
            return rejection(subject, () => new subject.Gtk.FileDialog().open(null, subject.cancelled()));
        },
        shows: { glibError: true, dismissed: false, failed: false, cancelled: true, closed: false, pending: false },
    },
    {
        row: 'promisify',
        rule: 'Gio._promisify throws at the call when the async or the finish method is missing',
        observe: ({ Gio }) => [
            throws(() => Gio._promisify(Gio.File.prototype, 'nope_async', 'nope_finish')),
            throws(() => Gio._promisify(Gio.File.prototype, 'load_contents_async', 'nope_finish')),
        ],
        shows: [true, true],
    },
    {
        row: 'refusal',
        rule: 'what ADR 0100 refuses throws by name',
        holds: 'subset',
        async observe(subject) {
            const { GLib, Gio, Gtk } = subject;
            const file = await pickToSave(subject, 'r.asm');
            const stream = await file.replace_async(null, false, Gio.FileCreateFlags.NONE, PRIORITY, null);
            const dialog = new Gtk.FileDialog();
            const filter = Gtk.FileFilter.new();
            const call = (target: unknown, name: string) => () => (target as Record<string, () => unknown>)[name]();
            const observed = {
                modalFalse: throws(() => new Gtk.FileDialog({ modal: false })),
                initialFolder: throws(() => new Gtk.FileDialog({ initial_folder: null })),
                acceptLabel: throws(() => new Gtk.FileDialog({ accept_label: 'Go' })),
                openMultiple: throws(call(dialog, 'open_multiple')),
                selectFolder: throws(call(dialog, 'select_folder')),
                otherGlob: throws(() => filter.add_pattern('a*.s')),
                newForPath: throws(() => Gio.File.new_for_path('/tmp/x')),
                newForUri: throws(() => Gio.File.new_for_uri('file:///tmp/x')),
                getParent: throws(() => file.get_parent()),
                queryExists: throws(() => file.query_exists(null)),
                etag: await refused(() => file.replace_async('e', false, Gio.FileCreateFlags.NONE, PRIORITY, null)),
                makeBackup: await refused(() =>
                    file.replace_async(null, true, Gio.FileCreateFlags.NONE, PRIORITY, null),
                ),
                flags: await refused(() => file.replace_async(null, false, 1, PRIORITY, null)),
                bytesSlice: throws(call(new GLib.Bytes(bytesOf('x')), 'slice')),
                streamWrite: throws(call(stream, 'write')),
                streamFlush: throws(call(stream, 'flush')),
                newLiteral: throws(call(GLib.Error, 'new_literal')),
            };
            // An open stream holds the file's write lock (an OPFS writable) until it is closed.
            await stream.close_async(PRIORITY, null);
            return observed;
        },
        shows: {
            modalFalse: true,
            initialFolder: true,
            acceptLabel: true,
            openMultiple: true,
            selectFolder: true,
            otherGlob: true,
            newForPath: true,
            newForUri: true,
            getParent: true,
            queryExists: true,
            etag: true,
            makeBackup: true,
            flags: true,
            bytesSlice: true,
            streamWrite: true,
            streamFlush: true,
            newLiteral: true,
        },
    },
];

/** The `_promisify` calls of Learn6502's `bootstrap.ts`, plus the one `replace_contents` the vectors avoid. */
export function promisifyFileChooser({ Gio, Gtk }: FileChooserNamespaces): void {
    Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
    Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
    Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
    Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
    Gio._promisify(Gtk.FileDialog.prototype, 'open', 'open_finish');
    Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
}

export async function driveFileChooserVectors(
    subject: FileChooserSubject,
    harness: ConstructHarness,
    vectors: readonly FileChooserVector[] = FILE_CHOOSER_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    promisifyFileChooser(subject);
    await describe(`${subject.name}: Gtk.FileDialog and Gio.File`, async () => {
        for (const vector of vectors) {
            if (vector.holds === 'subset' && subject.isOracle) continue;
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
