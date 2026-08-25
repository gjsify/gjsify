// The recursion behind `fs.watch(dir, { recursive: true })`.
//
// GIO directory monitors are FLAT: `g_file_monitor()` on a directory reports its
// direct children and nothing below them, and GIO exposes no recursive flag to
// turn on — so `recursive` was accepted in the options and then silently dropped,
// and `gjsify dev` rebuilt nothing at all for an edit under `src/components/`.
// Node is in exactly this position on Linux (inotify has no recursive mode
// either) and answers it in `lib/internal/fs/recursive_watch.js`: one watch per
// directory, kept in step with the tree as it changes. This is that, over Gio.
//
// The contract was MEASURED against node v24.19.0 on Linux, not read off a doc
// page: a nested content change arrives as ('change', 'sub/deep/a.txt') — a path
// relative to the watched root, never a basename — a directory created after the
// watch started arrives as ('rename', 'late') and is then itself watched, a
// symlinked directory is reported but not descended, and with `recursive: false`
// none of it fires.

import Gio from '@girs/gio-2.0';
import { basename, join, relative, sep } from 'node:path';
import { isNotFoundError } from './errors.js';

/** The two event names Node's `fs.watch` listener signature discriminates on. */
export type WatchEventType = 'rename' | 'change';

/** The walk needs each entry's name and whether it is a directory it may descend. */
const WALK_ATTRS = 'standard::name,standard::type';

/**
 * Node's `fs.watch` emits a single 'change' event whose listener signature is
 * (eventType: 'rename'|'change', filename: string). The string discriminant tells
 * the consumer whether a directory entry appeared/disappeared/was renamed
 * ('rename') or an existing file's contents changed ('change'). Emitting on the
 * event NAMES 'change' and 'rename' instead works for our own internal
 * 'change'-listener registration but silently drops every rename/create/delete
 * for any consumer (chokidar, vite, tsc) that registers only
 * `watcher.on('change', listener)` per Node's contract.
 *
 * CHANGED and CHANGES_DONE_HINT BOTH map to 'change', and the first one is the one
 * that has to be here. GIO documents CHANGES_DONE_HINT as exactly that, "a hint that
 * this was probably the last change in a set of changes": a local-monitor backend
 * synthesises it on a quiet-period timer if it synthesises it at all. A watcher whose
 * only route to 'change' is that hint therefore reports NOTHING for a modification on
 * any backend that does not raise it, which is a promise nothing in GIO makes. Node
 * is chattier than the hint in any case — libuv emits one 'change' per inotify
 * IN_MODIFY — so taking both moves toward its contract rather than away from it.
 * Found by the darwin GJS leg: it saw no 'change' event at all for an overwrite, at
 * any depth, while every create and delete arrived.
 */
function gioEventToNodeType(eventType: Gio.FileMonitorEvent): WatchEventType | null {
    switch (eventType) {
        case Gio.FileMonitorEvent.CHANGED:
        case Gio.FileMonitorEvent.CHANGES_DONE_HINT:
            return 'change';
        case Gio.FileMonitorEvent.DELETED:
        case Gio.FileMonitorEvent.CREATED:
        case Gio.FileMonitorEvent.RENAMED:
        case Gio.FileMonitorEvent.MOVED_IN:
        case Gio.FileMonitorEvent.MOVED_OUT:
            return 'rename';
        default:
            return null;
    }
}

interface ChildEntry {
    path: string;
    /** A real directory — a symlink pointing at one is deliberately NOT one (see `_children`). */
    isDirectory: boolean;
}

/**
 * Every `Gio.FileMonitor` behind ONE `fs.watch()` call, and the only place they are
 * created, replaced and disposed.
 *
 * Both entry points delegate here — `FSWatcher` (`fs.watch`) and `watchAsync`
 * (`fs.promises.watch`) — so the non-recursive case is not a second code path that
 * can drift from the recursive one: `recursive: false` is this class holding
 * exactly one monitor.
 */
