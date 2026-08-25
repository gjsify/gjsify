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
//
// ═══ WHAT A GIO DIRECTORY MONITOR DOES NOT TELL YOU ON macOS ═══
//
// A directory monitor reports a write to one of its children on some backends
// and not on others, and that is the fact most likely to be rediscovered at 2am.
// Measured on the two macOS CI legs (PR #1300) through a raw `Gio.FileMonitor`
// with none of our mapping in the way — `watch-backend.gjs.spec.ts` is that
// probe, and it stays in the suite so the answer is re-measured rather than
// remembered:
//
//   monitor on a DIRECTORY, child CREATED     CREATED           linux ✔  darwin ✔
//   monitor on a DIRECTORY, child WRITTEN     CHANGED           linux ✔  darwin ✘
//   monitor on a SUBdirectory, child WRITTEN  CHANGED           linux ✔  darwin ✘
//   monitor on the FILE, that file WRITTEN    CHANGED           linux ✔  darwin ✔
//
// On darwin GLib serves `g_file_monitor()` from kqueue, and that is kqueue's
// shape: `NOTE_WRITE` fires on a DIRECTORY vnode when an entry is added or
// removed, not when a write lands inside an existing child, while a watch on the
// child has its own vnode to fire on. So the missing event exists — it is just
// only reachable through a monitor on the file.
//
// Hence the fan-out below: on such a host every FILE gets a monitor of its own,
// layered on the per-directory monitors that already deliver create and delete
// correctly there. Two consequences a consumer should know:
//
//   1. This is NOT a recursion feature on darwin. A FLAT `fs.watch(dir, cb)`
//      needs it too: without a monitor of its own, `dir/config.json` being
//      rewritten in place produces no event whatsoever. Node has no such split
//      because libuv uses FSEvents there, which is file-granular and recursive
//      in one stream.
//   2. It costs a kernel file descriptor per watched file, where Node's FSEvents
//      stream costs one for the whole tree — which is what MONITOR_BUDGET below
//      is about.

import Gio from '@girs/gio-2.0';
import { isDarwin } from '@gjsify/utils/core';
import { basename, join, relative, sep } from 'node:path';
import { isNotFoundError } from './errors.js';

/** The two event names Node's `fs.watch` listener signature discriminates on. */
export type WatchEventType = 'rename' | 'change';

/** The walk needs each entry's name and whether it is a directory it may descend. */
const WALK_ATTRS = 'standard::name,standard::type';

/**
 * How many `Gio.FileMonitor`s ONE `fs.watch()` may hold on a host where each one
 * costs a kernel file descriptor.
 *
 * WHY A BOUND EXISTS AT ALL — it is attributability, not timidity.
 *
 * An unbounded fan-out does not announce itself when it exhausts the process
 * descriptor table. It announces itself somewhere else entirely: the next
 * `open()` ANYWHERE in the process fails, and the error surfaces on whatever
 * code happened to need a descriptor next — a config read, a log write, a socket
 * accept — so the stack trace does not contain the word `watch`. A bound that
 * raises an `error` event naming the limit and the path it could not attach to
 * puts the failure on the component that caused it instead. The same geometry
 * applies to teardown, which is why `close()` releasing the fan-out is asserted
 * against a DESCRIPTOR COUNT in `watch-cost.gjs.spec.ts` and not only against an
 * event that stops arriving: a leak would also fail later, in someone else's
 * `open()`, on the platform with the lowest ceiling.
 *
 * WHY THE DEFAULT IS PER-HOST, AND WHY IT IS NOT A NUMBER IN THIS COMMENT.
 *
 * Where a directory monitor reports child writes there is no fan-out, and the
 * per-directory cost was measured at one inotify watch descriptor per directory
 * against a `max_user_watches` of 131041 — a real project spends 0.03% of it, so
 * a bound would only ever be a new way to fail. `g_file_monitor()` raising
 * ENOSPC there already reaches the caller as an `error` event, which is the same
 * shape this budget takes. Hence `Number.POSITIVE_INFINITY`: an honest "this
 * host has no bound of ours", rather than a large number that reads as one.
 *
 * On a fan-out host the ceiling is `RLIMIT_NOFILE`, which is a property of the
 * PROCESS, not of this file — macOS ships a low soft limit and a caller may have
 * raised it. `watch-cost.gjs.spec.ts` measures the running host's limit and the
 * descriptors one watch actually spends, and prints both on every GJS run, so
 * the number below is checkable against the machine instead of against a comment
 * that has drifted.
 */
