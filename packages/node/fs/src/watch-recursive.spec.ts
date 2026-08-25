// `fs.watch(dir, { recursive: true })` and the filename shape that comes with it.
//
// The contract asserted here was measured against node v24.19.0 on Linux, where
// `recursive` is served by `lib/internal/fs/recursive_watch.js` because inotify
// has no recursive mode — the same position GIO leaves us in. What Node emits for
// a change to `sub/deep/a.txt` under a watch on `sub`'s parent is
// ('change', 'sub/deep/a.txt'): the eventType, and a path relative to the WATCHED
// directory rather than a basename.
//
// The control at the end is what keeps the rest from passing vacuously: an
// implementation that watched everything unconditionally would satisfy every
// positive assertion above it. It asserts exactly one thing, that a non-recursive
// watch names nothing INSIDE the nested directory, and that precision was paid for.
//
// The first spelling asserted that no reported filename STARTS WITH `sub`, which
// also matches the directory `sub` itself. The darwin and win32 Node legs went red
// on it while Linux stayed green (PR #1300), and it reads like a platform difference
// in what `recursive` controls. It is not one: libuv drops nested paths on both.
//
//   darwin — the FSEvents stream is created with kFSEventStreamCreateFlagFileEvents
//     so paths arrive file-granular, and `uv__fsevents_event_cb` then skips any path
//     carrying a further '/' after the watched-dir prefix unless
//     UV_FS_EVENT_RECURSIVE is set (libuv 1.52.1, src/unix/fsevents.c:295-300).
//   win32 — `ReadDirectoryChangesW` is called with bWatchSubtree = FALSE without
//     that flag, so the subtree is never reported at all (src/win/fs-event.c:46).
//
// What DOES differ between the backends is the containing DIRECTORY. Writing
// `sub/a.txt` updates `sub`'s own mtime, and FSEvents and ReadDirectoryChangesW
// (which libuv arms with FILE_NOTIFY_CHANGE_LAST_WRITE) both surface that as a
// change to the direct child `sub`, where inotify does not: IN_MODIFY on
// `sub/a.txt` reaches a watch on `sub` and never one on its parent. That is a
// property of the notification backend, the same question on either side of the
// runtime split rather than Node against us, and nothing here asserts it in either
// direction.