export class WatchTree {
    /** One monitor per watched directory, keyed by its absolute path. */
    private _monitors = new Map<string, Gio.FileMonitor>();
    private _closed = false;
    private _root: string;
    private _recursive: boolean;
    private _onEvent: (eventType: WatchEventType, filename: string) => void;
    private _onError: (err: unknown) => void;

    constructor(
        rootPath: string,
        recursive: boolean,
        onEvent: (eventType: WatchEventType, filename: string) => void,
        onError: (err: unknown) => void,
    ) {
        this._recursive = recursive;
        this._onEvent = onEvent;
        this._onError = onError;

        const rootFile = Gio.File.new_for_path(rootPath);
        // `g_file_new_for_path()` resolves a relative path against the working
        // directory, so this is the absolute spelling every `relative()` below
        // measures from — the GFiles Gio hands to the 'changed' signal are absolute
        // too, and comparing an absolute path against a relative root yields a
        // filename full of `../`.
        this._root = rootFile.get_path() ?? rootPath;

        // Deliberately NOT caught: `g_file_monitor()` is `throws="1"` and a watch on
        // a path that cannot be monitored has to reach the caller, which is what both
        // entry points already relied on.
        this._open(this._root, rootFile);

        // FOLLOWING flags (`NONE`) on the root and NOFOLLOW on every child, which is
        // Node's split: it reaches the root through `statSync` and each child through
        // a dirent. So `fs.watch(symlinkToProjectDir, { recursive: true })` works,
        // while a symlink INSIDE the tree is reported and not descended.
        if (recursive && rootFile.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
            // `announce: false` — the initial walk is not news. Node's is silent by
            // accident (its emits land before `fs.watch` attaches the listener); ours
            // says so, because `fs.promises.watch` QUEUES events and would otherwise
            // open every recursive iteration with one 'rename' per existing file.
            this._descend(this._root, false);
        }
    }

    close(): void {
        this._closed = true;
        for (const monitor of this._monitors.values()) monitor.cancel();
        this._monitors.clear();
    }

    /** Create the monitor for `path` and wire it up. Throws what `g_file_monitor()` throws. */
    private _open(path: string, file: Gio.File): void {
        // The `Gio.Cancellable` this used to be given cancelled the CREATION of the
        // monitor, never the monitor — measured: after `watcher.close()` cancelled it,
        // a further write still reached the listener. `g_file_monitor_cancel()` is
        // what stops one, and it is not `throws="1"`.
        const monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        monitor.connect(
            'changed',
            (_monitor: Gio.FileMonitor, changed: Gio.File, _other: Gio.File | null, event: Gio.FileMonitorEvent) => {
                this._dispatch(changed, event);
            },
        );
        this._monitors.set(path, monitor);
    }

    private _dispatch(changed: Gio.File, event: Gio.FileMonitorEvent): void {
        // No `this._closed` guard here, deliberately. A cancelled Gio.FileMonitor
        // delivers nothing, so the only case such a check could catch is a monitor that
        // was NOT cancelled — and catching it means HIDING it. Measured: with the guard
        // in place, a `close()` that cancelled only the root monitor still passed the
        // spec that says it cancels every one of them, because the leaked nested
        // monitors were firing and this line was swallowing them. The walk in
        // `_addSubtree` keeps its `_closed` check: that one is our own loop, which GIO
        // does not stop for us.
        //
        // A GFile with no local path (a URI backend) has no name Node could report.
        const path = changed.get_path();
        if (path === null) return;

        const type = gioEventToNodeType(event);
        // Emitted BEFORE the tree is adjusted so a new directory is announced ahead of
        // whatever `_addSubtree` finds inside it, matching Node's order.
        if (type !== null) this._emit(type, path);
        if (!this._recursive) return;

        switch (event) {
            case Gio.FileMonitorEvent.CREATED:
            case Gio.FileMonitorEvent.MOVED_IN:
                // `query_file_type` does not throw (no GError out-parameter); it answers
                // UNKNOWN for a path that has already gone again, which is not a directory
                // and so needs nothing.
                if (changed.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY)
                    this._addSubtree(path);
                break;
            case Gio.FileMonitorEvent.DELETED:
            case Gio.FileMonitorEvent.MOVED_OUT:
                this._dropSubtree(path);
                break;
        }
    }

