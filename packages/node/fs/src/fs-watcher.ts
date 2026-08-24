// Reference: Node.js lib/internal/fs/watchers.js
// Reimplemented for GJS using Gio.FileMonitor

import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { normalizePath } from './utils.js';
import { WatchTree, type WatchEventType } from './watch-tree.js';
const privates = new WeakMap();

import type { FSWatcher as IFSWatcher, PathLike, WatchOptions } from 'node:fs';

export class FSWatcher extends EventEmitter implements IFSWatcher {
    constructor(filename: PathLike, options, listener) {
        super();
        if (!options || typeof options !== 'object') options = { persistent: true };

        const persistent = options.persistent !== false;
        // The monitors, the walk that creates them and the disposal that ends them all
        // live in WatchTree — this class owns the event-loop hold and the emitter.
        const tree = new WatchTree(
            normalizePath(filename),
            options.recursive === true,
            (eventType: WatchEventType, name: string) => {
                this.emit('change', eventType, name);
            },
            (err: unknown) => {
                this.emit('error', err);
            },
        );

        // When persistent is true, acquire a reference on the default GLib main context
        // so the main loop stays alive while this watcher is active.
        // This mirrors Node.js behavior where persistent watchers keep the event loop alive.
        let sourceId: number | null = null;
        if (persistent) {
            // Add a never-firing timeout source to keep the mainloop alive.
            // This is a lightweight way to hold a ref on the main context.
            sourceId = (
                GLib.timeout_add as unknown as (priority: number, interval: number, fn: () => boolean) => number
            )(GLib.PRIORITY_LOW, 2147483647, () => GLib.SOURCE_CONTINUE);
        }

        privates.set(this, {
            persistent,
            closed: false,
            sourceId,
            // even if never used later on, the tree needs to be
            // attached to this instance or GJS reference counter
            // will ignore its monitors and no watch will ever happen
            tree,
        });
        if (listener) this.on('change', listener);
    }

    close() {
        const priv = privates.get(this);
        if (priv.closed) return;
        priv.closed = true;
        priv.tree.close();
        if (priv.sourceId !== null) {
            GLib.source_remove(priv.sourceId);
            priv.sourceId = null;
        }
    }

    /**
     * When called, requests that the Node.js event loop not exit so long as the
     * FSWatcher is active. Calling ref() multiple times has no effect.
     */
    ref(): this {
        const priv = privates.get(this);
        if (!priv.persistent && !priv.closed) {
            priv.persistent = true;
            priv.sourceId = (
                GLib.timeout_add as unknown as (priority: number, interval: number, fn: () => boolean) => number
            )(GLib.PRIORITY_LOW, 2147483647, () => GLib.SOURCE_CONTINUE);
        }
        return this;
    }

    /**
     * When called, the active FSWatcher will not require the Node.js event loop
     * to remain active. Calling unref() multiple times has no effect.
     */
    unref(): this {
        const priv = privates.get(this);
        if (priv.persistent) {
            priv.persistent = false;
            if (priv.sourceId !== null) {
                GLib.source_remove(priv.sourceId);
                priv.sourceId = null;
            }
        }
        return this;
    }
}

export default FSWatcher;

type WatchEvent = { eventType: string; filename: string | null };

export async function* watchAsync(
    filename: PathLike,
    options?: WatchOptions & { signal?: AbortSignal },
): AsyncIterableIterator<WatchEvent> {
    const signal = options?.signal;

    if (signal?.aborted) return;

    const pathStr = normalizePath(filename);

    const eventQueue: WatchEvent[] = [];
    const waiterQueue: Array<{ resolve: (r: IteratorResult<WatchEvent>) => void }> = [];
    let finished = false;
    let failure: unknown = null;

    function enqueue(event: WatchEvent): void {
        if (finished) return;
        if (waiterQueue.length > 0) {
            waiterQueue.shift()!.resolve({ value: event, done: false });
        } else {
            eventQueue.push(event);
        }
    }

    function terminate(): void {
        if (finished) return;
        finished = true;
        while (waiterQueue.length > 0) {
            // `done: true` iterator returns conventionally carry `value: undefined`;
            // the default `TReturn` of `IteratorResult` allows that without a cast.
            waiterQueue.shift()!.resolve({ value: undefined, done: true });
        }
    }

    let tree: WatchTree;
    try {
        tree = new WatchTree(
            pathStr,
            options?.recursive === true,
            (eventType, name) => {
                enqueue({ eventType, filename: name });
            },
            (err) => {
                // A failure deeper in the tree ends the iteration by throwing out of it,
                // which is how `events.on()` surfaces an 'error' to the consumer of
                // Node's own `fs.promises.watch`.
                failure = err;
                terminate();
            },
        );
    } catch {
        // `g_file_monitor()` is `throws="1"`: an unwatchable path yields an iterator
        // that is simply already done, rather than a rejection nobody is waiting on yet.
        return;
    }

    const abortHandler = () => terminate();
    signal?.addEventListener('abort', abortHandler);

    try {
        while (!finished) {
            if (eventQueue.length > 0) {
                yield eventQueue.shift()!;
                continue;
            }
            const result = await new Promise<IteratorResult<WatchEvent>>((resolve) => {
                waiterQueue.push({ resolve });
            });
            if (result.done) break;
            yield result.value;
        }
        if (failure !== null) throw failure;
    } finally {
        signal?.removeEventListener('abort', abortHandler);
        tree.close();
    }
}
