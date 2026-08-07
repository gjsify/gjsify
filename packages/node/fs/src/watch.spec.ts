// oxlint-disable typescript/no-explicit-any -- spec catches errors with catch (e: any) to assert fs.watch error codes and event shape
// Ported from refs/bun/test/js/node/watch/fs.watch.test.ts
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { promises, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// `realpathSync.native`, and BOTH halves of that are load-bearing on Windows.
//
// GitHub's Windows runners hand back an 8.3 SHORT path from `tmpdir()`
// (`C:\Users\RUNNER~1\AppData\Local\Temp`). libuv watches the directory it
// was given, then for each notification builds `dir + "\" + name`, expands it
// with `GetLongPathNameW`, and asserts the expansion still starts with `dir`
// (`uv__relative_path`, `refs/node/deps/uv/src/win/fs-event.c:72`). A short
// component makes the expansion diverge, so the assert fails:
//
//   Assertion failed: !_wcsnicmp(filename, dir, dirlen),
//   file src\win\fs-event.c, line 72          -> exit code 3221226505
//
// That is a hard ABORT, not a failing assertion: it took all 589 specs with it,
// which is also why `it.failing` could not have covered it — nothing survives
// to report a tolerated failure.
//
// Plain `realpathSync` is NOT enough and this was measured: it resolves
// symlinks but does not canonicalise 8.3 names, so the first attempt aborted
// identically. `.native` goes through `GetFinalPathNameByHandle` and returns
// the long form `GetLongPathNameW` will agree with. Our GJS implementation
// aliases `.native` to `realpathSync`, so the spec stays runtime-neutral, and
// the call also resolves `/tmp` -> `/private/tmp` on macOS.
function makeTmp(): string {
    return realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-watch-')));
}

/**
 * Timers a test armed and must not leave running past its own temp directory.
 *
 * Every test here writes into its temp dir from a timer and then removes that
 * dir when it ends, and the abort RACES the timeout by design — so "it will
 * have fired by then" is not a property any of them can rely on. A timer that
 * outlives its test writes into a path that no longer exists, and the ENOENT
 * surfaces against whichever test happens to be running when it fires: on
 * darwin a `tracked.txt` write armed by `filename in event is a string or null`
 * failed `stops cleanly when AbortController is aborted during iteration`.
 *
 * Four timers were armed and never cancelled. Rather than four clears, the
 * timer and the directory it writes into get ONE owner — {@link scheduleWrite}
 * arms, {@link cleanup} cancels and removes, and a test cannot do the second
 * without the first.
 */
const pendingWrites = new Set<ReturnType<typeof setTimeout>>();

/** Schedule `write` once, `ms` from now, and remember it until it fires. */
function scheduleWrite(write: () => void, ms: number): void {
    const id = setTimeout(() => {
        pendingWrites.delete(id);
        write();
    }, ms);
    pendingWrites.add(id);
}

/** Cancel anything still armed, THEN remove the directory it would write into. */
function cleanup(tmp: string): void {
    for (const id of pendingWrites) clearTimeout(id);
    pendingWrites.clear();
    rmSync(tmp, { recursive: true, force: true });
}

export default async () => {
    await describe('fs.promises.watch', async () => {
        await it('yields rename event when a file is created in a directory', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            let received = false;

            // Write the file shortly after the iterator starts waiting
            scheduleWrite(() => {
                writeFileSync(join(tmp, 'new-file.txt'), 'hello');
            }, 30);

            try {
                for await (const event of promises.watch(tmp, { signal: ac.signal })) {
                    expect(typeof event.eventType).toBe('string');
                    expect(['rename', 'change']).toContain(event.eventType);
                    received = true;
                    ac.abort();
                }
            } catch (e: any) {
                // AbortError from native Node.js is expected — our impl ends cleanly
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            }

            expect(received).toBe(true);
            cleanup(tmp);
        });

        await it('yields change event when a watched file is modified', async () => {
            const tmp = makeTmp();
            const file = join(tmp, 'watch-me.txt');
            writeFileSync(file, 'initial');

            const ac = new AbortController();
            let received = false;

            scheduleWrite(() => {
                writeFileSync(file, 'modified');
            }, 30);

            try {
                for await (const event of promises.watch(file, { signal: ac.signal })) {
                    expect(typeof event.eventType).toBe('string');
                    expect(['rename', 'change']).toContain(event.eventType);
                    received = true;
                    ac.abort();
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            }

            expect(received).toBe(true);
            cleanup(tmp);
        });

        await it('filename in event is a string or null', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            let filename: string | null | undefined = undefined;

            scheduleWrite(() => {
                writeFileSync(join(tmp, 'tracked.txt'), 'x');
            }, 30);

            try {
                for await (const event of promises.watch(tmp, { signal: ac.signal })) {
                    filename = event.filename;
                    ac.abort();
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            }

            // filename is a string basename or null (GJS writeFileSync uses atomic writes
            // via GLib.file_set_contents which may report a temp filename — any string is valid)
            expect(typeof filename === 'string' || filename === null).toBe(true);
            cleanup(tmp);
        });

        await it('stops iterating immediately when signal is pre-aborted', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            ac.abort(); // aborted BEFORE the watch starts

            let count = 0;
            try {
                for await (const _ of promises.watch(tmp, { signal: ac.signal })) {
                    count++;
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            }

            expect(count).toBe(0);
            cleanup(tmp);
        });

        await it('stops cleanly when AbortController is aborted during iteration', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            let eventCount = 0;

            // Write repeatedly so events keep coming
            const interval = setInterval(() => {
                writeFileSync(join(tmp, 'file.txt'), String(Date.now()));
            }, 20);

            try {
                for await (const event of promises.watch(tmp, { signal: ac.signal })) {
                    expect(['rename', 'change']).toContain(event.eventType);
                    eventCount++;
                    if (eventCount >= 2) {
                        clearInterval(interval);
                        ac.abort();
                    }
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            } finally {
                clearInterval(interval);
            }

            expect(eventCount).toBeGreaterThan(0);
            cleanup(tmp);
        });

        await it('multiple events can be collected before abort', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            const events: string[] = [];

            scheduleWrite(() => {
                writeFileSync(join(tmp, 'a.txt'), '1');
                writeFileSync(join(tmp, 'b.txt'), '2');
            }, 30);

            try {
                for await (const event of promises.watch(tmp, { signal: ac.signal })) {
                    events.push(event.eventType);
                    if (events.length >= 2) {
                        ac.abort();
                    }
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            }

            expect(events.length).toBeGreaterThan(0);
            cleanup(tmp);
        });
    });
};
