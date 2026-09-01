// `@react-native-async-storage/async-storage` — a real store, not a stub.
//
// One JSON document in the application's own data directory, read once and rewritten
// atomically on every mutation. That is a whole store rather than a shim, and it is
// what the API is documented for: preferences, a session token, a small cache.
//
// WHY NOT `@gjsify/sqlite`, which is the obvious answer and the wrong one here. It is
// tier 1 and would be a fine dependency, but it declares `node: "none"` and depends on
// `@girs/gda-6.0` — libgda. `@gjsify/react-native` declares `node: "polyfill"` because
// ADR 0032's own Consequences route macOS and Windows through Node + `@gjsify/node-gi`,
// so a `node: "none"` dependency would break the only route those two platforms have,
// and it would add a system library to a package that is otherwise pure TypeScript
// plus GTK.
//
// WHY NOT `GLib.KeyFile`, which is the DESKTOP shape and was measured before it was
// rejected. AsyncStorage keys are arbitrary strings — `@app:token`, `persist:root` —
// and MEASURED on glib 2.86: `g_key_file_set_string` with a key containing `=` prints
//
//     GLib-CRITICAL **: g_key_file_set_value: assertion 'key != NULL &&
//     g_key_file_is_key_name (key, strlen (key))' failed
//
// and then RETURNS NORMALLY having written nothing — the key is simply absent from
// `to_data()`. A store that silently loses a key is the exact failure this whole layer
// exists against, and percent-encoding every key to get around it would make the file
// unreadable for no gain over JSON.
//
// THE WRITE IS ATOMIC and that is not decoration: `Gio.File.replace_contents` with
// `REPLACE_DESTINATION` writes a temporary file and renames it, so a process killed
// mid-write leaves the previous document rather than half of one. A file corrupted by
// something ELSE is still reachable, and it is reported by name on the first read
// instead of silently starting from empty — an empty store looks like a first launch,
// and a user who lost their data to one would never know it happened.
//
// THE PATH NEEDS THE APPLICATION ID, and there is no honest default. `Gio.Application`
// is the desktop's own identity and `GLib.get_prgname()` is the interpreter's when no
// application exists — so a read before the application is constructed throws by name
// rather than writing to a directory called `gjs`.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { PrimitiveError } from '../primitives/errors.js';

const FILE_NAME = 'async-storage.json';

/** The decoder/encoder pair, built once: both are stateless and allocating per call is waste. */
const decoder = new TextDecoder();
const encoder = new TextEncoder();

let store: Map<string, string> | null = null;
let file: Gio.File | null = null;

/**
 * The application's own data directory, as `Gio.Application` names it.
 *
 * `Gio.Application.get_default()` first, because that IS the desktop's identity and
 * `AppRegistry.runApplication` has always required an `applicationId` for the same
 * reason: a phone host supplies the application identity, a desktop one IS the
 * application.
 */
function storeFile(): Gio.File {
    if (file !== null) return file;
    const application = Gio.Application.get_default();
    const id = application?.applicationId ?? null;
    if (id === null || id === '') {
        throw new PrimitiveError(
            'AsyncStorage',
            'the store’s location',
            'needs the application id, and there is no Gio.Application yet. `GLib.get_prgname()` would name the INTERPRETER, so the store would land in a directory called after gjs or node and a later run under the real application would find it empty. Build the application first — `registerRootComponent(App, { applicationId })` does — or read this from a component rather than at module scope',
        );
    }
    file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), id, FILE_NAME]));
    return file;
}

/**
 * The store, read from disk on first use.
 *
 * `load_contents` and not `Gio.File.load_contents_async`: every method below is
 * declared `async` and each one awaits this, so a synchronous read of a few kilobytes
 * once per process is simpler than a promise chain around a file that is almost
 * certainly in the page cache. The ASYNC SURFACE over a SYNC store is the sound
 * direction; the reverse is not.
 */
