// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// Optional OPFS (Origin Private File System) persistence bridge.
//
// The browser `fs` surface is synchronous and backed by an in-memory `Volume`
// (see ./volume.ts). OPFS, however, is asynchronous-only on the main thread
// (synchronous access handles exist solely inside dedicated Web Workers). We
// therefore cannot make the sync `fs.*Sync` calls hit OPFS directly. Instead
// this module keeps memfs as the in-memory working layer and bridges it to
// OPFS in two async phases:
//
//   1. Hydrate — on enable, the OPFS tree is read recursively into the volume
//      so files written in a previous session reappear.
//   2. Flush — every volume mutation schedules a debounced async flush that
//      mirrors the volume's `toJSON()` snapshot back into OPFS (creating
//      directories, writing changed files, deleting stale entries).
//
// Feature detection is `navigator.storage?.getDirectory`. When OPFS is
// unavailable (older engines, insecure contexts, GJS) `enableOpfsPersistence`
// resolves to a disabled controller and the volume stays purely in-memory —
// nothing throws.
//
// Honest limitations (unchanged from the in-memory layer):
//   - Symlinks: `toJSON()` serialises a symlink as a placeholder string, so
//     symlinks are NOT round-tripped through OPFS — they survive in-memory for
//     the session but are not persisted as links.
//   - File watching (FSWatcher) is still a stub and is not OPFS-aware.
//   - Permission / owner bits (mode/uid/gid) are not persisted — OPFS has no
//     POSIX metadata; hydrated files come back with default mode bits.
//   - Persistence is whole-file and snapshot-based (last-write-wins per flush),
//     not byte-range journalled.

import type { Volume } from './volume.js';
import { __defaultVolume } from './volume.js';

/** Options for {@link enableOpfsPersistence}. */
export interface OpfsPersistenceOptions {
    /** Volume to persist. Defaults to the process-wide `__defaultVolume`. */
    volume?: Volume;
    /**
     * Sub-directory inside the origin's private file system to mirror the
     * volume into. Lets multiple independent volumes share one origin without
     * clobbering each other. Default: `'gjsify-fs'`.
     */
    rootDir?: string;
    /**
     * Debounce window (ms) before a burst of mutations is flushed to OPFS.
     * Default: `50`. Set to `0` to flush on every microtask turn.
     */
    flushDelayMs?: number;
}

/** Handle returned by {@link enableOpfsPersistence}. */
export interface OpfsPersistenceController {
    /** Whether OPFS was available and persistence is active. */
    readonly enabled: boolean;
    /** If `enabled` is false, a short machine-readable reason. */
    readonly reason?: 'no-opfs' | 'error';
    /** Force an immediate flush of the volume to OPFS. Resolves when written. */
    flush(): Promise<void>;
    /** Stop persisting: unsubscribe the mutation listener (does not wipe OPFS). */
    disable(): void;
}

/** Feature-detect the main-thread OPFS root accessor. */
export function hasOpfs(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.storage !== 'undefined' &&
        typeof navigator.storage.getDirectory === 'function'
    );
}

const DEFAULT_ROOT = 'gjsify-fs';

/** Split an absolute POSIX path into segments (drops leading `/`). */
function segments(absPath: string): string[] {
    return absPath.split('/').filter(Boolean);
}

/** Resolve (creating if asked) a nested directory handle under `root`. */
async function dirHandle(
    root: FileSystemDirectoryHandle,
    parts: string[],
    create: boolean,
): Promise<FileSystemDirectoryHandle | undefined> {
    let cur = root;
    for (const part of parts) {
        try {
            cur = await cur.getDirectoryHandle(part, { create });
        } catch {
            return undefined;
        }
    }
    return cur;
}

/** Recursively read an OPFS directory into a flat `path -> bytes | null` map. */
async function readOpfsTree(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: Map<string, Uint8Array | null>,
): Promise<void> {
    let empty = true;
    // `entries()` is an async iterator on FileSystemDirectoryHandle.
    for await (const [name, handle] of (
        dir as unknown as {
            entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
        }
    ).entries()) {
        empty = false;
        const childPath = prefix === '/' ? '/' + name : prefix + '/' + name;
        if (handle.kind === 'directory') {
            await readOpfsTree(handle as FileSystemDirectoryHandle, childPath, out);
        } else {
            const file = await (handle as FileSystemFileHandle).getFile();
            out.set(childPath, new Uint8Array(await file.arrayBuffer()));
        }
    }
    // Preserve empty directories (excluding the synthetic root).
    if (empty && prefix !== '/') out.set(prefix, null);
}

