// oxlint-disable typescript/no-explicit-any -- spec catches errors with catch (e: any) to assert fs.watch error codes and event shape
// Ported from refs/bun/test/js/node/watch/fs.watch.test.ts
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { promises, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmp(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-watch-'));
}

// WHY EVERY DEFERRED WRITE BELOW IS CANCELLED IN A `finally`.
//
// These tests arm a timer that writes into the temp dir, then stop iterating as
// soon as ONE event arrives and remove the dir. If the timer is still pending at
// that point it fires into a directory that no longer exists, and the
// `ENOENT: … open '…/gjsify-watch-XXXX/new-file.txt'` surfaces as an unhandled
// error inside whichever test happens to be running next — so the failure is
// reported against an innocent neighbour.
//
// On Linux the timer cannot outlive its test: inotify only has an event to
// deliver BECAUSE the write happened, so the write always precedes the abort.
// On darwin the watcher can yield before that write lands, the test finishes
// early, and the orphan timer then throws. Measured on the macOS arm64 leg:
// 2 of 671, and neither was in the test that owned the timer
// (`fs.promises.watch` rename → reported against "change", abort-during-
// iteration → reported against the abort test).
//
// `stops cleanly when AbortController is aborted during iteration` already had
// this right with `clearInterval` in a `finally`; the four `setTimeout` cases
// did not. Cancel the timer, do not make the write defensive — a write that
// silently tolerates a missing directory would hide a real teardown bug.

export default async () => {
    await describe('fs.promises.watch', async () => {
        await it('yields rename event when a file is created in a directory', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            let received = false;

            // Write the file shortly after the iterator starts waiting
            const timer = setTimeout(() => {
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
            } finally {
                clearTimeout(timer);
            }

            expect(received).toBe(true);
            rmSync(tmp, { recursive: true, force: true });
        });

        await it('yields change event when a watched file is modified', async () => {
            const tmp = makeTmp();
            const file = join(tmp, 'watch-me.txt');
            writeFileSync(file, 'initial');

            const ac = new AbortController();
            let received = false;

            const timer = setTimeout(() => {
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
            } finally {
                clearTimeout(timer);
            }

            expect(received).toBe(true);
            rmSync(tmp, { recursive: true, force: true });
        });

        await it('filename in event is a string or null', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            let filename: string | null | undefined = undefined;

            const timer = setTimeout(() => {
                writeFileSync(join(tmp, 'tracked.txt'), 'x');
            }, 30);

            try {
                for await (const event of promises.watch(tmp, { signal: ac.signal })) {
                    filename = event.filename;
                    ac.abort();
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
            } finally {
                clearTimeout(timer);
            }

            // filename is a string basename or null (GJS writeFileSync uses atomic writes
            // via GLib.file_set_contents which may report a temp filename — any string is valid)
            expect(typeof filename === 'string' || filename === null).toBe(true);
            rmSync(tmp, { recursive: true, force: true });
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
            rmSync(tmp, { recursive: true, force: true });
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
            rmSync(tmp, { recursive: true, force: true });
        });

        await it('multiple events can be collected before abort', async () => {
            const tmp = makeTmp();
            const ac = new AbortController();
            const events: string[] = [];

            const timer = setTimeout(() => {
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
            } finally {
                clearTimeout(timer);
            }

            expect(events.length).toBeGreaterThan(0);
            rmSync(tmp, { recursive: true, force: true });
        });
    });
};