function load(): Map<string, string> {
    if (store !== null) return store;
    const target = storeFile();
    const loaded = new Map<string, string>();
    let bytes: Uint8Array | null = null;
    if (target.query_exists(null)) {
        // `load_contents` is `throws="1"` in the GIR — a file that exists can still
        // fail to be read (a permission, a device error), and that is the throw path
        // this catch has. It is re-raised by name: a store that silently started empty
        // is what the module comment refuses.
        try {
            const [, contents] = target.load_contents(null);
            bytes = contents;
        } catch (error) {
            throw new PrimitiveError(
                'AsyncStorage',
                `reading ${target.get_path() ?? FILE_NAME}`,
                `failed: ${error instanceof Error ? error.message : String(error)}. Starting from an empty store would look like a first launch, so this is loud instead`,
            );
        }
    }
    if (bytes !== null) {
        const text = decoder.decode(bytes);
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throw new PrimitiveError(
                'AsyncStorage',
                `parsing ${target.get_path() ?? FILE_NAME}`,
                `failed: ${error instanceof Error ? error.message : String(error)}. The file is not this store’s JSON any more. Move it aside to start over — deleting it silently is not this layer’s decision to make`,
            );
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new PrimitiveError(
                'AsyncStorage',
                `reading ${target.get_path() ?? FILE_NAME}`,
                `found ${Array.isArray(parsed) ? 'an array' : typeof parsed} where this store keeps a JSON object of string values`,
            );
        }
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') loaded.set(key, value);
        }
    }
    store = loaded;
    return loaded;
}

