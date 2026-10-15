// The GResource subset of `Gio` — ADR 0116 § 3: a synchronous reader of the REAL GVDB bytes
// `glib-compile-resources` writes, behind `Gio.Resource` and the process-wide `Gio.resources_*`
// functions. It never converts the bytes into a second table format, so the GNOME bytes and the
// bytes of a port cannot drift apart.
//
// A TRUE SUBSET of GIO. Supported: `Resource.new_from_data` (a `Uint8Array` or a `GLib.Bytes`),
// `lookup_data`, `get_info`, `enumerate_children`, `_register`/`_unregister`, and the
// `resources_register`/`resources_unregister`/`resources_lookup_data`/`resources_get_info`/
// `resources_enumerate_children` functions. Refused by name, never answered wrongly:
// `open_stream` (no `GInputStream`), `Resource.load` (no file system to read synchronously),
// `lookup_data` of a COMPRESSED entry (no synchronous inflate; ADR 0116 § 2 embeds uncompressed),
// and a big-endian (byte-swapped) file, which GIO reads and `glib-compile-resources` writes only
// on a big-endian host. `get_info` answers for a compressed entry — size and flags are in the table.
//
// WHAT GIO DOES AND THIS DOES TOO, because the specs ask real GIO: the registry is a list that
// `g_resources_register` PREPENDS to, so the most recently registered resource answers first; a
// path is a key as written (no normalisation, `enumerate_children` adds one trailing `/`);
// directory entries are not data (`lookup_data('/dir')` is NOT_FOUND); the children of a
// directory come in the order the builder wrote them; errors are `Gio.ResourceError`.
//
// GVDB, as read here (gvdb-format.h, little-endian): a 24-byte header (`GVariant` signature,
// version 0, options 0, the root pointer) and, at the root, a hash table of `n_bloom_words`
// (low 27 bits), `n_buckets`, the bloom words, the buckets and 24-byte items. An item has a key
// that is a SUFFIX of its full name (the parent chain supplies the rest), a type — `v` a
// serialised GVariant `v`, `L` a list of child item numbers — and an 8-byte value. A resource is
// a `v` holding `(uuay)`: size, flags, data. This reader walks the items instead of the bucket
// chains; the answer for a path is the same.
//
// Reference: glib gio/gresource.c, glib gvdb/gvdb-format.h, glib gvdb/gvdb-reader.c
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import { Bytes } from './glib-bytes.js';
import { GLibError, ResourceError } from './glib-error.js';
import { UnsupportedGObjectError } from './gobject.js';

function refuse(feature: string, why: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(feature, `${feature} ${why} (ADR 0116 § 3).`);
}

/** `Gio.ResourceLookupFlags`. GIO defines no flag but `NONE`. */
export const ResourceLookupFlags = Object.freeze({ NONE: 0 });

const FLAGS_COMPRESSED = 1;
const NO_PARENT = 0xffffffff;
const ITEM_SIZE = 24;
const HEADER_SIZE = 24;
// "GVar" "iant" as little-endian words, and the same words as a big-endian file stores them.
const SIGNATURE = [0x72615647, 0x746e6169];
const SWAPPED_SIGNATURE = [0x47566172, 0x69616e74];
const TYPE_VALUE = 0x76; // 'v'
const TYPE_LIST = 0x4c; // 'L'
const VARIANT_TYPE = [0x00, 0x28, 0x75, 0x75, 0x61, 0x79, 0x29]; // "\0(uuay)", what a `v` ends in

const utf8 = new TextDecoder();

function u32(bytes: Uint8Array, at: number): number {
    return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u16(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8);
}

function invalidHeader(): GLibError {
    return new GLibError(ResourceError, ResourceError.INTERNAL, 'invalid gvdb header');
}

function notFound(path: string): GLibError {
    return new GLibError(ResourceError, ResourceError.NOT_FOUND, `The resource at “${path}” does not exist`);
}

function checkFlags(flags: number): void {
    if (flags === ResourceLookupFlags.NONE) return;
    const shown = Number.isInteger(flags) ? `0x${(flags >>> 0).toString(16)}` : String(flags);
    throw new Error(`${shown} is not a valid value for flags argument lookup_flags`);
}

interface Entry {
    readonly size: number;
    readonly flags: number;
    readonly data: Uint8Array;
}

class GvdbTable {
    readonly #bytes: Uint8Array;
    readonly #items: number;
    readonly #count: number;
    #names: Map<string, number> | null = null;