const DARWIN_MONITOR_BUDGET = 96;

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
    /** A real regular file — a symlink pointing at one is deliberately NOT one either. */
    isFile: boolean;
}

/**
 * The two host-derived decisions, made overridable so their own behaviour can be
 * exercised anywhere.
 *
 * Not configuration: nothing outside this package's own specs passes either one.
 * They exist because both defaults are decided by the HOST, and a mechanism that
 * only runs on the one host CI has least of is a mechanism measured once. With
 * `fanOut` forced on, a Linux run exercises attach, re-attach and disposal of the
 * per-file monitors — the half of `close()` that a darwin-only path would leave
 * to a single leg; with `budget` set low, every run exercises the refusal and the
 * error it raises.
 */
export interface WatchTreeOverrides {
    /** Give every FILE its own monitor, not only every directory (see the header). */
    fanOut?: boolean;
    /** How many monitors this watch may hold before it refuses, loudly. */
    budget?: number;
}

/**
 * Every `Gio.FileMonitor` behind ONE `fs.watch()` call, and the only place they are
 * created, replaced and disposed.
 *
 * Both entry points delegate here — `FSWatcher` (`fs.watch`) and `watchAsync`
 * (`fs.promises.watch`) — so the non-recursive case is not a second code path that
 * can drift from the recursive one: `recursive: false` is this class holding
 * exactly one directory monitor, plus the per-file fan-out where the host needs it.
 */
export class WatchTree {
    /** One monitor per watched directory, keyed by its absolute path. */
    private _monitors = new Map<string, Gio.FileMonitor>();
    /** The fan-out: one monitor per watched FILE. Empty where the host needs none. */
    private _fileMonitors = new Map<string, Gio.FileMonitor>();
    private _closed = false;
    private _root: string;
    private _recursive: boolean;
    /** Does a directory monitor on this host miss writes to its children? (header) */
    private _fanOut: boolean;
    private _budget: number;
    /** The budget is announced ONCE — see `_refuseAttach`. */
    private _budgetReported = false;
    private _onEvent: (eventType: WatchEventType, filename: string) => void;
    private _onError: (err: unknown) => void;