/** Write the whole document, atomically. */
function flush(): void {
    const target = storeFile();
    const parent = target.get_parent();
    if (parent !== null && !parent.query_exists(null)) {
        // `throws="1"`, and the throw path is real: a data directory that cannot be
        // created is a permissions problem worth naming rather than a write that fails
        // one line later with no context.
        try {
            parent.make_directory_with_parents(null);
        } catch (error) {
            throw new PrimitiveError(
                'AsyncStorage',
                `creating ${parent.get_path() ?? '<data dir>'}`,
                `failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
    const document: Record<string, string> = {};
    for (const [key, value] of load()) document[key] = value;
    // REPLACE_DESTINATION is what makes this a write-to-temp-and-rename rather than a
    // truncate-and-write. Without it a process killed mid-write leaves a half document,
    // which the loader above would correctly refuse — and the user's data would be gone.
    target.replace_contents(
        encoder.encode(JSON.stringify(document, null, 2)),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
    );
}

const requireKey = (method: string, key: unknown): string => {
    if (typeof key !== 'string') {
        throw new PrimitiveError('AsyncStorage', method, `takes a string key, and received ${typeof key}`);
    }
    return key;
};

const requireValue = (method: string, value: unknown): string => {
    if (typeof value !== 'string') {
        throw new PrimitiveError(
            'AsyncStorage',
            method,
            `takes a string value — AsyncStorage stores strings, which is upstream’s own contract — and received ${typeof value}. Use JSON.stringify`,
        );
    }
    return value;
};

/**
 * `AsyncStorage`, over one JSON document.
 *
 * Also the module's DEFAULT export, because that is how every application imports it.
 * The named export exists so a consumer's own tooling — and this package's spec — can
 * reach it without a default import, which the build gate cannot see the names of.
 */
export const AsyncStorage = {
    async getItem(key: string): Promise<string | null> {
        return load().get(requireKey('getItem', key)) ?? null;
    },

    async setItem(key: string, value: string): Promise<void> {
        load().set(requireKey('setItem', key), requireValue('setItem', value));
        flush();
    },

    async removeItem(key: string): Promise<void> {
        load().delete(requireKey('removeItem', key));
        flush();
    },

    /**
     * Shallow-merge a JSON object into the value already at `key`.
     *
     * Upstream's own semantics: both sides must parse as JSON objects, and the merge
     * is one level deep. A key holding something that is not a JSON object is a named
     * refusal rather than an overwrite — an overwrite there is the silent data loss
     * this store is careful about everywhere else.
     */
    async mergeItem(key: string, value: string): Promise<void> {
        const name = requireKey('mergeItem', key);
        const incoming = parseObject('mergeItem', requireValue('mergeItem', value));
        const current = load().get(name);
        const merged = current === undefined ? incoming : { ...parseObject('mergeItem', current), ...incoming };
        load().set(name, JSON.stringify(merged));
        flush();
    },

    async clear(): Promise<void> {
        load().clear();
        flush();
    },

    async getAllKeys(): Promise<readonly string[]> {
        return [...load().keys()];
    },

    async multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]> {
        const current = load();
        return keys.map((key) => [requireKey('multiGet', key), current.get(key) ?? null] as const);
    },

    async multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
        const current = load();
        for (const [key, value] of pairs) {
            current.set(requireKey('multiSet', key), requireValue('multiSet', value));
        }
        // ONE flush for the batch, which is the whole reason the multi* methods exist:
        // a per-pair write would make `multiSet` N whole-document rewrites.
        flush();
    },

    async multiRemove(keys: readonly string[]): Promise<void> {
        const current = load();
        for (const key of keys) current.delete(requireKey('multiRemove', key));
        flush();
    },

    async multiMerge(pairs: readonly (readonly [string, string])[]): Promise<void> {
        const current = load();
        for (const [key, value] of pairs) {
            const name = requireKey('multiMerge', key);
            const incoming = parseObject('multiMerge', requireValue('multiMerge', value));
            const existing = current.get(name);
            const merged = existing === undefined ? incoming : { ...parseObject('multiMerge', existing), ...incoming };
            current.set(name, JSON.stringify(merged));
        }
        flush();
    },

    /**
     * A no-op, and a reasoned one.
     *
     * Upstream batches concurrent `getItem` calls and this is the flush of that queue.
     * Reads here are synchronous against an in-memory map, so there is no queue — and
     * a refusal would break the ordinary defensive call site that flushes before a
     * navigation.
     */
    async flushGetRequests(): Promise<void> {},
} as const;

function parseObject(method: string, text: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new PrimitiveError(
            'AsyncStorage',
            method,
            `needs both sides to be JSON objects, and one of them does not parse: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new PrimitiveError(
            'AsyncStorage',
            method,
            `merges JSON OBJECTS, and found ${Array.isArray(parsed) ? 'an array' : typeof parsed}. Overwriting instead would be silent data loss`,
        );
    }
    return parsed as Record<string, unknown>;
}

/** The per-key handle, which is pure composition over the store. */
export function useAsyncStorage(key: string): {
    readonly getItem: () => Promise<string | null>;
    readonly setItem: (value: string) => Promise<void>;
    readonly mergeItem: (value: string) => Promise<void>;
    readonly removeItem: () => Promise<void>;
} {
    return {
        getItem: () => AsyncStorage.getItem(key),
        setItem: (value: string) => AsyncStorage.setItem(key, value),
        mergeItem: (value: string) => AsyncStorage.mergeItem(key, value),
        removeItem: () => AsyncStorage.removeItem(key),
    };
}

/** For the spec: forget the loaded document and the resolved path. */
export const resetAsyncStorage = (): void => {
    store = null;
    file = null;
};

/**
 * Point the store at one specific file.
 *
 * A TEST SEAM, with the reason stated because nothing in the shipping path calls it:
 * the location is derived from the application id and `GLib.get_user_data_dir()`, and
 * a spec must not write into the developer's real data directory. Moving that
 * directory is not an option either — GLib caches it on the first read, and by the
 * time a suite runs something has read it.
 */
export const useStoreFile = (path: string): void => {
    file = Gio.File.new_for_path(path);
    store = null;
};

export default AsyncStorage;
