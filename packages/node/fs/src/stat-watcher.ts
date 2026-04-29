// Reference: Node.js lib/internal/fs/watchers.js (StatWatcher)
// Reimplemented for GJS using setInterval polling

import { EventEmitter } from 'node:events';
import { statSync } from './sync.js';

import type { PathLike, Stats } from 'node:fs';

function zeroedStat(): Stats {
  return {
    dev: 0, ino: 0, mode: 0, nlink: 0, uid: 0, gid: 0, rdev: 0,
    size: 0, blksize: 0, blocks: 0,
    atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
    atime: new Date(0), mtime: new Date(0), ctime: new Date(0), birthtime: new Date(0),
    isFile: () => false, isDirectory: () => false, isBlockDevice: () => false,
    isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false,
    isSocket: () => false,
  } as unknown as Stats;
}

export class StatWatcher extends EventEmitter {
  private _path: string;
  private _interval: number;
  private _timerId: ReturnType<typeof setInterval> | null = null;
  private _prev: Stats;
  private _changeCount = 0;

  constructor(path: string, interval: number) {
    super();
    this._path = path;
    this._interval = interval;
    this._prev = zeroedStat();
  }

  start(): void {
    try { this._prev = statSync(this._path) as unknown as Stats; } catch {}
    this._timerId = setInterval(() => {
      let curr: Stats;
      try { curr = statSync(this._path) as unknown as Stats; } catch { curr = zeroedStat(); }
      const prev = this._prev;
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size || curr.ino !== prev.ino) {
        this._prev = curr;
        this.emit('change', curr, prev);
      }
    }, this._interval);
  }

  stop(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    this.emit('stop');
  }

  addChangeListener(listener: (curr: Stats, prev: Stats) => void): void {
    this._changeCount++;
    this.on('change', listener);
  }

  removeChangeListener(listener: (curr: Stats, prev: Stats) => void): void {
    this._changeCount--;
    this.removeListener('change', listener);
  }

  removeAllChangeListeners(): void {
    this._changeCount = 0;
    this.removeAllListeners('change');
  }

  get changeListenerCount(): number {
    return this._changeCount;
  }
}

const statWatchers = new Map<string, StatWatcher>();

export function watchFile(
  filename: PathLike,
  options: { persistent?: boolean; interval?: number } | ((curr: Stats, prev: Stats) => void),
  listener?: (curr: Stats, prev: Stats) => void,
): StatWatcher {
  if (typeof options === 'function') {
    listener = options;
    options = {};
  }
  const interval = (options as { interval?: number }).interval ?? 5007;
  const resolved = filename.toString();

  let watcher = statWatchers.get(resolved);
  if (!watcher) {
    watcher = new StatWatcher(resolved, interval);
    watcher.start();
    statWatchers.set(resolved, watcher);
  }
  if (listener) watcher.addChangeListener(listener);
  return watcher;
}

export function unwatchFile(
  filename: PathLike,
  listener?: (curr: Stats, prev: Stats) => void,
): void {
  const resolved = filename.toString();
  const watcher = statWatchers.get(resolved);
  if (!watcher) return;
  if (listener) {
    watcher.removeChangeListener(listener);
  } else {
    watcher.removeAllChangeListeners();
  }
  if (watcher.changeListenerCount === 0) {
    watcher.stop();
    statWatchers.delete(resolved);
  }
}