    constructor(
        rootPath: string,
        recursive: boolean,
        onEvent: (eventType: WatchEventType, filename: string) => void,
        onError: (err: unknown) => void,
        overrides?: WatchTreeOverrides,
    ) {
        this._recursive = recursive;
        this._onEvent = onEvent;
        this._onError = onError;
        // The OS decision goes through `@gjsify/utils`' one detector (ADR 0018),
        // never a local `process.platform` read; `package.json#gjsify.os` carries
        // the matching claim.
        this._fanOut = overrides?.fanOut ?? isDarwin();
        this._budget = overrides?.budget ?? (this._fanOut ? DARWIN_MONITOR_BUDGET : Number.POSITIVE_INFINITY);

        const rootFile = Gio.File.new_for_path(rootPath);
        // `g_file_new_for_path()` resolves a relative path against the working
        // directory, so this is the absolute spelling every `relative()` below
        // measures from — the GFiles Gio hands to the 'changed' signal are absolute
        // too, and comparing an absolute path against a relative root yields a
        // filename full of `../`.
        this._root = rootFile.get_path() ?? rootPath;

        // Deliberately NOT caught: `g_file_monitor()` is `throws="1"` and a watch on
        // a path that cannot be monitored has to reach the caller, which is what both
        // entry points already relied on. The root is also exempt from the budget: a
        // watch that attaches nothing at all is not a degraded watch, it is a broken
        // one, and it would report its own failure through this same throw.
        this._open(this._root, rootFile);

        // FOLLOWING flags (`NONE`) on the root and NOFOLLOW on every child, which is
        // Node's split: it reaches the root through `statSync` and each child through
        // a dirent. So `fs.watch(symlinkToProjectDir, { recursive: true })` works,
        // while a symlink INSIDE the tree is reported and not descended.
        const rootIsDirectory = rootFile.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY;
        // The walk is what the fan-out needs even without recursion: on a host whose
        // directory monitor misses child writes, a flat watch that does not walk its
        // own directory reports nothing for `dir/config.json` being rewritten.
        if (rootIsDirectory && (recursive || this._fanOut)) {
            // `announce: false` — the initial walk is not news, at ANY depth. Node's
            // is silent by accident (its emits land before `fs.watch` attaches the
            // listener); ours says so, because `fs.promises.watch` QUEUES events and
            // would otherwise open every recursive iteration with one 'rename' per
            // existing file. Announcing was once threaded only through the root's own
            // children, which left every deeper level announcing itself and made the
            // `fs.promises.watch` recursion test pass on the startup walk rather than
            // on the event it names.
            this._descend(this._root, false);
        }
    }

    /**
     * How many monitors this watch holds — what the budget counts, and what
     * `close()` has to bring back to zero.
     */
    get monitorCount(): number {
        return this._monitors.size + this._fileMonitors.size;
    }

