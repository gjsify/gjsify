// Reference: Node.js lib/internal/fs/watchers.js
// Reimplemented for GJS using Gio.FileMonitor

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { EventEmitter } from 'node:events';
import { normalizePath } from './utils.js';
const privates = new WeakMap;

import type { FSWatcher as IFSWatcher, PathLike, WatchOptions } from 'node:fs';

export class FSWatcher extends EventEmitter implements IFSWatcher {

  constructor(filename: PathLike, options, listener) {
    super();
    if (!options || typeof options !== 'object')
      options = {persistent: true};

    const persistent = options.persistent !== false;
    const cancellable = Gio.Cancellable.new();
    const pathStr = normalizePath(filename);
    const file = Gio.File.new_for_path(pathStr);
    const watcher = file.monitor(Gio.FileMonitorFlags.NONE, cancellable);
    watcher.connect('changed', changed.bind(this));

    // When persistent is true, acquire a reference on the default GLib main context
    // so the main loop stays alive while this watcher is active.
    // This mirrors Node.js behavior where persistent watchers keep the event loop alive.
    let sourceId: number | null = null;
    if (persistent) {
      // Add a never-firing timeout source to keep the mainloop alive.
      // This is a lightweight way to hold a ref on the main context.
      sourceId = GLib.timeout_add(GLib.PRIORITY_LOW, 2147483647, () => GLib.SOURCE_CONTINUE, null);
    }

    privates.set(this, {
      persistent,
      cancellable,
      sourceId,
      // even if never used later on, the monitor needs to be
      // attached to this instance or GJS reference counter
      // will ignore it and no watch will ever happen
      watcher
    });
    if (listener) this.on('change', listener);
  }

  close() {
    const priv = privates.get(this);
    if (!priv.cancellable.is_cancelled()) {
      priv.cancellable.cancel();
      if (priv.sourceId !== null) {
        GLib.source_remove(priv.sourceId);
        priv.sourceId = null;
      }
    }
  }

  /**
   * When called, requests that the Node.js event loop not exit so long as the
   * FSWatcher is active. Calling ref() multiple times has no effect.
   */
  ref(): this {
    const priv = privates.get(this);
    if (!priv.persistent && !priv.cancellable.is_cancelled()) {
      priv.persistent = true;
      priv.sourceId = GLib.timeout_add(GLib.PRIORITY_LOW, 2147483647, () => GLib.SOURCE_CONTINUE, null);
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

};

function changed(watcher, file, otherFile, eventType) {
  switch (eventType) {
    case Gio.FileMonitorEvent.CHANGES_DONE_HINT:
      this.emit('change', 'change', file.get_basename());
      break;
    case Gio.FileMonitorEvent.DELETED:
    case Gio.FileMonitorEvent.CREATED:
    case Gio.FileMonitorEvent.RENAMED:
    case Gio.FileMonitorEvent.MOVED_IN:
    case Gio.FileMonitorEvent.MOVED_OUT:
      this.emit('rename', 'rename', file.get_basename());
      break;
  }
}

export default FSWatcher;

// ─── fs.promises.watch ────────────────────────────────────────────────────────

type WatchEvent = { eventType: string; filename: string | null };

function gioEventToNodeType(eventType: Gio.FileMonitorEvent): string | null {
  switch (eventType) {
    case Gio.FileMonitorEvent.CHANGES_DONE_HINT: return 'change';
    case Gio.FileMonitorEvent.DELETED:
    case Gio.FileMonitorEvent.CREATED:
    case Gio.FileMonitorEvent.RENAMED:
    case Gio.FileMonitorEvent.MOVED_IN:
    case Gio.FileMonitorEvent.MOVED_OUT: return 'rename';
    default: return null;
  }
}

export async function* watchAsync(
  filename: PathLike,
  options?: WatchOptions & { signal?: AbortSignal },
): AsyncIterableIterator<WatchEvent> {
  const signal = (options as any)?.signal as AbortSignal | undefined;

  if (signal?.aborted) return;

  const pathStr = normalizePath(filename);
  const file = Gio.File.new_for_path(pathStr);
  const cancellable = Gio.Cancellable.new();

  let watcher: Gio.FileMonitor;
  try {
    watcher = file.monitor(Gio.FileMonitorFlags.NONE, cancellable);
  } catch {
    return;
  }

  const eventQueue: WatchEvent[] = [];
  const waiterQueue: Array<{ resolve: (r: IteratorResult<WatchEvent>) => void }> = [];
  let finished = false;

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
    if (!cancellable.is_cancelled()) cancellable.cancel();
    while (waiterQueue.length > 0) {
      waiterQueue.shift()!.resolve({ value: undefined as any, done: true });
    }
  }

  const signalId = watcher.connect('changed', (_mon: Gio.FileMonitor, changedFile: Gio.File, _otherFile: Gio.File | null, eventType: Gio.FileMonitorEvent) => {
    const type = gioEventToNodeType(eventType);
    if (type === null) return;
    enqueue({ eventType: type, filename: changedFile?.get_basename() ?? null });
  });

  const abortHandler = () => terminate();
  signal?.addEventListener('abort', abortHandler);

  try {
    while (!finished) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
        continue;
      }
      const result = await new Promise<IteratorResult<WatchEvent>>(resolve => {
        waiterQueue.push({ resolve });
      });
      if (result.done) break;
      yield result.value;
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    try { watcher.disconnect(signalId); } catch {}
    if (!cancellable.is_cancelled()) cancellable.cancel();
  }
}