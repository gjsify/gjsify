// What GIO's file-monitor backend actually DELIVERS, measured rather than assumed.
//
// `watch-recursive.spec.ts` measures what `@gjsify/fs` reports. This measures the
// layer beneath it, through a raw `Gio.FileMonitor` with none of our mapping in the
// way, because a failure up there cannot tell "the backend delivered nothing" from
// "the backend delivered something we discarded" — different bugs, different fixes.
// On the darwin GJS leg they were indistinguishable: four rows failed with
// `Expected: true, Actual: false` while every create and delete row beside them
// passed, which is consistent with both readings and proves neither.
//
// GLib chooses the backend per platform: inotify on Linux, GKqueueFileMonitor on
// darwin, GWin32FileMonitor on Windows. GIO promises nothing uniform across them,
// and CHANGES_DONE_HINT is documented as exactly that — "a hint that this was
// probably the last change in a set of changes" — so treating it as the only route
// to "this file changed" is a promise GIO never made.
//
// The `.gjs.spec.ts` suffix is load-bearing, not cosmetic: `audit-runtimes.mjs`
// skips it precisely because specs are allowed to exercise GJS-only paths, and the
// GI modules load at runtime rather than through a static `@girs/*` import so the
// `--app node` bundle stays clean.

import { describe, expect, it, on, print } from '@gjsify/unit';
import { isDarwin } from '@gjsify/utils/core';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface GioFile {
    get_path(): string | null;
}
interface GioMonitor {
    connect(signal: string, cb: (m: unknown, f: GioFile, other: GioFile | null, ev: number) => void): number;
    cancel(): boolean;
}
interface GioModule {
    File: { new_for_path(path: string): { monitor(flags: number, cancellable: null): GioMonitor } };
    FileMonitorFlags: { NONE: number };
    FileMonitorEvent: Record<string, number>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to let the backend deliver. Generous: kqueue and inotify differ in latency. */
const SETTLE_MS = 1200;

export default async () => {
    await on('Gjs', async () => {
        await describe('Gio.FileMonitor — what this host delivers', async () => {
            const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioModule;

            /** `CHANGED` for 2, and so on — the enum read backwards, so a dump is legible. */
            const eventNames = new Map<number, string>();
            for (const [name, value] of Object.entries(Gio.FileMonitorEvent)) {
                if (typeof value === 'number' && !eventNames.has(value)) eventNames.set(value, name);
            }

            /**
             * Monitor `dir`, run `act`, and return one `(event, path, monitored)` triple
             * per signal. The triples are the whole point: a failure has to say what the
             * backend sent, or the next reader is back to guessing from a boolean.
             */
            async function record(dir: string, act: () => void): Promise<string[]> {
                const seen: string[] = [];
                const monitor = Gio.File.new_for_path(dir).monitor(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', (_m, file, _other, ev) => {
                    const name = eventNames.get(ev) ?? `UNKNOWN(${ev})`;
                    seen.push(`${name} path=${file?.get_path() ?? 'null'} monitored=${dir}`);
                });
                await sleep(60);
                act();
                await sleep(SETTLE_MS);
                monitor.cancel();
                return seen;
            }

            const dump = (seen: string[]): string => (seen.length === 0 ? '(no events at all)' : seen.join(' | '));

            const CHANGE_EVENTS = ['CHANGED', 'CHANGES_DONE_HINT'];
            const isChange = (triple: string): boolean => CHANGE_EVENTS.some((n) => triple.startsWith(`${n} `));

            await it('reports a child being CREATED in a monitored directory', async () => {
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                try {
                    const seen = await record(tmp, () => {
                        writeFileSync(join(tmp, 'fresh.txt'), 'x');
                    });
                    // The in-suite control: if this host raises nothing even for a create,
                    // the two rows below are measuring a dead monitor, not a backend.
                    expect(seen.length > 0 ? '' : 'the monitor raised nothing for a create').toBe('');
                } finally {
                    rmSync(tmp, { recursive: true, force: true });
                }
            });

            await it.failing(
                'reports a child being MODIFIED in a monitored directory',
                async () => {
                    const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                    const child = join(tmp, 'existing.txt');
                    writeFileSync(child, 'one');
                    try {
                        const seen = await record(tmp, () => {
                            writeFileSync(child, 'two');
                        });
                        // This is the event `fs.watch`'s 'change' is built from, and the one
                        // the darwin failures all have in common.
                        const changes = seen.filter(isChange);
                        expect(changes.length > 0 ? '' : `no ${CHANGE_EVENTS.join('/')}; raw: ${dump(seen)}`).toBe('');
                        // And it has to NAME the child. A backend that reports the monitored
                        // directory instead leaves `relative(root, path)` empty, which is the
                        // shape that would break the recursive filenames without breaking the
                        // event count.
                        expect(
                            changes.some((t) => t.includes(`path=${child} `))
                                ? ''
                                : `named no child; raw: ${dump(seen)}`,
                        ).toBe('');
                    } finally {
                        rmSync(tmp, { recursive: true, force: true });
                    }
                },
                'GLib serves g_file_monitor() from kqueue on darwin, and a directory vnode raises ' +
                    'NOTE_WRITE when an entry is ADDED or REMOVED — not when a write lands inside an ' +
                    'existing child. The FILE-monitor row below proves the same host reports that write ' +
                    'through a monitor on the file, which is what watch-tree.ts fans out to. Declared ' +
                    'rather than guarded so the row still RUNS here and fails the day the backend ' +
                    'starts delivering.',
                { when: isDarwin() },
            );

            await it.failing(
                'reports a child MODIFIED in a monitored SUBdirectory',
                async () => {
                    // The per-directory monitor recursion is built from: if this row is the
                    // one that fails, the recursion is sound and its leaves are not.
                    const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                    const sub = join(tmp, 'sub');
                    mkdirSync(sub, { recursive: true });
                    const child = join(sub, 'nested.txt');
                    writeFileSync(child, 'one');
                    try {
                        const seen = await record(sub, () => {
                            writeFileSync(child, 'two');
                        });
                        const changes = seen.filter(isChange);
                        expect(changes.length > 0 ? '' : `no ${CHANGE_EVENTS.join('/')}; raw: ${dump(seen)}`).toBe('');
                        expect(
                            changes.some((t) => t.includes(`path=${child} `))
                                ? ''
                                : `named no child; raw: ${dump(seen)}`,
                        ).toBe('');
                    } finally {
                        rmSync(tmp, { recursive: true, force: true });
                    }
                },
                'GLib serves g_file_monitor() from kqueue on darwin, and a directory vnode raises ' +
                    'NOTE_WRITE when an entry is ADDED or REMOVED — not when a write lands inside an ' +
                    'existing child. The FILE-monitor row below proves the same host reports that write ' +
                    'through a monitor on the file, which is what watch-tree.ts fans out to. Declared ' +
                    'rather than guarded so the row still RUNS here and fails the day the backend ' +
                    'starts delivering.',
                { when: isDarwin() },
            );

            await it('reports a MODIFY when the monitor is on the FILE itself', async () => {
                // THE ROW THAT DECIDES THE FIX, which is why it is separated from the two
                // above rather than folded into them.
                //
                // Those two monitor a DIRECTORY and ask whether a write to a child is
                // reported. This one monitors the file. `g_file_monitor()` picks a file or
                // a directory monitor from what the path IS, so these are two different
                // backend paths, and on darwin they may not agree: kqueue raises
                // `NOTE_WRITE` on a directory vnode when an entry is added or removed, not
                // when a write lands inside an existing child — while a watch on the child
                // itself has that child's own vnode to raise on.
                //
                // What the answer buys, in the two directions:
                //  - DELIVERS  → recursive watching on darwin is a per-FILE monitor
                //    fan-out. Bounded, priceable (one monitor per file rather than per
                //    directory), and a real implementation rather than a workaround.
                //  - SILENT    → GIO on this host cannot report a modification through any
                //    monitor shape, and no amount of fan-out fixes that. Then the honest
                //    ending is a declared `gjsify.os.darwin: "partial"` with a printed
                //    reason, not a quieter test.
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                const child = join(tmp, 'watched-directly.txt');
                writeFileSync(child, 'one');
                try {
                    const seen = await record(child, () => {
                        writeFileSync(child, 'two');
                    });
                    const changes = seen.filter(isChange);
                    expect(
                        changes.length > 0
                            ? ''
                            : `a monitor ON THE FILE raised no ${CHANGE_EVENTS.join('/')} for a write to it; ` +
                                  `raw: ${dump(seen)}`,
                    ).toBe('');
                } finally {
                    rmSync(tmp, { recursive: true, force: true });
                }
            });

            await it('records what an atomic same-name REPLACE delivers', async () => {
                // AN OPEN QUESTION, RECORDED RATHER THAN ASSERTED — both answers are
                // plausible and only the host can say which is true.
                //
                // Editors do not write in place. They write a temp file and rename it
                // over the target, so the watched path keeps its NAME and gains a new
                // inode. Two monitors can miss that in two different ways: a directory
                // monitor that reports entries appearing and disappearing has no name
                // change to report, and a file monitor bound to the old inode may go
                // DELETED and stop. `writeFileSync` is not this shape — it opens the
                // path O_TRUNC and writes in place, which is why the rows above measure
                // the write and this one has to stage the rename itself.
                //
                // What the answer buys: if BOTH sides stay silent on darwin, the fan-out
                // in `watch-tree.ts` has to re-arm a file monitor on DELETED, or a
                // `gjsify dev` loop on macOS stops seeing a file after the first save in
                // any editor that saves this way. If either side reports it, it does not.
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                const target = join(tmp, 'target.txt');
                const staged = join(tmp, 'target.txt.tmp');
                writeFileSync(target, 'one');
                const onDir: string[] = [];
                const onFile: string[] = [];
                const dirMonitor = Gio.File.new_for_path(tmp).monitor(Gio.FileMonitorFlags.NONE, null);
                const fileMonitor = Gio.File.new_for_path(target).monitor(Gio.FileMonitorFlags.NONE, null);
                dirMonitor.connect('changed', (_m, file, _other, ev) => {
                    onDir.push(`${eventNames.get(ev) ?? `UNKNOWN(${ev})`} path=${file?.get_path() ?? 'null'}`);
                });
                fileMonitor.connect('changed', (_m, file, _other, ev) => {
                    onFile.push(`${eventNames.get(ev) ?? `UNKNOWN(${ev})`} path=${file?.get_path() ?? 'null'}`);
                });
                try {
                    await sleep(60);
                    writeFileSync(staged, 'two');
                    await sleep(SETTLE_MS);
                    // The liveness control, and the reason the staging write is a separate
                    // step: a create IS delivered on every backend measured here, so a
                    // directory monitor that reports nothing for it is not a finding about
                    // renames — it is a dead monitor, and the print below would be noise.
                    expect(onDir.length > 0 ? '' : 'the directory monitor raised nothing for a create').toBe('');
                    onDir.length = 0;
                    onFile.length = 0;

                    renameSync(staged, target);
                    await sleep(SETTLE_MS);
                    print(`    ↳ replace, seen by the DIRECTORY monitor: ${dump(onDir)}`);
                    print(`    ↳ replace, seen by the FILE monitor:      ${dump(onFile)}`);
                } finally {
                    dirMonitor.cancel();
                    fileMonitor.cancel();
                    rmSync(tmp, { recursive: true, force: true });
                }
            });
        });
    });
};