    close(): void {
        this._closed = true;
        for (const monitor of this._monitors.values()) monitor.cancel();
        this._monitors.clear();
        for (const monitor of this._fileMonitors.values()) monitor.cancel();
        this._fileMonitors.clear();
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

    /**
     * Attach the fan-out monitor for one FILE.
     *
     * It reports ONLY modifications, because a create and a delete are the half a
     * directory monitor does deliver on every backend measured here — mapping them
     * a second time would emit each of them twice. The case that is neither, and
     * is an open question rather than a measurement, is an editor's atomic
     * same-name replace: `watch-backend.gjs.spec.ts` records what each monitor
     * shape sees of one, and if darwin turns out to report it through neither,
     * this monitor has to re-arm itself on DELETED.
     */
    private _watchFile(path: string): void {
        if (this._closed || this._fileMonitors.has(path)) return;
        if (!this._admit(path)) return;
        let monitor: Gio.FileMonitor;
        try {
            monitor = Gio.File.new_for_path(path).monitor(Gio.FileMonitorFlags.NONE, null);
        } catch (err: unknown) {
            // Same two real failure modes as a directory monitor: the file can vanish
            // between being seen and being opened, and the backend can run out of
            // kernel watches. Neither is a reason to abandon the rest of the tree.
            if (!isNotFoundError(err)) this._onError(err);
            return;
        }
        monitor.connect(
            'changed',
            (_monitor: Gio.FileMonitor, changed: Gio.File, _other: Gio.File | null, event: Gio.FileMonitorEvent) => {
                if (gioEventToNodeType(event) !== 'change') return;
                const changedPath = changed.get_path();
                if (changedPath !== null) this._emit('change', changedPath);
            },
        );
        this._fileMonitors.set(path, monitor);
    }

    /**
     * Is there budget left for one more monitor? Refuses LOUDLY when there is not.
     *
     * Announced once per watch, not once per path: past the limit every remaining
     * entry raises the same fact, and a storm of them is another way to be unread.
     * The one error that is raised says the watch is incomplete from here on, which
     * is what a consumer has to act on.
     */
    private _admit(path: string): boolean {
        if (this.monitorCount < this._budget) return true;
        if (this._budgetReported) return false;
        this._budgetReported = true;
        const err: Error & { code?: string; path?: string } = new Error(
            `fs.watch: this watch holds its whole budget of ${this._budget} monitors and stopped at ${path}. ` +
                `Anything under ${this._root} that is not already attached is NOT being watched, and no further ` +
                `event will arrive for it. The budget is finite because a monitor costs a kernel file descriptor ` +
                `on the hosts that need one per file, and spending the process's descriptor table surfaces as an ` +
                `unrelated open() failing elsewhere, in a trace that never mentions fs.watch. Watch a narrower ` +
                `directory, or raise the process RLIMIT_NOFILE and the budget with it.`,
        );
        err.code = 'ERR_FS_WATCH_MONITOR_BUDGET';
        err.path = path;
        this._onError(err);
        return false;
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
        // A flat watch on a host that needs no fan-out holds exactly one monitor and
        // has no tree to keep in step — leaving early here is what keeps that case
        // byte-for-byte what it was before the fan-out existed.
        if (!this._recursive && !this._fanOut) return;

        switch (event) {
            case Gio.FileMonitorEvent.CREATED:
            case Gio.FileMonitorEvent.MOVED_IN: {
                // `query_file_type` does not throw (no GError out-parameter); it answers
                // UNKNOWN for a path that has already gone again, which is neither a
                // directory nor a file and so needs nothing.
                const kind = changed.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                if (kind === Gio.FileType.DIRECTORY) {
                    if (this._recursive) this._addSubtree(path, true);
                } else if (this._fanOut && kind === Gio.FileType.REGULAR) {
                    // The directory monitor announcing a new child is what makes the
                    // fan-out grow event-driven rather than by re-walking: creates DO
                    // arrive on every backend, so the file can be attached here, at the
                    // moment it appears.
                    this._watchFile(path);
                }
                break;
            }
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
     * Start watching `dir` and everything below it, announcing what is found when
     * `announce` says this subtree is NEW.
     *
     * The announcement is not decoration: a directory can be created AND filled
     * before this monitor attaches (`mkdir -p src/components && cp Button.tsx
     * src/components/`), and those entries have no CREATED event of their own left to
     * arrive on. Node closes the same window the same way, in `#watchFolder`. The
     * startup walk passes `false` all the way down, because nothing that already
     * existed when the watch began is news.
     */
    private _addSubtree(dir: string, announce: boolean): void {
        if (this._closed || this._monitors.has(dir)) return;
        if (!this._admit(dir)) return;
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
        this._descend(dir, announce);
    }

    private _descend(dir: string, announce: boolean): void {
        for (const child of this._children(dir)) {
            if (this._closed) return;
            if (child.isDirectory) {
                // A non-recursive watch walks its own directory only for the fan-out,
                // and must not follow it down: the whole point of the control test is
                // that nothing inside `sub/` is ever named.
                if (!this._recursive) continue;
                if (announce) this._emit('rename', child.path);
                this._addSubtree(child.path, announce);
            } else {
                if (announce) this._emit('rename', child.path);
                if (this._fanOut && child.isFile) this._watchFile(child.path);
            }
        }
    }

    /** Drop the monitors for `path`, whether it is a watched file or a whole subtree. */
    private _dropSubtree(path: string): void {
        this._fileMonitors.get(path)?.cancel();
        this._fileMonitors.delete(path);
        const prefix = path + sep;
        for (const [file, monitor] of this._fileMonitors) {
            if (!file.startsWith(prefix)) continue;
            monitor.cancel();
            this._fileMonitors.delete(file);
        }
        for (const [dir, monitor] of this._monitors) {
            if (dir !== path && !dir.startsWith(prefix)) continue;
            monitor.cancel();
            this._monitors.delete(dir);
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
            // workspace would otherwise re-watch the whole repo, once per link. The
            // fan-out inherits that: `isFile` is REGULAR, so a symlink to a file is not
            // given a monitor of its own either.
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
                const type = info.get_file_type();
                entries.push({
                    path: join(dir, info.get_name()),
                    isDirectory: type === Gio.FileType.DIRECTORY,
                    isFile: type === Gio.FileType.REGULAR,
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