/** Mirror the volume's current snapshot into OPFS under `root`. */
async function flushVolumeToOpfs(vol: Volume, root: FileSystemDirectoryHandle): Promise<void> {
    const snapshot = vol.toJSON();

    // 1. Write / create every path present in the snapshot.
    const liveDirs = new Set<string>();
    const liveFiles = new Set<string>();
    for (const [path, content] of Object.entries(snapshot)) {
        const parts = segments(path);
        if (content === null) {
            // Empty directory marker — keep the dir and every ancestor live so
            // pruneStale doesn't recursively delete a nested empty directory.
            await dirHandle(root, parts, true);
            for (let i = 1; i <= parts.length; i++) liveDirs.add(parts.slice(0, i).join('/'));
        } else {
            const parent = await dirHandle(root, parts.slice(0, -1), true);
            if (!parent) continue;
            for (let i = 1; i < parts.length; i++) liveDirs.add(parts.slice(0, i).join('/'));
            const fileHandle = await parent.getFileHandle(parts[parts.length - 1], { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(new TextEncoder().encode(content));
            await writable.close();
            liveFiles.add(parts.join('/'));
        }
    }

    // 2. Prune OPFS entries no longer present in the snapshot (deletions).
    await pruneStale(root, '', liveFiles, liveDirs);
}

/** Remove OPFS entries that are absent from the live file/dir sets. */
async function pruneStale(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    liveFiles: Set<string>,
    liveDirs: Set<string>,
): Promise<void> {
    const toRemove: Array<{ name: string; recursive: boolean }> = [];
    for await (const [name, handle] of (
        dir as unknown as {
            entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
        }
    ).entries()) {
        const childKey = prefix ? prefix + '/' + name : name;
        if (handle.kind === 'directory') {
            // Recurse first so we can drop a now-empty live dir's stale children.
            await pruneStale(handle as FileSystemDirectoryHandle, childKey, liveFiles, liveDirs);
            if (!liveDirs.has(childKey) && !liveFiles.has(childKey)) {
                toRemove.push({ name, recursive: true });
            }
        } else if (!liveFiles.has(childKey)) {
            toRemove.push({ name, recursive: false });
        }
    }
    for (const { name, recursive } of toRemove) {
        try {
            await dir.removeEntry(name, { recursive });
        } catch {
            /* already gone */
        }
    }
}

/**
 * Enable OPFS-backed persistence for a memfs `Volume`.
 *
 * Hydrates the volume from OPFS (so a prior session's files reappear) and then
 * mirrors every subsequent mutation back to OPFS on a debounced schedule. The
 * synchronous `fs.*Sync` API surface is untouched — reads and writes still hit
 * the in-memory volume; OPFS is a write-behind durability layer.
 *
 * When OPFS is unavailable the returned controller has `enabled: false` and the
 * volume continues to work purely in-memory. This never throws for a missing
 * platform — only an actual OPFS I/O error during setup yields `reason: 'error'`.
 */
export async function enableOpfsPersistence(options: OpfsPersistenceOptions = {}): Promise<OpfsPersistenceController> {
    const vol = options.volume ?? __defaultVolume;

    if (!hasOpfs()) {
        return { enabled: false, reason: 'no-opfs', flush: async () => {}, disable: () => {} };
    }

    let root: FileSystemDirectoryHandle;
    try {
        const origin = await navigator.storage.getDirectory();
        root = await origin.getDirectoryHandle(options.rootDir ?? DEFAULT_ROOT, { create: true });
    } catch {
        return { enabled: false, reason: 'error', flush: async () => {}, disable: () => {} };
    }

    // ── Hydrate: OPFS → volume (no flush feedback). ──────────────────────────
    let suspendFlush = true;
    try {
        const tree = new Map<string, Uint8Array | null>();
        await readOpfsTree(root, '/', tree);
        const json: Record<string, string | Uint8Array | null> = {};
        for (const [path, bytes] of tree) json[path] = bytes;
        if (Object.keys(json).length > 0) vol.fromJSON(json);
    } catch {
        // A read failure leaves the volume in-memory-only but still flushable.
    } finally {
        suspendFlush = false;
    }

    // ── Flush: volume → OPFS (debounced). ────────────────────────────────────
    const delay = options.flushDelayMs ?? 50;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> = Promise.resolve();
    let pending = false;

    const doFlush = (): Promise<void> => {
        // Serialise flushes: chain after any in-flight write to avoid interleaving.
        inFlight = inFlight.then(() => flushVolumeToOpfs(vol, root)).catch(() => {});
        return inFlight;
    };

    const schedule = (): void => {
        if (suspendFlush) return;
        pending = true;
        if (timer !== undefined) return;
        timer = setTimeout(() => {
            timer = undefined;
            pending = false;
            void doFlush();
        }, delay);
    };

    const unsubscribe = vol.subscribe(schedule);

    return {
        enabled: true,
        async flush(): Promise<void> {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            pending = false;
            await doFlush();
        },
        disable(): void {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            unsubscribe();
            void pending; // a still-pending mutation is intentionally dropped on disable
        },
    };
}
