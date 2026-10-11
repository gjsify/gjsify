// The file-chooser core against the shared vectors through a scripted in-memory driver, plus what
// only the core can see: the request the driver is handed, a missing or failing driver, the filter
// matching a self-drawn dialog uses.

import { describe, expect, it } from '@gjsify/unit';

import { driveFileChooserVectors, type FileChooserNamespaces, type ScriptedPick } from './conformance/file-chooser.js';
import {
    dismissedError,
    FileCreateFlags,
    FileDialog,
    FileFilter,
    fileFilterAccepts,
    fileFilterSpec,
    FileOutputStream,
    GioFile,
    GioListStore,
    OutputStream,
    promisify,
    registerFileChooserDriver,
    type FileChooserDriver,
    type FileChooserHandle,
    type FileChooserRequest,
    type FileFilterSpec,
} from './file-chooser.js';
import { Bytes } from './glib-bytes.js';
import { DialogError, GLibError, IOErrorEnum } from './glib-error.js';

/** A file held in memory: `openWriter` truncates, `close` commits what was written. */
function memoryHandle(basename: string, initial: Uint8Array = new Uint8Array()): FileChooserHandle {
    let stored = initial.slice();
    return {
        basename,
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

/** How the vectors write a filter: `*.ext` per pattern or suffix, `*` for accept-all, MIME types as given. */
export function filterGlobs(spec: FileFilterSpec): string[] {
    return [
        ...(spec.acceptAll ? ['*'] : []),
        ...spec.patterns.map((ext) => `*.${ext}`),
        ...spec.suffixes.map((ext) => `*.${ext}`),
        ...spec.mimeTypes,
    ];
}

function scriptedDriver() {
    let next: ScriptedPick = null;
    let last: FileChooserRequest | null = null;
    const answer = async (request: FileChooserRequest): Promise<FileChooserHandle> => {
        last = request;
        if (next === null) throw dismissedError();
        return memoryHandle(next.basename, next.contents);
    };
    const driver: FileChooserDriver = { open: answer, save: answer };
    return {
        driver,
        script: (pick: ScriptedPick) => void (next = pick),
        last: () => last,
    };
}

const Gio = {
    File: GioFile,
    OutputStream,
    FileOutputStream,
    ListStore: GioListStore,
    FileCreateFlags,
    IOErrorEnum,
    _promisify: promisify,
};
const Gtk = { FileDialog, FileFilter, DialogError };
const GLib = { Error: GLibError, Bytes, PRIORITY_DEFAULT: 0 };

function openAsPromise(dialog: FileDialog): Promise<unknown> {
    return (dialog.open as unknown as (p: unknown, c: unknown) => Promise<unknown>)(null, null);
}

export default async () => {
    const scripted = scriptedDriver();
    const previous = registerFileChooserDriver(scripted.driver);
    try {
        await driveFileChooserVectors(
            {
                name: 'adwaita-core',
                isOracle: false,
                GLib,
                Gio: Gio as unknown as FileChooserNamespaces['Gio'],
                Gtk: Gtk as unknown as FileChooserNamespaces['Gtk'],
                script: scripted.script,
                pickerFilters: () => (scripted.last()?.filters ?? []).map(filterGlobs),
                cancelled: () => ({ is_cancelled: () => true }),
            },
            { describe, it, expect },
        );

        await describe('adwaita-core: the file-chooser driver seam', async () => {
            await it('hands the driver the title, initial name, default filter and parent', async () => {
                const filter = FileFilter.new();
                filter.set_name('Text');
                filter.add_suffix('txt');
                filter.add_mime_type('text/plain');
                scripted.script({ basename: 'a.txt' });
                const parent = {};
                const dialog = new FileDialog({ title: 'Save', initialName: 'a.txt', defaultFilter: filter });
                await (dialog.save as unknown as (p: unknown, c: unknown) => Promise<unknown>)(parent, null);
                const request = scripted.last()!;
                expect(
                    JSON.stringify([
                        request.title,
                        request.initialName,
                        request.defaultFilter,
                        request.parent === parent,
                    ]),
                ).toBe(
                    JSON.stringify([
                        'Save',
                        'a.txt',
                        { name: 'Text', patterns: [], suffixes: ['txt'], mimeTypes: ['text/plain'], acceptAll: false },
                        true,
                    ]),
                );
            });

            await it('rejects with Gtk.DialogError.FAILED when no driver is registered', async () => {
                const mine = registerFileChooserDriver(null);
                try {
                    await openAsPromise(new FileDialog());
                    expect('resolved').toBe('rejected');
                } catch (error) {
                    expect((error as GLibError).matches(DialogError, DialogError.FAILED)).toBe(true);
                } finally {
                    registerFileChooserDriver(mine);
                }
            });

            await it('turns a driver that throws a plain Error into Gtk.DialogError.FAILED naming the cause', async () => {
                const mine = registerFileChooserDriver({
                    open: () => Promise.reject(new Error('needs user activation')),
                    save: () => Promise.reject(new Error('needs user activation')),
                });
                try {
                    await openAsPromise(new FileDialog());
                    expect('resolved').toBe('rejected');
                } catch (error) {
                    const e = error as GLibError;
                    expect(e instanceof GLibError).toBe(true);
                    expect(e.matches(DialogError, DialogError.FAILED)).toBe(true);
                    expect(e.message.includes('needs user activation')).toBe(true);
                } finally {
                    registerFileChooserDriver(mine);
                }
            });

            await it('registerFileChooserDriver returns the driver it replaced', () => {
                const other: FileChooserDriver = { open: scripted.driver.open, save: scripted.driver.save };
                const replaced = registerFileChooserDriver(other);
                expect(replaced === scripted.driver).toBe(true);
                expect(registerFileChooserDriver(replaced) === other).toBe(true);
            });
        });

        await describe('adwaita-core: Gtk.FileFilter by name', async () => {
            await it('matches *.ext case-sensitively and add_suffix case-insensitively', () => {
                const filter = FileFilter.new();
                filter.add_pattern('*.asm');
                filter.add_suffix('s');
                const spec = fileFilterSpec(filter);
                expect(
                    JSON.stringify(['a.asm', 'a.ASM', 'b.s', 'b.S', 'c.txt'].map((n) => fileFilterAccepts(spec, n))),
                ).toBe(JSON.stringify([true, false, true, true, false]));
            });

            await it('lets every name through an accept-all or a MIME-only filter', () => {
                const all = FileFilter.new();
                all.add_pattern('*');
                const mime = FileFilter.new();
                mime.add_mime_type('text/plain');
                expect(fileFilterAccepts(fileFilterSpec(all), 'x.bin')).toBe(true);
                expect(fileFilterAccepts(fileFilterSpec(mime), 'x.bin')).toBe(true);
            });

            await it('refuses a Gio.ListStore of anything but FileFilter and a non-filter item', () => {
                let wrongType = false;
                try {
                    new GioListStore({ item_type: GioFile as never });
                } catch {
                    wrongType = true;
                }
                let wrongItem = false;
                try {
                    new GioListStore({ item_type: FileFilter.$gtype }).append({});
                } catch {
                    wrongItem = true;
                }
                expect(JSON.stringify([wrongType, wrongItem])).toBe(JSON.stringify([true, true]));
            });
        });

        await describe('adwaita-core: Gio._promisify', async () => {
            await it('derives the finish name from _async or _begin when none is given', async () => {
                class Probe {
                    thing_async(value: number, callback: (s: object, r: unknown) => void): void {
                        Promise.resolve().then(() => callback(this, value * 2));
                    }
                    thing_finish(result: unknown): [boolean, number] {
                        return [true, result as number];
                    }
                }
                promisify(Probe.prototype, 'thing_async');
                const out = await (new Probe().thing_async as unknown as (v: number) => Promise<unknown>)(21);
                expect(JSON.stringify(out)).toBe(JSON.stringify([42]));
            });

            await it('leaves a call with its callback on the callback path', async () => {
                const file = new GioFile(memoryHandle('cb.asm', Uint8Array.of(65)));
                const viaCallback = await new Promise<unknown>((resolve) =>
                    file.load_contents_async(null, (source, result) =>
                        resolve((source as GioFile).load_contents_finish(result)[0]),
                    ),
                );
                expect(viaCallback).toBe(true);
            });

            await it('rejects an unknown result in a _finish', () => {
                let threw = false;
                try {
                    new GioFile(memoryHandle('x')).load_contents_finish({});
                } catch {
                    threw = true;
                }
                expect(threw).toBe(true);
            });
        });
    } finally {
        registerFileChooserDriver(previous);
    }
};