    constructor(bytes: Uint8Array) {
        if (bytes.length < HEADER_SIZE) throw invalidHeader();
        const first = u32(bytes, 0);
        const second = u32(bytes, 4);
        if (first === SWAPPED_SIGNATURE[0] && second === SWAPPED_SIGNATURE[1]) {
            throw refuse('A byte-swapped (big-endian) GVDB file', 'is outside the Gio.Resource subset');
        }
        if (first !== SIGNATURE[0] || second !== SIGNATURE[1]) throw invalidHeader();
        if (u32(bytes, 8) !== 0 || u32(bytes, 12) !== 0) throw invalidHeader();
        // GIO checks the header only: a root table that does not fit the file is accepted and
        // answers NOT_FOUND for every path, so this does the same instead of raising.
        const start = u32(bytes, 16);
        const end = u32(bytes, 20);
        let items = 0;
        let count = 0;
        if (start <= end && end <= bytes.length && start % 4 === 0 && end - start >= 8) {
            const first = start + 8 + (u32(bytes, start) & 0x7ffffff) * 4 + u32(bytes, start + 4) * 4;
            if (first <= end) {
                items = first;
                count = Math.floor((end - first) / ITEM_SIZE);
            }
        }
        this.#bytes = bytes;
        this.#items = items;
        this.#count = count;
    }