    private _emit(type: WatchEventType, path: string): void {
        // Node reports a path relative to the watched directory. Without recursion that
        // is indistinguishable from the basename, which is why reporting the basename
        // survived this long; with it, `components/Button.tsx` and `views/Button.tsx`
        // become the same string, and `isSelfWrite()` in the CLI's watch loop — which
        // resolves the reported name against the watched dir — stops being able to tell
        // a source edit from the bundle it just wrote.
        const name = relative(this._root, path);
        // Empty when the root itself is the subject: a watch on a single file, or the
        // watched directory being deleted. Node names it by its basename there.
        this._onEvent(type, name === '' ? basename(path) : name);
    }

    /**
     * Start watching `dir` and everything below it, announcing what is found.
     *
     * The announcement is not decoration: a directory can be created AND filled
     * before this monitor attaches (`mkdir -p src/components && cp Button.tsx
     * src/components/`), and those entries have no CREATED event of their own left to
     * arrive on. Node closes the same window the same way, in `#watchFolder`.
     */
    private _addSubtree(dir: string): void {
        if (this._closed || this._monitors.has(dir)) return;
        try {
            this._open(dir, Gio.File.new_for_path(dir));
        } catch (err: unknown) {
            // Two real failure modes for `g_file_monitor()` here, neither of them a
            // reason to abandon the rest of the tree: the directory can vanish between
            // being seen and being opened, and the inotify backend can run out of
            // watches (ENOSPC) on a tree far larger than a project.
            if (!isNotFoundError(err)) this._onError(err);
            return;
        }
        this._descend(dir, true);
    }

    private _descend(dir: string, announce: boolean): void {
        for (const child of this._children(dir)) {
            if (this._closed) return;
            if (announce) this._emit('rename', child.path);
            if (child.isDirectory) this._addSubtree(child.path);
        }
    }

    /** Drop `dir`'s monitor and every monitor below it. */
    private _dropSubtree(dir: string): void {
        const prefix = dir + sep;
        for (const [path, monitor] of this._monitors) {
            if (path !== dir && !path.startsWith(prefix)) continue;
            monitor.cancel();
            this._monitors.delete(path);
        }
    }

    private _children(dir: string): ChildEntry[] {
        let enumerator: Gio.FileEnumerator;
        try {
            // NOFOLLOW_SYMLINKS is what decides that symlinked directories are NOT
            // followed — with it, a symlink to a directory reports SYMBOLIC_LINK and
            // fails the `isDirectory` test below, so it is watched as an entry of its
            // parent and never descended. Node's recursive watcher makes the same call
            // (`file.isDirectory() && !file.isSymbolicLink()`), and it is what makes a
            // cycle through a symlink structurally impossible rather than something a
            // visited-set has to notice: a `node_modules` full of links back into the
            // workspace would otherwise re-watch the whole repo, once per link.
            enumerator = Gio.File.new_for_path(dir).enumerate_children(
                WALK_ATTRS,
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null,
            );
        } catch (err: unknown) {
            // `g_file_enumerate_children()` is `throws="1"`. A directory that has
            // already been removed is a race, not an error; anything else is the
            // caller's to see.
            if (!isNotFoundError(err)) this._onError(err);
            return [];
        }

        // Drain into an array and CLOSE the enumerator before recursing: unclosed, GJS
        // holds the Gio.FileEnumerator and its dirfd until GC, and a deep walk
        // exhausts the per-process fd limit as EMFILE (the same trap `readdirSync`
        // carries).
        const entries: ChildEntry[] = [];
        try {
            let info = enumerator.next_file(null);
            while (info !== null) {
                entries.push({
                    path: join(dir, info.get_name()),
                    isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
                });
                info = enumerator.next_file(null);
            }
        } catch (err: unknown) {
            // `next_file()` is `throws="1"`; a partial listing is still worth watching.
            if (!isNotFoundError(err)) this._onError(err);
        } finally {
            try {
                enumerator.close(null);
            } catch {
                // GIO sometimes throws on close after iteration completes — non-fatal.
            }
        }
        return entries;
    }
}