import { describe, it, expect } from '@gjsify/unit';
import { promises, watch, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

/** See the note in `watch.spec.ts`: `.native` is what makes this safe on Windows and macOS. */
function makeTmp(): string {
    return realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-rwatch-')));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough for the monitors to be live before the test writes anything. */
const ARM_MS = 60;

/**
 * Long enough for a backend's own event horizon to move past a tree that was just
 * built, before a watch over it is opened. See the startup-silence row.
 */
const TREE_SETTLE_MS = 1200;

/** A filesystem event as the `fs.watch` listener receives it. */
type Seen = [eventType: string, filename: string | null];

/**
 * Poll until some recorded event satisfies `match`, or the window closes.
 *
 * Returns a boolean rather than throwing so the negative cases can use the same
 * helper: "did this arrive" and "did this stay away" are the same question.
 *
 * The window has to stay well inside `@gjsify/unit`'s 5 s per-test timeout, fixed
 * sleeps included: a wait that outlasts it turns a precise "expected true, got
 * false" into a bare Timeout that names nothing. Measured, a nested event lands in
 * ~100 ms on both runtimes.
 */
async function sawEvent(events: Seen[], match: (event: Seen) => boolean, timeoutMs = 2500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (events.some(match)) return true;
        if (Date.now() > deadline) return false;
        await sleep(25);
    }
}

const named =
    (filename: string) =>
    ([, name]: Seen): boolean =>
        name === filename;

/** Every event that arrived, for a failure message that can be acted on. */
function describeEvents(events: Seen[]): string {
    if (events.length === 0) return '(no events at all)';
    return events.map(([type, name]) => `${type} ${name}`).join(', ');
}

/**
 * Wait for an event named `filename`; return `''` when it arrives and a description
 * of what arrived instead when it does not.
 *
 * Compared as a STRING rather than a boolean so a failure can be diagnosed from the
 * log alone. `Expected: true, Actual: false` cannot distinguish "nothing arrived",
 * "something arrived under a different name" and "the watch was never live", and
 * those are three different bugs. The darwin GJS leg needed exactly that distinction
 * and a boolean could not give it: four rows failed identically while the create and
 * delete rows beside them passed, and only the event dump says why.
 */
async function eventNamed(events: Seen[], filename: string): Promise<string> {
    if (await sawEvent(events, named(filename))) return '';
    return `expected an event named "${filename}", saw: ${describeEvents(events)}`;
}

/**
 * Did this event name something INSIDE `sub`, under either spelling a leak takes?
 *
 * `sub/a.txt` is the relative path a recursive watch reports. A bare `a.txt` is the
 * same leak arriving under a filename contract that has regressed to a basename, and
 * no file of that name exists at the top level, so it cannot turn up legitimately.
 * The directory entry `sub` is deliberately NOT matched: see the header.
 */
function namesSomethingInsideSub([, name]: Seen): boolean {
    if (name === null) return false;
    return name === 'a.txt' || name.startsWith(`sub${sep}`);
}

export default async () => {
    await describe('fs.watch — recursive', async () => {
        await it('reports a change to a file in a nested directory', async () => {
            const tmp = makeTmp();
            const nested = join(tmp, 'sub', 'deep');
            mkdirSync(nested, { recursive: true });
            const target = join(nested, 'a.txt');
            writeFileSync(target, 'one');

            const events: Seen[] = [];
            const watcher = watch(tmp, { recursive: true }, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                writeFileSync(target, 'two');
                expect(await eventNamed(events, join('sub', 'deep', 'a.txt'))).toBe('');
            } finally {
                watcher.close();
                rmSync(tmp, { recursive: true, force: true });
            }
        });

        await it('says nothing about a tree that already existed when it started', async () => {
            // The recursion has to walk the tree to attach to it, and that walk must not
            // be mistaken for news.
            //
            // THE ITERATOR FORM, and that is load-bearing rather than a preference. A
            // startup announcement is emitted from inside the WatchTree constructor,
            // which `new FSWatcher()` runs BEFORE it attaches the listener — so the
            // callback form cannot observe one at all, and a version of this row written
            // against `watch(dir, cb)` stayed green with the bug deliberately restored.
            // `fs.promises.watch` QUEUES its events, so the queue is exactly where a
            // startup announcement shows up, and it is where a consumer would have met
            // one: an iteration over a source tree opened with a 'rename' per nested
            // file, none of which had happened.
            //
            // Measured: announcing was threaded only through the ROOT's own children, so
            // every level below them announced itself — and the spec that names a nested
            // write was satisfied by that announcement rather than by the event it is
            // about, which is a test passing for the wrong reason on every platform at
            // once. Node is silent here by accident (its emits land before `fs.watch`
            // returns), so this row is a contract test rather than a note about ours.
            const tmp = makeTmp();
            const nested = join(tmp, 'sub', 'deep');
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(tmp, 'top.txt'), 'one');
            writeFileSync(join(tmp, 'sub', 'a.txt'), 'one');
            const target = join(nested, 'b.txt');
            writeFileSync(target, 'one');
            // SETTLE BEFORE THE WATCH STARTS, and this is not padding.
            //
            // Measured on darwin (PR #1300): Node's own recursive watcher yielded
            // `rename <tmpdir>, rename sub, rename sub/deep, rename top.txt,
            // rename sub/a.txt, rename sub/deep/b.txt` — the tree built immediately
            // above, in the exact order it was BUILT, the temp directory's own
            // creation included. A startup walk cannot produce that order (it would
            // list `sub` and `top.txt` together, and never name the root); FSEvents
            // replaying its recent history can, because libuv arms the stream with
            // kFSEventStreamEventIdSinceNow and the kernel's horizon reaches back
            // past that instant. inotify has no such window, which is why Linux
            // never showed it. So the noise is about files created microseconds
            // before the watch, not about the watch announcing what it found, and
            // waiting separates the two instead of weakening the assertion.
            await sleep(TREE_SETTLE_MS);

            const ac = new AbortController();
            const yielded: Seen[] = [];
            const iteration = (async () => {
                try {
                    for await (const event of promises.watch(tmp, { recursive: true, signal: ac.signal })) {
                        yielded.push([event.eventType, event.filename]);
                    }
                } catch (err: unknown) {
                    const e = err as { name?: string; code?: string };
                    if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw err;
                }
            })();

            try {
                // Well past the ~100 ms a real nested event takes to land, so this is a
                // silence that was waited for rather than one that was raced.
                await sleep(600);
                const beforeAnythingHappened = describeEvents(yielded);

                // The positive control: without it, "the queue was empty" is also what a
                // watch that never armed would report.
                writeFileSync(target, 'two');
                const arrived = await eventNamed(yielded, join('sub', 'deep', 'b.txt'));

                expect(beforeAnythingHappened).toBe('(no events at all)');
                expect(arrived).toBe('');
            } finally {
                ac.abort();
                await iteration;
                rmSync(tmp, { recursive: true, force: true });
            }
            // The settle, the silence window and the positive control's own wait add
            // up past the 5 s default, and a row that runs out of time reports a bare
            // Timeout naming nothing instead of the event dump this one exists for.
        }, 8000);

        await it('watches a directory that is created after the watch started', async () => {
            const tmp = makeTmp();
            const events: Seen[] = [];
            const watcher = watch(tmp, { recursive: true }, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                mkdirSync(join(tmp, 'late'));
                // The new directory being REPORTED is not the point and would be true of
                // a flat monitor too; waiting for it here only establishes that the
                // watcher has had its chance to start monitoring it.
                expect(await eventNamed(events, 'late')).toBe('');
                events.length = 0;

                writeFileSync(join(tmp, 'late', 'b.txt'), 'hello');
                expect(await eventNamed(events, join('late', 'b.txt'))).toBe('');
            } finally {
                watcher.close();
                rmSync(tmp, { recursive: true, force: true });
            }
        });

        await it('names the file relative to the watched directory, not by its basename', async () => {
            const tmp = makeTmp();
            mkdirSync(join(tmp, 'x'), { recursive: true });
            mkdirSync(join(tmp, 'y'), { recursive: true });
            writeFileSync(join(tmp, 'x', 'dup.txt'), 'one');
            writeFileSync(join(tmp, 'y', 'dup.txt'), 'one');

            const events: Seen[] = [];
            const watcher = watch(tmp, { recursive: true }, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                writeFileSync(join(tmp, 'x', 'dup.txt'), 'two');
                expect(await eventNamed(events, join('x', 'dup.txt'))).toBe('');
                // The two files are the same string once reduced to a basename, so a
                // consumer resolving the reported name against the watched directory —
                // `isSelfWrite()` in the CLI's watch loop does exactly that — would act on
                // the wrong file.
                expect(
                    events
                        .filter(named('dup.txt'))
                        .map(([type]) => type)
                        .join(', '),
                ).toBe('');

                events.length = 0;
                writeFileSync(join(tmp, 'y', 'dup.txt'), 'two');
                expect(await eventNamed(events, join('y', 'dup.txt'))).toBe('');
            } finally {
                watcher.close();
                rmSync(tmp, { recursive: true, force: true });
            }
        });

        await it('re-watches a nested directory that was deleted and created again', async () => {
            const tmp = makeTmp();
            const nested = join(tmp, 'sub');
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(nested, 'a.txt'), 'one');

            const events: Seen[] = [];
            const watcher = watch(tmp, { recursive: true }, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                rmSync(nested, { recursive: true, force: true });
                expect(await eventNamed(events, 'sub')).toBe('');
                events.length = 0;

                mkdirSync(nested);
                expect(await eventNamed(events, 'sub')).toBe('');
                events.length = 0;

                writeFileSync(join(nested, 'c.txt'), 'x');
                // This is what makes "dispose the monitors of a deleted directory" an
                // observable requirement rather than a resource-hygiene footnote: a
                // monitor left behind still occupies this path, so the directory that
                // now exists under it never gets one, and the write below reaches
                // nothing at all.
                expect(await eventNamed(events, join('sub', 'c.txt'))).toBe('');
            } finally {
                watcher.close();
                rmSync(tmp, { recursive: true, force: true });
            }
        });

        await it('close() stops the nested monitors, not only the root one', async () => {
            const tmp = makeTmp();
            const nested = join(tmp, 'sub');
            mkdirSync(nested, { recursive: true });
            const target = join(nested, 'a.txt');
            writeFileSync(target, 'one');

            const events: Seen[] = [];
            const watcher = watch(tmp, { recursive: true }, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                writeFileSync(target, 'two');
                expect(await eventNamed(events, join('sub', 'a.txt'))).toBe('');
            } finally {
                watcher.close();
            }

            // Whatever was already in flight lands inside this window; anything after it
            // is a monitor that outlived close().
            await sleep(250);
            events.length = 0;
            writeFileSync(target, 'three');
            writeFileSync(join(tmp, 'top.txt'), 'x');
            await sleep(600);
            expect(describeEvents(events)).toBe('(no events at all)');
            rmSync(tmp, { recursive: true, force: true });
        });

        await it('does not see nested changes without recursive', async () => {
            const tmp = makeTmp();
            const nested = join(tmp, 'sub');
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(nested, 'a.txt'), 'one');
            const top = join(tmp, 'top.txt');
            writeFileSync(top, 'one');

            const events: Seen[] = [];
            // Two arguments, the way Node documents the default: no options object at
            // all, so `recursive` is absent rather than false.
            const watcher = watch(tmp, (eventType, filename) => {
                events.push([eventType, filename]);
            });
            try {
                await sleep(ARM_MS);
                writeFileSync(join(nested, 'a.txt'), 'two');
                writeFileSync(top, 'two');
                // The top-level write is the positive control: without it, "saw nothing
                // nested" is also what a watcher that never armed at all would report.
                expect(await eventNamed(events, 'top.txt')).toBe('');
                await sleep(500);
                // Compared as a STRING so a failure NAMES what leaked. The first
                // spelling was `events.some(...)` against a boolean, and when it went
                // red on darwin and win32 all it could say was `Expected: false,
                // Actual: true` — which is how a mis-scoped predicate got read as a
                // platform difference for a whole CI round.
                const leaked = events.filter(namesSomethingInsideSub).map(([type, name]) => `${type} ${name}`);
                expect(leaked.join(', ')).toBe('');
            } finally {
                watcher.close();
                rmSync(tmp, { recursive: true, force: true });
            }
        });
    });

    await describe('fs.promises.watch — recursive', async () => {
        await it('yields an event for a nested file, named relative to the watched directory', async () => {
            const tmp = makeTmp();
            const nested = join(tmp, 'sub');
            mkdirSync(nested, { recursive: true });
            const target = join(nested, 'a.txt');
            writeFileSync(target, 'one');

            const ac = new AbortController();
            // The iterator blocks forever on an implementation that never yields the
            // nested event, and a hung suite reports nothing at all.
            const bail = setTimeout(() => ac.abort(), 2500);
            let seen = false;
            const yielded: string[] = [];
            const write = sleep(ARM_MS * 2).then(() => {
                writeFileSync(target, 'two');
            });

            try {
                for await (const event of promises.watch(tmp, { recursive: true, signal: ac.signal })) {
                    yielded.push(`${event.eventType} ${event.filename}`);
                    if (event.filename === join('sub', 'a.txt')) {
                        seen = true;
                        ac.abort();
                    }
                }
            } catch (err: unknown) {
                const e = err as { name?: string; code?: string };
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw err;
            } finally {
                clearTimeout(bail);
                await write;
            }

            expect(
                seen ? '' : `no event named "${join('sub', 'a.txt')}"; saw: ${yielded.join(', ') || '(nothing)'}`,
            ).toBe('');
            rmSync(tmp, { recursive: true, force: true });
        });
    });
};