    #at(item: number): number {
        return this.#items + item * ITEM_SIZE;
    }

    #key(item: number): string | null {
        const at = this.#at(item);
        const start = u32(this.#bytes, at + 8);
        const end = start + u16(this.#bytes, at + 12);
        return end > this.#bytes.length ? null : utf8.decode(this.#bytes.subarray(start, end));
    }

    /** An item's key is a suffix; the parent chain holds the rest of the path. */
    #name(item: number): string | null {
        const parts: string[] = [];
        let at = item;
        for (let depth = 0; depth <= this.#count; depth++) {
            const key = this.#key(at);
            if (key === null) return null;
            parts.push(key);
            const parent = u32(this.#bytes, this.#at(at) + 4);
            if (parent === NO_PARENT) return parts.reverse().join('');
            if (parent >= this.#count) return null;
            at = parent;
        }
        return null;
    }

    #find(path: string, type: number): number | null {
        if (this.#names === null) {
            this.#names = new Map();
            for (let i = 0; i < this.#count; i++) {
                const name = this.#name(i);
                if (name !== null) this.#names.set(name, i);
            }
        }
        const item = this.#names.get(path);
        return item !== undefined && this.#bytes[this.#at(item) + 14] === type ? item : null;
    }

    #range(item: number, alignment: number): Uint8Array | null {
        const at = this.#at(item);
        const start = u32(this.#bytes, at + 16);
        const end = u32(this.#bytes, at + 20);
        if (start > end || end > this.#bytes.length || start % alignment !== 0) return null;
        return this.#bytes.subarray(start, end);
    }

    /** The `(uuay)` a path holds; null when the path is no resource. */
    entry(path: string): Entry | null {
        const item = this.#find(path, TYPE_VALUE);
        if (item === null) return null;
        const variant = this.#range(item, 8);
        if (variant === null || variant.length < 8 + VARIANT_TYPE.length) return null;
        const child = variant.subarray(0, variant.length - VARIANT_TYPE.length);
        if (!VARIANT_TYPE.every((byte, i) => variant[child.length + i] === byte)) return null;
        const size = u32(child, 0);
        const flags = u32(child, 4);
        const array = child.subarray(8);
        if (!(flags & FLAGS_COMPRESSED) && size > array.length) return null;
        return { size, flags, data: flags & FLAGS_COMPRESSED ? array : array.subarray(0, size) };
    }

    /** The children of a directory (its path ends in `/`), in the order the builder wrote them. */
    children(path: string): string[] | null {
        const item = this.#find(path, TYPE_LIST);
        if (item === null) return null;
        const list = this.#range(item, 4);
        if (list === null) return null;
        const names: string[] = [];
        for (let at = 0; at + 4 <= list.length; at += 4) {
            const child = u32(list, at);
            const key = child < this.#count ? this.#key(child) : null;
            if (key !== null) names.push(key);
        }
        return names;
    }
}

const TABLES = new WeakMap<object, GvdbTable>();

function tableOf(resource: unknown): GvdbTable {
    const table = typeof resource === 'object' && resource !== null ? TABLES.get(resource) : undefined;
    if (!table) throw new TypeError('expected a Gio.Resource');
    return table;
}

function dataOf(entry: Entry, path: string): Bytes {
    if (entry.flags & FLAGS_COMPRESSED) {
        throw refuse(
            `Gio.Resource lookup_data of the compressed entry ${path}`,
            'needs a zlib inflate the subset lacks',
        );
    }
    return new Bytes(entry.data);
}

function directory(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

export class Resource {
    private constructor() {}

    static new_from_data(data: Uint8Array | Bytes): Resource {
        const bytes = data instanceof Bytes ? Bytes.view(data) : data;
        if (!(bytes instanceof Uint8Array))
            throw refuse(`Gio.Resource.new_from_data(${typeof data})`, 'takes a Uint8Array or a GLib.Bytes');
        const resource = new Resource();
        TABLES.set(resource, new GvdbTable(bytes.slice()));
        return resource;
    }

    static load(path: string): never {
        throw refuse(
            `Gio.Resource.load(${JSON.stringify(path)})`,
            'has no file system to read; embed the compiled bytes and call Gio.Resource.new_from_data',
        );
    }

    lookup_data(path: string, lookup_flags: number): Bytes {
        checkFlags(lookup_flags);
        const entry = path === '' ? null : tableOf(this).entry(path);
        if (!entry) throw notFound(path);
        return dataOf(entry, path);
    }

    get_info(path: string, lookup_flags: number): [boolean, number, number] {
        checkFlags(lookup_flags);
        const entry = path === '' ? null : tableOf(this).entry(path);
        if (!entry) throw notFound(path);
        return [true, entry.size, entry.flags];
    }

    enumerate_children(path: string, lookup_flags: number): string[] {
        checkFlags(lookup_flags);
        const children = path === '' ? null : tableOf(this).children(directory(path));
        if (!children) throw notFound(path);
        return children;
    }

    open_stream(): never {
        throw refuse('Gio.Resource.open_stream()', 'needs a GInputStream the web subset does not have');
    }

    _register(): void {
        resources_register(this);
    }

    _unregister(): void {
        resources_unregister(this);
    }
}

// --- The process-wide registry ---------------------------------------------------------------

const REGISTRY_MARK = Symbol.for('@gjsify/adwaita-core/gio-resource-registry');

/**
 * Two copies of this module would be two registries answering differently, so the second one to
 * load throws (ADR 0116 § 3). `host` is `globalThis`; it is a parameter so a spec can show it.
 * @internal
 */
export function claimResourceRegistry(host: object): void {
    if (Object.prototype.hasOwnProperty.call(host, REGISTRY_MARK)) {
        throw new Error(
            'A second copy of the Gio resource registry was loaded: @gjsify/adwaita-core must be in the bundle once (ADR 0116 § 3).',
        );
    }
    Object.defineProperty(host, REGISTRY_MARK, { value: true });
}

claimResourceRegistry(globalThis);

/** Most recently registered first: `g_resources_register` prepends. */
const registered: Resource[] = [];

export function resources_register(resource: Resource): void {
    tableOf(resource);
    registered.unshift(resource);
}

export function resources_unregister(resource: Resource): void {
    tableOf(resource);
    const at = registered.indexOf(resource);
    if (at < 0) {
        console.warn('Tried to remove not registered resource');
        return;
    }
    registered.splice(at, 1);
}

function lookup(path: string): Entry | null {
    if (path === '') return null;
    for (const resource of registered) {
        const entry = tableOf(resource).entry(path);
        if (entry) return entry;
    }
    return null;
}

export function resources_lookup_data(path: string, lookup_flags: number): Bytes {
    checkFlags(lookup_flags);
    const entry = lookup(path);
    if (!entry) throw notFound(path);
    return dataOf(entry, path);
}

export function resources_get_info(path: string, lookup_flags: number): [boolean, number, number] {
    checkFlags(lookup_flags);
    const entry = lookup(path);
    if (!entry) throw notFound(path);
    return [true, entry.size, entry.flags];
}

export function resources_enumerate_children(path: string, lookup_flags: number): string[] {
    checkFlags(lookup_flags);
    const names = new Set<string>();
    let found = false;
    for (const resource of path === '' ? [] : registered) {
        const children = tableOf(resource).children(directory(path));
        if (!children) continue;
        found = true;
        for (const name of children) names.add(name);
    }
    if (!found) throw notFound(path);
    return [...names];
}
